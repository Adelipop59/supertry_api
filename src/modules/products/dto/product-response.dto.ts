export class ProductResponseDto {
  id: string;
  sellerId: string;
  seller: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    avatar?: string;
  };
  categoryId: string;
  category: {
    id: string;
    name: string;
    slug: string;
  };
  name: string;
  description: string;
  asin?: string;
  productUrl?: string;
  price: number;
  shippingCost: number;
  images: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
