-- Migration: Convertir marketplace (String) en marketplaces (String[])

-- Étape 1: Ajouter la nouvelle colonne marketplaces
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS marketplaces TEXT[] DEFAULT '{}';

-- Étape 2: Migrer les données existantes (marketplace -> marketplaces)
-- Si marketplace est non null, on le met dans le tableau marketplaces
UPDATE campaigns
SET marketplaces = ARRAY[marketplace]::TEXT[]
WHERE marketplace IS NOT NULL;

-- Étape 3: Pour les campagnes sans marketplace, laisser le tableau vide
UPDATE campaigns
SET marketplaces = '{}'::TEXT[]
WHERE marketplace IS NULL AND marketplaces IS NULL;

-- Étape 4: Supprimer l'ancienne colonne marketplace
ALTER TABLE campaigns DROP COLUMN IF EXISTS marketplace;

-- Vérification
SELECT id, title, marketplaces FROM campaigns LIMIT 10;
