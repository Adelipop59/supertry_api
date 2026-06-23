import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { WsTicketService } from '../../common/services/ws-ticket.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway, WsTicketService],
  exports: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
