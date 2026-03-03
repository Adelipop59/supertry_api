export interface ProductImage {
  clearKey: string;
  blurredKey: string;
}

/**
 * Normalise une entrée d'image (legacy string ou nouveau format structuré).
 * Les anciennes entrées string sont traitées comme clear-only (pas de version floue).
 */
export function normalizeImageEntry(
  entry: string | ProductImage,
): ProductImage {
  if (typeof entry === 'string') {
    return { clearKey: entry, blurredKey: entry };
  }
  return entry;
}
