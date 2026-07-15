import { IsNotEmpty, IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Sens de résolution d'un litige de session (modèle binaire).
 * - REFUND_TESTER : résolution en faveur du testeur → il reçoit le montant maximum
 *   de la campagne (produit + livraison + bonus). Rien n'est remboursé au PRO.
 * - REFUND_PRO    : résolution en faveur du PRO → il est intégralement remboursé.
 *   Le testeur ne reçoit rien.
 * Le MONTANT exact est calculé côté serveur (jamais fourni par le client), à partir
 * des règles métier et de l'offre — évite toute manipulation du montant décaissé.
 */
export enum DisputeResolutionMode {
  REFUND_TESTER = 'REFUND_TESTER',
  REFUND_PRO = 'REFUND_PRO',
}

export class ResolveDisputeDto {
  @ApiProperty({
    description: 'Sens de la résolution',
    enum: DisputeResolutionMode,
    example: DisputeResolutionMode.REFUND_TESTER,
  })
  @IsNotEmpty()
  @IsEnum(DisputeResolutionMode)
  resolution: DisputeResolutionMode;

  @ApiProperty({
    description: 'Motif de la résolution (tracé, notifié aux parties)',
    example: 'Le testeur a fourni les preuves de test demandées',
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  reason: string;
}
