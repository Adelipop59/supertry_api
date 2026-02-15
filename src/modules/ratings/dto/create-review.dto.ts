import { IsNotEmpty, IsUUID, IsInt, Min, Max, IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

export class CreateReviewDto {
  @IsNotEmpty()
  @IsUUID()
  sessionId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  productRating: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  sellerRating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
