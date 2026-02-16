import { ApiProperty } from '@nestjs/swagger';

export class RevenueBreakdownItemDto {
  @ApiProperty() type: string;
  @ApiProperty() total: number;
  @ApiProperty() count: number;
}

export class RevenuePeriodDto {
  @ApiProperty() period: string;
  @ApiProperty({ type: [RevenueBreakdownItemDto] })
  breakdown: RevenueBreakdownItemDto[];
  @ApiProperty() total: number;
}

export class RevenueResponseDto {
  @ApiProperty({ type: [RevenuePeriodDto] })
  periods: RevenuePeriodDto[];

  @ApiProperty()
  grandTotal: number;
}
