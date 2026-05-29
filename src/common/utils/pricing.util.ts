/**
 * Plafond de dépense affiché au testeur (« < X $ »).
 * On n'expose JAMAIS le prix exact : on arrondit le total (produit + livraison)
 * au multiple de 5 supérieur, ce qui donne une borne haute "assez serrée".
 * Ex: 25 + 4 = 29 → 30 ; 22 → 25 ; 31 → 35.
 */
export function computeSpendCeiling(
  productPrice: number | string | null | undefined,
  shippingCost: number | string | null | undefined,
): number {
  const total = Number(productPrice ?? 0) + Number(shippingCost ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / 5) * 5;
}
