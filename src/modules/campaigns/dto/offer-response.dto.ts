export class OfferResponseDto {
  id: string;
  campaignId: string;
  productId: string;
  productName: string;
  expectedPrice: number;
  shippingCost: number;
  priceRangeMin: number;
  priceRangeMax: number;
  isPriceRevealed: boolean;
  reimbursedPrice: boolean;
  reimbursedShipping: boolean;
  maxReimbursedPrice?: number;
  maxReimbursedShipping?: number;
  bonus: number;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}
