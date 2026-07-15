-- SEC-S4c : idempotence du remboursement des slots non utilisés.
-- `refundUnusedSlots` appelait Stripe sans clé d'idempotence ni verrou → un double
-- déclenchement (retry, double-clic) remboursait deux fois. Ce flag sert de claim
-- atomique (updateMany WHERE unused_slots_refunded_at IS NULL).
ALTER TABLE "campaigns" ADD COLUMN "unused_slots_refunded_at" TIMESTAMP(3);
