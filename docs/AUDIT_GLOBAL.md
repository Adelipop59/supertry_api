# Audit dev SuperTry — Readiness de merge (Conformité, Sécurité & Business Process)

**Date :** 23 juin 2026
**Branche auditée :** `dev` (vérifiée : `supertry_api` et `supertry_saas` sont sur `dev`, local == `origin/dev`, 0 écart)
**Périmètre :** `supertry_api` (NestJS/Prisma) + `supertry_saas` (Next.js), config Supabase dev (`wkcmhpmptgdfvjyvgfdh`)
**Méthode :** analyse statique du code (vérifiée fichier:ligne), inspection live Supabase/Stripe (MCP), croisement des findings, re-vérification directe des critiques.
**Objectif :** déterminer ce qui doit être propre sur `dev` avant de **merger `dev → main`**, et chiffrer la readiness de merge.

> **Hors scope (assumé par l'équipe, donc non compté comme bloquant de merge) :**
> - **Configuration `business_rules`** (table vide en dev/prod) — sera seedée avant lancement.
> - **Configuration Stripe** (Connect, produits, KYC live) — sera faite avant lancement.
> - **RLS Supabase désactivée** — choix d'architecture assumé : tout l'accès données passe par le backend NestJS (pas de client `@supabase/supabase-js`, pas de clé anon publiée côté front). ✅ Acceptable **à une condition à vérifier une fois** : que le **Data API REST/PostgREST du projet Supabase soit désactivé** (ou le rôle `anon` révoqué). Tant que l'API REST anon n'est pas joignable, l'absence de RLS n'est pas exploitable.
> - **Secrets de test commités (`auth-tokens.txt`)** — comptes de test qui seront supprimés → risque vivant nul. La clé `POSTHOG_API_KEY=phc_…` est la **clé de projet publique** PostHog (faite pour être exposée), pas un secret. Reste une simple hygiène : retirer le fichier du repo + `.gitignore` (non bloquant).
> - **Versement du bonus sans « preuve d'avis »** — choix produit assumé. Justifié car : (a) le retrait d'argent exige Stripe Connect (IBAN + identité Stripe) et l'Identity complète au-delà du seuil `kycRequiredAfterTests` → le couple **ban + KYC** mord au point de sortie ; (b) le PRO **note/évalue le testeur en fin de mission** ; (c) le seuil KYC est réglable via `business_rules` pour resserrer la fraude sans toucher au code. ⇒ **BUS-C1 retiré des bloquants.**

---

## 1. Verdict exécutif (readiness de merge dev → main)

**Readiness de merge : ~60 % → pas encore mergeable proprement, mais le chemin s'est raccourci.**

> _Révisé après clarifications équipe (23/06) : les findings « secrets de test » et « bonus sans preuve d'avis » sont sortis des bloquants (voir encadré hors-scope). Il reste 2 critiques de sécurité pure + des élevés sécurité/anti-fraude._

Bonne nouvelle d'abord : la base auditée **est bien `dev`**, donc tous les constats portent sur le code que vous voulez merger. Les fondations sont solides (architecture propre, guards globaux, argon2, idempotence + signature des webhooks Stripe, capture manuelle + escrow, et les commits récents « audit pass 1-3 » Stripe ont déjà durci KYC/payout/capture/réconciliation).

Mais, en retirant les 3 éléments assumés ci-dessus, il reste sur `dev` un noyau de **vulnérabilités de code et de trous de logique métier** qui ne devraient pas atterrir sur `main` : secrets commités, fuite de hash de mot de passe, exposition du token de session, IDOR média, SSRF, absence de durcissement HTTP (CORS/Helmet/rate-limit), et surtout deux failles de processus (paiement du bonus sans preuve d'avis, sessions pouvant rester bloquées indéfiniment).

| Domaine (scope merge dev) | Readiness | Statut |
|---|---|---|
| Sécurité technique (code) | ~58 % | 🔴 Bloquant merge (2 critiques) |
| Business process / anti-fraude | ~65 % | 🟠 À durcir (anti auto-test) |
| Conformité légale / RGPD (parties *code*) | ~50 % | 🟠 À traiter |
| Qualité code Stripe / flux financiers | ~75 % | 🟢 OK (config différée) |

**Bloquants de merge restants : 2 CRITIQUES** (fuite `passwordHash`, exposition JWT via `ws-token`) + une poignée d'**ÉLEVÉS** sécurité/anti-fraude (IDOR média, SSRF, CORS/Helmet/rate-limit, anti auto-test). Les findings « secrets de test » (SEC-C1) et « bonus sans preuve d'avis » (BUS-C1) sont **retirés** suite aux clarifications équipe ; la clé PostHog (SEC-E9) était un faux positif (clé publique).

### Re-vérifications faites sur `dev` pour ce rapport
- **BUS-C1 confirmé** : `submitTest` (`test-sessions.service.ts:1198`) verse le bonus ; `complete()` ne paie rien (`:1277-1278`) ; aucune `reviewProof`/URL d'avis n'existe dans le schéma (seules des preuves d'**achat** existent).
- **BUS-C2 confirmé** : schedulers présents = `payment-capture`, `campaign-activation`, `ugc`, `audit`, `wallet-reconciliation`. **Aucun** ne traite les sessions `PURCHASE_SUBMITTED`/`SUBMITTED` bloquées (le `ugc.scheduler` n'expire que les demandes UGC, pas le flux test-session).
- **BUS-M1 partiellement traité** : un cron `wallet-reconciliation` (quotidien, 5h) a été ajouté → la réconciliation wallet/escrow est désormais outillée (à valider fonctionnellement).
- **BUS-E1 confirmé** : les contrôles `seller.id !== sellerId` sont des vérifs d'ownership de campagne, **pas** une garde `testerId !== sellerId` (auto-test toujours possible).
- **BUS-E2 confirmé** : `purchaseProofKeys` reste `@IsOptional()`, `orderNumber` sans unicité.
- **Headers front confirmés absents** : `next.config.ts` ne pose une CSP que sur `/admin/*`, rien de global (HSTS/CSP/X-Frame).

---

## 2. Domaine 1 — Sécurité technique

### 2.1 Findings CRITIQUES

**[SEC-C1] ~~Identifiants commités dans `auth-tokens.txt`~~ → RÉTROGRADÉ (mineur).**
Vérifié : le fichier est tracké. Mais ce sont des **comptes de test qui seront supprimés** (décision équipe) → risque vivant nul une fois supprimés. Reste une hygiène simple, non bloquante : retirer le fichier du repo + l'ajouter au `.gitignore`. La clé `POSTHOG_API_KEY=phc_…` (SEC-E9) est la **clé de projet publique** PostHog, pas un secret → faux positif.

**[SEC-C2] Fuite de `passwordHash` (et champs sensibles) sur `GET /auth/session`** — CRITIQUE confirmé, **reste bloquant.**
Vérifié : `src/modules/auth/auth.controller.ts:381-385` fait `profile.findUnique(...)` puis `return { user: profile }` sans `select`, renvoyant **tout** le profil — `passwordHash` argon2, `stripeConnectAccountId`, `siret`, etc. — à chaque appel de session.
*Impact :* exfiltration des hash de mots de passe et de données sensibles.
*Remédiation :* `select` explicite ou `mapProfileToResponse`, retirer `passwordHash`.

**[SEC-C3] Token de session httpOnly réexposé au JavaScript via `/api/auth/ws-token`**
Vérifié : `supertry_saas/src/app/api/auth/ws-token/route.ts` lit le cookie httpOnly `auth_session` et **renvoie le JWT brut** dans le JSON. Consommé côté client (chats, notifications). Cela annule la protection httpOnly : toute XSS ou extension tierce vole la session complète.
*Remédiation :* émettre un token WebSocket éphémère à scope réduit, distinct du JWT de session.

### 2.2 Findings ÉLEVÉS (sélection)

| ID | Finding | Preuve | Remédiation |
|---|---|---|---|
| SEC-E1 | **IDOR média total** : `DELETE /media/delete/*path`, `GET /media/signed-url/*path`, `/media/exists/*path` acceptent une clé S3 arbitraire avec un simple contrôle de rôle, **sans vérif d'ownership**. Un user peut supprimer / lire les fichiers d'autrui (KYC, preuves d'achat, disputes). | `media.controller.ts:73-118` (vérifié) | Préfixer les clés par `userId` + valider, ou table de mapping fichier→propriétaire |
| SEC-E2 | **CORS `origin: true` + `credentials: true`** (config la plus permissive possible) | `main.ts:25-28` (vérifié) | Liste blanche d'origines |
| SEC-E3 | **Aucun Helmet / en-têtes de sécurité** côté API (pas de CSP, HSTS, X-Frame-Options…) | grep négatif (vérifié) | `app.use(helmet())` |
| SEC-E4 | **Aucun rate limiting** : login, forgot-password, check-email, OTP brute-forçables | grep négatif `Throttler` (vérifié) | `@nestjs/throttler` global + limites strictes sur `/auth/*` |
| SEC-E5 | **SSRF — proxy ouvert non authentifié** `/api/images` : `fetch(url)` sur n'importe quelle URL (accès métadonnées cloud `169.254.169.254`, `localhost`, services internes) | `supertry_saas/src/app/api/images/route.ts` (vérifié) | Allowlist de domaines (Supabase storage), interdire IP privées/loopback/`file:` |
| SEC-E6 | **Aucun en-tête de sécurité global côté front** (HSTS/CSP/X-Frame absents sauf `/admin`) | `next.config.ts:27-48` (vérifié) | Bloc `headers()` global |
| SEC-E7 | **OTP de vérification générés avec `Math.random()`** (non cryptographique, devinable) | `auth.service.ts:1263-1265` | `crypto.randomInt(100000, 1000000)` |
| SEC-E8 | **Sessions sans expiration** (`expires: false`) | `lucia.service.ts:57-58` | TTL + rotation |
| SEC-E9 | **Clé PostHog réelle dans `.env.example` commité** | `.env.example:109` (vérifié, `phc_t99J…`) | Placeholder + rotation de la clé |
| SEC-E10 | **Upload SVG autorisé** → XSS stocké si servi sur le domaine | `media.service.ts:60-67,487` | Interdire SVG ou `Content-Disposition: attachment` + domaine isolé |

### 2.3 Findings MOYENS / FAIBLES (résumé)
Énumération de comptes (`/auth/check-email` renvoie `exists` + `role`), messages de login distincts, DTO non validés (`returnUrl`, `reason`, payload Apple), `makePublic`/`folder` pilotés par le client sur les uploads, WebSocket CORS `*`, absence de CSRF, Swagger exposé en prod sans auth, mot de passe min. 6 caractères, JWT loggué en console prod, cookie de session 30 j sans rotation, JSON-LD non échappé, erreurs de webhook avalées (200 systématique), double lockfile (`package-lock.json` + `pnpm-lock.yaml`).

### 2.4 Points forts confirmés
Guards globaux chaînés (Auth → Onboarding → Roles), scoping par `userId` anti-IDOR sur la plupart des ressources métier, argon2 bien paramétré, **aucune injection SQL** (raw queries paramétrés), **signature + idempotence des webhooks Stripe robustes**, bypass de sécurité (signature Stripe, KYC, business rules) tous neutralisés en production via `NODE_ENV`, Dockerfile multi-stage **non-root**, cookies de session httpOnly + secure + sameSite côté front, bannière de consentement avec PostHog **opt-out par défaut**.

---

## 3. Domaine 2 — Conformité légale / RGPD (marché FR/UE)

### 3.1 Findings CRITIQUES

**[LEG-C1] Mentions légales = placeholders vides**
`supertry_saas/src/app/[locale]/(public)/legal/page.tsx:24-43` : raison sociale, forme juridique, capital, siège, RCS, SIRET, TVA, directeur de publication, hébergeur — **tous `[À COMPLÉTER]`**. Illégal pour un service en ligne FR (art. 6 LCEN).

**[LEG-C2] Identité de l'éditeur / responsable de traitement absente**
Même cause : la politique de confidentialité (`privacy/page.tsx:32-33`) laisse le responsable de traitement vide. Non conforme art. 13 RGPD.

### 3.2 Findings ÉLEVÉS

| ID | Finding | Preuve | Impact |
|---|---|---|---|
| LEG-E1 | **CGU et CGV absentes** (aucune route ; footer ne liste que `legal` + `privacy`) | `landing-footer.tsx:22-25` | Marketplace B2B encaissant des paiements sans CGV = non-conformité + insécurité contractuelle |
| LEG-E2 | **Pas d'acceptation CGU/confidentialité à l'inscription** (aucune case à cocher) | `register-form.tsx:25-27` | Pas de preuve de consentement au point de collecte |
| LEG-E3 | **Aucun droit RGPD en self-service** (suppression de compte, export/portabilité) — uniquement un e-mail `dpo@` | grep négatif sur `src/` | Droits art. 17 & 20 non exerçables |
| LEG-E4 | **`posthog.identify()` envoie email/nom/rôle sans vérifier le consentement analytics** | `posthog-identify.tsx:9-18` | Transfert de PII sans base légale claire |
| LEG-E5 | **Session Replay PostHog `maskAllInputs: false`** → KYC, email, téléphone, SIRET, montants enregistrés en clair | `posthog-provider.tsx:41-44` | Captation de données sensibles dans les replays |
| LEG-E6 | **Médiateur de la consommation absent** (obligatoire dès qu'il y a des consommateurs — les testeurs particuliers) | grep négatif | Non-conformité art. L612-1 Code conso |

### 3.3 Findings MOYENS
Gestion des cookies non rejouable après le choix initial (retrait du consentement difficile), droit de rétractation non mentionné.

### 3.4 Points forts
Bannière cookies à 3 choix + granularité analytics/marketing, PostHog opt-out par défaut (pas de tracking avant consentement), consentement conservé 13 mois (recommandation CNIL), politique de confidentialité bien structurée sur le fond (données, finalités, bases légales, durées).

---

## 4. Domaine 3 — Stripe & flux financiers

### 4.1 Configuration (HORS SCOPE MERGE — assumé, à faire avant lancement)

Ces deux points sont des tâches de **configuration de fin de parcours**, explicitement différées par l'équipe. Ils ne bloquent pas le merge `dev → main`, mais restent des **conditions de lancement** rappelées ici pour mémoire.

| Élément | État constaté | À faire avant lancement |
|---|---|---|
| Stripe Connect (comptes, KYC, produits) | 0 compte Connect, 0 produit, 0 PaymentIntent en live | Onboarding Connect + test end-to-end d'un payout réel |
| `business_rules` | 0 ligne (dev et prod) → l'app tourne sur les défauts codés | Seeder + vérifier commissions, seuils KYC, règles de ban, % Stripe |

Le pricing officiel **10 € + 3,9 %** reste garanti même table vide via le fallback `resolveStripeFeePercent → 0.039` (bon garde-fou).

### 4.2 Qualité du code de paiement (positif)
Le code financier est mature : pricing calculé **côté serveur** (non manipulable client), idempotence via `purchaseReimbursedAt`/`bonusPaidAt` + dédup webhooks (`StripeWebhookEvent`), capture manuelle + grace period (annulation sans frais avant capture), rollback wallet/escrow sur `transfer.failed`/`reversed`, verrou pessimiste (`FOR UPDATE`) sur les slots. Voir `docs/AUDIT_STRIPE.md` pour le détail.

### 4.3 À surveiller (cohérence comptable)
Deux référentiels d'escrow non réconciliés : `campaign.escrowAmount` (base, **hors** couverture Stripe) vs `PlatformWallet.escrowBalance` (crédité du **montant total** capturé). Risque de divergence comptable → ajouter une réconciliation (voir BUS-M1).

---

## 5. Domaine 4 — Business process / anti-fraude

### 5.0 Décision produit — modèle anti-fraude par dissuasion (BUS-C1 ACCEPTÉ)

**[BUS-C1] ~~Bonus versé sans preuve d'avis~~ → ACCEPTÉ comme choix produit.**
Le bonus est versé à `submitTest` (action testeur) sans exiger de preuve d'avis ; le PRO note le testeur en fin de mission. Initialement classé CRITIQUE, **retiré des bloquants** après revue du flux de sortie d'argent :
- Tout **retrait exige un compte Stripe Connect** (`withdrawals.service.ts:54`) → IBAN + identité rattachés à Stripe, traçables.
- L'**Identity Stripe complète** est exigée au-delà de `kycRequiredAfterTests` (défaut 3) — pour la candidature (`test-sessions.service.ts:220`), le remboursement et le bonus (`payments.service.ts:200,427`) **et** le retrait (`withdrawals.service.ts:83`).
- Le seuil est **réglable via `business_rules`** → la tolérance à la fraude se resserre sans toucher au code.

⇒ Le couple **ban + KYC** est réellement dissuasif au point de sortie. Risque résiduel borné (~3 tests avant Identity complète, avec IBAN traçable). **Acceptable.** Voir BUS-E1/E2 pour les garde-fous complémentaires bon marché.

### 5.1 Findings CRITIQUES / ÉLEVÉS restants

**[BUS-C2] ÉLEVÉE — Sessions bloquées sans automatisme.**
Aucun cron ne traite les sessions en `PURCHASE_SUBMITTED` (le vendeur ne valide jamais l'achat) ni `SUBMITTED`. Pas de deadline côté session.
*Scénario :* le testeur a dépensé son argent réel, le vendeur ne fait rien → la session reste figée **pour toujours**, seul recours = ouvrir un litige manuellement.
*Remédiation :* cron d'auto-validation/escalade après N jours.

### 5.2 Findings ÉLEVÉS

| ID | Finding | Preuve | Risque |
|---|---|---|---|
| BUS-E1 | **Aucune anti-fraude auto-test / multi-comptes** : `apply` ne vérifie pas `testerId !== sellerId`, ni IP/adresse/IBAN/device partagés. KYC seulement après 3 tests. | `test-sessions.service.ts:145-319` | Un vendeur s'auto-teste avec un 2ᵉ compte → faux avis 5★ + auto-remboursement |
| BUS-E2 | **Preuve d'achat optionnelle et non contrôlée** : `purchaseProofKeys` `@IsOptional()`, `orderNumber` sans format ni unicité | `submit-purchase.dto.ts:51` | Remboursement sans achat réel ; numéro de commande réutilisable |
| BUS-E3 | **`CampaignCriteria` non appliqués** : `apply` n'évalue que `minTier`, ignore âge/genre/pays/`noActiveSessionWithSeller`/quotas | `test-sessions.service.ts:245-249` | Le vendeur paie un ciblage non honoré ; garde anti auto-test inopérante |

### 5.3 Findings MOYENS / FAIBLES
Escrow double-référentiel non réconcilié (BUS-M1), statut `PENDING_ACTIVATION` mort + double scheduler concurrent, litige créable après `COMPLETED` pouvant re-rembourser au-delà de l'escrow restant, divergence règle de ban doc↔code (doc = ban dès 1ʳᵉ annulation tardive, code = 2ᵉ), vérifier qu'aucune valeur `0.035` ne subsiste pour le % Stripe.

### 5.4 Points forts
Transitions d'état gardées par statut sur chaque action, idempotence des paiements, capture manuelle + remboursement Stripe correct selon l'état, verrou sur les slots.

---

## 6. Domaine 5 — Infra & données (Supabase) — RLS assumée

**[INF-OK] RLS désactivée = choix d'architecture assumé.**
Constat technique : sur les 38 tables du schéma `public`, RLS désactivée partout, 0 policy, rôle `anon` avec `SELECT`. C'est **cohérent et acceptable** dans votre modèle puisque **tout l'accès données passe par le backend NestJS** (vérifié : aucun client `@supabase/supabase-js`, aucune clé anon `NEXT_PUBLIC_SUPABASE_*` publiée côté front ; le front ne touche Supabase que pour le **Storage** d'images via un proxy).

➡️ **Une seule vérification de config à faire une fois (non bloquante pour le merge) :** confirmer dans Supabase (Settings → API → Data API) que **l'exposition REST/PostgREST est désactivée** (ou le rôle `anon` révoqué de PostgREST). C'est le seul vecteur qui rendrait l'absence de RLS exploitable (lecture directe `…supabase.co/rest/v1/<table>` avec la clé anon). Une fois ce point coché, le sujet RLS est clos.

---

## 7. Score de readiness de merge (dev → main)

Scope = code de `dev` uniquement. Stripe/`business_rules`/RLS exclus (assumés).

| Domaine | Poids | Score | Justification |
|---|---|---|---|
| Sécurité technique (code) | 35 % | 58 % | 2 critiques restants (passwordHash, ws-token) + IDOR média + SSRF + CORS/Helmet/rate-limit ; SEC-C1/E9 retirés |
| Business process / anti-fraude | 30 % | 65 % | Modèle ban+KYC accepté (BUS-C1 retiré) ; restent anti auto-test, preuve d'achat obligatoire, timeout sessions |
| Conformité (parties *code*) | 20 % | 50 % | Manque routes CGU/CGV, consentement à l'inscription, droits RGPD UI, consentement analytics/masquage replay (le remplissage de contenu = pré-lancement) |
| Qualité code Stripe / flux financiers | 15 % | 75 % | Code mature, idempotence, capture manuelle, réconciliation outillée — config différée |
| **GLOBAL pondéré (merge)** | **100 %** | **≈ 60 %** | **Pas encore mergeable proprement, mais 2 critiques seulement** |

### Interprétation
- **~60 %** = `dev` fonctionne ; après clarifications, il ne reste que **2 critiques de sécurité pure** + des élevés sécurité/anti-fraude avant un `main` sain.
- **Seuil « clean to merge » recommandé : ~90 %** = zéro CRITIQUE ouvert, zéro ÉLEVÉ de sécurité/logique ouvert ; les MOYENS/FAIBLES peuvent être tracés en tickets.
- **Effort estimé pour atteindre le seuil :** les 2 P0 = ~½ journée ; les P1 = quelques jours. C'est très atteignable.

---

## 8. Plan priorisé pour atteindre 90 % (readiness de merge)

Objectif : passer de **~60 % → ~90 %** par lots indépendants, du plus rapide/à plus fort impact au plus coûteux. Chaque lot est mergeable séparément. Effort indicatif (1 dev).

### 🟢 Lot 0 — Débloquer le merge · ✅ APPLIQUÉ (23/06) → ~68 %
Les 2 CRITIQUES + l'hygiène. Code appliqué sur `dev`, `tsc --noEmit` OK sur les 2 repos.

| # | ID | Action | Statut |
|---|---|---|---|
| 1 | SEC-C2 | Omit `passwordHash` sur `GET /auth/session` (pattern `getMe`, aucun autre champ retiré) | ✅ fait (`auth.controller.ts`) |
| 2 | SEC-C3 | Ticket WS éphémère HMAC (`ws-ticket.service.ts` + endpoint `/auth/ws-ticket`) ; gateway **rétro-compatible** (ticket → repli token) ; front `ws-token` renvoie le ticket | ✅ code fait — ⚠️ **valider E2E chat sur env tournant** avant retrait du repli legacy |
| 3 | SEC-C1 | `auth-tokens.txt` supprimé + dé-tracké + `.gitignore` | ✅ fait |

### 🟢 Lot 1 — Durcissement HTTP · ✅ APPLIQUÉ (23/06) → ~78 % (E8 reporté)
Config/middleware sans nouvelle dépendance. `tsc --noEmit` OK sur les 2 repos.

| # | ID | Action | Statut |
|---|---|---|---|
| 4 | SEC-E2 | CORS **liste blanche** pilotée par env (`CORS_ORIGINS`/`FRONTEND_URL`), no-origin & localhost autorisés | ✅ fait (`main.ts`) |
| 5 | SEC-E3 | En-têtes sécurité API via middleware (nosniff, X-Frame DENY, Referrer-Policy, HSTS prod) — **sans** dépendance helmet | ✅ fait (`main.ts`) |
| 6 | SEC-E4 | Rate-limit **maison, fail-open, scopé** aux 7 routes auth sensibles (login, check-email, forgot/reset, verify/resend, signup) — pas de dépendance | ✅ fait (`common/guards/rate-limit.guard.ts`) — *en mémoire/instance ; passer à un store Redis pour le multi-réplicas* |
| 7 | SEC-E6 | Headers sécurité globaux front (nosniff, X-Frame DENY, Referrer-Policy, HSTS) — pas de CSP globale stricte | ✅ fait (`next.config.ts`) |
| 8a | SEC-E7 | OTP via `crypto.randomInt` | ✅ fait (`auth.service.ts`) |
| 8b | SEC-E8 | Expiration/rotation des sessions Lucia | ⏸️ **reporté** — `expires:false` imbriqué avec le cookie 30 j géré par le front + Bearer mobile → risque de déconnexions ; à faire en tâche dédiée avec test web+mobile |
| 9 | SEC-E10 | SVG retiré des types image autorisés à l'upload | ✅ fait (`media.service.ts`) |

### 🟠 Lot 2 — IDOR média + SSRF · ✅ APPLIQUÉ (23/06) → ~85 %
`tsc --noEmit` OK sur les 2 repos.

| # | ID | Action | Statut |
|---|---|---|---|
| 10 | SEC-E1 | Endpoints média bruts (`delete`/`signed-url`/`exists`) **réservés ADMIN** ; nouvel endpoint **scopé** `GET /test-sessions/:id/proof-url` (autorise testeur/vendeur/admin + vérifie clé ∈ preuves de la session) ; front PRO migré | ✅ fait — ⚠️ **confirmer que le mobile n'appelle pas `/media/signed-url`** (sinon prévoir endpoints scopés mobiles) |
| 11 | SEC-E5 | `/api/images` : http/https only + résolution DNS + blocage IP privées/loopback/metadata + pas de redirection + `image/*` only (sans casser les images publiques) | ✅ fait (`saas/.../api/images/route.ts`) |

### 🟠 Lot 3 — Intégrité anti-fraude (2 à 3 jours) · +6 pts → ~91 % ✅
Les garde-fous qui sécurisent le modèle « rembourser vite + dissuasion ».

| # | ID | Action | Fichier |
|---|---|---|---|
| 12 | BUS-E1 | Garde `testerId !== sellerId` + recoupement Connect/IBAN/adresse/device | `test-sessions.service.ts:apply` |
| 13 | BUS-E2 | `purchaseProofKeys` **obligatoire** + `orderNumber` **unique** (index) | `submit-purchase.dto.ts:51`, `schema.prisma` |
| 14 | BUS-C2 | Cron d'escalade/auto-résolution des sessions bloquées | nouveau scheduler |
| 15 | BUS-E3 | Appliquer réellement tous les `CampaignCriteria` (pas que `minTier`) | `test-sessions.service.ts:245` |

> **Atteinte du seuil ~90 % à la fin du Lot 3.** Les 15 actions = ~5 à 7 jours-homme cumulés.

### ⚪ Hors readiness de merge (tickets séparés)
- **Refonte flux paiement** (cf. `WORKFLOW_PAIEMENTS.md`) : remboursement auto à la soumission, récompense bloquée sur solde plateforme, `transfers.createReversal` (clawback), auto-`refundUnusedSlots` en fin de campagne. *Initiative produit, à séquencer à part — n'empêche pas le merge.*
- **Conformité (contenu/UI)** : consentement CGU à l'inscription, suppression/export de compte, `maskAllInputs:true`, médiateur conso.
- **Divers** : Swagger off en prod, mot de passe ≥ 12, énumération de comptes, DTO inline, double lockfile.

### 🔵 Conditions de LANCEMENT (après merge — rappel, hors scope merge)
- Configurer Stripe Connect + seeder `business_rules` + test end-to-end d'un payout réel.
- Compléter le **contenu** légal : mentions légales, CGU/CGV, responsable de traitement.
- Vérifier la désactivation du Data API REST Supabase (cf. §6).

---

## 9. Recommandation finale

`dev` n'est **pas encore mergeable proprement** (~60 %), mais le reste est court : **4 lots / ~5-7 jours-homme** mènent à ~90 % (cf. §8). Lot 0 (½ j) débloque le merge en levant les 2 derniers CRITIQUES ; Lots 1-3 montent la sécurité, ferment l'IDOR/SSRF et posent les garde-fous anti-fraude. Les sujets de **configuration** (Stripe, `business_rules`) et de **contenu légal** restent en aval, juste avant lancement, comme prévu. **RLS clos** sous réserve de la vérif Data API REST (§6). **Secrets de test** et **bonus sans preuve d'avis** : retirés des bloquants suite aux décisions équipe — le modèle anti-fraude par dissuasion (ban + KYC au retrait + notation PRO) est acceptable, à compléter par la garde anti auto-test (BUS-E1) et la preuve d'achat obligatoire (BUS-E2) qui restent les deux garde-fous à fort ROI.

---

*Audit de la branche `dev` (local == origin/dev) ; findings établis par analyse de code, critiques re-vérifiés fichier:ligne ; état Supabase/Stripe constaté en live le 23/06/2026. Items Stripe/business_rules/RLS sortis du scope de merge à la demande de l'équipe. Document à mettre à jour après chaque correction P0/P1.*
