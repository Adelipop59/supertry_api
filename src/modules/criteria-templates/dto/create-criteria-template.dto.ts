import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCriteriaTemplateDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  maxAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  maxRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCompletedSessions?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredGender?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCountries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredLocations?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedLocations?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCategories?: string[];

  @IsOptional()
  @IsBoolean()
  noActiveSessionWithSeller?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerWeek?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSessionsPerMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minCompletionRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxCancellationRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAccountAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastActiveWithinDays?: number;

  @IsOptional()
  @IsBoolean()
  requireVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  requirePrime?: boolean;
}
