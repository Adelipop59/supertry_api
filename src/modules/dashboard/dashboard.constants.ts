import { SessionStatus } from '@prisma/client';

/** Sessions actively being worked on (between acceptance and submission). */
export const ACTIVE_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.ACCEPTED,
  SessionStatus.PRICE_VALIDATED,
  SessionStatus.PURCHASE_SUBMITTED,
  SessionStatus.PURCHASE_VALIDATED,
  SessionStatus.IN_PROGRESS,
  SessionStatus.PROCEDURES_COMPLETED,
  SessionStatus.SUBMITTED,
];
