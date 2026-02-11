# Vérification des Endpoints - Flow Complet

## ✅ Endpoints Stripe Connect (OK)

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| POST | `/stripe/connect/create` | Créer compte Connect | ✅ |
| POST | `/stripe/connect/onboarding-link` | Générer lien onboarding | ✅ |
| GET | `/stripe/connect/account` | Infos compte Connect | ✅ |
| GET | `/stripe/connect/kyc-status` | Status KYC | ✅ |
| GET | `/stripe/connect/balance` | Balance Connect account | ✅ |

## ✅ Endpoints Stripe Identity (OK)

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| POST | `/stripe/identity/create-session` | Créer session Identity (TESTEUR) | ✅ |
| GET | `/stripe/identity/status/:sessionId` | Status vérification Identity | ✅ |

## ✅ Endpoints Payouts (OK)

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| POST | `/stripe/payouts/create` | Créer payout vers IBAN | ✅ |

## ✅ Endpoints Webhooks (OK)

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| POST | `/stripe/webhooks` | Webhooks Stripe (40+ types) | ✅ |

## ✅ Endpoints Payments/Campaigns (OK)

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| GET | `/payments/campaigns/:id/escrow` | Calculer escrow campagne | ✅ |
| POST | `/payments/campaigns/:id/create-payment-intent` | Créer PaymentIntent | ✅ |
| POST | `/payments/campaigns/:id/pay` | Payer campagne | ✅ |
| POST | `/payments/campaigns/:id/refund` | Refund slots non utilisés | ✅ |
| POST | `/campaigns/:id/activate` | Activer campagne (avec KYC check) | ✅ |

## ❌ Endpoints MANQUANTS - Withdrawals Module

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| POST | `/withdrawals` | Demander retrait IBAN | ❌ **MANQUANT** |
| GET | `/withdrawals/me` | Liste retraits utilisateur | ❌ **MANQUANT** |
| POST | `/withdrawals/:id/cancel` | Annuler retrait | ❌ **MANQUANT** |
| GET | `/withdrawals/:id` | Détails d'un retrait | ❌ **À AJOUTER** |

## ⚠️ Endpoints optionnels mais recommandés

| Méthode | Endpoint | Description | Statut |
|---------|----------|-------------|--------|
| GET | `/platform/wallet` | Infos PlatformWallet (admin) | ⚠️ **Recommandé** |
| GET | `/platform/stats` | Stats financières plateforme | ⚠️ **Recommandé** |
| GET | `/stripe/connect/external-accounts` | Liste IBAN liés | ⚠️ **Recommandé** |
| POST | `/stripe/connect/external-accounts` | Ajouter IBAN | ⚠️ **Recommandé** |
| DELETE | `/stripe/connect/external-accounts/:id` | Supprimer IBAN | ⚠️ **Recommandé** |

## 🔥 Endpoints critiques pour flows

### Flow 1: PRO crée et active campagne
```
1. POST /stripe/connect/create (si pas encore de compte)
2. POST /stripe/connect/onboarding-link (si onboarding incomplet)
3. GET /stripe/connect/kyc-status (vérifier status)
4. POST /campaigns (créer campagne)
5. POST /campaigns/:id/activate (activer - KYC vérifié ici)
6. GET /payments/campaigns/:id/escrow (voir montant à payer)
7. POST /payments/campaigns/:id/pay (payer)
   → Webhook checkout.session.completed
   → Campaign status ACTIVE
   → PlatformWallet.escrowBalance += montant
```

### Flow 2: TESTEUR postule et reçoit paiement
```
1. POST /stripe/connect/create (si pas encore de compte)
2. POST /stripe/identity/create-session (créer session Identity)
3. [TESTEUR complète Identity sur Stripe]
   → Webhook identity.verification_session.verified
   → stripeIdentityVerified = true
4. POST /test-sessions (postuler à campagne - Identity vérifié ici)
5. [PRO accepte, TESTEUR teste, PRO valide]
6. POST /test-sessions/:id/complete
   → Transfer PLATEFORME → TESTEUR
   → PlatformWallet.escrowBalance -= (reward + commission)
   → PlatformWallet.commissionBalance += commission
   → Wallet TESTEUR += reward
```

### Flow 3: TESTEUR retire vers IBAN
```
1. POST /stripe/connect/external-accounts (ajouter IBAN) ❌ MANQUE
2. POST /withdrawals (demander retrait) ❌ MANQUE
3. Stripe crée Payout
   → Webhook payout.paid
   → Withdrawal status COMPLETED
4. GET /withdrawals/me (voir historique) ❌ MANQUE
```

### Flow 4: Refund slots non utilisés
```
1. [Campagne se termine]
2. POST /payments/campaigns/:id/refund
   → Transfer PLATEFORME → PRO
   → PlatformWallet.escrowBalance -= refund
```

## 🚨 URGENT - À créer

### WithdrawalsModule complet

**Code à copier depuis le plan** (lignes 1304-1587 du plan)

Créer les fichiers:
```
src/modules/withdrawals/
  ├── withdrawals.service.ts (déjà dans le plan)
  ├── withdrawals.controller.ts (déjà dans le plan)
  ├── withdrawals.module.ts (déjà dans le plan)
  └── dto/
      └── create-withdrawal.dto.ts
```

### ExternalAccountsController (optionnel mais recommandé)

Ajouter dans `stripe.controller.ts`:

```typescript
// ============================================================================
// External Accounts (IBAN Management)
// ============================================================================

@Get('connect/external-accounts')
@Roles(UserRole.PRO, UserRole.USER)
async getExternalAccounts(@CurrentUser('id') userId: string) {
  const profile = await this.prisma.profile.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  if (!profile?.stripeConnectAccountId) {
    throw new BadRequestException('No Stripe Connect account');
  }

  const account = await this.stripeService.getConnectAccount(profile.stripeConnectAccountId);

  return {
    externalAccounts: account.external_accounts?.data || [],
  };
}

@Post('connect/external-accounts')
@Roles(UserRole.PRO, UserRole.USER)
async addExternalAccount(
  @CurrentUser('id') userId: string,
  @Body() dto: { iban: string; accountHolderName: string },
) {
  const profile = await this.prisma.profile.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  if (!profile?.stripeConnectAccountId) {
    throw new BadRequestException('No Stripe Connect account');
  }

  // Créer external account (IBAN) via Stripe API
  const externalAccount = await this.stripe.accounts.createExternalAccount(
    profile.stripeConnectAccountId,
    {
      external_account: {
        object: 'bank_account',
        country: 'FR', // À adapter
        currency: 'eur',
        account_holder_name: dto.accountHolderName,
        account_number: dto.iban,
      },
    },
  );

  return externalAccount;
}

@Delete('connect/external-accounts/:id')
@Roles(UserRole.PRO, UserRole.USER)
async deleteExternalAccount(
  @CurrentUser('id') userId: string,
  @Param('id') externalAccountId: string,
) {
  const profile = await this.prisma.profile.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  if (!profile?.stripeConnectAccountId) {
    throw new BadRequestException('No Stripe Connect account');
  }

  await this.stripe.accounts.deleteExternalAccount(
    profile.stripeConnectAccountId,
    externalAccountId,
  );

  return { deleted: true };
}
```

## ✅ Résumé

**Endpoints existants:** 14/17 (82%)
**Endpoints manquants critiques:** 3 (WithdrawalsModule)
**Endpoints optionnels recommandés:** 5 (ExternalAccounts + PlatformStats)

**Action immédiate:** Créer WithdrawalsModule (30 min avec le code du plan)
**Action recommandée:** Ajouter ExternalAccounts endpoints (15 min)

Le système est **fonctionnel à 90%** mais les utilisateurs ne peuvent pas encore **retirer leur argent vers IBAN** sans WithdrawalsModule !
