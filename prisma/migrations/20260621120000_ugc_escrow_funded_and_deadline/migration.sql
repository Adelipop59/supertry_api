-- P0.1 / P0.3 : garde d'idempotence pour le financement de l'escrow UGC
ALTER TABLE "ugcs" ADD COLUMN "escrow_funded_at" TIMESTAMP(3);

-- P0.1 : nouvelle deadline UGC par défaut (4 jours) pour rester sous le seuil
-- d'expiration d'une autorisation Stripe en manual capture (~7 jours).
-- N'affecte que la valeur par défaut des futures lignes business_rules.
ALTER TABLE "business_rules" ALTER COLUMN "ugc_default_deadline_days" SET DEFAULT 4;
