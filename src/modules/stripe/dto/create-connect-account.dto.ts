import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export enum ConnectAccountType {
  EXPRESS = 'express',
  STANDARD = 'standard',
}

export class CreateConnectAccountDto {
  @IsEmail()
  email: string;

  @IsString()
  country: string;

  @IsEnum(ConnectAccountType)
  @IsOptional()
  type?: ConnectAccountType = ConnectAccountType.EXPRESS;
}
