import { ApiProperty } from '@nestjs/swagger';

export class CampaignInfoDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() status: string;
  @ApiProperty() totalSlots: number;
  @ApiProperty() sellerId: string;
  @ApiProperty() sellerEmail: string;
}

export class CampaignFinancialDto {
  @ApiProperty() totalPaid: number;
  @ApiProperty() totalRefunded: number;
  @ApiProperty() totalRewarded: number;
  @ApiProperty() totalCommissions: number;
  @ApiProperty() totalCompensations: number;
  @ApiProperty() escrowRemaining: number;
}

export class CampaignTransactionDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() amount: number;
  @ApiProperty() reason: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ required: false }) stripeId?: string;
}

export class CampaignPnlDto {
  @ApiProperty() revenue: number;
  @ApiProperty() costs: number;
  @ApiProperty() netProfit: number;
}

export class CampaignBreakdownResponseDto {
  @ApiProperty({ type: CampaignInfoDto })
  campaign: CampaignInfoDto;

  @ApiProperty({ type: CampaignFinancialDto })
  financial: CampaignFinancialDto;

  @ApiProperty({ type: [CampaignTransactionDto] })
  transactions: CampaignTransactionDto[];

  @ApiProperty({ type: CampaignPnlDto })
  pnl: CampaignPnlDto;
}
