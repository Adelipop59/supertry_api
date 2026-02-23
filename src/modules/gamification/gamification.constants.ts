import { TesterTier } from '@prisma/client';

// Seuils XP pour chaque palier
export const TIER_THRESHOLDS: Record<TesterTier, number> = {
  BRONZE: 0,
  SILVER: 500,
  GOLD: 2000,
  PLATINUM: 5000,
  DIAMOND: 12000,
};

// Ordre des paliers (du plus bas au plus haut)
export const TIER_ORDER: TesterTier[] = [
  TesterTier.BRONZE,
  TesterTier.SILVER,
  TesterTier.GOLD,
  TesterTier.PLATINUM,
  TesterTier.DIAMOND,
];

// Milestones : nombre de tests → XP bonus
export const MILESTONES: Record<number, number> = {
  10: 200,
  25: 400,
  50: 600,
  100: 1000,
};

// Noms affichables des paliers
export const TIER_NAMES: Record<TesterTier, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PLATINUM: 'Platine',
  DIAMOND: 'Diamant',
};

/**
 * Détermine le palier correspondant à un total XP donné.
 */
export function getTierForXp(totalXp: number): TesterTier {
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    if (totalXp >= TIER_THRESHOLDS[TIER_ORDER[i]]) {
      return TIER_ORDER[i];
    }
  }
  return TesterTier.BRONZE;
}

/**
 * Vérifie si un palier est au moins égal à un palier requis.
 */
export function isTierAtLeast(
  testerTier: TesterTier,
  requiredTier: TesterTier,
): boolean {
  return TIER_ORDER.indexOf(testerTier) >= TIER_ORDER.indexOf(requiredTier);
}

/**
 * Retourne le palier suivant, ou null si déjà DIAMOND.
 */
export function getNextTier(currentTier: TesterTier): TesterTier | null {
  const idx = TIER_ORDER.indexOf(currentTier);
  return idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}
