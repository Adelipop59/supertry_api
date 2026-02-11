import { SetMetadata } from '@nestjs/common';
import { AuditCategory } from '@prisma/client';

export const AUDIT_METADATA_KEY = 'audit_metadata';

export interface AuditMetadata {
  category?: AuditCategory;
  action?: string;
}

/**
 * Décorateur @Audit pour enrichir les logs automatiques
 * Usage:
 * @Audit({ category: AuditCategory.AUTH, action: 'LOGIN_SUCCESS' })
 */
export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_METADATA_KEY, metadata);
