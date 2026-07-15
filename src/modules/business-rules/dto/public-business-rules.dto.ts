import { ApiProperty } from '@nestjs/swagger';

/**
 * Projection PUBLIQUE des règles métier (SEC-S6).
 *
 * L'endpoint `GET /business-rules/latest` est consommé par le front (wizard de
 * création de campagne) pour afficher la facture prévisionnelle et les paliers de
 * prix. Il ne doit exposer QUE les champs strictement nécessaires à cet affichage
 * tarifaire — jamais la mécanique anti-fraude et opérationnelle complète
 * (pourcentage/jours de bannissement en cas d'annulation, seuil KYC, commissions
 * UGC/tips, paramètres XP, délais de capture…), qui reste réservée à l'ADMIN via
 * `GET /business-rules` et `GET /business-rules/:id`.
 */
export class PublicBusinessRulesDto {
  @ApiProperty({ example: 'clx1234567890' })
  id: string;

  @ApiProperty({ description: 'Bonus standard accordé au testeur', example: 5.0 })
  testerBonus: number;

  @ApiProperty({ description: 'Frais fixes de commission (frais de plateforme)', example: 5.0 })
  commissionFixedFee: number;

  @ApiProperty({ description: 'Pourcentage de frais Stripe couvert', example: 0.039 })
  stripeFeePercent: number;

  @ApiProperty({
    description: 'Paliers de fourchette de prix affichée au testeur',
    example: [
      { maxPrice: 50, step: 5 },
      { maxPrice: 100, step: 10 },
    ],
  })
  priceRangeTiers: any;

  @ApiProperty({ example: 30.0 })
  tierBronzeMaxProductPrice: number;

  @ApiProperty({ example: 60.0 })
  tierSilverMaxProductPrice: number;

  @ApiProperty({ example: 120.0 })
  tierGoldMaxProductPrice: number;

  @ApiProperty({ example: 250.0 })
  tierPlatinumMaxProductPrice: number;

  @ApiProperty({ example: 99999 })
  tierDiamondMaxProductPrice: number;
}
