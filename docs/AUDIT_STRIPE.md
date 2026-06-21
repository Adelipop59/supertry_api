# Audit Stripe — SuperTry API

> **Mise à jour 21/06/2026 — 1ʳᵉ passe de corrections appliquée (quick wins critiques).** Voir [§10](#10-corrections-appliquées-passe-1).

**Date :** 21 juin 2026
**Périmètre :** KYC / Stripe Connect, retrait (withdraw/payout) testeur, phases de paiement des campagnes (PRO), sécurité des webhooks.
**Méthode :** lecture du code (`supertry_api`), vérification manuelle des findings critiques sur le code réel. Le croisement avec les données Stripe live (compte test) **n'a pas pu être effectué** : le connecteur Stripe est resté déconnecté pendant la session. Voir [§9](#9-vérifications-stripe-live-à-faire).

---

## 1. Résumé exécutif

L'architecture est saine dans ses fondations : modèle « Separate Charges & Transfers », vérification de signature des webhooks avec `rawBody`, verrou pessimiste sur le wallet, autorisations (authz) correctement liées à l'utilisateur serveur, statut KYC dérivé de webhooks signés, montants stockés en `Decimal`.

**Mais plusieurs failles touchent directement le mouvement d'argent réel et doivent être corrigées avant toute mise en production / montée en charge.** Les trois plus dangereuses :

1. **Un second chemin de retrait non sécurisé** (`POST /stripe/payouts/create`) qui contourne le débit du wallet et la vérification d'identité → vidage de fonds possible.
2. **L'idempotence Stripe est cassée** sur les payouts (clé avec `Date.now()`) et **absente** sur les webhooks (pas de déduplication d'`event.id`) → double virement et double re-crédit de solde possibles sur un simple retry réseau, scénario garanti par le modèle « at-least-once » de Stripe.
3. **Le flux de paiement campagne « pay » capture immédiatement** (pas de capture différée) alors que le reste du code suppose un escrow avec capture différée → l'annulation/remboursement d'une campagne échoue, et le scheduler de capture remet des campagnes déjà payées en brouillon.

| Sévérité | Nombre |
|----------|--------|
| 🔴 Critique | 6 (dont C6, ajouté après vérif live) |
| 🟠 Élevé | 8 (dont H8) |
| 🟡 Moyen | 9 (dont M9) |
| ⚪ Faible | 4 |

> Findings ajoutés après le croisement live Stripe/Supabase du 21/06 : **C6** (business_rules vide en prod), **H8** (incohérence Identity/retrait), **M9** (capability `card_payments` superflue). Détails en [§9](#9-vérifications-stripe-live-effectuées-le-21062026).

---

## 2. Findings critiques 🔴

### C1 — Endpoint payout direct qui contourne tout le pipeline de retrait sécurisé
**Fichier :** `src/modules/stripe/stripe.controller.ts:347-370`

```ts
@Post('payouts/create')
@Roles(UserRole.USER)
async createPayout(@CurrentUser('id') userId, @Body() dto: { amount: number; withdrawalId: string }) {
  const profile = await this.prisma.profile.findUnique({ where: { id: userId }, select: { stripeConnectAccountId: true } });
  if (!profile?.stripeConnectAccountId) { throw ... }
  return this.stripeService.createPayout(dto.amount, profile.stripeConnectAccountId, 'eur', { withdrawalId: dto.withdrawalId });
}
```

Il existe **deux chemins** pour déclencher un virement vers l'IBAN du testeur :
- `POST /withdrawals` → `createWithdrawal()` : vérifie onboarding **et** `stripeIdentityVerified`, pose un verrou `FOR UPDATE` sur le wallet, **débite le solde**, puis crée le payout. **Correct.**
- `POST /stripe/payouts/create` → appelle `createPayout()` **directement** : ne lit pas le wallet, ne le débite pas, ne vérifie pas l'identité. Le **montant** et le `withdrawalId` viennent **entièrement du client**.

**Impact :** un testeur authentifié peut retirer un montant arbitraire des fonds présents sur son compte Connect, sans débit correspondant du wallet et sans KYC Identity → double-retrait / contournement KYC.

**Correction :** supprimer cet endpoint, ou le rerouter vers `withdrawalsService.createWithdrawal(userId, amount)`. Ne jamais exposer `createPayout` brut côté testeur ; le `withdrawalId` ne doit jamais venir du client.

---

### C2 — Idempotence Stripe cassée sur les payouts (et transfers) par `Date.now()`
**Fichier :** `src/modules/stripe/stripe.service.ts:1021` (payout), `:929` (transfer plateforme)

```ts
idempotencyKey: `payout-${metadata.withdrawalId}-${Date.now()}`,
```

`Date.now()` rend la clé **unique à chaque appel** → la protection d'idempotence de Stripe ne joue plus. En cas de retry (timeout réseau, double déclenchement), **deux virements réels** peuvent partir pour le même retrait. Si `metadata.withdrawalId` est absent, la clé devient `payout-undefined-<timestamp>`.

**Correction :** clé déterministe et stable, `idempotencyKey: \`payout-${withdrawalId}\`` (sans timestamp). Idem pour le transfer `:929`.

---

### C3 — Le flux de paiement campagne « pay » capture immédiatement (pas de capture différée)
**Fichiers :** `src/modules/payments/payments.service.ts:178-197` · `src/modules/stripe/stripe.service.ts:468`

`processCampaignPayment` appelle `createPaymentIntent(...)` **sans** passer `captureMethod`, donc :

```ts
// stripe.service.ts:468
capture_method: options.captureMethod || 'automatic',
```

→ capture **automatique** (immédiate). Puis le code exige `status === 'succeeded'` (`:195`) et met la campagne en `PENDING_ACTIVATION` avec `paymentAuthorizedAt`, **sans jamais poser `paymentCapturedAt`** (`:253-261`). Seul le flux « checkout » (`stripe.controller.ts:633`) utilise `captureMethod: 'manual'`.

**Impacts en chaîne :**
- L'annulation d'une campagne (`processCampaignCancellationRefund`) teste `if (!campaign.paymentCapturedAt) cancelPaymentIntent(...)` → elle appelle `cancel` sur un PaymentIntent **déjà capturé** → erreur Stripe → **l'annulation/remboursement échoue**. La promesse « annulez sous 1h sans frais » est cassée.
- Le scheduler de capture re-tente une capture sur un PI déjà capturé (voir H4).
- État incohérent : campagne `PENDING_ACTIVATION` avec argent **déjà prélevé** mais `paymentCapturedAt = null`, indiscernable d'une vraie autorisation non capturée.

**Correction :** passer `captureMethod: 'manual'` dans `processCampaignPayment` et attendre `requires_capture` (pas `succeeded`) ; **ou** unifier sur le flux « checkout » manual capture et supprimer le flux « pay ». Garantir l'invariant **`ACTIVE ⇔ paymentCapturedAt != null`**.

---

### C4 — Aucune déduplication des webhooks Stripe → double re-crédit / double décrément
**Fichiers :** `src/modules/stripe/stripe.controller.ts:376+` (handler) · `src/modules/stripe/handlers/webhook-handlers.service.ts` · `prisma/schema.prisma` (aucun modèle de déduplication)

Aucune table ne stocke les `event.id` déjà traités (vérifié : pas de `StripeWebhookEvent`/équivalent dans le schéma). Stripe garantit une livraison **« at-least-once »** — les rejeux sont normaux. Plusieurs handlers ne sont pas idempotents et n'ont pas de garde de transition de statut :
- `handlePayoutFailed` (`:1378`) et `handlePayoutCanceled` (`:1440`) **re-créditent le wallet** sans vérifier le statut courant → un rejeu re-crédite **une seconde fois**.
- `handleChargeRefunded` (`:1149`) **décrémente** `escrowBalance`/`totalReceived` ; la garde ne protège que les refunds **complets**, donc un refund **partiel** ré-exécute le décrément à chaque rejeu.
- `handlePayoutPaid` (`:1330`) passe à `COMPLETED` sans garde (events en double / désordre).

**Impact :** un testeur peut récupérer 2× son montant sur un `payout.failed` rejoué ; la comptabilité `PlatformWallet` se corrompt. **Perte financière directe.**

**Correction :** (1) table `StripeWebhookEvent { id @id }`, insérée en début de handler dans une transaction, skip si déjà présent. (2) re-crédits **conditionnels** : `updateMany({ where: { id, status: { in: [PENDING, PROCESSING] } }, ... })` et ne créditer que si `count === 1`. (3) ajustements escrow basés sur le **delta** de refund, pas sur le cumulé.

---

### C5 — Frais plateforme à 3,5 % au lieu de 3,9 % (non conforme au pricing officiel)
**Fichiers :** `prisma/schema.prisma:1271` · `src/modules/business-rules/business-rules.service.ts`

```prisma
stripeFeePercent Decimal @default(0.035) ... // % couverture frais Stripe (3.5%)
```

Le pricing officiel SuperTry est **10 € + 3,9 %** (cf. doc interne). Le code et le `@default` utilisent **3,5 %** → sous-facturation de **0,4 point** sur chaque testeur, perte de marge systématique. Le breakdown affiché au PRO reflète la valeur réelle (3,5 %), donc divergence avec la communication commerciale.

**Note :** la valeur effective est celle **persistée en base** via `BusinessRules` (le `@default` ne s'applique qu'à la création). **À vérifier en prod** : si la ligne `BusinessRules` est restée au défaut, l'écart est actif.

**Correction :** porter `stripeFeePercent` à `0.039` (en base + `@default` + commentaires) **et** ajouter un fallback de sécurité à 3,9 % dans `calculateCommission` si la règle est absente/invalide (au lieu de throw — cf. C6). Voir aussi M6 (frais fixe non modélisé). **Vérifié en live (§9) : dev = 3,5 % ; prod = aucune règle.**

---

## 3. Findings élevés 🟠

### H1 — Deux soldes parallèles jamais réconciliés : wallet DB ≠ solde Stripe Connect
**Fichiers :** `src/modules/withdrawals/withdrawals.service.ts:96-121` · `src/modules/stripe/stripe.service.ts:966-1013`

Le check + débit portent sur `wallets.balance` (Postgres), mais le payout est exécuté sur le **solde du compte Stripe Connect** (`balance.retrieve` puis `payouts.create`). Rien ne garantit l'égalité des deux. Si le solde Stripe est inférieur (fonds `pending`), le check DB passe mais le payout échoue ; aucun invariant `wallet.balance == solde Connect disponible` n'est testé. Risque de litiges et d'incohérences comptables.

**Correction :** choisir une source de vérité unique (recommandé : le ledger DB fait autorité, Stripe exécute), avec réconciliation systématique via webhooks `balance`/`payout`.

### H2 — `escrowAmount` non écrit au paiement → remboursement post-capture = 0
**Fichiers :** `src/modules/payments/payments.service.ts:253-261` · `src/modules/campaigns/campaigns.service.ts:1108` · `payments.service.ts:1063`

L'update de campagne dans `processCampaignPayment` ne renseigne pas `escrowAmount` (qui reste à `@default(0)`). Or l'annulation calcule `remainingAmount = Number(campaign.escrowAmount) - …` → si `escrowAmount = 0`, le montant remboursé devient `≤ 0` : **le PRO n'est pas remboursé** alors que l'argent a été prélevé.

**Correction :** poser `escrowAmount: escrow.totalAmount` dans l'update campagne au moment du paiement.

### H3 — Pas d'`idempotencyKey` sur create/confirm PaymentIntent + checks hors transaction → double paiement
**Fichiers :** `src/modules/stripe/stripe.service.ts:452,562` · `payments.service.ts:163-170`

Les gardes applicatives (`status !== DRAFT`, `stripePaymentIntentId` déjà posé) sont faites **hors transaction**, sans verrou, **avant** les appels Stripe. Deux requêtes « pay » concurrentes (double-clic / retry) passent toutes deux les checks → **deux PaymentIntents créés et confirmés** → double débit carte. La contrainte `@unique` ne se déclenche qu'à l'écriture DB, après les charges Stripe.

**Correction :** `idempotencyKey` déterministe (`pay_${campaignId}`) sur `paymentIntents.create`/`confirm`, et update conditionnel `WHERE status = DRAFT` dans une transaction avant l'appel Stripe.

### H4 — Le scheduler de capture nullifie des campagnes déjà payées
**Fichier :** `src/modules/payments/payment-capture.scheduler.ts:55-156`

Le CRON sélectionne les campagnes `paymentCapturedAt: null` et appelle `capturePaymentIntent` sans vérifier l'état réel du PI. Combiné à C3 (PI déjà `succeeded`), la capture lève « cannot be captured », l'erreur incrémente `captureRetryCount`, et après 3 essais **remet la campagne en `DRAFT` avec `stripePaymentIntentId: null`** — alors que **l'argent du PRO a déjà été prélevé**. Fonds orphelins, perte de traçabilité.

**Correction :** `getPaymentIntent` avant capture ; ne capturer que si `status === 'requires_capture'` ; si `succeeded`, poser `paymentCapturedAt` + `ACTIVE` sans recapturer ; ne jamais nullifier `stripePaymentIntentId`.

### H5 — Le workflow d'approbation admin des retraits est illusoire
**Fichiers :** `src/modules/withdrawals/withdrawals.service.ts:140,230,407` · `admin-withdrawals.controller.ts`

`createWithdrawal` enchaîne `PENDING` → payout Stripe → `PROCESSING` dans le même appel. Le payout **part avant** toute revue. `rejectByAdmin`/`cancelWithdrawal` exigent `status === PENDING`, état qui ne dure que quelques millisecondes. Aucune revue anti-fraude possible avant l'envoi d'argent.

**Correction :** si une approbation est voulue, séparer création (`PENDING`, sans payout) et exécution (action admin `approve` → `createPayout`). Sinon documenter explicitement que les retraits sont auto-approuvés.

### H6 — `country` / `email` du compte Connect fournis par le client sans whitelist
**Fichiers :** `src/modules/stripe/dto/create-connect-account.dto.ts` · `stripe.controller.ts:77`

Le compte Connect est créé avec `createDto.country` (`@IsString()`, aucune valeur contrôlée) et `createDto.email`, au lieu d'être dérivés du profil serveur authentifié. Le pays détermine la juridiction KYC et la devise de payout ; un client peut créer son compte avec un pays/email incohérent avec son identité réelle → affaiblissement du KYC.

**Correction :** whitelist `@IsIn([...])` / `@IsISO31661Alpha2()` sur `country` ; dériver `email`/`country` du profil serveur, pas du body.

### H7 — Course entre le `catch` de débit et le webhook payout → double dépense
**Fichiers :** `src/modules/withdrawals/withdrawals.service.ts:187-204` · `webhook-handlers.service.ts:1374`

Si `createPayout` lève une erreur **après** que Stripe a réellement créé le payout (timeout sur la réponse), le `catch` marque `FAILED` et **re-crédite le wallet**. Le payout réussit ensuite côté Stripe → `payout.paid` marque `COMPLETED`. Résultat : argent parti **et** solde rendu.

**Correction :** ne pas re-créditer sur erreur réseau/timeout (état incertain) ; marquer `PROCESSING`/`UNKNOWN` et laisser le webhook trancher ; s'appuyer sur l'`idempotencyKey` stable (C2) pour retrouver le payout existant.

---

## 4. Findings moyens 🟡

| # | Sujet | Fichier:ligne | Correction |
|---|-------|---------------|------------|
| M1 | Double comptabilisation escrow (création + capture ; webhook + CRON), sans transaction partagée ni flag idempotent | `payments.service.ts:234` · `payment-capture.scheduler.ts:91` | Centraliser la compta escrow en un seul point, gardé par `WHERE paymentCapturedAt IS NULL` |
| M2 | IDOR sur `GET /stripe/identity/status/:sessionId` : pas de vérif que la session appartient au user | `stripe.controller.ts:296-304` | Comparer `sessionId` à `profile.stripeIdentitySessionId` |
| M3 | `returnUrl`/`refreshUrl` des account links et de l'Identity session sans whitelist → open redirect / phishing crédible (flux part d'un vrai domaine Stripe) | `dto/create-onboarding-link.dto.ts` · `stripe.controller.ts:282` | Whitelist de domaines, ou construire les URLs côté serveur |
| M4 | `cancelWithdrawal`/`rejectByAdmin` : check de statut hors transaction (TOCTOU) → double re-crédit concurrent | `withdrawals.service.ts:230,407` | `updateMany WHERE status=PENDING` + créditer si `count===1`, dans une transaction |
| M5 | Remboursement recalculé sur les BusinessRules **live**, pas sur le breakdown figé au paiement (stocké dans `transaction.metadata` mais non réutilisé) | `payments.service.ts:883,1083` | Rembourser sur la base du breakdown figé au paiement |
| M6 | Montants en float (euros), conversion centimes tardive ; pas de **frais fixe** Stripe (0,25 €) modélisé → arrondis cumulés + couverture insuffisante sur petits montants | `stripe.service.ts:465,649,729` · `business-rules.service.ts:56` | Travailler en entiers centimes ; ajouter `stripeFeeFixed` |
| M7 | Deux flux de paiement divergents (`PENDING_ACTIVATION` vs `PENDING_PAYMENT`, auto vs manual capture) non réconciliés | `payments.controller.ts:38,71` | Choisir un seul flux (cf. C3) |
| M8 | `handlePayoutPaid` non idempotent / transitions désordonnées (emails + events PostHog en double) | `webhook-handlers.service.ts:1330` | Transition conditionnelle `WHERE status=PROCESSING` + dédup `event.id` (C4) |

---

## 5. Findings faibles ⚪

| # | Sujet | Fichier:ligne | Correction |
|---|-------|---------------|------------|
| L1 | Bypass de vérification de signature webhook activable par env, sans garde `NODE_ENV=production` | `stripe.service.ts:1248-1260` | Forcer `skipVerification = false` si `NODE_ENV === 'production'` |
| L2 | Logs verbeux `JSON.stringify(error/params)` → PII potentielle dans les logs (aucun secret/clé API loggé en dur, bon point) | `stripe.service.ts:547-548,750` | Logger des champs ciblés, pas les objets complets |
| L3 | Création de compte Connect : pas de garde de concurrence entre `findUnique` et `update` → second compte orphelin possible | `stripe.controller.ts:68-96` | Re-vérifier l'absence de compte dans une transaction avant `update` |
| L4 | DTO de retrait sans `@Max` ni `maxDecimalPlaces` (accepte `10.999`) | `dto/create-withdrawal.dto.ts:11` | `@IsNumber({ maxDecimalPlaces: 2 })` + `@Max(plafond)` |

---

## 6. Ce qui est bien fait ✅

- **Vérification de signature webhook correcte** : `rawBody` est bien capturé uniquement pour les webhooks Stripe (`main.ts:9-18`) et `constructEvent(rawBody, signature)` est utilisé, avec rejet si signature absente.
- **Verrou pessimiste** `SELECT … FOR UPDATE` sur le wallet dans `createWithdrawal` → check + débit atomiques contre le double-spend concurrent (sur le chemin sécurisé).
- **KYC = source de vérité fiable** : statut dérivé du webhook signé `account.updated` (lookup par `stripeConnectAccountId`) et de `accounts.retrieve` ; non falsifiable par le client.
- **Authz solide** : endpoints Connect liés au `userId` serveur (pas au DTO), ownership campagne (`sellerId`) vérifié, `@Roles(ADMIN)` + `RolesGuard` global sur l'admin, montants de paiement **recalculés côté serveur** (le DTO ne porte que `paymentMethodId`).
- **Payouts en mode manuel** (`schedule.interval: 'manual'`), compte `express`/`individual` cohérent.
- **Anticipation de l'expiration des autorisations (7 j)** : `handleStalePayments` annule les PI > 5 j.
- **Gardes d'idempotence métier** : `purchaseReimbursedAt`, `bonusPaidAt`, `handlePaymentIntentAmountCapturableUpdated`.
- **`createTestTopUp` bloqué en production.**

---

## 7. Plan de remédiation priorisé

**Avant tout passage en production / montée en charge :**
1. **C1** — supprimer/rerouter `POST /stripe/payouts/create`.
2. **C2** — `idempotencyKey` déterministe sur payouts et transfers (correctif trivial, impact majeur).
3. **C4** — table de déduplication `event.id` + re-crédits/ajustements escrow conditionnels et basés sur deltas.
4. **C3 + H4 + M7** — trancher un flux de paiement unique en **manual capture**, garantir `ACTIVE ⇔ paymentCapturedAt`, durcir le scheduler.
5. **C5 + M6** — passer à **3,9 %** + modéliser le frais fixe ; vérifier la valeur réellement persistée en base.

**Ensuite :** H1 (réconciliation des soldes), H2 (`escrowAmount` au paiement), H3 (idempotence paiement), H5 (workflow d'approbation), H6 (whitelist country/email), H7 (course catch/webhook), puis les moyens et faibles.

---

## 8. Limites de l'audit

Audit statique du code à date du 21 juin 2026. Non couvert : valeurs réellement persistées en base de production (notamment `BusinessRules.stripeFeePercent`), configuration réelle des comptes Connect chez Stripe, comportement runtime sous charge concurrente (les races décrites sont déduites du code, pas reproduites). Les numéros de ligne correspondent à l'état du repo au moment de l'audit.

## 9. Vérifications Stripe live (effectuées le 21/06/2026)

Connecteur Stripe actif (clé **`ek_live`**, compte `acct_1SyiGkCnFv2Fk1sw` « SuperTry »). Croisement code ↔ données réelles :

- **`stripeFeePercent` en base — confirmé (C5) :**
  - **Prod** (`umfrbfbqefejwsircgto`) : la table `business_rules` est **VIDE**. → `findLatest()` lève `BUSINESS_RULES_NOT_FOUND` et **tout calcul de paiement campagne échoue en prod** (aucun fallback). Voir nouveau finding **C6**.
  - **Dev** (`wkcmhpmptgdfvjyvgfdh`) : une ligne, `stripe_fee_percent = 0.0350` (**3,5 %**), `commission_fixed_fee = 5.00`, `kyc_required_after_tests = 3`.
- **Comptes Connect :** le compte Stripe **live** connecté n'a **aucun compte Connect** (`GET /v1/accounts` → `[]`) → pas encore de testeurs réels onboardés en production. Les comptes Connect de dev (ex. `acct_1TbpFd…`) sont en **mode test**, sous une autre clé, **inaccessibles** via le MCP live. Impossible donc de confirmer en live `payouts.schedule.interval = manual` et les capabilities ; **confirmé dans le code** (`stripe.service.ts:77-83`, `:68-71`).
- **Cas réel observé en base dev :** un profil avec `stripe_onboarding_completed = true` / `stripe_onboarding_status = COMPLETED` mais `stripe_identity_verified = false` → **ce testeur ne peut pas retirer** (le retrait exige `stripeIdentityVerified`), bien que l'onboarding soit « COMPLETED ». Voir nouveau finding **H8**.
- **PaymentIntents réels :** aucun en prod (pas d'activité) → `capture_method` (C3) non vérifiable en live, confirmé dans le code.

### C6 🔴 — `business_rules` vide en production → calcul de paiement campagne cassé + pas de fallback de frais
**Fichiers :** `business-rules.service.ts:88-98` (`findLatest` throw) · `:42-68` (`calculateCommission`)

En prod la table est vide ; `findLatest()` lève une exception au lieu de retomber sur des valeurs par défaut. Tout paiement de campagne (et tout calcul de commission/escrow) échoue. **Correction :** seeder une ligne `business_rules` en prod **et** introduire un fallback de sécurité (`stripeFeePercent = 0.039`, commission, etc.) dans le service plutôt que de throw — cf. demande métier « 3,9 % doit s'appliquer en cas d'erreur ».

### H8 🟠 — Incohérence : Identity exigée à tout retrait, mais « non requise » avant 3 sessions
**Fichiers :** `withdrawals.service.ts:71-79` (exige `stripeIdentityVerified` **sans condition**) · `stripe.service.ts:253,314` (`identityRequired = completedSessionsCount >= 3`, statut `NOT_REQUIRED` sinon)

Le statut d'onboarding annonce l'Identity comme `NOT_REQUIRED` tant que le testeur a moins de 3 sessions, mais `createWithdrawal` la rend obligatoire pour **tout** retrait. Un testeur avec solde et onboarding « COMPLETED » mais Identity non faite est bloqué au retrait sans que l'UI de statut ne l'ait annoncé (cas réel observé en base dev). **Correction :** aligner la règle — soit conditionner l'exigence Identity au retrait sur le même seuil (`kycRequiredAfterTests`), soit refléter « Identity obligatoire pour retirer » dès le départ dans le statut d'onboarding.

### M9 🟡 — Capability `card_payments` superflue pour un testeur (payee pur) + onboarding jugé sur `charges_enabled`
**Fichiers :** `stripe.service.ts:68-71` (demande `card_payments` + `transfers`) · `:291` (`stripeOnboardingCompleted = charges_enabled && details_submitted`)

Un testeur ne fait que **recevoir** des fonds (via `transfers`/payouts) ; il n'encaisse jamais de paiement carte. La capability `card_payments` n'est donc pas nécessaire et **ajoute des exigences KYC** (donc de la friction d'onboarding). De plus, l'« onboarding complété » est jugé sur `charges_enabled` (lié à `card_payments`) alors que pour un payee la capability pertinente est `transfers`/`payouts_enabled`. **Correction :** ne demander que `transfers` ; baser `stripeOnboardingCompleted` sur `payouts_enabled` (le retrait re-vérifie déjà `payouts_enabled`, bon point).

---

## 10. Corrections appliquées (passe 1)

1ʳᵉ passe de corrections — **quick wins critiques**, code uniquement (aucune modification de base : les valeurs `business_rules` seront gérées via le panel admin). `npx tsc --noEmit` ✅ 0 erreur, `npx prisma validate` ✅.

| Finding | Fichier(s) modifié(s) | Correction appliquée |
|---------|-----------------------|----------------------|
| **C1** 🔴 | `stripe.controller.ts` | Endpoint `POST /stripe/payouts/create` **supprimé** (inutilisé par le front, confirmé par recherche). Seul `POST /withdrawals` (débit wallet + verrou + KYC) déclenche un payout. |
| **C2** 🔴 | `stripe.service.ts:1021,929` | `idempotencyKey` rendus **déterministes** (suppression de `Date.now()`). Payout = `payout-${withdrawalId}` ; transfer = clé composée des identifiants stables (type + session/ugc/tip/dispute) pour distinguer chaque transfert logique sans bloquer les transferts multiples légitimes. |
| **C5/C6** 🔴 | `schema.prisma:1271`, `business-rules.service.ts`, `admin-overview.service.ts:492` | `@default` → **0.039** ; fallback de sécurité **3,9 %** (`resolveStripeFeePercent`) si la valeur configurée est absente/invalide ; fallback admin codé en dur passé de 0.035 → 0.039 ; commentaires « 3.5% » corrigés. **NB :** seeder/mettre à jour `business_rules` en prod via le panel admin (C6 reste sinon bloquant : table vide en prod). |
| **H6** 🟠 | `stripe.controller.ts`, `dto/create-connect-account.dto.ts` | `email`/`country` du compte Connect **dérivés du profil serveur** (plus du DTO). DTO : champs marqués deprecated/optionnels, `@IsISO31661Alpha2()` sur `country`. |
| **M2** 🟡 | `stripe.controller.ts`, `i18n/*/stripe.json` | `GET /stripe/identity/status/:sessionId` vérifie désormais que la session **appartient au user** (`stripeIdentitySessionId`) → anti-IDOR. Nouvelle clé i18n `identity_session_not_found` (7 locales). |
| **L1** ⚪ | `stripe.service.ts:1248` | Bypass de signature webhook **interdit si `NODE_ENV=production`**, quelle que soit la variable d'env. |
| **L4** ⚪ | `dto/create-withdrawal.dto.ts` | `amount` : `@IsNumber({ maxDecimalPlaces: 2 })` + `@Max(10000)`. |

## 11. Corrections appliquées (passe 2 — C3 & C4)

2ᵉ passe — structurels. `npx tsc --noEmit` ✅ 0 erreur, `npx prisma validate` ✅.

| Finding | Fichier(s) | Correction |
|---------|-----------|------------|
| **C3** 🔴 (+ H4) | `payments.controller.ts`, `payments.service.ts`, `payment-capture.scheduler.ts` | Chemin « pay » **supprimé** (route `POST /campaigns/:id/pay` + méthode `processCampaignPayment`, imports nettoyés) : il capturait en automatique et cassait l'escrow. Seul subsiste le flux **checkout (capture manuelle)**. Scheduler **durci** : lit l'état réel du PI avant capture (capture seulement si `requires_capture`, réconcilie si `succeeded`), et **annule le PI avant** de relâcher `stripePaymentIntentId` (plus de fonds orphelins). |
| **C4** 🔴 | `schema.prisma`, migration `20260621160000_add_stripe_webhook_events`, `stripe.controller.ts`, `webhook-handlers.service.ts` | **Déduplication** des webhooks : nouvelle table `stripe_webhook_events`, `INSERT … ON CONFLICT DO NOTHING` atomique en tête de handler → un event rejoué est ignoré. **Re-crédits conditionnels** : `payout.failed`/`payout.canceled` ne re-créditent que si le retrait est encore `PENDING/PROCESSING` (`updateMany` + garde) ; `payout.paid` ne passe à `COMPLETED` que depuis `PROCESSING` ; `charge.refunded` décrémente l'escrow sur le **delta** (et non le cumulé) pour les remboursements partiels. |

> ⚠️ **Déploiement (ordre impératif) :** la table `stripe_webhook_events` doit exister **avant** que ce code ne tourne, sinon **tous les webhooks échoueront** (l'INSERT de déduplication précède le try/catch). Étapes : `npx prisma migrate deploy` (crée la table) **puis** `npx prisma generate` (rafraîchit le client) sur dev puis prod, en même temps que le déploiement du code. La déduplication elle-même utilise du SQL brut, donc elle fonctionne même sans `prisma generate`, mais la table reste indispensable.

## 12. Corrections appliquées (passe 3 — H1, H2, H8)

3ᵉ passe. `npx tsc --noEmit` ✅ 0 erreur.

| Finding | Fichier(s) | Décision / Correction |
|---------|-----------|------------------------|
| **H2** 🟠 | — (analyse) | **Résolu de fait.** `escrowAmount` est bien renseigné à la **création** de la campagne (`campaigns.service.ts:244`). Le bug « refund = 0 » ne concernait que le chemin « pay » (supprimé en C3). Nuance restante (non bloquante) : `escrowAmount` exclut la couverture Stripe 3,9 %, donc les remboursements se calculent hors-frais → **question de politique de remboursement**, à trancher côté produit, pas un bug. Aucun changement de logique d'argent effectué. |
| **H1** 🟠 | `wallet-reconciliation.scheduler.ts` (nouveau), `wallet.module.ts` | **Job de réconciliation** quotidien (5h, `Europe/Paris`), **lecture seule** : compare, par testeur, le solde Connect (available + pending) à `wallet.balance + retraits en cours (PENDING/PROCESSING)`, et **alerte** (log + audit `WALLET_RECONCILIATION_DRIFT`) au-delà d'une tolérance de 0,01 €. Ne corrige jamais automatiquement. Le risque aigu de divergence est par ailleurs déjà atténué par C2 (idempotency keys déterministes) + gardes `purchaseReimbursedAt`/`bonusPaidAt`. |
| **H8** 🟠 | `withdrawals.service.ts` | **Identity conditionnelle** : le retrait n'exige `stripeIdentityVerified` que si `completedSessionsCount >= kycRequiredAfterTests` (défaut 3), aligné sur le statut d'onboarding. En-dessous du seuil, l'onboarding Connect (déjà vérifié) suffit. Plus de testeur bloqué sans préavis. |

### Reste à traiter (passes suivantes)
**H3** (idempotence create/confirm PI + lock — en grande partie caduc depuis la suppression du « pay », à valider sur le checkout), **H5** (workflow d'approbation retrait — décision produit : auto-approbation vs revue manuelle), **H7** (course catch/webhook — atténuée par C2+C4), **M1** (double comptabilisation escrow — atténuée par C4, à revérifier sur le checkout), **M3** (whitelist URLs onboarding/identity), **M5** (remboursement sur breakdown figé), **M6** (frais fixe Stripe), **M9** (capability `card_payments` superflue + `payouts_enabled`), **L2** (logs PII), **L3** (concurrence création compte Connect). Plus la **politique de remboursement** (escrowAmount avec/sans couverture Stripe) à clarifier (cf. H2).
