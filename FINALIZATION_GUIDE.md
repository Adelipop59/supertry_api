# Guide de finalisation - 10% restants

## ✅ Déjà complété (90%)

1. ✅ Migrations Prisma complètes
2. ✅ StripeService entièrement refactoré
3. ✅ WebhookHandlersService créé (40+ webhooks)
4. ✅ StripeController mis à jour avec tous les webhooks
5. ✅ PaymentsService refactoré:
   - ✅ processCampaignPayment → PlatformWallet
   - ✅ processTestCompletion → Platform → TESTEUR
   - ✅ refundUnusedSlots → Platform → PRO

## 🔄 À terminer rapidement (1-2h)

### 1. CampaignsService - KYC dès 1ère campagne (15 min)

**Fichier:** `src/modules/campaigns/campaigns.service.ts`
**Méthode:** `activate()` (autour ligne 640-787)

**Rechercher:**
```typescript
activeCampaignCount >= 2
```

**Remplacer par:**
```typescript
// KYC obligatoire dès la 1ère campagne (plus de compteur)
const seller = await this.prisma.profile.findUnique({
  where: { id: sellerId },
  select: {
    stripeConnectAccountId: true,
    stripeOnboardingCompleted: true,
    stripeIdentityVerified: true,
  },
});

if (!seller?.stripeConnectAccountId) {
  throw new BadRequestException({
    message: 'Create Stripe Connect account first',
    kycRequired: true,
  });
}

if (!seller.stripeOnboardingCompleted) {
  const onboardingUrl = await this.stripeService.createAccountLink(
    seller.stripeConnectAccountId,
    'account_onboarding',
    `${process.env.FRONTEND_URL}/dashboard/onboarding/refresh`,
    `${process.env.FRONTEND_URL}/dashboard/onboarding/success`,
  );

  throw new BadRequestException({
    message: 'Complete Stripe onboarding to activate campaign',
    kycRequired: true,
    onboardingUrl,
  });
}

// Vérifier charges_enabled sur Stripe API
const kycStatus = await this.stripeService.getKycStatus(seller.stripeConnectAccountId);
if (!kycStatus.chargesEnabled) {
  const onboardingUrl = await this.stripeService.createAccountLink(
    seller.stripeConnectAccountId,
    'account_update',
    `${process.env.FRONTEND_URL}/dashboard/onboarding/refresh`,
    `${process.env.FRONTEND_URL}/dashboard/onboarding/success`,
  );

  throw new BadRequestException({
    message: 'Complete Stripe onboarding to activate campaign',
    kycRequired: true,
    onboardingUrl,
  });
}
```

### 2. TestSessionsService - Identity obligatoire (15 min)

**Fichier:** `src/modules/test-sessions/test-sessions.service.ts`
**Méthode:** `apply()` (autour ligne 85-128)

**Rechercher:**
```typescript
if (!tester.stripeOnboardingCompleted) {
```

**Remplacer par:**
```typescript
// Vérifier Stripe Identity OBLIGATOIRE pour TESTEUR
if (!tester.stripeIdentityVerified) {
  const verificationSession = await this.stripeService.createIdentityVerificationSession(
    testerId,
    `${process.env.FRONTEND_URL}/dashboard/identity/callback`,
  );

  throw new BadRequestException({
    message: 'Complete identity verification to apply to campaigns',
    identityRequired: true,
    verificationUrl: verificationSession.url,
    clientSecret: verificationSession.clientSecret,
  });
}

// Vérifier Stripe API en temps réel
const kycStatus = await this.stripeService.getKycStatus(tester.stripeConnectAccountId);
if (!kycStatus.chargesEnabled) {
  const verificationSession = await this.stripeService.createIdentityVerificationSession(
    testerId,
    `${process.env.FRONTEND_URL}/dashboard/identity/callback`,
  );

  throw new BadRequestException({
    message: 'Complete identity verification to apply to campaigns',
    identityRequired: true,
    verificationUrl: verificationSession.url,
    clientSecret: verificationSession.clientSecret,
  });
}
```

### 3. WithdrawalsModule - COPIER depuis le plan (30 min)

Le code complet est dans le plan `/Users/adelblk/.claude/plans/synthetic-fluttering-lobster.md` lignes 1304-1587.

**Créer les fichiers:**
- `src/modules/withdrawals/withdrawals.service.ts`
- `src/modules/withdrawals/withdrawals.controller.ts`
- `src/modules/withdrawals/withdrawals.module.ts`
- `src/modules/withdrawals/dto/create-withdrawal.dto.ts`

**DTO simple:**
```typescript
// create-withdrawal.dto.ts
import { IsNumber, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(10)
  amount: number;
}
```

**Module:**
```typescript
// withdrawals.module.ts
import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';

@Module({
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
```

### 4. Enregistrer WithdrawalsModule dans AppModule (2 min)

**Fichier:** `src/app.module.ts`

```typescript
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';

@Module({
  imports: [
    // ... existing
    WithdrawalsModule, // ← AJOUTER
  ],
})
```

### 5. Vérifier les flows critiques

#### Flow Annulation

**Fichier potentiel:** `src/modules/test-sessions/test-sessions.service.ts`
- Chercher méthode `cancel()`
- Si annulation après ACCEPTED → bannir testeur temporairement
- Pas de refund automatique car argent est dans PlatformWallet escrow

#### Flow Refunds

✅ Déjà géré dans `refundUnusedSlots()` pour slots non utilisés
✅ Webhook `refund.*` gérés dans WebhookHandlersService

#### Flow Litiges

**Fichier potentiel:** `src/modules/disputes/` ou similaire
- Vérifier si disputes existent
- Si oui, s'assurer que les litiges n'affectent pas PlatformWallet directement
- Les refunds sont gérés par Stripe → webhooks `refund.created/failed`

---

## 🎯 Checklist finale rapide

```bash
# 1. Vérifier compilation
pnpm run build

# 2. Vérifier linting
pnpm run lint

# 3. Tests si disponibles
pnpm test

# 4. Vérifier que Prisma Client est à jour
npx prisma generate

# 5. Vérifier migrations
npx prisma migrate status
```

---

## 🚨 Points critiques à ne pas oublier

### Variables d'environnement

Vérifier `.env`:
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SKIP_SIGNATURE_VERIFICATION=false  # PROD: false
SKIP_KYC_VERIFICATION=false  # PROD: false
FRONTEND_URL=http://localhost:3000
```

### Webhooks Stripe à configurer

Dans Stripe Dashboard → Webhooks, ajouter ces événements:
- `account.updated`
- `account.external_account.*`
- `capability.updated`
- `identity.verification_session.*` (6 types)
- `payment_intent.*` (5 types)
- `transfer.*` (5 types)
- `refund.*` (4 types)
- `payout.*` (5 types)
- `checkout.session.completed`
- `charge.refunded`

URL du webhook: `https://your-domain.com/stripe/webhooks`

---

## 📝 Tests manuels recommandés

1. **Flow PRO paie campagne:**
   - Créer compte Connect PRO
   - Compléter Onboarding
   - Créer campagne
   - Activer campagne (KYC doit être vérifié)
   - Payer → vérifier PlatformWallet.escrowBalance augmente

2. **Flow TESTEUR reçoit paiement:**
   - Créer compte Connect TESTEUR
   - Compléter Stripe Identity
   - Postuler à campagne
   - Compléter test
   - PRO valide → vérifier transfer Plateforme → TESTEUR
   - Vérifier PlatformWallet.commissionBalance augmente

3. **Flow Refund slots non utilisés:**
   - Campagne avec 10 slots
   - Seulement 7 complétés
   - Terminer campagne
   - Vérifier refund de 3 slots → PRO Connect
   - Vérifier PlatformWallet.escrowBalance diminue

4. **Flow Withdrawal (retrait IBAN):**
   - TESTEUR a balance > 0
   - Demander withdrawal
   - Vérifier Stripe Payout créé
   - Simuler webhook `payout.paid`
   - Vérifier Withdrawal COMPLETED

---

## 🔍 Debugging

Si problème avec webhooks:
```bash
# Utiliser Stripe CLI pour tester localement
stripe listen --forward-to localhost:3000/stripe/webhooks

# Trigger événements manuellement
stripe trigger payment_intent.succeeded
stripe trigger identity.verification_session.verified
```

Si problème avec transfers:
```bash
# Vérifier PlatformWallet
SELECT * FROM platform_wallets;

# Vérifier transactions
SELECT * FROM transactions WHERE wallet_id IS NULL ORDER BY created_at DESC;
```

---

## 📚 Résumé architecture finale

```
┌─────────────────┐
│  PRO paie 700€  │
└────────┬────────┘
         ↓
┌──────────────────────────┐
│  PLATEFORME Stripe       │
│  PlatformWallet          │
│  escrowBalance: 700€     │
└────────┬─────────────────┘
         ↓
    ┌───────────────────┐
    │ TESTEUR complète  │
    └───────┬───────────┘
            ↓
    ┌─────────────────────────┐
    │  Transfer 65€ → TESTEUR │
    │  Commission 5€ → PLATEFORME │
    │  PlatformWallet:        │
    │    escrowBalance: 630€  │
    │    commissionBalance: 5€│
    └─────────────────────────┘
            ↓
    ┌──────────────────────┐
    │  Refund 210€ → PRO   │
    │  (3 slots non utilisés)│
    │  PlatformWallet:     │
    │    escrowBalance: 420€│
    └──────────────────────┘
```

**✅ L'implémentation est à 90% complète !**
**⏰ Temps restant estimé: 1-2h pour finaliser**
