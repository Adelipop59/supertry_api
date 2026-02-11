# Test Script: PRO Payment Flow avec Stripe

Ce script teste le flow complet de paiement d'une campagne par un PRO:

## Flow testé

1. **Création compte PRO** → Stripe Connect créé automatiquement
2. **Création produit** → Avec possibilité d'upload image
3. **Création campagne** → Avec lien Amazon
4. **Calcul escrow** → Affiche le montant total à payer
5. **Génération PaymentIntent** → Lien de paiement Stripe
6. **Paiement manuel** → Vous payez via le lien avec carte test
7. **Vérification** → Statut campagne ACTIVE + wallet escrow

## Prérequis

1. L'API doit être lancée:
```bash
pnpm run start:dev
```

2. Variables d'environnement configurées (`.env`):
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
DATABASE_URL=...
```

3. Base de données migrée:
```bash
npx prisma migrate dev
```

## Lancer le script

```bash
npx ts-node scripts/test-pro-payment-flow.ts
```

## Ce que le script fait

### 1. Création compte PRO
- Email: `pro-test-{timestamp}@example.com`
- Password: `Test1234!`
- **Stripe Connect créé automatiquement** lors de l'inscription
- Pays: FR, BE

### 2. Création produit
- Titre: "Test Product - iPhone 15 Pro"
- Prix: 1199.99€
- Marketplaces: FR, BE

### 3. Création campagne
- Titre: "Test Campaign - iPhone 15 Pro Review"
- Total slots: 5
- Durée: 30 jours
- Offre FR:
  - Lien Amazon: `https://www.amazon.fr/dp/B0CHX1W1XY`
  - Prix produit: 50€
  - Frais livraison: 5€
  - Bonus testeur: 10€

### 4. Calcul escrow
Le script affiche le détail:
```
💰 Coût produit: 50€
📦 Frais livraison: 5€
🎁 Bonus testeur: 10€
💳 Commission SuperTry: 5€
👤 Par testeur: 70€
💵 TOTAL À PAYER: 350€ (5 testeurs)
```

### 5. Génération lien de paiement

Le script génère un **PaymentIntent Stripe** et affiche:

```
🔗 LIEN DE PAIEMENT:
https://checkout.stripe.com/pay/cs_test_...

⚠️  En mode TEST, utilisez les cartes de test Stripe:
   - Carte qui fonctionne: 4242 4242 4242 4242
   - Date expiration: n'importe quelle date future
   - CVC: n'importe quel 3 chiffres
```

### 6. Paiement manuel

1. Copiez le lien de paiement
2. Ouvrez-le dans votre navigateur
3. Payez avec la carte test: `4242 4242 4242 4242`
4. Revenez au terminal et appuyez sur **ENTER**

### 7. Vérification

Le script vérifie:
- ✅ Statut campagne = `ACTIVE`
- ✅ Wallet `pendingBalance` = 350€ (escrow)
- ✅ Transaction créée
- ✅ Notifications envoyées au PRO

## Cartes de test Stripe

### Carte qui fonctionne
- **Numéro**: `4242 4242 4242 4242`
- **Expiration**: n'importe quelle date future (ex: 12/25)
- **CVC**: n'importe quel 3 chiffres (ex: 123)

### Carte qui échoue (pour tester les erreurs)
- **Numéro**: `4000 0000 0000 0002`
- **Expiration**: n'importe quelle date future
- **CVC**: n'importe quel 3 chiffres

### Carte qui requiert 3D Secure
- **Numéro**: `4000 0027 6000 3184`
- **Expiration**: n'importe quelle date future
- **CVC**: n'importe quel 3 chiffres

## Résultat attendu

```
🚀 Test Flow: PRO Signup → Product → Campaign → Stripe Payment

================================================

=== 1. Création compte PRO ===
📧 Email: pro-test-1234567890@example.com
🔑 Password: Test1234!
✅ Compte PRO créé avec succès
👤 User ID: clx...
🔗 Stripe Connect créé automatiquement

=== 2. Création produit ===
✅ Produit créé
📦 Product ID: clx...
📝 Title: Test Product - iPhone 15 Pro

=== 3. Upload image produit ===
⏭️  Upload image skipped

=== 4. Création campagne ===
✅ Campagne créée
📋 Campaign ID: clx...
📝 Title: Test Campaign - iPhone 15 Pro Review
📊 Status: DRAFT
🔢 Total Slots: 5

=== 5. Calcul escrow ===
✅ Escrow calculé
💰 Coût produit: 50€
📦 Frais livraison: 5€
🎁 Bonus testeur: 10€
💳 Commission SuperTry: 5€
👤 Par testeur: 70€
💵 TOTAL À PAYER: 350€

=== 6. Génération lien paiement Stripe ===
✅ PaymentIntent créé
💳 Payment Intent ID: pi_...
💵 Montant: 350€

🔗 LIEN DE PAIEMENT:
https://checkout.stripe.com/pay/cs_test_...

📝 Client Secret (pour API): cs_test_...

⚠️  En mode TEST, utilisez les cartes de test Stripe:
   - Carte qui fonctionne: 4242 4242 4242 4242
   - Date expiration: n'importe quelle date future
   - CVC: n'importe quel 3 chiffres

=== 7. Activation campagne (après paiement) ===
⚠️  Cette étape nécessite que vous ayez payé via le lien Stripe ci-dessus
💡 Utilisez la carte de test: 4242 4242 4242 4242

⏸️  Appuyez sur ENTER une fois le paiement effectué...

📊 Statut campagne: ACTIVE
✅ Campagne ACTIVE - Paiement confirmé !

💰 Wallet Balance: 0€
⏳ Pending Balance (escrow): 350€

✅ Flow de test terminé avec succès !
================================================
```

## Notes importantes

### Stripe Connect automatique
- Le **Stripe Connect** est créé **automatiquement** lors de l'inscription PRO/TESTEUR
- Pas besoin d'appeler manuellement l'API `/stripe/connect/create`
- Le `stripeConnectAccountId` est enregistré dans le Profile

### KYC (Know Your Customer)
- **PRO**: KYC requis à partir de la **3ème campagne**
- **TESTEUR**: KYC requis **avant la première application**
- Le script ne teste pas encore le KYC (campagne 1, donc KYC non requis)

### Escrow Management
- Lors du paiement, le montant est mis en `pendingBalance` (escrow)
- Lors de la complétion d'un test, le montant est transféré au testeur
- Les slots non utilisés sont remboursés au PRO à la fin de la campagne

### Webhooks Stripe
- Le webhook `/stripe/webhooks` gère les événements:
  - `payment_intent.succeeded` → Confirme l'activation
  - `payment_intent.payment_failed` → Revient en DRAFT
  - `account.updated` → Met à jour le statut KYC

## Troubleshooting

### Erreur: "No Stripe Connect account found"
→ Le Stripe Connect n'a pas été créé lors du signup. Vérifiez:
1. `STRIPE_SECRET_KEY` est définie dans `.env`
2. L'API est bien lancée
3. Les logs de l'API montrent: `Stripe Connect account created for ...`

### Erreur: "Campaign payment failed"
→ Le paiement n'a pas réussi. Vérifiez:
1. Vous avez utilisé la carte test: `4242 4242 4242 4242`
2. Le webhook Stripe est configuré (optionnel en dev)
3. Les logs de l'API

### Erreur: "KYC required"
→ Normal si vous testez une 3ème campagne pour le même PRO
→ Utilisez la route `/stripe/connect/onboarding-link` pour compléter le KYC

## Prochaines étapes

1. Tester le flow TESTEUR qui applique à la campagne
2. Tester la complétion d'un test session
3. Tester le refund des slots non utilisés
4. Tester le KYC obligatoire (3ème campagne PRO)
