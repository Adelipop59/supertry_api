import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { LuciaService } from '../lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';
import { MessagesService } from './messages.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(
    private readonly luciaService: LuciaService,
    private readonly prismaService: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  async afterInit(server: Server) {
    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = process.env.REDIS_PORT || '6379';
      const redisPassword = process.env.REDIS_PASSWORD || undefined;

      const pubClient = createClient({
        url: `redis://${redisHost}:${redisPort}`,
        password: redisPassword,
      });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      server.adapter(createAdapter(pubClient, subClient) as any);
      this.logger.log('Socket.io Redis adapter initialized');
    } catch (error) {
      this.logger.warn(
        'Redis adapter failed to initialize, running without adapter: ' +
          error.message,
      );
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const result = await this.luciaService.validateSession(token);
      if (!result.session || !result.user) {
        client.disconnect();
        return;
      }

      const profile = await this.prismaService.profile.findUnique({
        where: { id: result.user.id },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      });

      if (!profile || !profile.isActive) {
        client.disconnect();
        return;
      }

      (client as any).userId = profile.id;
      (client as any).userRole = profile.role;
      (client as any).userName =
        `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();

      // Auto-join personal room for global notifications (new_message, typing, read receipts)
      client.join(`user:${profile.id}`);

      this.logger.log(`Client connected: ${profile.id} (${profile.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      this.logger.log(`Client disconnected: ${userId}`);
    }
  }

  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const userId = (client as any).userId;
    const userRole = (client as any).userRole;
    if (!userId) return { success: false, error: 'Not authenticated' };

    try {
      await this.messagesService.validateAccess(
        data.sessionId,
        userId,
        userRole,
      );
      client.join(`session:${data.sessionId}`);
      await this.messagesService.markAsRead(data.sessionId, userId);
      this.logger.log(`User ${userId} joined session:${data.sessionId}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('leave_session')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.leave(`session:${data.sessionId}`);
    return { success: true };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      sessionId: string;
      content: string;
      attachments?: any;
      messageType?: string;
    },
  ) {
    const userId = (client as any).userId;
    const userRole = (client as any).userRole;
    if (!userId) return { success: false, error: 'Not authenticated' };

    try {
      await this.messagesService.validateAccess(
        data.sessionId,
        userId,
        userRole,
      );

      const message = await this.messagesService.createMessage(
        {
          sessionId: data.sessionId,
          content: data.content,
          attachments: data.attachments,
          messageType: data.messageType,
        },
        userId,
      );

      // Broadcast to session room (for users with the conversation open)
      this.server
        .to(`session:${data.sessionId}`)
        .emit('new_message', message);

      // Broadcast to personal rooms of all participants (for conversation list updates)
      const participantIds =
        await this.messagesService.getSessionParticipantIds(data.sessionId);
      for (const pid of participantIds) {
        this.server.to(`user:${pid}`).emit('new_message', message);
      }

      return { success: true, message };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const userId = (client as any).userId;
    if (!userId) return { success: false };

    try {
      await this.messagesService.markAsRead(data.sessionId, userId);
      const payload = {
        sessionId: data.sessionId,
        readBy: userId,
      };

      // Broadcast to session room (for the open chat view)
      client.to(`session:${data.sessionId}`).emit('messages_read', payload);

      // Broadcast to personal rooms of participants (for conversation list read receipts)
      const participantIds =
        await this.messagesService.getSessionParticipantIds(data.sessionId);
      for (const pid of participantIds) {
        if (pid !== userId) {
          this.server.to(`user:${pid}`).emit('messages_read', payload);
        }
      }

      return { success: true };
    } catch {
      return { success: false };
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; isTyping: boolean },
  ) {
    const userId = (client as any).userId;
    const userName = (client as any).userName;
    const payload = {
      userId,
      userName,
      sessionId: data.sessionId,
      isTyping: data.isTyping,
    };

    // Broadcast to session room (for the open chat view)
    client.to(`session:${data.sessionId}`).emit('user_typing', payload);

    // Broadcast to personal rooms of participants (for conversation list)
    const participantIds =
      await this.messagesService.getSessionParticipantIds(data.sessionId);
    for (const pid of participantIds) {
      if (pid !== userId) {
        this.server.to(`user:${pid}`).emit('user_typing', payload);
      }
    }
  }

  emitToSession(sessionId: string, event: string, data: any) {
    this.server.to(`session:${sessionId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
