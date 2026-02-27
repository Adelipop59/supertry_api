-- AlterTable
ALTER TABLE "business_rules" ADD COLUMN     "price_range_tiers" JSONB NOT NULL DEFAULT '[{"maxPrice":10,"margin":2,"roundTo":1},{"maxPrice":100,"margin":5,"roundTo":5},{"maxPrice":99999,"margin":10,"roundTo":10}]';
