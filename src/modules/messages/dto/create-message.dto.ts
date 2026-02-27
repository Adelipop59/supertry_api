import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMessageDto {
  @ApiProperty({ description: 'ID de la session de test' })
  @IsString()
  sessionId: string;

  @ApiProperty({ description: 'Contenu du message', maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ description: 'Pièces jointes (JSON)' })
  @IsOptional()
  attachments?: any;

  @ApiPropertyOptional({
    description: 'Type de message',
    default: 'TEXT',
    enum: ['TEXT', 'IMAGE', 'FILE'],
  })
  @IsOptional()
  @IsString()
  messageType?: string;
}
