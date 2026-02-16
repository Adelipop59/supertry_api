import { ApiProperty } from '@nestjs/swagger';

export class PlatformWalletDto {
  @ApiProperty() escrowBalance: number;
  @ApiProperty() commissionBalance: number;
  @ApiProperty() totalReceived: number;
  @ApiProperty() totalTransferred: number;
  @ApiProperty() totalCommissions: number;
}

export class CommissionBreakdownItemDto {
  @ApiProperty() type: string;
  @ApiProperty() total: number;
  @ApiProperty() count: number;
}

export class PeriodStatsDto {
  @ApiProperty() period: string;
  @ApiProperty() totalAmount: number;
  @ApiProperty() transactionCount: number;
}

export class PendingWithdrawalsDto {
  @ApiProperty() amount: number;
  @ApiProperty() count: number;
}

export class DashboardResponseDto {
  @ApiProperty({ type: PlatformWalletDto })
  platformWallet: PlatformWalletDto;

  @ApiProperty({ type: PeriodStatsDto })
  periodStats: PeriodStatsDto;

  @ApiProperty({ type: [CommissionBreakdownItemDto] })
  commissionBreakdown: CommissionBreakdownItemDto[];

  @ApiProperty()
  activeCampaigns: number;

  @ApiProperty({ type: PendingWithdrawalsDto })
  pendingWithdrawals: PendingWithdrawalsDto;
}
