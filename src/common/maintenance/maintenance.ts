/**
 * Mode maintenance — pendant les travaux, seuls les comptes ADMIN accèdent à l'API.
 *
 * Activé par la variable d'env MAINTENANCE_MODE=true (overlay k8s). Relue à
 * chaque appel : pas besoin de redémarrer pour les tests locaux.
 */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === 'true';
}

/**
 * Routes joignables sans session admin pendant la maintenance.
 * Chemins complets (préfixe global api/v1 inclus), comparés sans query string.
 */
const OPEN_ROUTES: RegExp[] = [
  // Sondes k8s
  /^\/api\/v1\/health(\/ready)?$/,
  // Webhooks Stripe signés : les paiements en cours doivent continuer d'être réconciliés
  /^\/api\/v1\/stripe\/webhooks$/,
  // Connexion des admins — le rôle est revérifié à la création de session (LuciaService)
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/logout$/,
  /^\/api\/v1\/auth\/oauth\/[a-z]+(\/callback)?$/,
  /^\/api\/v1\/auth\/oauth\/token$/,
];

export function isOpenDuringMaintenance(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  return OPEN_ROUTES.some((re) => re.test(clean));
}
