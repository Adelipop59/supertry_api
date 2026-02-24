# FIX-83db19 : Correction bugs payment flow (mobile + web)

**Date** : 2026-02-24
**Fichiers modifies** : 4

---

## Bugs corriges

### 1. Transactions orphelines (createPaymentIntent)
**Fichier** : `src/modules/campaigns/campaigns.controller.ts`

Quand un PRO retentait le paiement, chaque appel a `createPaymentIntent` creait une nouvelle transaction PENDING sans annuler les precedentes. Resultat : N transactions orphelines en BDD pour la meme campagne.

**Fix** : `updateMany` qui marque toutes les anciennes transactions PENDING/CAMPAIGN_PAYMENT comme CANCELLED avant de creer la nouvelle.

### 2. Race condition DB (createPaymentIntent)
**Fichier** : `src/modules/campaigns/campaigns.controller.ts`

La creation de la transaction et la mise a jour de la campagne etaient 2 operations separees. Si un crash arrivait entre les deux, la BDD etait dans un etat incoherent (transaction creee mais campagne pas mise a jour, ou inversement).

**Fix** : Les deux operations sont maintenant dans un `prisma.$transaction` atomique.

### 3. Webhook idempotence (double delivery)
**Fichier** : `src/modules/stripe/handlers/webhook-handlers.service.ts`

Si Stripe re-delivrait le webhook `payment_intent.amount_capturable_updated`, le handler re-ecrivait `paymentAuthorizedAt` avec une nouvelle date, ce qui decalait le timer de grace period du scheduler.

**Fix** : Si `paymentAuthorizedAt` est deja set pour le meme PI, on skip (log idempotent).

### 4. Escrow update non atomique (scheduler + checkout web)
**Fichiers** :
- `src/modules/payments/payment-capture.scheduler.ts`
- `src/modules/stripe/stripe.controller.ts`

Dans `handleAutoCapture` et `handleCheckoutSessionCompleted`, les updates campaign + transaction + platformWallet etaient 3 operations separees. Un crash entre campaign=ACTIVE et wallet.increment pouvait perdre l'argent de l'escrow.

**Fix** : Tout dans un `prisma.$transaction` atomique dans les deux endroits.

### 5. Recovery si capture echoue (scheduler)
**Fichier** : `src/modules/payments/payment-capture.scheduler.ts`

Si `capturePaymentIntent` echouait (PI expire, erreur Stripe...), la campagne restait bloquee en PENDING_PAYMENT indefiniment. Le scheduler retentait a chaque CRON mais sans limite.

**Fix** :
- Compteur de retries stocke dans `metadata.captureRetryCount` de la transaction
- Apres 3 echecs : campagne revert en DRAFT, transaction passe en FAILED
- Le PRO peut alors relancer le paiement depuis l'app

### 6. Stale cleanup ne met pas a jour les transactions
**Fichier** : `src/modules/payments/payment-capture.scheduler.ts`

Le CRON `handleStalePayments` (PI > 5 jours) annulait le PI Stripe et mettait la campagne en CANCELLED, mais les transactions associees restaient en PENDING.

**Fix** : `transaction.updateMany` dans un `$transaction` atomique avec le campaign update. Les transactions passent en CANCELLED.

---

## Resume des fichiers

| Fichier | Bugs fixes |
|---------|-----------|
| `campaigns.controller.ts` | #1, #2 |
| `webhook-handlers.service.ts` | #3 |
| `payment-capture.scheduler.ts` | #4, #5, #6 |
| `stripe.controller.ts` | #4 |
