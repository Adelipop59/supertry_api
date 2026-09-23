import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Mode maintenance — pendant les travaux, l'API n'est utilisable qu'avec le
 * « pass » que le site délivre contre le code d'accès (MAINTENANCE_CODE).
 * Une fois le pass obtenu, tous les comptes fonctionnent (tests testeur/pro/admin).
 *
 * MAINTENANCE_MODE=true (overlay k8s) active le blocage ; relu à chaque appel.
 */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === 'true';
}

/** Cookie posé par le site ; le proxy du site le transmet tel quel. */
export const MAINTENANCE_COOKIE = 'mt_pass';
/** En-tête utilisé par les appels serveur du site (apiFetch). */
export const MAINTENANCE_HEADER = 'x-maintenance-pass';

/** Routes joignables sans pass : sondes k8s et webhooks Stripe (signés). */
const OPEN_ROUTES: RegExp[] = [
  /^\/api\/v1\/health(\/ready)?$/,
  /^\/api\/v1\/stripe\/webhooks$/,
];

export function isOpenDuringMaintenance(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  return OPEN_ROUTES.some((re) => re.test(clean));
}

/**
 * Vérifie un pass « <exp>.<hmac> » signé en HMAC-SHA256 avec le code d'accès
 * (même format que supertry_saas/src/lib/maintenance.ts). Sans code configuré,
 * aucun pass n'est valide : l'API reste fermée.
 */
export function verifyMaintenancePass(pass: string | undefined): boolean {
  const code = process.env.MAINTENANCE_CODE?.trim();
  if (!code || !pass) return false;

  const [expStr, sig] = pass.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isInteger(exp) || exp < Date.now() / 1000) return false;

  const expected = createHmac('sha256', code)
    .update(`mt:${exp}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
