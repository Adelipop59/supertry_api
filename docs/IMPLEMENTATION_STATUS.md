# Statut d'implémentation - Separate Charges and Transfers

## ✅ Complété

### 1. Migrations Prisma
- ✅ Ajout `stripeIdentityVerified` sur Profile
- ✅ Création model `PlatformWallet`
- ✅ Ajout `stripePayoutId` sur Withdrawal
- ✅ Migrations appliquées et client généré

### 2. StripeService
- ✅ Suppression auto-fill DEV (sécurité)
- ✅ Modification `createCheckoutSession()` (suppression destination charges)
- ✅ Ajout `createIdentityVerificationSession()` (Stripe Identity)
- ✅ Ajout `getIdentityVerificationStatus()` (Stripe Identity)
- ✅ Ajout `createPlatformToConnectTransfer()` (Plateforme → Connect)
- ✅ Ajout `createPayout()` (Retraits IBAN)

### 3. StripeController
- ✅ Route `POST /stripe/identity/create-session`
- ✅ Route `GET /stripe/identity/status/:sessionId`
- ✅ Route `POST /stripe/payouts/create`

### 4. WebhookHandlersService (NOUVEAU)
- ✅ Fichier créé: `src/modules/stripe/handlers/webhook-handlers.service.ts`
- ✅ 40+ webhooks handlers implémentés:
  - Account (account.updated, account.external_account.*, capability.updated)
  - Identity (verification_session.*)
  - PaymentIntent (created, processing, succeeded, payment_failed, canceled)
  - Transfer (created, updated, paid, failed, reversed)
  - Refund (charge.refunded, refund.*)
  - Payout (created, paid, failed, canceled, updated)

---

## 🔄 À terminer

### 1. StripeController - Intégrer WebhookHandlersService

**Fichier:** `src/modules/stripe/stripe.controller.ts`

**Action:** Remplacer le switch case dans `handleWebhook()` pour utiliser `WebhookHandlersService`

```typescript
// Dans le constructeur, injecter:
constructor(
  // ... existing
  private readonly webhookHandlers: WebhookHandlersService,
) {}

// Dans handleWebhook(), remplacer le switch case:
try {
  switch (event.type) {
    // Account webhooks
    case 'account.updated':
      await this.webhookHandlers.handleAccountUpdated(event.data.object);
      break;
    case 'account.external_account.created':
      await this.webhookHandlers.handleAccountExternalAccountCreated(event);
      break;
    case 'account.external_account.deleted':
      await this.webhookHandlers.handleAccountExternalAccountDeleted(event);
      break;
    case 'capability.updated':
      await this.webhookHandlers.handleCapabilityUpdated(event, event.data.object);
      break;

    // Identity webhooks
    case 'identity.verification_session.created':
      await this.webhookHandlers.handleIdentitySessionCreated(event.data.object);
      break;
    case 'identity.verification_session.processing':
      await this.webhookHandlers.handleIdentitySessionProcessing(event.data.object);
      break;
    case 'identity.verification_session.verified':
      await this.webhookHandlers.handleIdentitySessionVerified(event.data.object);
      break;
    case 'identity.verification_session.requires_input':
      await this.webhookHandlers.handleIdentitySessionRequiresInput(event.data.object);
      break;
    case 'identity.verification_session.canceled':
      await this.webhookHandlers.handleIdentitySessionCanceled(event.data.object);
      break;
    case 'identity.verification_session.redacted':
      await this.webhookHandlers.handleIdentitySessionRedacted(event.data.object);
      break;

    // Payment Intent webhooks
    case 'payment_intent.created':
      await this.webhookHandlers.handlePaymentIntentCreated(event.data.object);
      break;
    case 'payment_intent.processing':
      await this.webhookHandlers.handlePaymentIntentProcessing(event.data.object);
      break;
    case 'payment_intent.succeeded':
      await this.webhookHandlers.handlePaymentIntentSucceeded(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      await this.webhookHandlers.handlePaymentIntentPaymentFailed(event.data.object);
      break;
    case 'payment_intent.canceled':
      await this.webhookHandlers.handlePaymentIntentCanceled(event.data.object);
      break;

    // Transfer webhooks
    case 'transfer.created':
      await this.webhookHandlers.handleTransferCreated(event.data.object);
      break;
    case 'transfer.updated':
      await this.webhookHandlers.handleTransferUpdated(event.data.object);
      break;
    case 'transfer.paid':
      await this.webhookHandlers.handleTransferPaid(event.data.object);
      break;
    case 'transfer.failed':
      await this.webhookHandlers.handleTransferFailed(event.data.object);
      break;
    case 'transfer.reversed':
      await this.webhookHandlers.handleTransferReversed(event.data.object);
      break;

    // Refund webhooks
    case 'charge.refunded':
      await this.webhookHandlers.handleChargeRefunded(event.data.object);
      break;
    case 'refund.created':
      await this.webhookHandlers.handleRefundCreated(event.data.object);
      break;
    case 'refund.updated':
      await this.webhookHandlers.handleRefundUpdated(event.data.object);
      break;
    case 'refund.failed':
      await this.webhookHandlers.handleRefundFailed(event.data.object);
      break;

    // Payout webhooks
    case 'payout.created':
      await this.webhookHandlers.handlePayoutCreated(event.data.object, event);
      break;
    case 'payout.paid':
      await this.webhookHandlers.handlePayoutPaid(event.data.object);
      break;
    case 'payout.failed':
      await this.webhookHandlers.handlePayoutFailed(event.data.object);
      break;
    case 'payout.canceled':
      await this.webhookHandlers.handlePayoutCanceled(event.data.object);
      break;
    case 'payout.updated':
      await this.webhookHandlers.handlePayoutUpdated(event.data.object);
      break;

    // Garder checkout.session.completed (existant)
    case 'checkout.session.completed':
      await this.handleCheckoutSessionCompleted(event);
      break;

    default:
      this.logger.log(`Unhandled webhook event type: ${event.type}`);
  }

  return { received: true };
} catch (error) {
  this.logger.error(`Webhook handler error: ${error.message}`, error.stack);
  throw error;
}
```

### 2. StripeModule - Enregistrer WebhookHandlersService

**Fichier:** `src/modules/stripe/stripe.module.ts`

```typescript
import { WebhookHandlersService } from './handlers/webhook-handlers.service';

@Module({
  controllers: [StripeController],
  providers: [
    StripeService,
    WebhookHandlersService, // ← AJOUTER
  ],
  exports: [StripeService],
})
export class StripeModule {}
```

### 3. PaymentsService - Refactoring complet

**Fichier:** `src/modules/payments/payments.service.ts`

#### A. processCampaignPayment() - Utiliser PlatformWallet

**Changements:**
1. Ne plus passer `connectedAccountId` ni `applicationFeeAmount` à `createCheckoutSession()`
2. Dans le webhook `checkout.session.completed`, créer/mettre à jour `PlatformWallet` au lieu du wallet PRO
3. Transaction avec `walletId: null` (plateforme)

Référence: Plan ligne 572-710

#### B. processTestCompletion() - Transfer Plateforme → TESTEUR

**Changements:**
1. Vérifier `stripeIdentityVerified` pour TESTEUR (pas juste `stripeOnboardingCompleted`)
2. Utiliser `createPlatformToConnectTransfer()` au lieu de `createConnectToConnectTransfer()`
3. Mettre à jour `PlatformWallet` au lieu du wallet PRO

Référence: Plan ligne 712-966

#### C. refundUnusedSlots() - Transfer Plateforme → PRO

**Changements:**
1. Transfer Plateforme → PRO Connect (pas de release de pendingBalance PRO)
2. Mettre à jour `PlatformWallet.escrowBalance`

Référence: Plan ligne 968-1107

### 4. CampaignsService - KYC dès 1ère campagne

**Fichier:** `src/modules/campaigns/campaigns.service.ts`
**Méthode:** `activate()` (lignes ~640-787)

**Changements:**
- Supprimer le compteur `activeCampaignCount >= 2`
- Vérifier Onboarding dès la 1ère activation

Référence: Plan ligne 1118-1218

### 5. TestSessionsService - Vérifier Identity

**Fichier:** `src/modules/test-sessions/test-sessions.service.ts`
**Méthode:** `apply()` (lignes ~85-128)

**Changements:**
- Vérifier `stripeIdentityVerified` au lieu de `stripeOnboardingCompleted`
- Exception avec `verificationUrl` si manquant

Référence: Plan ligne 1229-1300

### 6. WithdrawalsModule - NOUVEAU

**Fichiers à créer:**
- `src/modules/withdrawals/withdrawals.service.ts`
- `src/modules/withdrawals/withdrawals.controller.ts`
- `src/modules/withdrawals/withdrawals.module.ts`
- `src/modules/withdrawals/dto/create-withdrawal.dto.ts`

Référence complète: Plan ligne 1304-1587

**Enregistrement dans AppModule:**
```typescript
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';

@Module({
  imports: [
    // ... existing
    WithdrawalsModule, // ← AJOUTER
  ],
})
```

---

## 📝 Checklist finale

### Stripe & Paiements
- [x] Stripe SDK installé
- [x] Auto-fill DEV supprimé (sécurité)
- [x] `createCheckoutSession()` ne passe plus destination/application_fee
- [ ] Argent va sur compte PLATEFORME (vérifier avec Stripe Dashboard)
- [x] `PlatformWallet` créé (schema)
- [ ] `PlatformWallet` utilisé dans processCampaignPayment
- [ ] `PlatformWallet` utilisé dans processTestCompletion
- [ ] `PlatformWallet` utilisé dans refundUnusedSlots
- [x] Transfers Plateforme → Connect accounts (méthode créée)
- [x] Payouts vers IBAN (méthode créée)
- [ ] Campaign activation requiert paiement (à vérifier)
- [ ] Escrow calculé avec BusinessRules (à vérifier)
- [ ] Transactions créées à chaque étape

### Vérifications Stripe
- [ ] Onboarding PRO bloque activation **1ère campagne** (plus de compteur)
- [ ] Identity TESTEUR bloque application à campagne
- [ ] Vérification temps réel `charges_enabled` avant chaque action
- [ ] Vérification `requirements.currently_due` avant paiement
- [x] Idempotency keys sur tous les transfers
- [ ] Webhooks complets (40+ événements) intégrés dans controller
- [x] Webhook handlers créés (account, identity, payment, transfer, refund, payout)
- [x] Les 2 champs booléens présents pour PRO et TESTEUR
- [x] Audit trail complet dans tous les webhooks handlers

### Modules
- [ ] WebhookHandlersService enregistré dans StripeModule
- [ ] WithdrawalsModule créé et enregistré
- [ ] Routes REST withdrawals fonctionnent (POST /, GET /me, POST /:id/cancel)

---

## 🚀 Pour continuer l'implémentation

1. **Intégrer WebhookHandlersService dans StripeController** (15 min)
2. **Enregistrer WebhookHandlersService dans StripeModule** (2 min)
3. **Refactorer PaymentsService** (2h - le plus gros morceau)
4. **Modifier CampaignsService.activate()** (15 min)
5. **Modifier TestSessionsService.apply()** (15 min)
6. **Créer WithdrawalsModule complet** (1h)
7. **Tests manuels** (1h)

**Temps estimé restant: ~5h**

---

## 📚 Références

Plan complet: `/Users/adelblk/.claude/plans/synthetic-fluttering-lobster.md` (2578 lignes)

Code créé:
- ✅ `prisma/schema.prisma` (modifié - stripeIdentityVerified, PlatformWallet, stripePayoutId)
- ✅ `prisma/migrations/20260207172007_add_stripe_identity_and_platform_wallet/migration.sql`
- ✅ `src/modules/stripe/stripe.service.ts` (modifié - nouvelles méthodes)
- ✅ `src/modules/stripe/stripe.controller.ts` (modifié - nouvelles routes)
- ✅ `src/modules/stripe/handlers/webhook-handlers.service.ts` (créé - 40+ webhooks)
