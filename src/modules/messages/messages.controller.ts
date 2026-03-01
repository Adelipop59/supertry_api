import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { CreateMessageDto } from './dto/create-message.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Messages')
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly messagesGateway: MessagesGateway,
  ) {}

  @Get('conversations')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Lister les conversations' })
  async getConversations(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.messagesService.getConversations(userId, userRole);
  }

  @Get('unread-counts')
  @Roles(UserRole.USER, UserRole.PRO)
  @ApiOperation({ summary: 'Nombre de messages non lus par session' })
  async getUnreadCounts(@CurrentUser('id') userId: string) {
    return this.messagesService.getUnreadCounts(userId);
  }

  @Get(':sessionId')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Récupérer les messages d\'une session' })
  async getMessages(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.messagesService.validateAccess(sessionId, userId, userRole);
    return this.messagesService.getMessages(
      sessionId,
      cursor,
      parseInt(limit ?? '50'),
    );
  }

  @Post()
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Envoyer un message' })
  async sendMessage(
    @Body() dto: CreateMessageDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    await this.messagesService.validateAccess(
      dto.sessionId,
      userId,
      userRole,
    );
    const message = await this.messagesService.createMessage(dto, userId);
    this.messagesGateway.emitToSession(dto.sessionId, 'new_message', message);
    return message;
  }

  @Post(':sessionId/read')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer les messages comme lus' })
  async markAsRead(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.messagesService.markAsRead(sessionId, userId);
    return { success: true };
  }
}
