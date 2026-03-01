import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SessionStatus, UserRole } from '@prisma/client';
import { CreateMessageDto } from './dto/create-message.dto';

const CHAT_ALLOWED_STATUSES: SessionStatus[] = [
  SessionStatus.ACCEPTED,
  SessionStatus.PRICE_VALIDATED,
  SessionStatus.PURCHASE_SUBMITTED,
  SessionStatus.PURCHASE_VALIDATED,
  SessionStatus.IN_PROGRESS,
  SessionStatus.PROCEDURES_COMPLETED,
  SessionStatus.SUBMITTED,
  SessionStatus.COMPLETED,
];

const SENDER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatar: true,
  role: true,
};

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async validateAccess(
    sessionId: string,
    userId: string,
    userRole?: string,
  ) {
    // Admin can access any session
    if (userRole === UserRole.ADMIN) {
      const session = await this.prisma.testSession.findUnique({
        where: { id: sessionId },
        include: { campaign: { select: { sellerId: true } } },
      });
      if (!session) {
        throw new BadRequestException('Session not found');
      }
      return { session, isTester: false, isPro: false, isAdmin: true };
    }

    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      include: { campaign: { select: { sellerId: true } } },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    const isTester = session.testerId === userId;
    const isPro = session.campaign.sellerId === userId;

    if (!isTester && !isPro) {
      throw new ForbiddenException(
        'You are not a participant of this session',
      );
    }

    if (!CHAT_ALLOWED_STATUSES.includes(session.status)) {
      throw new BadRequestException(
        'Chat is not available for this session status',
      );
    }

    return { session, isTester, isPro, isAdmin: false };
  }

  async createMessage(dto: CreateMessageDto, senderId: string) {
    return this.prisma.message.create({
      data: {
        sessionId: dto.sessionId,
        senderId,
        content: dto.content,
        attachments: dto.attachments ?? undefined,
        messageType: dto.messageType ?? 'TEXT',
        isSystemMessage: false,
      },
      include: { sender: { select: SENDER_SELECT } },
    });
  }

  async createSystemMessage(sessionId: string, content: string) {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      select: { testerId: true },
    });
    if (!session) return null;

    return this.prisma.message.create({
      data: {
        sessionId,
        senderId: session.testerId,
        content,
        messageType: 'SYSTEM',
        isSystemMessage: true,
      },
      include: { sender: { select: SENDER_SELECT } },
    });
  }

  async getMessages(
    sessionId: string,
    cursor?: string,
    limit: number = 50,
  ) {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      include: { sender: { select: SENDER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return messages.reverse();
  }

  async markAsRead(sessionId: string, userId: string) {
    await this.prisma.message.updateMany({
      where: {
        sessionId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async getUnreadCounts(
    userId: string,
  ): Promise<{ sessionId: string; count: number }[]> {
    const sessions = await this.prisma.testSession.findMany({
      where: {
        OR: [
          { testerId: userId },
          { campaign: { sellerId: userId } },
        ],
        status: { in: CHAT_ALLOWED_STATUSES },
      },
      select: { id: true },
    });

    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) return [];

    const counts = await this.prisma.message.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: sessionIds },
        senderId: { not: userId },
        isRead: false,
      },
      _count: true,
    });

    return counts.map((c) => ({ sessionId: c.sessionId, count: c._count }));
  }

  async getSessionParticipantIds(sessionId: string): Promise<string[]> {
    const session = await this.prisma.testSession.findUnique({
      where: { id: sessionId },
      select: {
        testerId: true,
        campaign: { select: { sellerId: true } },
      },
    });
    if (!session) return [];
    return [session.testerId, session.campaign.sellerId];
  }

  async getConversations(userId: string, userRole: string) {
    const where =
      userRole === UserRole.ADMIN
        ? {
            status: { in: CHAT_ALLOWED_STATUSES },
            messages: { some: {} },
          }
        : {
            OR: [
              { testerId: userId },
              { campaign: { sellerId: userId } },
            ],
            status: { in: CHAT_ALLOWED_STATUSES },
            messages: { some: {} },
          };

    const sessions = await this.prisma.testSession.findMany({
      where,
      include: {
        campaign: { select: { id: true, title: true } },
        tester: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return sessions.map((s) => ({
      sessionId: s.id,
      campaignTitle: s.campaign.title,
      tester: s.tester,
      lastMessage: s.messages[0] ?? null,
    }));
  }
}
