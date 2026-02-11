import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  ValidateIf,
  Length,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum UserRole {
  USER = 'USER',
  PRO = 'PRO',
  ADMIN = 'ADMIN',
}

export class SignupDto {
  @ApiProperty({ description: 'Adresse email', example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Mot de passe (min 6 caractères)',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @ApiProperty({
    description: "Rôle de l'utilisateur",
    enum: UserRole,
    required: false,
    default: UserRole.USER,
  })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({
    description: 'Prénom (obligatoire pour PRO)',
    required: false,
    example: 'Jean',
  })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsString()
  @MinLength(2)
  @ValidateIf((o) => o.role !== UserRole.PRO)
  @IsOptional()
  firstName?: string;

  @ApiProperty({
    description: 'Nom (obligatoire pour PRO)',
    required: false,
    example: 'Dupont',
  })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsString()
  @MinLength(2)
  @ValidateIf((o) => o.role !== UserRole.PRO)
  @IsOptional()
  lastName?: string;

  @ApiProperty({
    description: 'Numéro de téléphone',
    required: false,
    example: '+33612345678',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: "Nom de l'entreprise",
    required: false,
    example: 'ACME Corp',
  })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiProperty({
    description: 'Numéro SIRET (pour PRO)',
    required: false,
    example: '12345678901234',
  })
  @IsString()
  @IsOptional()
  siret?: string;

  @ApiProperty({
    description: 'Code pays ISO (obligatoire pour USER)',
    required: false,
    example: 'FR',
  })
  @ValidateIf((o) => !o.role || o.role === UserRole.USER)
  @IsString()
  @Length(2, 2)
  @IsOptional()
  country?: string;

  @ApiProperty({
    description: 'Codes pays ISO (obligatoire pour PRO, min 1)',
    required: false,
    example: ['FR', 'DE', 'BE'],
    type: [String],
  })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  countries?: string[];
}

export class LoginDto {
  @ApiProperty({ description: 'Adresse email', example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'Mot de passe', example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

class ProfileInAuthResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ required: false }) firstName?: string;
  @ApiProperty({ required: false }) lastName?: string;
  @ApiProperty({ required: false }) phone?: string;
  @ApiProperty({ required: false }) companyName?: string;
  @ApiProperty({ required: false }) siret?: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AuthResponseDto {
  @ApiProperty({ description: "Token de session" })
  access_token!: string;

  @ApiProperty({ description: "Token de rafraîchissement" })
  refresh_token!: string;

  @ApiProperty({ description: "Type de token", example: 'bearer' })
  token_type!: string;

  @ApiProperty({ description: "Durée de validité (secondes)", example: 2592000 })
  expires_in!: number;

  @ApiProperty({ description: "Profil utilisateur", type: ProfileInAuthResponse })
  profile!: ProfileInAuthResponse;
}

export class RefreshTokenResponseDto {
  @ApiProperty({ description: "Token de session" })
  access_token!: string;

  @ApiProperty({ description: "Type de token", example: 'bearer' })
  token_type!: string;

  @ApiProperty({ description: "Durée de validité (secondes)", example: 2592000 })
  expires_in!: number;
}

export class MessageResponseDto {
  @ApiProperty({ description: 'Message', example: 'Opération réussie' })
  message!: string;
}

export class OAuthUrlResponseDto {
  @ApiProperty({
    description: 'URL de redirection OAuth',
    example: 'https://accounts.google.com/o/oauth2/v2/auth?...',
  })
  url!: string;

  @ApiProperty({
    description: 'Provider OAuth',
    example: 'google',
    enum: ['google', 'github', 'azure'],
  })
  provider!: string;

  @ApiProperty({
    description: 'État CSRF',
    example: 'a1b2c3d4e5f6...',
    required: false,
  })
  state?: string;
}

export class CheckEmailDto {
  @ApiProperty({ description: 'Adresse email', example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class CheckEmailResponseDto {
  @ApiProperty({ description: "Si l'email existe", example: true })
  exists!: boolean;

  @ApiProperty({ description: 'Email vérifié', example: 'user@example.com' })
  email!: string;

  @ApiProperty({
    description: "Rôle si existe",
    enum: ['USER', 'PRO', 'ADMIN'],
    required: false,
  })
  role?: string;
}

export class CompleteOnboardingDto {
  @ApiProperty({ description: "Rôle", enum: UserRole, example: UserRole.USER })
  @IsEnum(UserRole)
  @IsNotEmpty()
  role!: UserRole;

  @ApiProperty({ description: 'Prénom', required: false })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsString()
  @MinLength(2)
  @ValidateIf((o) => o.role !== UserRole.PRO)
  @IsOptional()
  firstName?: string;

  @ApiProperty({ description: 'Nom', required: false })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsString()
  @MinLength(2)
  @ValidateIf((o) => o.role !== UserRole.PRO)
  @IsOptional()
  lastName?: string;

  @ApiProperty({ description: 'Téléphone', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: "Nom de l'entreprise", required: false })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiProperty({ description: 'SIRET', required: false })
  @IsString()
  @IsOptional()
  siret?: string;

  @ApiProperty({ description: 'Code pays (obligatoire USER)', required: false })
  @ValidateIf((o) => o.role === UserRole.USER)
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiProperty({
    description: 'Codes pays (obligatoire PRO)',
    required: false,
    type: [String],
  })
  @ValidateIf((o) => o.role === UserRole.PRO)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  countries?: string[];
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Ancien mot de passe' })
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

  @ApiProperty({ description: 'Nouveau mot de passe (min 6)', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword!: string;
}
