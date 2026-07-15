# Audit Sécurité — SuperTry (Stripe · Sécurité transverse · Admin panel)

**Date :** 12 juillet 2026
**Périmètre :** implémentation Stripe (Connect, webhooks, capture, transferts, payouts, remboursements), sécurité applicative transverse, back-office admin (API + UI).
**Méthode :** lecture réelle du code (`supertry_api`, `supertry_saas`). Aucun fichier modifié.
**Repos :** API NestJS `supertry_api`, front Next.js `supertry_saas`.

> Cet audit complète et actualise `docs/AUDIT_STRIPE.md` (juin 2026). Les points de configuration prod déjà identifiés (table `business_rules` vide en prod, clé Stripe MCP live sans Connect) restent à vérifier — voir §5.

---

> **⚠️ Statut au 13 juillet 2026 — corrigés : les 3 CRITIQUES (S-1/S-2/S-3), le bug S-7, tout le lot P1 (S-4a/b/c/d + IDOR refund), S-6 (`business-rules` public), et le point 7 (`resolveDispute` atomique + mismatch DTO litige).** Voir §8 « Corrections appliquées ». Restent ouverts : rate-limit Redis + lockout, Swagger prod, IDOR `purchaseProofKeys`, CORS WS, pagination admin, et les chantiers structurels (maker-checker, 2FA admin, audit trail immuable).

## 0. Synthèse exécutive

L'implémentation Stripe est **mature et bien pensée** : signature webhook jamais contournable en prod, idempotence des transferts/payouts/refunds via clés déterministes, payouts en `manual` (modèle *Separate Charges & Transfers*), vérification du compte destinataire avant transfert, KYC dérivé du profil serveur, ancien endpoint de payout dangereux supprimé. Le socle applicatif est sain (Argon2id, `ValidationPipe` strict, SQL 100 % paramétré, ownership checks quasi systématiques, headers de sécurité, BFF front).

**Mais trois défauts structurels doivent être traités avant toute montée en charge :**

| # | Sévérité | Résumé |
|---|----------|--------|
| S-1 | 🔴 CRITIQUE | Module `Audit` sans contrôle de rôle : n'importe quel utilisateur lit, forge et **supprime** le journal d'audit (IDOR + anti-forensics) |
| S-2 | 🔴 CRITIQUE | `credit-tester-max` (admin) : pas de verrou, transfert hors transaction → double-crédit du wallet interne / argent non tracé (virement Stripe protégé par clé de secours) |
| S-3 | 🔴 ÉLEVÉ→CRITIQUE | Webhook : la dédup est écrite **avant** le traitement, et le `catch` renvoie 200 à Stripe → un handler financier qui échoue perd l'événement **définitivement** (pas de retry) |
| S-4 | 🟠 ÉLEVÉ | Plusieurs flux de paiement non atomiques / non idempotents (compensations, remboursement slots, transfert avant `$transaction`) |
| S-5 | 🟠 ÉLEVÉ | Aucun maker-checker ni 2FA admin ; audit trail non immuable, sans IP ni avant/après |
| S-6 | 🟠 ÉLEVÉ | `business-rules` `GET`/`latest` en `@Public()` : fuite de toute la mécanique tarifaire/anti-fraude |
| S-7 | 🟠 ÉLEVÉ | Bug : `req.user.userId` (undefined) dans Disputes → résolution de litige cassée + audit corrompu |

Le détail, les preuves `fichier:ligne` et les correctifs suivent. Un plan de remédiation priorisé figure en §7.

---

## 1. Audit Stripe

### 1.1 Ce qui est bien fait (à conserver)

- **Signature webhook** : `constructEvent` (`stripe.service.ts:1258`) vérifie la signature ; le bypass `STRIPE_SKIP_SIGNATURE_VERIFICATION` est **inconditionnellement désactivé en production** (`isProduction` forcé, l.1265-1268). Le `rawBody` n'est capturé que pour `/stripe/webhooks` (`main.ts:14-21`). Signature manquante → 400 (`stripe.controller.ts:388`).
- **Idempotence webhook** : `INSERT ... ON CONFLICT (id) DO NOTHING` race-safe sur `event.id` (`stripe.controller.ts:402-410`, migration `20260621160000_add_stripe_webhook_events`). Empêche les double-crédits sur retry Stripe.
- **Clés d'idempotence déterministes** (sans `Date.now()`) sur : transferts plateforme (`platform-transfer-<type>-<discriminator>`, `stripe.service.ts:938`), payouts (`payout-<withdrawalId>`, l.1035), refunds d'annulation (`cancel_<campaignId>`), capture de PI.
- **Payouts `manual`** (`stripe.service.ts:78-82`) : bloque les payouts automatiques, conforme au modèle *Separate Charges & Transfers* (l'argent reste sur la plateforme, transferts pilotés manuellement).
- **`source_transaction`** utilisé pour transférer immédiatement sans attendre la disponibilité des fonds (l.869-914).
- **Vérification du compte destinataire** avant transfert : `charges_enabled` + `currently_due` vides (`stripe.service.ts:856-866`).
- **KYC dérivé serveur** : pays et email pris sur le profil authentifié, **jamais du DTO client** (`stripe.controller.ts:76-81`) — empêche de rattacher un compte de paiement à une juridiction incohérente.
- **Anti-IDOR** sur le statut Identity (`stripe.controller.ts:312-323`) : on ne renvoie que si la session appartient à l'utilisateur.
- **Ancien endpoint dangereux supprimé** : `POST /stripe/payouts/create` (vidage de fonds) retiré, commentaire explicatif l.369-375. Seul `POST /withdrawals` (verrou pessimiste + KYC + débit atomique) crée un payout.
- **Plafonds de remboursement** : `Math.min(session.productPrice, maxReimbursedPrice)` (`payments.service.ts:187-188`) — filet anti-fraude sur les montants déclarés par le testeur.
- **Seuil KYC** vérifié avant chaque versement (`payments.service.ts:198-202`, 425-429).
- **Helpers de test** (`createTestTopUp`) interdits en prod (`stripe.service.ts:1097-1103`).
- **Scheduler de capture robuste** (`payment-capture.scheduler.ts`) : relit l'état réel du PI avant capture, gère `succeeded`/`requires_capture`, retries plafonnés (3), annule le PI pour **libérer l'autorisation** sur la carte avant retour en DRAFT, et annule les PI *stale* > 5 j avant l'expiration Stripe à 7 j.

### 1.2 Findings Stripe

#### S-3 · [ÉLEVÉ] Webhook : perte silencieuse d'événements financiers
`stripe.controller.ts:402-410` insère la ligne de déduplication **avant** d'exécuter le handler (l.423-528), et le `catch` global **avale l'erreur et renvoie 200** à Stripe (l.529-532, commentaire *« Don't throw - return 200 to Stripe to avoid retries »*).

Conséquence : si `handlePaymentIntentSucceeded`, `handleTransferReversed`, `handleChargeRefunded`… échoue (bug transitoire, DB indisponible), l'événement est **déjà marqué comme traité**. Stripe reçoit 200 → **aucun retry**. Et la dédup **bloquera tout rejeu manuel** du même `event.id`. L'effet financier est perdu sans trace exploitable (juste un `logger.error`).

**Impact :** désynchronisation wallet/escrow ↔ Stripe non rattrapable ; crédits/remboursements perdus.
**Correctif :**
- N'inscrire la dédup qu'**après** succès du handler (déplacer l'`INSERT ON CONFLICT` en fin de traitement), **ou**
- En cas d'échec sur un event critique, **`throw`** pour renvoyer un 5xx et laisser Stripe retenter (et ne pas persister la dédup), **ou**
- Persister les échecs dans une table *dead-letter* (`stripe_webhook_events.status = 'FAILED'`, payload conservé) avec un job de rejeu.
Recommandé : marquer `processing` à l'insert, `processed` en fin de succès, `failed` en cas d'exception, et rejouer les `failed`.

#### S-4a · [ÉLEVÉ] Transfert Stripe émis avant la `$transaction` DB
`payments.service.ts` — `processPurchaseReimbursement` déclenche le transfert (l.218) **avant** la `$transaction` d'écriture (l.263) ; idem `processBonusPayment` (transfert l.445, tx l.491).

Deux problèmes :
1. Si l'écriture DB échoue après un transfert réussi → argent parti, wallet interne + escrow non mis à jour, session non marquée `bonusPaidAt`/`purchaseReimbursedAt`.
2. La garde d'idempotence (`if (session.bonusPaidAt) return`) est lue **en début de méthode sans verrou** : deux appels concurrents la franchissent tous deux. La clé d'idempotence Stripe empêche le **double virement réel**, mais les deux `$transaction` DB peuvent **créditer deux fois le wallet interne** et décrémenter deux fois l'escrow → comptabilité interne fausse.

**Correctif :** verrou pessimiste (`SELECT … FOR UPDATE` sur la session/wallet, comme `withdrawals.service.ts:96`) ou passage du flag `bonusPaidAt` de façon conditionnelle **dans** la transaction (`updateMany where bonusPaidAt = null`) avant d'émettre le transfert ; couvrir le transfert par une logique de compensation si la DB échoue.

#### S-4b · [ÉLEVÉ] Compensations non atomiques et non idempotentes
`processSessionCancellationRefund` (`payments.service.ts:1161`) et `compensateTesterOnProCancellation` (l.1284) enchaînent `transaction.create` + `platformWallet.update` + `wallet.update` en **appels Prisma séparés, hors `$transaction`**. Une panne au milieu laisse l'escrow incohérent.

De plus, `compensateTesterOnProCancellation` appelle `createTransfer` **sans clé d'idempotence** (l.1326-1338) et **sans garde d'idempotence** sur la session → **double compensation** possible sur retry/double déclenchement.

**Correctif :** envelopper les écritures dans une seule `$transaction` (comme le fait très bien `processCampaignCancellationRefund`, l.970-1083) ; ajouter une clé d'idempotence déterministe (`compensation-<sessionId>`) et un flag anti-rejeu sur la session.

#### S-4c · [MOYEN] `refundUnusedSlots` sans idempotence
`payments.service.ts:715` : `createRefund` est appelé **sans `idempotencyKey`** et sans flag d'idempotence sur la campagne. Un double déclenchement (retry, double-clic, cron concurrent) **rembourse deux fois** les slots inutilisés. Contraste avec `processCampaignCancellationRefund` qui passe bien `cancel_<campaignId>`.
**Correctif :** `idempotencyKey: refund-unused-${campaignId}` + marqueur `unusedSlotsRefundedAt` sur la campagne.

#### S-4d · [MOYEN] `rejectByAdmin` (retraits) : garde de statut hors transaction
`withdrawals.service.ts` : la vérification `status !== PENDING` est faite **avant** la `$transaction`, et l'`update` interne n'a pas de garde conditionnelle. Deux rejets concurrents (double-clic admin) lisent tous deux `PENDING` puis **remboursent deux fois** le wallet.
**Correctif :** utiliser `updateMany({ where: { id, status: PENDING }, … })` et vérifier `count === 1` dans la transaction, ou `SELECT … FOR UPDATE`.

#### S-5-config · [MOYEN] Rappels de configuration prod (issus de l'audit de juin)
- Vérifier que `business_rules` est **seedé en prod** : `calculateCommission` / `findLatest` en dépendent ; une table vide fait échouer ou fausse tous les calculs de montants.
- Confirmer que la clé Stripe utilisée en prod a bien **Connect activé** (l'ancien constat MCP = clé live sans Connect empêcherait les transferts).
- `STRIPE_WEBHOOK_SECRET` obligatoire (le code jette si absent, l.1283) — s'assurer qu'il est défini par environnement.

#### S-6 · [FAIBLE] Logs verbeux d'erreurs Stripe
`stripe.service.ts:547-548` logge `JSON.stringify(sessionParams)` et l'erreur complète ; `createRefund` logge `charge`, `code`, `type`. Pas de secret, mais des identifiants financiers/PII partiels finissent dans les logs. À filtrer si les logs sont exportés.

---

## 2. Sécurité transverse

### 2.1 Bien fait
Argon2id (params sains), reset password (token 32 o, SHA-256 stocké, réponse générique, usage unique transactionnel, invalidation des sessions), OTP CSPRNG, cookies `httpOnly + secure(prod) + sameSite=lax`, `ValidationPipe` global `whitelist + forbidNonWhitelisted + transform` (neutralise le mass-assignment Prisma), filtre d'exception sans stack trace exposée, `passwordHash` jamais renvoyé, uploads avec sniff magic-bytes + SVG retiré + ACL `private`, SQL brut 100 % paramétré (`$queryRaw` tagged, aucun `Unsafe`), headers de sécurité (`main.ts:50-62`), CORS HTTP en allowlist, ticket WebSocket HMAC + `timingSafeEqual`, front BFF qui garde `API_URL` et le `service_role` Supabase côté serveur.

### 2.2 Findings transverses

#### S-1 · [CRITIQUE] Module `Audit` entièrement non protégé
`audit/audit.controller.ts` n'a **ni `@Roles`, ni contrôle d'appartenance**. Sous les guards globaux (session valide seulement), **tout utilisateur authentifié** (un simple testeur) peut :
- `GET /audit` → lire **tout le journal d'audit** de la plateforme, avec jointure `user` exposant email/nom/rôle de tous (fuite PII massive, `audit.service.ts:82-94`).
- `GET /audit/me?userId=<n'importe qui>` → **IDOR** (`userId` vient du query, jamais du token, `audit.controller.ts:63-75`).
- `POST /audit` → **forger** de fausses entrées.
- `DELETE /audit/cleanup?days=0` → **détruire tout le journal** (`deleteMany`). Anti-forensics.

Le code porte les TODO : `// (ADMIN only - à sécuriser avec guard)`.
**Correctif :** `@Roles(UserRole.ADMIN)` au niveau classe ; `GET /audit/me` scopé via `@CurrentUser('id')` (retirer le param) ; retirer `POST /audit` du HTTP (écriture interne uniquement) ; supprimer `DELETE /audit/cleanup` de l'API (le cron `audit.scheduler.ts` suffit) ou le réserver à un super-admin et le convertir en archivage.

#### S-6 · [ÉLEVÉ] `business-rules` `GET`/`latest` en `@Public()`
`business-rules.controller.ts:40-54` expose sans authentification `supertryCommission`, `stripeFeePercent`, seuils de paliers, `kycRequiredAfterTests`, `campaignCancellationFeePercent`, jours de ban… soit toute la mécanique tarifaire et anti-fraude.
**Correctif :** exposer une projection publique minimale (uniquement ce dont le front testeur/PRO a besoin) et réserver la vue complète à ADMIN.

#### [MOYEN] Rate-limiting en mémoire, fail-open, inefficace multi-pod
`common/guards/rate-limit.guard.ts:36` : store `new Map()` **par instance**. Avec `REPLICAS=2` (prod), le quota est divisé par pod et remis à zéro à chaque déploiement ; guard **fail-open** ; clé par **IP uniquement** (pas de lockout par compte → credential stuffing multi-IP). Correctement posé sur login/signup/reset.
**Correctif :** store Redis partagé (Redis déjà présent via Bull) + compteur d'échecs par compte sur `login`.

#### [MOYEN] Swagger exposé en production
`main.ts:78-155` : `SwaggerModule.setup` est appelé **inconditionnellement** → surface d'API documentée publiquement.
**Correctif :** `if (process.env.NODE_ENV !== 'production')` ou protéger derrière auth basic.

#### [MOYEN] IDOR de lecture S3 via `purchaseProofKeys`
`test-sessions.service.ts:942` stocke `purchaseProofKeys` fournis par le client **sans validation de préfixe** ; `getProofSignedUrl` (l.1473-1498) signe ensuite n'importe quelle clé présente. Un testeur peut injecter `profiles/<autre>/kyc.pdf` dans **sa** session puis obtenir une URL signée vers un objet privé d'autrui. (Le flux UGC valide correctement le préfixe — `ugc.service.ts:411`.)
**Correctif :** imposer `key.startsWith('purchases/<sessionId>/')` à la soumission ; idéalement générer les clés côté serveur (presigned PUT).

#### [MOYEN] WebSocket : CORS `origin: '*'` + repli token de session
`messages.gateway.ts:21` (`cors: { origin: '*' }`) et handshake qui retombe sur `validateSession(token)` alors que le ticket WS éphémère devait remplacer ce mode.
**Correctif :** restreindre `origin` à `CORS_ORIGINS` ; retirer le repli une fois les clients migrés.

#### [FAIBLE→MOYEN] Énumération de comptes
`/auth/check-email` renvoie `{ exists, role }` (oracle) ; `login` lève avant tout calcul Argon2 si le profil est absent (timing side-channel).
**Correctif :** réponse générique ; `verifyPassword` factice quand l'utilisateur n'existe pas pour égaliser les temps.

#### [FAIBLE / INFO]
- Cookie front `user_role` **non signé** utilisé par `middleware.ts` pour l'affichage des zones `/admin|/pro|/tester` : `httpOnly` empêche la forge JS, et les données restent protégées côté API — **défense en profondeur seulement**, à durcir (dériver le rôle via `/auth/session`).
- **Lucia v3** (EOL) : dette de maintenance à planifier.
- `.env` non suivi par git (bien) mais contient des secrets S3 dev **et prod** en commentaires clairs + flags `SKIP_*` → à purger.
- `/translate` et `/translate/batch` authentifiés mais **sans rate-limit** (risque de coût si backend externe).

---

## 3. Admin panel — audit de l'existant

### 3.1 Contrôle d'accès
Tous les contrôleurs `admin/*`, `admin-withdrawals`, `disputes` (résolution), `business-rules` (écriture), `gamification/admin/*` portent bien `@Roles(UserRole.ADMIN)` (vérifié un par un). Le rôle ADMIN **n'est pas attribuable en self-service** (`auth.service.ts:1161-1167` rejette `role === 'ADMIN'` à l'inscription/OAuth). **Le trou est le module Audit (S-1)** et `business-rules` public (S-6).

Front : `app/admin/layout.tsx` appelle `getCurrentUser()` mais **ne vérifie pas `role === ADMIN`** avant de rendre le shell (les données restent vides car l'API renvoie 403, mais l'UI s'affiche). À corriger par une redirection serveur.

### 3.2 Actions sensibles

#### S-2 · [CRITIQUE] `credit-tester-max` : double crédit interne + argent non tracé
`admin-moderation.service.ts` : l'anti-double-paiement est un simple `findFirst` sur les `TEST_REWARD COMPLETED` **hors transaction et sans verrou**. Le transfert Stripe est émis **avant** la `$transaction` DB.

Nuance : le virement Stripe lui-même est protégé, car `createPlatformToConnectTransfer` génère une clé d'idempotence de secours déterministe à partir des metadata (`platform-transfer-ADMIN_CREDIT_MAX-<sessionId>`) → pas de double virement réel. **Mais deux risques subsistent :**
1. **Double-crédit interne** — deux appels concurrents (double-clic) franchissent tous deux le `findFirst`, créent chacun une transaction `TEST_REWARD` et incrémentent deux fois le wallet + décrémentent deux fois l'escrow, alors que Stripe n'a viré qu'une fois → **wallet interne et escrow faussés**.
2. **Argent non tracé** — si la `$transaction` DB échoue après un transfert réussi, l'argent est parti sans aucune écriture locale (ni transaction, ni décrément d'escrow).

**Correctif :** verrou `SELECT … FOR UPDATE` sur le wallet/session ; passer le garde-fou d'idempotence **dans** la transaction (marquer l'intent avant le transfert) ; réconcilier en cas d'échec DB post-transfert.

#### [ÉLEVÉ] `resolveDispute` non atomique
`disputes.service.ts:199-395` : transfert testeur + refund PRO + updates `transaction`/`wallet`/`platformWallet` en appels séparés **sans `$transaction`**. Panne au milieu → état incohérent (escrow non décrémenté, session toujours `DISPUTED`).
**Correctif :** Stripe puis toutes les écritures DB dans une unique `$transaction` ; idempotence.

#### S-7 · [ÉLEVÉ] Bug `req.user.userId` (undefined) dans Disputes
`disputes.controller.ts:39,56,81` lit `req.user.userId` alors que le guard attache `request.user = profile` (clé `id`). Résultat : `resolveDispute(sessionId, undefined, dto)` → 403 **systématique** ; `createDispute` journalise `userId: undefined`.
**Correctif :** `req.user.id` (ou `@CurrentUser('id')` comme partout ailleurs).

#### [ÉLEVÉ] Audit trail non immuable
`schema.prisma` (`AuditLog`) ne stocke ni **IP**, ni **user-agent**, ni **avant/après**. `audit.service.ts` expose `cleanup()`/`deleteMany`, cron de purge à 90 j, aucune signature/hash-chaining → un ADMIN (ou n'importe qui via S-1) peut réécrire l'histoire.
**Correctif :** ajouter `ipAddress`, `userAgent`, `targetType/targetId`, `before`/`after` ; table append-only (révoquer DELETE au niveau DB ou hash-chaining) ; rétention longue pour les actions financières.

#### [ÉLEVÉ] Aucun maker-checker
Un seul ADMIN peut, seul : créditer un testeur, résoudre un litige, rejeter un retrait, **modifier les `business_rules`** (tarification de toute la plateforme), désactiver un compte, ajuster l'XP. Aucun seuil ne déclenche de double validation.

#### [MOYEN] Pagination non bornée (DoS)
`AuditFilterDto.limit` (`@Min(1)` sans `@Max`), `AdminSessionFilterDto` (ni `@IsInt` ni `@Max`), `admin/users/flagged` (`Number(query)` brut) → `?limit=99999999` charge des dizaines de milliers de lignes avec jointures.
**Correctif :** `@Max(100)` partout (comme `PaginationDto` qui est bien borné).

#### [MOYEN] `adjust-xp` sans borne · `reason` inline non validés
`admin-adjust-xp.dto.ts` : `@IsInt() amount` sans min/max (XP négatif géant possible). Endpoints `resolve-verification` / `withdrawal reject` prennent un `@Body() body: { … }` inline non validé.

#### [MOYEN] Mismatch DTO résolution de litige (UI cassée)
Le front envoie `{ resolution, reason }` alors que le backend exige `{ disputeResolution, testerAmount }` → rejet 400 (`forbidNonWhitelisted`). La résolution via l'UI ne fonctionne pas en l'état.

#### [FAIBLE] `priceRangeTiers: any` non validé · `execSync('df -B1 /')` (statique, sans injection).

### 3.3 API sans UI (actions sensibles pilotables seulement en appel brut)
`finance/campaigns/:id/breakdown`, `overview/products`, `users/flagged`, `verification-details`, `request-documents`, `business-rules DELETE`, `gamification adjust-xp`/`backfill`. Tests : **aucun `.spec.ts`** sur les modules qui déplacent de l'argent.

---

## 4. Admin panel — blueprint cible (fintech)

1. **RBAC granulaire** — remplacer l'enum binaire ADMIN par des rôles + permissions : `SUPPORT` (lecture + actions non financières), `FINANCE` (décaissements, litiges, refunds — sous maker-checker), `COMPLIANCE` (KYC, PII, ban), `OWNER` (business_rules, gestion des rôles), `AUDITOR` (read-only + journal). Table `Permission`/`RolePermission`, `@RequirePermission('finance.credit_tester')`, moindre privilège.
2. **Maker-checker** — table `PendingAction` ; toute action > seuil (crédit, refund, litige, **toute** modif `business_rules`) crée une demande `PENDING` validée par un **second** opérateur (maker ≠ checker) ; exécution idempotente à l'approbation.
3. **Audit log fintech** — append-only, `actorId/role, ip, userAgent, action, targetType/Id, amount, before/after, requestId`, **hash-chaining**, DELETE/UPDATE révoqués au niveau DB, rétention légale, journalisation des **consultations de PII** (KYC).
4. **Impersonation sécurisée** — jeton court, bannière permanente, **actions financières interdites** en impersonation, log `impersonatedBy`.
5. **Auth admin renforcée** — **2FA/TOTP obligatoire**, IP allowlist (fail-closed), **domaine/app admin séparé** (sous-domaine, cookie distinct, CORS restreint), sessions courtes + step-up pour actions critiques, enforcement `role === ADMIN` dans le layout.
6. **Observabilité** — alertes temps réel (Slack/PostHog) sur crédit testeur, résolution litige, refund, modif `business_rules`, désactivation de compte, `audit cleanup`, échec de transfert ; réconciliation planifiée wallet interne ↔ solde Stripe (`getPlatformBalance` existe déjà ; `wallet-reconciliation.scheduler` à exploiter).
7. **RGPD** — séparer rétention audit financier (longue) et PII opérationnelle (minimisation) ; restreindre `birthDate`/adresse au rôle COMPLIANCE.

**Vues à construire, par priorité :** (0) corriger S-1/S-2/S-7 avant tout ; (1) file maker-checker ; (2) journal d'audit enrichi ; (3) validation des retraits au-dessus d'un seuil ; (4) fiche testeur/PRO 360° ; (5) console litiges avec saisie du montant (corrige le mismatch DTO) ; (6) queue KYC/compliance (endpoints existants sans UI) ; (7) éditeur `business_rules` versionné + double validation ; (8) réconciliation financière + exports comptables bornés et audités.

---

## 5. Points de configuration à valider (prod)
- [ ] `business_rules` seedé en production (sinon calculs de montants faussés/plantés).
- [ ] Clé Stripe prod avec **Connect activé** + `STRIPE_WEBHOOK_SECRET` par environnement.
- [ ] `CORS_ORIGINS` / `FRONTEND_URL` définis (sinon aucune origine autorisée).
- [ ] `STRIPE_SKIP_SIGNATURE_VERIFICATION` et `SKIP_KYC_VERIFICATION` **jamais** à `true` hors dev (déjà bloqué en prod par le code pour la signature).
- [ ] Secrets purgés des commentaires de `.env`.

---

## 6. Tableau récapitulatif des findings

| # | Sévérité | Finding | Emplacement |
|---|----------|---------|-------------|
| S-1 | 🔴 CRITIQUE | Module Audit sans `@Roles` : lecture/forge/**suppression** du journal + IDOR | `audit/audit.controller.ts` |
| S-2 | 🔴 CRITIQUE | `credit-tester-max` sans verrou, transfert hors tx → double-crédit interne / argent non tracé | `admin-moderation.service.ts` |
| S-3 | 🔴 ÉLEVÉ | Webhook : dédup avant traitement + catch 200 → perte définitive d'events | `stripe.controller.ts:402-532` |
| S-4a | 🟠 ÉLEVÉ | Transfert Stripe avant `$transaction` + garde d'idempotence sans verrou | `payments.service.ts:218/263, 445/491` |
| S-4b | 🟠 ÉLEVÉ | Compensations non atomiques + `createTransfer` sans idempotence | `payments.service.ts:1161, 1284` |
| S-4c | 🟡 MOYEN | `refundUnusedSlots` sans clé d'idempotence ni flag | `payments.service.ts:715` |
| S-4d | 🟡 MOYEN | `rejectByAdmin` : garde de statut hors transaction → double refund | `withdrawals.service.ts` |
| S-5 | 🟠 ÉLEVÉ | Pas de maker-checker / 2FA ; audit trail non immuable, sans IP/before-after | transverse |
| S-6 | 🟠 ÉLEVÉ | `business-rules` `GET`/`latest` `@Public()` : fuite tarification/anti-fraude | `business-rules.controller.ts:40-54` |
| S-7 | 🟠 ÉLEVÉ | `req.user.userId` undefined → résolution de litige 403 + audit corrompu | `disputes.controller.ts:39,56,81` |
| — | 🟠 ÉLEVÉ | `resolveDispute` non atomique | `disputes.service.ts:199-395` |
| — | 🟡 MOYEN | Rate-limit en mémoire (multi-pod), Swagger prod, IDOR `purchaseProofKeys`, WS CORS `*`, pagination non bornée, DTO litige, `adjust-xp` non borné | voir détail |
| — | 🟢 FAIBLE | Énumération de comptes, cookie `user_role`, Lucia EOL, logs verbeux, `priceRangeTiers: any` | voir détail |
| — | ✅ BIEN | Idempotence Stripe, signature webhook, payouts manuels, KYC serveur, withdrawals atomiques, ADMIN non self-service, `ValidationPipe`, SQL paramétré | — |

---

## 7. Plan de remédiation priorisé

**P0 — à traiter immédiatement (argent réel / destruction de preuves)**
1. S-1 : `@Roles(ADMIN)` sur `AuditController` + scoper `/me` + retirer `POST`/`DELETE cleanup` du HTTP. *(quick win)*
2. S-2 : verrou + idempotence sur `credit-tester-max`, transfert couvert par la transaction.
3. S-3 : ne marquer la dédup webhook qu'après succès, ou dead-letter + rejeu.
4. S-7 : corriger `req.user.userId` → `req.user.id`.

**P1 — semaine suivante**
5. S-4a/b/c/d : atomicité + idempotence sur reimbursement, bonus, compensations, refund slots, reject retrait.
6. S-6 : projection publique minimale des business rules.
7. `resolveDispute` atomique + fix du mismatch DTO côté UI.
8. Rate-limit Redis + lockout par compte ; Swagger désactivé en prod.

**P2 — durcissement structurel**
9. Audit trail immuable (IP, before/after, hash-chaining) + retrait du cleanup destructif.
10. Maker-checker + 2FA admin + enforcement `role===ADMIN` côté layout.
11. Bornes de pagination, validation des `@Body` inline, IDOR `purchaseProofKeys`, CORS WS.
12. Tests automatisés sur les flux financiers.

**P3 — vérifs config prod** : voir §5.

---

## 8. Corrections appliquées (13 juillet 2026)

Les **3 findings CRITIQUES (S-1, S-2, S-3)** sont corrigés. Schéma Prisma validé (`prisma validate`) et compilation TypeScript OK.

### S-1 — Module Audit verrouillé
`src/modules/audit/audit.controller.ts` (réécrit), `dto/audit-filter.dto.ts`
- `@Roles(UserRole.ADMIN)` au niveau de la **classe**.
- `GET /audit/me` : l'identifiant vient désormais du token (`@CurrentUser('id')`), le paramètre `?userId=` est supprimé → **IDOR fermé**. Reste ouvert à USER/PRO/ADMIN pour leurs propres logs (le `@Roles` du handler prime sur celui de la classe).
- **`POST /audit` supprimé** : l'écriture reste strictement interne via `AuditService.log` → piste d'audit non falsifiable.
- **`DELETE /audit/cleanup` supprimé** : la purge est déjà assurée par `AuditScheduler` (cron quotidien 3h) → **anti-forensics fermé**.
- Bonus : `@Max(100)` sur `AuditFilterDto.limit` (DoS / exfiltration massive).
- *Impact nul côté front* : l'UI admin appelle `/admin/audit-logs` (endpoint inexistant), aucun appelant des routes retirées.

### S-2 — `credit-tester-max` : pattern « réserver → transférer → solder »
`src/modules/admin/admin-moderation.service.ts`
- **Phase 1** (`$transaction`) : verrou pessimiste `SELECT id FROM wallets WHERE user_id = … FOR UPDATE` (sérialise les appels concurrents), puis recalcul du restant dû via un **`aggregate` sommant les `TEST_REWARD` COMPLETED *et* PENDING** — un appel concurrent voit donc la réservation de l'autre. Création d'une transaction **PENDING = réservation atomique**.
- **Phase 2** : transfert Stripe avec **clé d'idempotence explicite** `admin-credit-max-<reservationId>`.
- **Phase 3** (`$transaction`) : la réservation passe à COMPLETED (+ `stripeTransferId`) et les soldes wallet/escrow sont mis à jour.
- **Échec Stripe** → la réservation passe à `FAILED` (ne bloque pas une nouvelle tentative) + audit `ADMIN_CREDIT_TESTER_MAX_FAILED`.
- **Crash entre 2 et 3** → la ligne PENDING subsiste en base : l'argent reste **réconciliable** (plus d'argent non tracé).
- Résultat : plus de double-crédit du wallet interne, plus de double-décrément d'escrow.

### S-3 — Webhook Stripe : plus de perte silencieuse d'événements
`prisma/schema.prisma`, migration `20260713090000_stripe_webhook_event_status`, `src/modules/stripe/stripe.controller.ts`, i18n (7 locales)
- Nouvel enum `StripeWebhookStatus` (`PROCESSING` / `PROCESSED` / `FAILED`) + colonnes `attempts`, `last_error`, `received_at` sur `stripe_webhook_events` ; `processed_at` devient nullable (renseigné **au succès uniquement**). Les lignes existantes sont migrées en `PROCESSED`.
- **Réclamation atomique** de l'event (race-safe via la PK) : `INSERT … ON CONFLICT (id) DO UPDATE … WHERE status = 'FAILED' RETURNING attempts`.
  - Ligne absente → traitée. Ligne `FAILED` → **reprise** (attempts+1). Ligne `PROCESSED`/`PROCESSING` → doublon ignoré (200).
- L'event n'est marqué **`PROCESSED` qu'APRÈS succès** du handler.
- **En cas d'échec** : statut `FAILED` + `lastError` + audit `STRIPE_WEBHOOK_FAILED`, puis **500 renvoyé à Stripe** → retry automatique avec backoff (au lieu du 200 qui perdait l'event définitivement).
- **Garde anti-poison** : au-delà de `MAX_WEBHOOK_ATTEMPTS = 5`, on répond 200 pour stopper la tempête de retries, mais l'event **reste en `FAILED` donc rejouable manuellement**.

### S-7 — Bug `req.user.userId` (Disputes) corrigé
`src/modules/disputes/disputes.controller.ts`
- Les 3 sites (`createDispute`, `resolveDispute`, `getDisputeDetails`) lisaient `req.user.userId`, toujours `undefined` car le guard attache `request.user = profile` (clé `id`). Conséquences : résolution de litige **403 systématique** et litiges journalisés avec `userId=null`.
- Remplacé par `@CurrentUser('id')` (convention du reste du codebase) ; import `@Request` retiré. Vérifié : plus aucune occurrence de `user.userId` ailleurs dans le codebase.

### Lot P1 — S-4a/b/c/d + IDOR refund (13 juillet 2026)
Atomicité et idempotence des flux de paiement restants. Schéma validé, compilation OK.

**S-4a — `processPurchaseReimbursement` / `processBonusPayment`** (`payments.service.ts`)
- **Claim atomique** avant le transfert Stripe : `updateMany({ where: { id, purchaseReimbursedAt: null }, … })` (resp. `bonusPaidAt`). Le second appelant concurrent voit `count=0` et sort en idempotent → plus de double-crédit interne.
- En cas d'échec Stripe, le claim est **relâché** (flag remis à `null`) pour permettre une nouvelle tentative. Le double-marquage dans la `$transaction` finale a été retiré.

**S-4b — `processSessionCancellationRefund` / `compensateTesterOnProCancellation`** (`payments.service.ts`, `stripe.service.ts`)
- Garde d'**idempotence** par existence de transaction (`CANCELLATION_COMMISSION` / `TESTER_COMPENSATION` pour la session).
- Écritures financières regroupées dans une **`$transaction` unique** (avant : appels Prisma séparés → escrow incohérent en cas de crash).
- Ajout d'un paramètre `idempotencyKey` à `StripeService.createTransfer` ; la compensation passe `compensation-pro-session-<sessionId>`.

**S-4c — `refundUnusedSlots`** (`payments.service.ts`, `payments.controller.ts`, schéma)
- Nouveau flag `Campaign.unusedSlotsRefundedAt` (migration `20260713093000_campaign_unused_slots_refunded_at`) + **claim atomique** ; second appel → `PAYMENT_ALREADY_REFUNDED` (400).
- **Clé d'idempotence** `refund-unused-<campaignId>` sur le refund Stripe ; claim relâché en cas d'échec.
- **IDOR corrigé au passage** : l'endpoint `POST /payments/campaigns/:id/refund` (`@Roles(PRO)`) ne vérifiait pas l'appartenance — le `userId` capturé était inutilisé. Un PRO pouvait rembourser la campagne d'un autre. Contrôle `campaign.sellerId === userId` ajouté (403 sinon).

**S-4d — `rejectByAdmin`** (`withdrawals.service.ts`)
- Transition de statut **conditionnelle dans la transaction** : `updateMany({ where: { id, status: PENDING }, … })` ; si `count=0`, pas de second refund. Empêche le double-crédit du wallet sur double-clic admin.

Nouvelles clés i18n (7 locales) : `stripe.webhook_processing_failed` (S-3), `payment.already_refunded` (S-4c).

### S-6 — `business-rules` : projection publique minimale
`business-rules.controller.ts`, `business-rules.service.ts`, `dto/public-business-rules.dto.ts`
- `GET /business-rules/latest` reste public mais renvoie désormais un **`PublicBusinessRulesDto`** limité aux champs tarifaires d'affichage (testerBonus, commissionFixedFee, stripeFeePercent, priceRangeTiers, paliers Bronze→Diamant) — exactement ce que le front (`useBusinessRules`) consomme. La mécanique anti-fraude/opérationnelle (bannissement, seuil KYC, commissions UGC/tips, XP, délais de capture) n'est plus exposée sans authentification.
- `GET /business-rules` (liste complète de toutes les versions) passe de `@Public()` à **`@Roles(ADMIN)`** (page de config admin, contexte authentifié).

### P1-7 — `resolveDispute` atomique + modèle de résolution aligné (backend + front)
`disputes.service.ts`, `dto/resolve-dispute.dto.ts`, `[saas] disputes-table.tsx`
- **Atomicité** : refactor en 2 phases — appels Stripe (transfert testeur + refund PRO) puis **toutes les écritures DB dans une seule `$transaction`** (avant : appels entrelacés → escrow incohérent en cas de panne).
- **Idempotence** : garde par existence de transaction `DISPUTE_RESOLUTION` (rejet `DISPUTE_ALREADY_RESOLVED`) + **clé d'idempotence** `dispute-refund-<sessionId>` sur le refund PRO.
- **Mismatch DTO résolu (modèle binaire choisi)** : le DTO backend accepte désormais `{ resolution: 'REFUND_TESTER' | 'REFUND_PRO', reason }` — ce que le front envoyait déjà. Le **montant est calculé côté serveur** (REFUND_TESTER → testeur reçoit le max, REFUND_PRO → PRO intégralement remboursé), jamais fourni par le client. Le front expose deux boutons explicites (« Refund tester » / « Refund PRO ») ; le dialogue de confirmation indique le sens choisi. La résolution de litige via l'UI fonctionne à nouveau (auparavant : rejet 400).

### À faire avant déploiement
```bash
npx prisma generate          # requis : nouvel enum + colonnes (webhook, unusedSlotsRefundedAt)
npx prisma migrate deploy    # applique 20260713090000_* et 20260713093000_*
```
*(S-6 et P1-7 ne nécessitent aucune migration.)*
*(`prisma generate` n'a pas pu être exécuté dans le sandbox — EPERM sur `node_modules` — mais le schéma est validé et la compilation a été vérifiée contre un client généré à partir de ce schéma.)*

**Suggestion de suivi :** ajouter une alerte sur `stripe_webhook_events.status = 'FAILED'` (aucun event ne doit y rester durablement) et un endpoint/commande de rejeu manuel.
