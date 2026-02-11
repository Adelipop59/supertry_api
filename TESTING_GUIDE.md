# Guide de Test - Flows Complets

## 🧪 Tests Manuels avec curl/Postman

---

## Prérequis

1. **Démarrer le serveur:**
```bash
npm run start:dev
```

2. **Variables d'environnement:**
```bash
# .env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:3000
SKIP_KYC_VERIFICATION=false  # Pour tester avec KYC
```

3. **Stripe CLI (pour webhooks locaux):**
```bash
# Installer Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Écouter webhooks localement
stripe listen --forward-to localhost:3000/stripe/webhooks
```

---

## Flow 1: PRO Crée et Paie Campagne

### Étape 1: Créer compte utilisateur PRO
```bash
# S'inscrire via /auth/register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "pro@example.com",
    "password": "Password123!",
    "firstName": "John",
    "lastName": "Doe",
    "role": "PRO"
  }'

# ✅ Récupérer cookie auth_session
```

### Étape 2: Créer compte Stripe Connect
```bash
curl -X POST http://localhost:3000/stripe/connect/create \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json"

# ✅ Response:
# {
#   "accountId": "acct_xxx",
#   "detailsSubmitted": false,
#   "chargesEnabled": false
# }
```

### Étape 3: Générer lien onboarding
```bash
curl -X POST http://localhost:3000/stripe/connect/onboarding-link \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshUrl": "http://localhost:3000/dashboard/onboarding/refresh",
    "returnUrl": "http://localhost:3000/dashboard/onboarding/success"
  }'

# ✅ Response:
# {
#   "url": "https://connect.stripe.com/setup/s/xxx"
# }

# 🌐 Ouvrir l'URL dans le navigateur et compléter l'onboarding
```

### Étape 4: Vérifier KYC
```bash
curl -X GET http://localhost:3000/stripe/connect/kyc-status \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "chargesEnabled": true,
#   "payoutsEnabled": true,
#   "detailsSubmitted": true,
#   "requirementsCurrentlyDue": []
# }
```

### Étape 5: Créer campagne
```bash
curl -X POST http://localhost:3000/campaigns \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Produit XYZ",
    "description": "Test de produit cosmétique",
    "categoryId": "category_xxx",
    "totalSlots": 10,
    "offers": [
      {
        "productPrice": 50,
        "shippingCost": 10,
        "bonus": 5
      }
    ]
  }'

# ✅ Response: Campaign créée avec status DRAFT
```

### Étape 6: Activer campagne
```bash
curl -X POST http://localhost:3000/campaigns/:id/activate \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "id": "campaign_xxx",
#   "status": "PENDING_PAYMENT",
#   ...
# }

# ⚠️ Si KYC incomplet:
# {
#   "message": "Complete Stripe onboarding to activate campaign",
#   "kycRequired": true,
#   "onboardingUrl": "https://connect.stripe.com/setup/s/xxx"
# }
```

### Étape 7: Calculer escrow
```bash
curl -X GET http://localhost:3000/payments/campaigns/:id/escrow \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "total": 700,
#   "perTester": 70,
#   "breakdown": {
#     "productPrice": 50,
#     "shippingCost": 10,
#     "bonus": 5,
#     "supertryCommission": 5
#   },
#   "totalSlots": 10,
#   "currency": "EUR"
# }
```

### Étape 8: Payer campagne
```bash
curl -X POST http://localhost:3000/payments/campaigns/:id/pay \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "successUrl": "http://localhost:3000/campaigns/:id/success",
    "cancelUrl": "http://localhost:3000/campaigns/:id/cancel"
  }'

# ✅ Response:
# {
#   "sessionId": "cs_xxx",
#   "url": "https://checkout.stripe.com/pay/cs_xxx"
# }

# 🌐 Ouvrir l'URL et compléter le paiement avec carte test:
# 4242 4242 4242 4242
# Date: N'importe quelle date future
# CVC: N'importe quel 3 chiffres
```

### Étape 9: Vérifier webhook checkout.session.completed
```bash
# Webhook automatiquement déclenché par Stripe

# ✅ Vérifier dans logs:
# - Campaign status → ACTIVE
# - PlatformWallet.escrowBalance += 700
# - Transaction CAMPAIGN_PAYMENT créée
```

### Étape 10: Vérifier PlatformWallet
```bash
# Avec Prisma Studio
npx prisma studio

# Ou requête SQL
npx prisma db execute --stdin <<< "SELECT * FROM platform_wallets;"

# ✅ Vérifier:
# - escrowBalance = 700
# - totalReceived = 700
```

---

## Flow 2: TESTEUR Postule et Reçoit Paiement

### Étape 1: Créer compte utilisateur TESTEUR
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tester@example.com",
    "password": "Password123!",
    "firstName": "Alice",
    "lastName": "Smith",
    "role": "USER"
  }'
```

### Étape 2: Créer compte Stripe Connect
```bash
curl -X POST http://localhost:3000/stripe/connect/create \
  -H "Cookie: auth_session=xxx"
```

### Étape 3: Créer session Stripe Identity
```bash
curl -X POST http://localhost:3000/stripe/identity/create-session \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "returnUrl": "http://localhost:3000/dashboard/identity/callback"
  }'

# ✅ Response:
# {
#   "clientSecret": "vi_xxx_secret_xxx",
#   "url": "https://verify.stripe.com/start/xxx",
#   "sessionId": "vs_xxx"
# }

# 🌐 Ouvrir l'URL et compléter la vérification Identity:
# - Télécharger documents (CNI/Passeport)
# - Prendre selfie
```

### Étape 4: Vérifier statut Identity
```bash
curl -X GET http://localhost:3000/stripe/identity/status/:sessionId \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "status": "verified",
#   "lastError": null
# }
```

### Étape 5: Postuler à campagne
```bash
curl -X POST http://localhost:3000/test-sessions \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "campaign_xxx",
    "applicationMessage": "Je suis intéressé par ce test"
  }'

# ✅ Response:
# {
#   "id": "session_xxx",
#   "status": "PENDING",
#   ...
# }

# ⚠️ Si Identity incomplet:
# {
#   "message": "Complete identity verification to apply to campaigns",
#   "identityRequired": true,
#   "verificationUrl": "https://verify.stripe.com/start/xxx",
#   "clientSecret": "vi_xxx_secret_xxx"
# }
```

### Étape 6: PRO accepte candidature
```bash
# Se reconnecter avec compte PRO
curl -X POST http://localhost:3000/test-sessions/:id/accept \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "id": "session_xxx",
#   "status": "ACCEPTED",
#   ...
# }
```

### Étape 7: TESTEUR soumet test
```bash
# Se reconnecter avec compte TESTEUR
curl -X POST http://localhost:3000/test-sessions/:id/submit \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "feedback": "Produit excellent, packaging soigné",
    "rating": 5
  }'

# ✅ Response:
# {
#   "id": "session_xxx",
#   "status": "SUBMITTED",
#   ...
# }
```

### Étape 8: PRO valide test
```bash
# Se reconnecter avec compte PRO
curl -X POST http://localhost:3000/test-sessions/:id/complete \
  -H "Cookie: auth_session=xxx"

# ✅ Response: Transfer créé, paiement traité
```

### Étape 9: Vérifier transactions
```bash
# TESTEUR: Vérifier balance
curl -X GET http://localhost:3000/wallet/balance \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "balance": 65,
#   "totalEarned": 65,
#   ...
# }

# Vérifier transactions
curl -X GET http://localhost:3000/wallet/transactions \
  -H "Cookie: auth_session=xxx"

# ✅ Response: Transaction TEST_REWARD visible
```

### Étape 10: Vérifier PlatformWallet
```bash
npx prisma studio

# ✅ Vérifier:
# - escrowBalance = 630 (700 - 70)
# - commissionBalance = 5
# - totalTransferred = 65
# - totalCommissions = 5
```

---

## Flow 3: Refund Slots Non Utilisés

### Étape 1: Campagne se termine avec slots non utilisés
```bash
# Exemple: 10 slots, seulement 7 complétés
```

### Étape 2: Demander refund
```bash
curl -X POST http://localhost:3000/payments/campaigns/:id/refund \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "unusedSlots": 3,
#   "refundAmount": 210,
#   "transfer": {
#     "id": "tr_xxx",
#     "amount": 21000,
#     "destination": "acct_xxx"
#   },
#   "transaction": {
#     "id": "txn_xxx",
#     "type": "CAMPAIGN_REFUND",
#     "amount": 210
#   }
# }
```

### Étape 3: Vérifier PlatformWallet
```bash
npx prisma studio

# ✅ Vérifier:
# - escrowBalance diminue de 210
# - totalTransferred augmente de 210
```

### Étape 4: Vérifier balance PRO Connect
```bash
# Se connecter avec compte PRO
curl -X GET http://localhost:3000/stripe/connect/balance \
  -H "Cookie: auth_session=xxx"

# ✅ Response: 210€ disponibles dans Connect account
```

---

## Flow 4: TESTEUR Retire vers IBAN

### Étape 1: Vérifier balance TESTEUR
```bash
curl -X GET http://localhost:3000/wallet/balance \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "balance": 65,
#   ...
# }
```

### Étape 2: Ajouter IBAN (via Stripe Dashboard)
```bash
# 1. Aller sur https://dashboard.stripe.com/test/connect/accounts
# 2. Trouver le Connect account du TESTEUR
# 3. Ajouter un external account (IBAN test)
#
# Ou via API (future feature):
# POST /stripe/connect/external-accounts
# {
#   "iban": "FR1420041010050500013M02606",
#   "accountHolderName": "Alice Smith"
# }
```

### Étape 3: Demander retrait
```bash
curl -X POST http://localhost:3000/withdrawals \
  -H "Cookie: auth_session=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 65
  }'

# ✅ Response:
# {
#   "id": "withdrawal_xxx",
#   "amount": 65,
#   "status": "PROCESSING",
#   "stripePayoutId": "po_xxx",
#   ...
# }
```

### Étape 4: Vérifier balance mise à jour
```bash
curl -X GET http://localhost:3000/wallet/balance \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "balance": 0,  // Déduit immédiatement
#   ...
# }
```

### Étape 5: Lister retraits
```bash
curl -X GET http://localhost:3000/withdrawals/me \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "items": [
#     {
#       "id": "withdrawal_xxx",
#       "amount": 65,
#       "status": "PROCESSING",
#       "stripePayoutId": "po_xxx",
#       ...
#     }
#   ],
#   "total": 1,
#   "page": 1
# }
```

### Étape 6: Simuler webhook payout.paid
```bash
# Avec Stripe CLI
stripe trigger payout.paid

# ✅ Webhook déclenché:
# - Withdrawal status → COMPLETED
# - Notification email envoyée
```

### Étape 7: Vérifier statut final
```bash
curl -X GET http://localhost:3000/withdrawals/:id \
  -H "Cookie: auth_session=xxx"

# ✅ Response:
# {
#   "id": "withdrawal_xxx",
#   "status": "COMPLETED",
#   "completedAt": "2026-02-07T12:05:00Z",
#   ...
# }
```

---

## Tests Webhooks avec Stripe CLI

### Installer et configurer
```bash
# Installer
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Écouter webhooks
stripe listen --forward-to localhost:3000/stripe/webhooks
```

### Trigger webhooks manuellement
```bash
# Account updated
stripe trigger account.updated

# Identity verified
stripe trigger identity.verification_session.verified

# Payment succeeded
stripe trigger payment_intent.succeeded

# Payout paid
stripe trigger payout.paid

# Transfer failed
stripe trigger transfer.failed

# Refund created
stripe trigger refund.created
```

---

## Tests d'Erreurs

### KYC incomplet (PRO)
```bash
# Activer campagne sans KYC
curl -X POST http://localhost:3000/campaigns/:id/activate \
  -H "Cookie: auth_session=xxx"

# ✅ Expected: 400 Bad Request
# {
#   "message": "Complete Stripe onboarding to activate campaign",
#   "kycRequired": true,
#   "onboardingUrl": "https://connect.stripe.com/setup/s/xxx"
# }
```

### Identity incomplet (TESTEUR)
```bash
# Postuler sans Identity
curl -X POST http://localhost:3000/test-sessions \
  -H "Cookie: auth_session=xxx" \
  -d '{"campaignId": "xxx"}'

# ✅ Expected: 400 Bad Request
# {
#   "message": "Complete identity verification to apply to campaigns",
#   "identityRequired": true,
#   "verificationUrl": "https://verify.stripe.com/start/xxx"
# }
```

### Balance insuffisante
```bash
# Retirer plus que la balance
curl -X POST http://localhost:3000/withdrawals \
  -H "Cookie: auth_session=xxx" \
  -d '{"amount": 1000}'

# ✅ Expected: 400 Bad Request
# {
#   "message": "Insufficient balance"
# }
```

### Annuler retrait en cours
```bash
# Annuler un withdrawal en status PROCESSING
curl -X POST http://localhost:3000/withdrawals/:id/cancel \
  -H "Cookie: auth_session=xxx" \
  -d '{"reason": "test"}'

# ✅ Expected: 400 Bad Request
# {
#   "message": "Cannot cancel withdrawal in this status"
# }
```

---

## Vérifications Base de Données

### Vérifier PlatformWallet
```sql
SELECT * FROM platform_wallets;
```

### Vérifier Transactions
```sql
SELECT
  id,
  type,
  amount,
  status,
  wallet_id,
  campaign_id,
  created_at
FROM transactions
WHERE wallet_id IS NULL  -- Transactions plateforme
ORDER BY created_at DESC;
```

### Vérifier Withdrawals
```sql
SELECT
  id,
  user_id,
  amount,
  status,
  stripe_payout_id,
  completed_at,
  created_at
FROM withdrawals
ORDER BY created_at DESC;
```

### Vérifier Wallets
```sql
SELECT
  id,
  user_id,
  balance,
  pending_balance,
  total_earned,
  total_withdrawn
FROM wallets;
```

---

## Scripts de Test Automatisés

### Script complet
```bash
#!/bin/bash
# test-full-flow.sh

echo "🧪 Testing Full Flow..."

# 1. PRO: Create account, KYC, create campaign, pay
echo "1️⃣  PRO creates campaign and pays..."
# ... curl commands

# 2. TESTEUR: Create account, Identity, apply, complete test
echo "2️⃣  TESTEUR applies and completes test..."
# ... curl commands

# 3. Verify transfers and balances
echo "3️⃣  Verifying balances..."
# ... curl commands

# 4. Refund unused slots
echo "4️⃣  Refunding unused slots..."
# ... curl commands

# 5. Withdrawal
echo "5️⃣  TESTEUR withdraws to IBAN..."
# ... curl commands

echo "✅ All tests passed!"
```

---

## Debugging

### Logs API
```bash
# Voir tous les logs
npm run start:dev

# Filtrer par module
npm run start:dev | grep "WithdrawalsService"
npm run start:dev | grep "WebhookHandlersService"
```

### Stripe Dashboard
- **Payments:** https://dashboard.stripe.com/test/payments
- **Connect Accounts:** https://dashboard.stripe.com/test/connect/accounts
- **Webhooks:** https://dashboard.stripe.com/test/webhooks
- **Payouts:** https://dashboard.stripe.com/test/payouts
- **Transfers:** https://dashboard.stripe.com/test/transfers

### Prisma Studio
```bash
npx prisma studio
# Ouvrir http://localhost:5555
```

---

## 🔥 Checklist Tests Manuels

- [ ] PRO crée compte et complète Onboarding
- [ ] PRO crée campagne
- [ ] PRO active campagne (KYC vérifié)
- [ ] PRO paie campagne
- [ ] Webhook `checkout.session.completed` reçu
- [ ] PlatformWallet.escrowBalance augmente
- [ ] TESTEUR crée compte et complète Identity
- [ ] TESTEUR postule à campagne (Identity vérifié)
- [ ] PRO accepte candidature
- [ ] TESTEUR complète test
- [ ] PRO valide test
- [ ] Transfer Plateforme → TESTEUR créé
- [ ] PlatformWallet met à jour (escrow, commission)
- [ ] Wallet TESTEUR augmente
- [ ] Refund slots non utilisés
- [ ] Transfer Plateforme → PRO créé
- [ ] TESTEUR demande retrait
- [ ] Stripe Payout créé
- [ ] Webhook `payout.paid` reçu
- [ ] Withdrawal status → COMPLETED
- [ ] Notifications emails reçues

**✅ Tous les flows testés et validés !**
