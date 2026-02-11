#!/bin/bash

# Script pour vérifier les balances et transactions Stripe
# =========================================================

API_URL="${API_URL:-http://localhost:3000/api/v1}"

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}📊 VÉRIFICATION BALANCES & TRANSACTIONS STRIPE${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Demander les emails ou utiliser les derniers du test
read -p "Email PRO (ou ENTER pour le dernier test): " PRO_EMAIL
read -p "Email TESTEUR (ou ENTER pour le dernier test): " TESTEUR_EMAIL
read -p "Mot de passe (défaut: Test123456!): " PASSWORD

PASSWORD=${PASSWORD:-Test123456!}

# Login PRO
if [ -n "$PRO_EMAIL" ]; then
    echo -e "${BLUE}🔐 Login PRO...${NC}"
    PRO_COOKIE_FILE="/tmp/pro_check_cookies.txt"
    LOGIN_PRO=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -c "$PRO_COOKIE_FILE" \
        -d "{\"email\": \"$PRO_EMAIL\", \"password\": \"$PASSWORD\"}")

    echo -e "${YELLOW}📋 Balance PRO:${NC}"
    curl -s -X GET "$API_URL/stripe/connect/balance" \
        -b "$PRO_COOKIE_FILE" | jq '.'

    echo ""
    echo -e "${YELLOW}📋 KYC Status PRO:${NC}"
    curl -s -X GET "$API_URL/stripe/connect/kyc-status" \
        -b "$PRO_COOKIE_FILE" | jq '.'
    echo ""
fi

# Login TESTEUR
if [ -n "$TESTEUR_EMAIL" ]; then
    echo -e "${BLUE}🔐 Login TESTEUR...${NC}"
    TESTEUR_COOKIE_FILE="/tmp/testeur_check_cookies.txt"
    LOGIN_TESTEUR=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -c "$TESTEUR_COOKIE_FILE" \
        -d "{\"email\": \"$TESTEUR_EMAIL\", \"password\": \"$PASSWORD\"}")

    echo -e "${YELLOW}📋 Balance TESTEUR:${NC}"
    curl -s -X GET "$API_URL/stripe/connect/balance" \
        -b "$TESTEUR_COOKIE_FILE" | jq '.'

    echo ""
    echo -e "${YELLOW}📋 KYC Status TESTEUR:${NC}"
    curl -s -X GET "$API_URL/stripe/connect/kyc-status" \
        -b "$TESTEUR_COOKIE_FILE" | jq '.'

    echo ""
    echo -e "${YELLOW}💰 Wallet TESTEUR:${NC}"
    curl -s -X GET "$API_URL/wallets/my-wallet" \
        -b "$TESTEUR_COOKIE_FILE" | jq '.'

    echo ""
    echo -e "${YELLOW}📜 Transactions TESTEUR:${NC}"
    curl -s -X GET "$API_URL/wallets/transactions" \
        -b "$TESTEUR_COOKIE_FILE" | jq '.[] | {id, type, amount, status, createdAt}'
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Vérification terminée${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${CYAN}💡 Pour voir dans Stripe Dashboard:${NC}"
echo "   1. Stripe Dashboard → Connect → Accounts"
echo "   2. Balance → Transfers (voir les 65 EUR au TESTEUR)"
echo "   3. Connect → Application fees (voir les 5 EUR SuperTry)"
echo "   4. Payments → All payments (voir le paiement 350 EUR du PRO)"
echo ""

# Cleanup
rm -f /tmp/pro_check_cookies.txt /tmp/testeur_check_cookies.txt 2>/dev/null
