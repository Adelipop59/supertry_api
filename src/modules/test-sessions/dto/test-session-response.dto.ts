import { SessionStatus, CampaignMarketplaceMode } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStepProgressResponseDto } from './session-step-progress-response.dto';

export class TestSessionResponseDto {
  @ApiProperty({
    description: 'Identifiant unique de la session de test',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  id: string;

  @ApiProperty({
    description: 'Identifiant de la campagne associée',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  campaignId: string;

  @ApiProperty({
    description: 'Informations sur la campagne associée',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test Samsung Galaxy S24',
      marketplaceMode: 'AMAZON',
      seller: { id: '550e8400-e29b-41d4-a716-446655440050', firstName: 'Jean', lastName: 'Dupont' },
    },
  })
  campaign: {
    id: string;
    title: string;
    marketplaceMode: CampaignMarketplaceMode;
    seller: {
      id: string;
      firstName: string;
      lastName: string;
    };
  };

  @ApiProperty({
    description: 'Identifiant du testeur',
    example: '550e8400-e29b-41d4-a716-446655440060',
  })
  testerId: string;

  @ApiProperty({
    description: 'Informations sur le testeur',
    example: {
      id: '550e8400-e29b-41d4-a716-446655440060',
      firstName: 'Marie',
      lastName: 'Martin',
      avatar: 'https://example.com/avatar.jpg',
    },
  })
  tester: {
    id: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  };

  @ApiProperty({
    description: 'Statut actuel de la session de test',
    example: 'IN_PROGRESS',
    enum: SessionStatus,
  })
  status: SessionStatus;

  // Application
  @ApiPropertyOptional({
    description: 'Message de candidature du testeur',
    example: 'Je suis très intéressé par ce produit',
  })
  applicationMessage?: string;

  @ApiProperty({
    description: 'Date de candidature du testeur',
    example: '2026-03-01T10:00:00.000Z',
  })
  appliedAt: Date;

  // Acceptance
  @ApiPropertyOptional({
    description: 'Date d\'acceptation de la candidature',
    example: '2026-03-02T14:00:00.000Z',
  })
  acceptedAt?: Date;

  @ApiPropertyOptional({
    description: 'Date de rejet de la candidature',
    example: '2026-03-02T14:00:00.000Z',
  })
  rejectedAt?: Date;

  @ApiPropertyOptional({
    description: 'Raison du rejet de la candidature',
    example: 'Profil ne correspondant pas aux critères',
  })
  rejectionReason?: string;

  // Purchase
  @ApiPropertyOptional({
    description: 'Date d\'achat programmée',
    example: '2026-03-15T00:00:00.000Z',
  })
  scheduledPurchaseDate?: Date;

  @ApiPropertyOptional({
    description: 'Prix du produit validé',
    example: 29.99,
  })
  validatedProductPrice?: number;

  @ApiPropertyOptional({
    description: 'Date de validation du prix',
    example: '2026-03-05T10:00:00.000Z',
  })
  priceValidatedAt?: Date;

  @ApiProperty({
    description: 'Nombre de tentatives de validation du prix',
    example: 1,
  })
  priceValidationAttempts: number;

  @ApiPropertyOptional({
    description: 'Titre du produit soumis par le testeur',
    example: 'Samsung Galaxy S24 Ultra 256Go',
  })
  productTitleSubmitted?: string;

  @ApiPropertyOptional({
    description: 'Numéro de commande',
    example: 'AMZ-123-456-789',
  })
  orderNumber?: string;

  @ApiPropertyOptional({
    description: 'Prix du produit (en euros)',
    example: 29.99,
  })
  productPrice?: number;

  @ApiPropertyOptional({
    description: 'Frais de livraison (en euros)',
    example: 4.99,
  })
  shippingCost?: number;

  @ApiPropertyOptional({
    description: 'URL de la preuve d\'achat',
    example: 'https://example.com/proof.jpg',
  })
  purchaseProofUrl?: string;

  @ApiPropertyOptional({
    description: 'Date de l\'achat',
    example: '2026-03-10T16:00:00.000Z',
  })
  purchasedAt?: Date;

  @ApiPropertyOptional({
    description: 'Date de validation du numéro de commande',
    example: '2026-03-10T17:00:00.000Z',
  })
  orderNumberValidatedAt?: Date;

  // Purchase validation (PRO)
  @ApiPropertyOptional({
    description: 'Date de validation de l\'achat par le vendeur',
    example: '2026-03-11T09:00:00.000Z',
  })
  purchaseValidatedAt?: Date;

  @ApiPropertyOptional({
    description: 'Commentaire de validation de l\'achat',
    example: 'Achat validé, les montants sont corrects',
  })
  purchaseValidationComment?: string;

  @ApiPropertyOptional({
    description: 'Date de rejet de l\'achat par le vendeur',
    example: '2026-03-11T09:00:00.000Z',
  })
  purchaseRejectedAt?: Date;

  @ApiPropertyOptional({
    description: 'Raison du rejet de l\'achat',
    example: 'La preuve d\'achat ne correspond pas au produit',
  })
  purchaseRejectionReason?: string;

  // Progress
  @ApiProperty({
    description: 'Progression des étapes du test',
    type: [SessionStepProgressResponseDto],
  })
  stepProgress: SessionStepProgressResponseDto[];

  // Completion
  @ApiPropertyOptional({
    description: 'Date de soumission du test par le testeur',
    example: '2026-03-20T15:00:00.000Z',
  })
  submittedAt?: Date;

  @ApiPropertyOptional({
    description: 'Date de validation finale du test',
    example: '2026-03-22T10:00:00.000Z',
  })
  completedAt?: Date;

  @ApiPropertyOptional({
    description: 'Montant de la récompense (en euros)',
    example: 15.0,
  })
  rewardAmount?: number;

  // Cancellation
  @ApiPropertyOptional({
    description: 'Date d\'annulation de la session',
    example: '2026-03-12T08:00:00.000Z',
  })
  cancelledAt?: Date;

  @ApiPropertyOptional({
    description: 'Raison de l\'annulation',
    example: 'Produit non conforme à la description',
  })
  cancellationReason?: string;

  @ApiProperty({
    description: 'Date de création de la session',
    example: '2026-03-01T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date de dernière mise à jour de la session',
    example: '2026-03-20T15:00:00.000Z',
  })
  updatedAt: Date;
}
