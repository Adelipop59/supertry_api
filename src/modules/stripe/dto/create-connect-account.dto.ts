import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ConnectAccountType {
  EXPRESS = 'express',
  STANDARD = 'standard',
}

export class CreateConnectAccountDto {
  @ApiProperty({
    description: 'Adresse email associée au compte Connect Stripe',
    example: 'testeur@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Code pays ISO 3166-1 alpha-2 du compte',
    example: 'FR',
  })
  @IsString()
  country: string;

  @ApiPropertyOptional({
    description: 'Type de compte Connect Stripe',
    enum: ConnectAccountType,
    default: ConnectAccountType.EXPRESS,
    example: 'express',
  })
  @IsEnum(ConnectAccountType)
  @IsOptional()
  type?: ConnectAccountType = ConnectAccountType.EXPRESS;
}
