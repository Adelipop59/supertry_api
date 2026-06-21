import { IsEmail, IsEnum, IsISO31661Alpha2, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ConnectAccountType {
  EXPRESS = 'express',
  STANDARD = 'standard',
}

export class CreateConnectAccountDto {
  // NOTE SÉCURITÉ : email et country sont désormais IGNORÉS côté serveur et dérivés
  // du profil authentifié (cf. StripeController.createConnectAccount). Ils restent
  // acceptés (optionnels) pour compatibilité ascendante, mais ne sont pas utilisés
  // pour créer le compte Connect afin de préserver l'intégrité du KYC.
  @ApiPropertyOptional({
    description: 'DEPRECATED — ignoré, l’email est pris depuis le profil serveur',
    example: 'testeur@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'DEPRECATED — ignoré, le pays est pris depuis le profil serveur (ISO 3166-1 alpha-2)',
    example: 'FR',
  })
  @IsISO31661Alpha2()
  @IsOptional()
  country?: string;

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
