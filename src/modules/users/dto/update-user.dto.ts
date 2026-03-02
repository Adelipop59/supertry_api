import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jean' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Dupont' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Téléphone au format international E.164', example: '+33612345678' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Le numéro de téléphone doit être au format international (ex: +33612345678)',
  })
  phone?: string;

  @ApiPropertyOptional({ description: 'Date de naissance (format ISO)', example: '1995-06-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: 'FCM device token for push notifications' })
  @IsOptional()
  @IsString()
  deviceToken?: string;
}
