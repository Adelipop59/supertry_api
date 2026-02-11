#!/bin/bash

# Script de test complet du flow de paiement Stripe
# ==================================================

set -e

STRIPE_CLI="/tmp/stripe"
API_URL="${API_URL:-http://localhost:3000/api/v1}"
STRIPE_KEY=$(grep STRIPE_SECRET_KEY .env 2>/dev/null | cut -d= -f2)

echo "🎯 TEST COMPLET DU FLOW DE PAIEMENT STRIPE"
echo "=========================================="
echo ""

# Vérifier que l'API tourne
if ! curl -s "$API_URL/categories" > /dev/null 2>&1; then
  echo "❌ L'API ne répond pas sur $API_URL"
  echo "   Lance d'abord: pnpm run start:dev"
  exit 1
fi

echo "✅ API accessible"
echo ""

# Option 1: Test automatique avec Stripe CLI
echo "📋 OPTION 1: Test automatique (RECOMMANDÉ)"
echo "==========================================="
echo ""
echo "Cette option va:"
echo "  1. Lancer Stripe listen en arrière-plan"
echo "  2. Trigger un événement checkout.session.completed"
echo "  3. Le webhook sera automatiquement envoyé à ton API"
echo ""
echo "Commandes:"
echo "  $STRIPE_CLI listen --api-key $STRIPE_KEY --forward-to $API_URL/stripe/webhooks &"
echo "  sleep 3"
echo "  $STRIPE_CLI trigger checkout.session.completed --api-key $STRIPE_KEY"
echo ""

# Option 2: Test manuel avec vraie session
echo "📋 OPTION 2: Test manuel avec vraie session Stripe"
echo "=================================================="
echo ""
echo "1. Dans Terminal 1, lance:"
echo "   $STRIPE_CLI listen --api-key $STRIPE_KEY --forward-to $API_URL/stripe/webhooks"
echo ""
echo "2. Dans Terminal 2, crée une session:"
echo "   pnpm tsx scripts/test-pro-payment-flow.ts"
echo ""
echo "3. Ouvre le lien Stripe dans le navigateur"
echo ""
echo "4. Paie avec la carte de test: 4242 4242 4242 4242"
echo ""
echo "5. Stripe enverra automatiquement le webhook à ton API"
echo ""
echo "6. La campagne sera automatiquement activée!"
echo ""

# Option 3: Test avec script complet
echo "📋 OPTION 3: Lancer le test automatique maintenant"
echo "================================================="
echo ""
read -p "Lancer le test automatique? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "🚀 Lancement du test..."
  echo ""
  
  # Lancer stripe listen en arrière-plan
  echo "1️⃣ Démarrage du webhook forwarding..."
  $STRIPE_CLI listen --api-key "$STRIPE_KEY" --forward-to "$API_URL/stripe/webhooks" > /tmp/stripe-webhook.log 2>&1 &
  LISTEN_PID=$!
  echo "   PID: $LISTEN_PID"
  
  # Attendre que stripe listen soit prêt
  echo "   Attente du démarrage (5s)..."
  sleep 5
  
  # Trigger l'événement
  echo ""
  echo "2️⃣ Déclenchement de l'événement checkout.session.completed..."
  $STRIPE_CLI trigger checkout.session.completed --api-key "$STRIPE_KEY"
  
  # Attendre la réception
  echo ""
  echo "3️⃣ Attente de la réception du webhook (3s)..."
  sleep 3
  
  # Afficher les logs
  echo ""
  echo "📋 Logs du webhook:"
  tail -15 /tmp/stripe-webhook.log
  
  # Arrêter stripe listen
  echo ""
  echo "4️⃣ Arrêt du webhook forwarding..."
  kill $LISTEN_PID 2>/dev/null || true
  
  echo ""
  echo "✅ Test terminé!"
  echo ""
  echo "⚠️  Note: L'événement trigger crée une session fictive."
  echo "   Pour tester avec une vraie session, utilise l'OPTION 2."
else
  echo ""
  echo "ℹ️  Test annulé. Utilise les options ci-dessus pour tester."
fi

echo ""
echo "================================================"
echo "Documentation complète: STRIPE_MODULE_README.md"

