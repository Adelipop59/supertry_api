#!/bin/bash

# ============================================================================
# Script pour ajouter des fonds au balance Stripe en mode test
# ============================================================================
# Utilise la carte de test spéciale 4000 0000 0000 0077 qui ajoute
# immédiatement des fonds au balance disponible du compte plateforme
# ============================================================================

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000/api/v1}"
AMOUNT="${1:-350}"  # Montant par défaut: 350€ (5 slots × 70€)

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}${BOLD}💰 AJOUT DE FONDS AU BALANCE STRIPE (MODE TEST)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Ce script vous aide à ajouter des fonds au balance disponible${NC}"
echo -e "${YELLOW}du compte plateforme Stripe en mode test.${NC}"
echo ""
echo -e "${BLUE}Montant à ajouter:${NC} ${GREEN}${BOLD}${AMOUNT} EUR${NC}"
echo ""
echo -e "${YELLOW}Instructions:${NC}"
echo -e "  ${BLUE}1.${NC} Créez un Payment Intent de test"
echo -e "  ${BLUE}2.${NC} Utilisez la carte ${BOLD}4000 0000 0000 0077${NC}"
echo -e "  ${BLUE}3.${NC} Les fonds seront immédiatement disponibles"
echo ""
echo -e "${RED}${BOLD}⚠️  ATTENTION:${NC}"
echo -e "${RED}   La carte 4242 4242 4242 4242 ne fonctionne PAS pour cela!${NC}"
echo -e "${RED}   Vous DEVEZ utiliser 4000 0000 0000 0077${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${CYAN}Option 1: Via Stripe Dashboard (Recommandé)${NC}"
echo -e "  ${BLUE}•${NC} Allez sur https://dashboard.stripe.com/test/balance"
echo -e "  ${BLUE}•${NC} Utilisez la carte ${BOLD}4000 0000 0000 0077${NC} pour créer un Payment Intent"
echo ""
echo -e "${CYAN}Option 2: Via API (Automatique)${NC}"
echo -e "  ${BLUE}•${NC} Le script peut créer automatiquement un Payment Intent de test"
echo ""

read -p "Voulez-vous créer automatiquement un Payment Intent de test? (o/N): " AUTO_CREATE

if [[ "$AUTO_CREATE" =~ ^[Oo]$ ]]; then
    echo ""
    echo -e "${BLUE}➜${NC} Création d'un Payment Intent de ${AMOUNT}€..."

    # Note: Cette fonctionnalité nécessiterait une route API dédiée
    # ou l'utilisation directe de la CLI Stripe

    echo -e "${YELLOW}⚠️  Fonctionnalité non implémentée${NC}"
    echo -e "${YELLOW}   Utilisez le Stripe Dashboard ou créez une campagne de test${NC}"
    echo -e "${YELLOW}   avec la carte 4000 0000 0000 0077${NC}"
else
    echo ""
    echo -e "${GREEN}✅ Utilisez le Stripe Dashboard ou créez une campagne de test${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}${BOLD}💡 ASTUCE:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Pour vérifier votre balance actuel, utilisez:${NC}"
echo -e "  ${GREEN}./scripts/check-stripe-balances.sh${NC}"
echo ""
echo -e "${YELLOW}Documentation Stripe sur les cartes de test:${NC}"
echo -e "  ${BLUE}https://stripe.com/docs/testing#available-balance${NC}"
echo ""
