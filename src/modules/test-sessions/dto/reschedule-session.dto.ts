import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RescheduleSessionDto {
  @ApiProperty({
    description:
      'ID de la distribution (date) nouvellement choisie par le testeur.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  distributionId: string;
}
