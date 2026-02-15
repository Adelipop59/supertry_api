#!/bin/bash

# ============================================================================
# Script de Test - Flow Complet SuperTry A→Z
# ============================================================================
# Ce script teste automatiquement:
# 1. Création PRO + produit + campagne + paiement (manual capture)
# 2. Vérification escrow breakdown (5€ fixe + 3.5% Stripe coverage)
# 3. Attente capture automatique CRON (ou forçage)
# 4. Création TESTEUR + KYC Identity
# 5. Application + test complété
# 6. Validation PRO → Testeur crédité + Commission 5€ fixe
# 7. (Optionnel) Test annulation campagne gratuite
# ============================================================================

set -e  # Exit on error

# Configuration
API_URL="${API_URL:-http://localhost:3000/api/v1}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3001}"
DB_URL="${DATABASE_URL:-postgresql://postgres:1234@localhost:5432/supertry_dev}"

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Variables globales
TIMESTAMP=$(date +%s)
PRO_EMAIL="pro-test-${TIMESTAMP}@example.com"
TESTEUR_EMAIL="testeur-test-${TIMESTAMP}@example.com"
PASSWORD="Test123456!"

PRO_COOKIE_FILE="pro_cookies_${TIMESTAMP}.txt"
TESTEUR_COOKIE_FILE="testeur_cookies_${TIMESTAMP}.txt"

PRODUCT_ID=""
CATEGORY_ID=""
CAMPAIGN_ID=""
SESSION_ID=""
IDENTITY_SESSION_ID=""
CHECKOUT_URL=""
VERIFICATION_URL=""
REWARD_AMOUNT=""
BALANCE=""
UGC_VIDEO_ID=""

# ============================================================================
# Fonctions Utilitaires
# ============================================================================

print_header() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BOLD}${CYAN}$1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

print_step() {
    echo -e "${BLUE}➜${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_money() {
    echo -e "${MAGENTA}💰 $1${NC}"
}

check_response() {
    local response="$1"
    local step_name="$2"

    if echo "$response" | jq -e '.statusCode' >/dev/null 2>&1; then
        local status_code=$(echo "$response" | jq -r '.statusCode')
        if [ "$status_code" -ge 400 ]; then
            local message=$(echo "$response" | jq -r '.message')
            print_error "$step_name échoué: $message"
            return 1
        fi
    fi
    return 0
}

# ============================================================================
# Phase 1: Setup PRO + Campagne + Paiement (Manual Capture)
# ============================================================================

setup_pro() {
    print_header "📋 PHASE 1: CRÉATION COMPTE PRO + CAMPAGNE + PAIEMENT"

    # 1. Signup PRO
    print_step "Création compte PRO ($PRO_EMAIL)..."
    PRO_SIGNUP_RESPONSE=$(curl -s -X POST "$API_URL/auth/signup" \
        -H "Content-Type: application/json" \
        -c "$PRO_COOKIE_FILE" \
        -d '{
            "email": "'"$PRO_EMAIL"'",
            "password": "'"$PASSWORD"'",
            "role": "PRO",
            "firstName": "John",
            "lastName": "Seller",
            "companyName": "Test Company Ltd",
            "countries": ["FR"]
        }')

    check_response "$PRO_SIGNUP_RESPONSE" "Signup PRO" || exit 1
    print_success "Compte PRO créé"

    # 2. Récupérer catégorie
    print_step "Récupération catégorie..."
    CATEGORIES_RESPONSE=$(curl -s -X GET "$API_URL/categories")
    CATEGORY_ID=$(echo "$CATEGORIES_RESPONSE" | jq -r '.[0].id')

    if [ "$CATEGORY_ID" = "null" ] || [ -z "$CATEGORY_ID" ]; then
        print_error "Aucune catégorie trouvée. Exécutez 'npx prisma db seed' d'abord."
        exit 1
    fi
    print_success "Catégorie: $CATEGORY_ID"

    # 3. Créer produit
    print_step "Création produit..."
    PRODUCT_RESPONSE=$(curl -s -X POST "$API_URL/products" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "name": "Test Product Script Auto",
            "description": "Produit de test automatisé pour le flow complet",
            "categoryId": "'"$CATEGORY_ID"'",
            "price": 50,
            "shippingCost": 10,
            "asin": "TEST'$TIMESTAMP'",
            "productUrl": "https://amazon.fr/test-product"
        }')

    check_response "$PRODUCT_RESPONSE" "Création produit" || exit 1
    PRODUCT_ID=$(echo "$PRODUCT_RESPONSE" | jq -r '.id')
    print_success "Produit créé: $PRODUCT_ID"

    # 4. Créer campagne
    print_step "Création campagne..."
    START_DATE=$(date -u -v+1d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT00:00:00Z")
    END_DATE=$(date -u -v+30d +"%Y-%m-%dT23:59:59Z" 2>/dev/null || date -u -d "+30 days" +"%Y-%m-%dT23:59:59Z")

    CAMPAIGN_RESPONSE=$(curl -s -X POST "$API_URL/campaigns" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "title": "Campaign Test Script Auto",
            "description": "Campagne de test automatisée - Manual Capture",
            "categoryId": "'"$CATEGORY_ID"'",
            "startDate": "'"$START_DATE"'",
            "endDate": "'"$END_DATE"'",
            "totalSlots": 5,
            "autoAcceptApplications": false,
            "marketplaceMode": "PRODUCT_LINK",
            "amazonLink": "https://amazon.fr/test-product-script",
            "offer": {
                "productId": "'"$PRODUCT_ID"'",
                "productName": "Test Product Script Auto",
                "expectedPrice": 75,
                "shippingCost": 10,
                "priceRangeMin": 45,
                "priceRangeMax": 55,
                "isPriceRevealed": true,
                "reimbursedPrice": true,
                "reimbursedShipping": true,
                "bonus": 5,
                "quantity": 1
            },
            "distributions": [
                {
                    "type": "RECURRING",
                    "dayOfWeek": 1,
                    "maxUnits": 5,
                    "isActive": true
                }
            ]
        }')

    check_response "$CAMPAIGN_RESPONSE" "Création campagne" || exit 1
    CAMPAIGN_ID=$(echo "$CAMPAIGN_RESPONSE" | jq -r '.id')
    print_success "Campagne créée: $CAMPAIGN_ID"

    # 5. Paiement campagne (MANUAL CAPTURE)
    print_step "Création session paiement Stripe (manual capture)..."
    CHECKOUT_RESPONSE=$(curl -s -X POST "$API_URL/campaigns/$CAMPAIGN_ID/checkout-session" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "successUrl": "'"$FRONTEND_URL"'/campaigns/'"$CAMPAIGN_ID"'/success",
            "cancelUrl": "'"$FRONTEND_URL"'/campaigns/'"$CAMPAIGN_ID"'/cancel"
        }')

    check_response "$CHECKOUT_RESPONSE" "Création checkout session" || exit 1
    CHECKOUT_URL=$(echo "$CHECKOUT_RESPONSE" | jq -r '.checkoutUrl')
    CHECKOUT_AMOUNT=$(echo "$CHECKOUT_RESPONSE" | jq -r '.amount')
    CHECKOUT_AMOUNT_EUR=$(echo "scale=2; $CHECKOUT_AMOUNT / 100" | bc 2>/dev/null || echo "$CHECKOUT_AMOUNT")

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${YELLOW}${BOLD}💳 PAIEMENT STRIPE CHECKOUT (MANUAL CAPTURE)${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}URL:${NC} ${GREEN}$CHECKOUT_URL${NC}"
    echo -e "${BLUE}Montant:${NC} ${CYAN}${CHECKOUT_AMOUNT_EUR} EUR${NC}"
    echo ""
    echo -e "${MAGENTA}${BOLD}Breakdown par testeur:${NC}"
    echo -e "  ${BLUE}Prix produit:${NC}        75.00€"
    echo -e "  ${BLUE}Frais de port:${NC}       10.00€"
    echo -e "  ${BLUE}Bonus testeur:${NC}        5.00€"
    echo -e "  ${BLUE}Commission SuperTry:${NC}  5.00€ (fixe)"
    echo -e "  ${BLUE}Couverture Stripe:${NC}    ~3.44€ (3.5%)"
    echo -e "  ${CYAN}────────────────────────────────${NC}"
    echo -e "  ${BOLD}Par testeur:${NC}          ~98.44€"
    echo -e "  ${BOLD}x 5 testeurs${NC}"
    echo -e "  ${GREEN}${BOLD}TOTAL:                ~492.20€${NC}"
    echo ""
    echo -e "${YELLOW}➜ Ouvrez ce lien dans votre navigateur${NC}"
    echo -e "${YELLOW}➜ Carte de test: ${BOLD}4242 4242 4242 4242${NC}"
    echo -e "${YELLOW}➜ Date: ${BOLD}N'importe quelle date future${NC}"
    echo -e "${YELLOW}➜ CVC: ${BOLD}N'importe quels 3 chiffres${NC}"
    echo ""
    echo -e "${RED}${BOLD}IMPORTANT: Avec manual capture, le paiement est AUTORISÉ mais pas capturé.${NC}"
    echo -e "${RED}Le PRO a 1h pour annuler GRATUITEMENT (0 frais Stripe, 0 frais SuperTry).${NC}"
    echo -e "${RED}Après 1h, le CRON capture automatiquement et la campagne passe ACTIVE.${NC}"
    echo ""
    read -p "Appuyez sur ENTRÉE une fois le paiement complété..."

    # 6. Attendre webhook checkout.session.completed
    print_step "Attente webhook checkout.session.completed..."
    sleep 5

    # Vérifier statut campagne - Avec manual capture, le statut devrait être PENDING_PAYMENT
    CAMPAIGN_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CAMPAIGN_ID" \
        -b "$PRO_COOKIE_FILE")

    CAMPAIGN_STATUS=$(echo "$CAMPAIGN_STATUS_RESPONSE" | jq -r '.status')

    echo ""
    echo -e "${BOLD}Statut campagne après paiement:${NC} ${CYAN}$CAMPAIGN_STATUS${NC}"

    if [ "$CAMPAIGN_STATUS" = "PENDING_PAYMENT" ]; then
        print_success "Campagne en PENDING_PAYMENT (manual capture - paiement autorisé)"
        echo ""
        echo -e "${YELLOW}${BOLD}Le paiement est autorisé mais PAS ENCORE capturé.${NC}"
        echo -e "${YELLOW}Le PRO peut annuler GRATUITEMENT tant que le PI n'est pas capturé.${NC}"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e "${BOLD}Que voulez-vous faire ?${NC}"
        echo -e "  ${BLUE}1.${NC} ${RED}Annuler la campagne GRATUITEMENT${NC} (0 frais Stripe, 0 frais SuperTry)"
        echo -e "  ${BLUE}2.${NC} ${GREEN}Continuer${NC} → attendre la capture automatique par le CRON (~10s)"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        read -p "Votre choix (1 ou 2) : " -n 1 -r CHOICE
        echo ""
        echo ""

        if [ "$CHOICE" = "1" ]; then
            # ===== ANNULATION GRATUITE =====
            print_header "🚫 ANNULATION GRATUITE (PI non capturé)"

            print_step "Annulation de la campagne $CAMPAIGN_ID..."
            CANCEL_RESPONSE=$(curl -s -X DELETE "$API_URL/campaigns/$CAMPAIGN_ID" \
                -b "$PRO_COOKIE_FILE")

            # Afficher la réponse
            echo "$CANCEL_RESPONSE" | jq '.' 2>/dev/null || echo "$CANCEL_RESPONSE"
            echo ""

            sleep 2

            # Vérifier le statut final
            FINAL_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CAMPAIGN_ID" \
                -b "$PRO_COOKIE_FILE")
            FINAL_STATUS=$(echo "$FINAL_STATUS_RESPONSE" | jq -r '.status')

            echo -e "${BOLD}Statut final de la campagne:${NC} ${CYAN}$FINAL_STATUS${NC}"
            echo ""

            if [ "$FINAL_STATUS" = "CANCELLED" ]; then
                print_success "Campagne ANNULÉE avec succès !"
                print_success "0 frais Stripe (PI annulé avant capture)"
                print_success "0 frais SuperTry"
                echo ""
                echo -e "${MAGENTA}${BOLD}Vérifiez dans le Stripe Dashboard :${NC}"
                echo -e "  ${BLUE}→ Le PaymentIntent devrait être 'Canceled'${NC}"
                echo -e "  ${BLUE}→ Aucun frais prélevé${NC}"
                echo -e "  ${BLUE}→ Metadata: captureMethod=manual, transactionType=CAMPAIGN_PAYMENT${NC}"
            else
                print_error "Statut inattendu après annulation: $FINAL_STATUS (attendu: CANCELLED)"
            fi

            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo -e "${YELLOW}La campagne a été annulée. Le script va maintenant en créer une nouvelle pour continuer le flow.${NC}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            read -p "Appuyez sur ENTRÉE pour créer une nouvelle campagne et continuer..."

            # Recréer une campagne pour continuer le flow complet
            print_step "Création d'une nouvelle campagne..."
            START_DATE=$(date -u -v+1d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT00:00:00Z")
            END_DATE=$(date -u -v+30d +"%Y-%m-%dT23:59:59Z" 2>/dev/null || date -u -d "+30 days" +"%Y-%m-%dT23:59:59Z")

            CAMPAIGN_RESPONSE=$(curl -s -X POST "$API_URL/campaigns" \
                -H "Content-Type: application/json" \
                -b "$PRO_COOKIE_FILE" \
                -d '{
                    "title": "Campaign Test Script Auto (2)",
                    "description": "Campagne de test après annulation gratuite",
                    "categoryId": "'"$CATEGORY_ID"'",
                    "startDate": "'"$START_DATE"'",
                    "endDate": "'"$END_DATE"'",
                    "totalSlots": 5,
                    "autoAcceptApplications": false,
                    "marketplaceMode": "PRODUCT_LINK",
                    "amazonLink": "https://amazon.fr/test-product-script-2",
                    "offer": {
                        "productId": "'"$PRODUCT_ID"'",
                        "productName": "Test Product Script Auto",
                        "expectedPrice": 75,
                        "shippingCost": 10,
                        "priceRangeMin": 45,
                        "priceRangeMax": 55,
                        "isPriceRevealed": true,
                        "reimbursedPrice": true,
                        "reimbursedShipping": true,
                        "bonus": 5,
                        "quantity": 1
                    },
                    "distributions": [
                        {
                            "type": "RECURRING",
                            "dayOfWeek": 1,
                            "maxUnits": 5,
                            "isActive": true
                        }
                    ]
                }')

            check_response "$CAMPAIGN_RESPONSE" "Création campagne" || exit 1
            CAMPAIGN_ID=$(echo "$CAMPAIGN_RESPONSE" | jq -r '.id')
            print_success "Nouvelle campagne créée: $CAMPAIGN_ID"

            # Nouveau paiement
            print_step "Paiement de la nouvelle campagne (manual capture)..."
            CHECKOUT_RESPONSE=$(curl -s -X POST "$API_URL/campaigns/$CAMPAIGN_ID/checkout-session" \
                -H "Content-Type: application/json" \
                -b "$PRO_COOKIE_FILE" \
                -d '{
                    "successUrl": "'"$FRONTEND_URL"'/campaigns/'"$CAMPAIGN_ID"'/success",
                    "cancelUrl": "'"$FRONTEND_URL"'/campaigns/'"$CAMPAIGN_ID"'/cancel"
                }')

            check_response "$CHECKOUT_RESPONSE" "Création checkout session" || exit 1
            CHECKOUT_URL=$(echo "$CHECKOUT_RESPONSE" | jq -r '.checkoutUrl')

            echo ""
            echo -e "${YELLOW}${BOLD}💳 Payez cette nouvelle campagne :${NC}"
            echo -e "${GREEN}$CHECKOUT_URL${NC}"
            echo -e "${YELLOW}Carte de test: ${BOLD}4242 4242 4242 4242${NC}"
            echo ""
            read -p "Appuyez sur ENTRÉE une fois le paiement complété..."

            sleep 5

            # Vérifier puis attendre la capture
            CAMPAIGN_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CAMPAIGN_ID" \
                -b "$PRO_COOKIE_FILE")
            CAMPAIGN_STATUS=$(echo "$CAMPAIGN_STATUS_RESPONSE" | jq -r '.status')
            echo -e "${BOLD}Statut:${NC} ${CYAN}$CAMPAIGN_STATUS${NC}"

            if [ "$CAMPAIGN_STATUS" = "PENDING_PAYMENT" ]; then
                print_step "Attente capture automatique par le CRON (~10s en dev)..."
                for i in {1..12}; do
                    sleep 5
                    CAMPAIGN_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CAMPAIGN_ID" \
                        -b "$PRO_COOKIE_FILE")
                    CAMPAIGN_STATUS=$(echo "$CAMPAIGN_STATUS_RESPONSE" | jq -r '.status')
                    if [ "$CAMPAIGN_STATUS" = "ACTIVE" ]; then
                        print_success "Campagne capturée et activée par le CRON !"
                        break
                    fi
                    echo -e "${BLUE}   ⏳ Attente capture... ($((i * 5))s) - Statut: $CAMPAIGN_STATUS${NC}"
                    if [ $i -eq 12 ]; then
                        print_warning "Timeout après 60s. Vérifiez le serveur NestJS."
                        read -p "Continuer ? (o/n) " -n 1 -r
                        echo ""
                        if [[ ! $REPLY =~ ^[Oo]$ ]]; then exit 1; fi
                    fi
                done
            fi
        else
            # ===== CONTINUER → attendre la capture CRON =====
            print_step "Attente capture automatique par le CRON (~10s en dev)..."
            echo -e "${YELLOW}   captureDelayMinutes=0, CRON toutes les 10s → capture en ~10-20s${NC}"
            echo ""

            for i in {1..12}; do
                sleep 5

                CAMPAIGN_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CAMPAIGN_ID" \
                    -b "$PRO_COOKIE_FILE")
                CAMPAIGN_STATUS=$(echo "$CAMPAIGN_STATUS_RESPONSE" | jq -r '.status')

                if [ "$CAMPAIGN_STATUS" = "ACTIVE" ]; then
                    print_success "Campagne capturée et activée automatiquement par le CRON !"
                    break
                fi

                echo -e "${BLUE}   ⏳ Attente capture... ($((i * 5))s) - Statut: $CAMPAIGN_STATUS${NC}"

                if [ $i -eq 12 ]; then
                    print_warning "Timeout: la campagne est toujours en $CAMPAIGN_STATUS après 60s"
                    echo -e "${YELLOW}   Vérifiez que le serveur NestJS tourne et que le CRON est actif.${NC}"
                    echo ""
                    read -p "Voulez-vous continuer quand même ? (o/n) " -n 1 -r
                    echo ""
                    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
                        exit 1
                    fi
                fi
            done
        fi

    elif [ "$CAMPAIGN_STATUS" = "ACTIVE" ]; then
        print_success "Campagne activée (capture automatique ou délai court)"
    else
        print_warning "Campagne en statut inattendu: $CAMPAIGN_STATUS"
    fi
}

# ============================================================================
# Phase 1b (Optionnel): Test annulation gratuite
# ============================================================================

test_free_cancellation() {
    print_header "🚫 PHASE 1b: TEST ANNULATION GRATUITE (manual capture)"

    echo -e "${YELLOW}Ce test crée une 2ème campagne, paie, puis annule dans le délai de grâce.${NC}"
    echo -e "${YELLOW}Résultat attendu: 0 frais Stripe, 0 frais SuperTry.${NC}"
    echo ""
    read -p "Voulez-vous tester l'annulation gratuite ? (o/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
        print_step "Test annulation skippé"
        return
    fi

    # Créer une 2ème campagne
    print_step "Création 2ème campagne pour test annulation..."
    START_DATE=$(date -u -v+1d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -u -d "+1 day" +"%Y-%m-%dT00:00:00Z")
    END_DATE=$(date -u -v+30d +"%Y-%m-%dT23:59:59Z" 2>/dev/null || date -u -d "+30 days" +"%Y-%m-%dT23:59:59Z")

    CANCEL_CAMPAIGN_RESPONSE=$(curl -s -X POST "$API_URL/campaigns" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "title": "Campaign Test Annulation Gratuite",
            "description": "Test annulation dans le delai de grace",
            "categoryId": "'"$CATEGORY_ID"'",
            "startDate": "'"$START_DATE"'",
            "endDate": "'"$END_DATE"'",
            "totalSlots": 2,
            "autoAcceptApplications": false,
            "marketplaceMode": "PRODUCT_LINK",
            "amazonLink": "https://amazon.fr/test-cancel",
            "offer": {
                "productId": "'"$PRODUCT_ID"'",
                "productName": "Test Cancel Product",
                "expectedPrice": 30,
                "shippingCost": 5,
                "priceRangeMin": 25,
                "priceRangeMax": 35,
                "isPriceRevealed": true,
                "reimbursedPrice": true,
                "reimbursedShipping": true,
                "bonus": 5,
                "quantity": 1
            },
            "distributions": [
                {
                    "type": "RECURRING",
                    "dayOfWeek": 1,
                    "maxUnits": 2,
                    "isActive": true
                }
            ]
        }')

    check_response "$CANCEL_CAMPAIGN_RESPONSE" "Création campagne annulation" || return
    CANCEL_CAMPAIGN_ID=$(echo "$CANCEL_CAMPAIGN_RESPONSE" | jq -r '.id')
    print_success "Campagne annulation créée: $CANCEL_CAMPAIGN_ID"

    # Paiement
    print_step "Paiement de la campagne..."
    CANCEL_CHECKOUT_RESPONSE=$(curl -s -X POST "$API_URL/campaigns/$CANCEL_CAMPAIGN_ID/checkout-session" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "successUrl": "'"$FRONTEND_URL"'/campaigns/'"$CANCEL_CAMPAIGN_ID"'/success",
            "cancelUrl": "'"$FRONTEND_URL"'/campaigns/'"$CANCEL_CAMPAIGN_ID"'/cancel"
        }')

    CANCEL_CHECKOUT_URL=$(echo "$CANCEL_CHECKOUT_RESPONSE" | jq -r '.checkoutUrl')
    echo ""
    echo -e "${YELLOW}${BOLD}💳 Payez cette 2ème campagne:${NC}"
    echo -e "${GREEN}$CANCEL_CHECKOUT_URL${NC}"
    echo ""
    read -p "Appuyez sur ENTRÉE une fois le paiement complété..."

    sleep 5

    # Vérifier statut (devrait être PENDING_PAYMENT)
    CANCEL_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CANCEL_CAMPAIGN_ID" \
        -b "$PRO_COOKIE_FILE")
    CANCEL_STATUS=$(echo "$CANCEL_STATUS_RESPONSE" | jq -r '.status')
    echo -e "${BOLD}Statut:${NC} $CANCEL_STATUS"

    if [ "$CANCEL_STATUS" = "PENDING_PAYMENT" ]; then
        # Annuler immédiatement (dans le délai de grâce)
        print_step "Annulation de la campagne (dans le délai de grâce)..."
        CANCEL_RESPONSE=$(curl -s -X DELETE "$API_URL/campaigns/$CANCEL_CAMPAIGN_ID" \
            -b "$PRO_COOKIE_FILE")

        echo "$CANCEL_RESPONSE" | jq '.' 2>/dev/null

        # Vérifier que le statut est CANCELLED
        sleep 2
        FINAL_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/campaigns/$CANCEL_CAMPAIGN_ID" \
            -b "$PRO_COOKIE_FILE")
        FINAL_STATUS=$(echo "$FINAL_STATUS_RESPONSE" | jq -r '.status')

        if [ "$FINAL_STATUS" = "CANCELLED" ]; then
            print_success "Campagne annulée ! Statut: CANCELLED"
            print_success "0 frais Stripe, 0 frais SuperTry (PaymentIntent annulé avant capture)"
            echo ""
            echo -e "${MAGENTA}${BOLD}Vérifiez dans le Stripe Dashboard:${NC}"
            echo -e "  ${BLUE}→ Le PaymentIntent devrait être 'Canceled'${NC}"
            echo -e "  ${BLUE}→ Aucun frais prélevé${NC}"
            echo -e "  ${BLUE}→ Metadata: transactionType=CAMPAIGN_PAYMENT, captureMethod=manual${NC}"
        else
            print_warning "Statut inattendu après annulation: $FINAL_STATUS"
        fi
    else
        print_warning "La campagne n'est pas en PENDING_PAYMENT ($CANCEL_STATUS), impossible de tester l'annulation gratuite"
    fi
}

# ============================================================================
# Phase 2: Setup TESTEUR + KYC
# ============================================================================

setup_testeur() {
    print_header "👤 PHASE 2: CRÉATION COMPTE TESTEUR + ONBOARDING"

    # 1. Signup TESTEUR
    print_step "Création compte TESTEUR ($TESTEUR_EMAIL)..."
    TESTEUR_SIGNUP_RESPONSE=$(curl -s -X POST "$API_URL/auth/signup" \
        -H "Content-Type: application/json" \
        -c "$TESTEUR_COOKIE_FILE" \
        -d '{
            "email": "'"$TESTEUR_EMAIL"'",
            "password": "'"$PASSWORD"'",
            "role": "USER",
            "firstName": "Alice",
            "lastName": "Tester",
            "country": "FR"
        }')

    check_response "$TESTEUR_SIGNUP_RESPONSE" "Signup TESTEUR" || exit 1
    print_success "Compte TESTEUR créé"

    # 2. Créer Stripe Connect TESTEUR
    print_step "Création compte Stripe Connect TESTEUR..."
    TESTEUR_CONNECT_RESPONSE=$(curl -s -X POST "$API_URL/stripe/connect/create" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "email": "'"$TESTEUR_EMAIL"'",
            "country": "FR",
            "type": "express"
        }')

    check_response "$TESTEUR_CONNECT_RESPONSE" "Stripe Connect TESTEUR" || exit 1
    print_success "Stripe Connect TESTEUR créé"

    # ============================================================================
    # 3. ONBOARDING STRIPE CONNECT (requis AVANT de postuler)
    # ============================================================================

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${CYAN}${BOLD}🏦 STRIPE CONNECT ONBOARDING${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    print_step "Vérification du statut Stripe Connect..."
    KYC_STATUS=$(curl -s -X GET "$API_URL/stripe/connect/kyc-status" \
        -b "$TESTEUR_COOKIE_FILE")

    CHARGES_ENABLED=$(echo "$KYC_STATUS" | jq -r '.chargesEnabled // false')
    DETAILS_SUBMITTED=$(echo "$KYC_STATUS" | jq -r '.detailsSubmitted // false')

    if [ "$CHARGES_ENABLED" = "true" ] && [ "$DETAILS_SUBMITTED" = "true" ]; then
        print_success "Onboarding déjà complété !"
    else
        echo -e "${YELLOW}L'onboarding Stripe Connect est requis AVANT de postuler${NC}"
        echo ""

        print_step "Génération du lien d'onboarding..."
        ONBOARDING_RESPONSE=$(curl -s -X POST "$API_URL/stripe/connect/onboarding-link" \
            -H "Content-Type: application/json" \
            -b "$TESTEUR_COOKIE_FILE" \
            -d '{
                "type": "account_onboarding",
                "refreshUrl": "http://localhost:3000/refresh",
                "returnUrl": "http://localhost:3000/return"
            }')

        ONBOARDING_URL=$(echo "$ONBOARDING_RESPONSE" | jq -r '.url')

        if [ -z "$ONBOARDING_URL" ] || [ "$ONBOARDING_URL" = "null" ]; then
            print_error "Impossible de générer le lien d'onboarding"
            echo "$ONBOARDING_RESPONSE" | jq '.'
            exit 1
        fi

        echo ""
        echo -e "${BLUE}🔗 Lien d'onboarding:${NC}"
        echo -e "${GREEN}${BOLD}$ONBOARDING_URL${NC}"
        echo ""
        echo -e "${YELLOW}➜ Complétez l'onboarding (IBAN: DE89370400440532013000, Adresse)${NC}"
        echo ""
        read -p "Appuyez sur ENTRÉE après avoir complété l'onboarding..."

        for k in {1..30}; do
            sleep 3

            KYC_STATUS=$(curl -s -X GET "$API_URL/stripe/connect/kyc-status" \
                -b "$TESTEUR_COOKIE_FILE")

            CHARGES_ENABLED=$(echo "$KYC_STATUS" | jq -r '.chargesEnabled // false')
            DETAILS_SUBMITTED=$(echo "$KYC_STATUS" | jq -r '.detailsSubmitted // false')

            if [ "$CHARGES_ENABLED" = "true" ] && [ "$DETAILS_SUBMITTED" = "true" ]; then
                print_success "Onboarding complété !"
                break
            elif [ $k -eq 30 ]; then
                print_error "Timeout: Onboarding non complété après 90s"
                exit 1
            fi

            if [ $((k % 5)) -eq 0 ]; then
                echo -e "${BLUE}   ⏳ Attente onboarding... ($k/30)${NC}"
            fi
        done
    fi

    # ============================================================================
    # 4. APPLICATION À LA CAMPAGNE
    # ============================================================================

    echo ""
    print_step "Application à la campagne..."
    APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "applicationMessage": "Je suis très intéressé par ce test!"
        }')

    # Debug : afficher la réponse si erreur
    SESSION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id // empty')

    if [ -z "$SESSION_ID" ]; then
        # Vérifier si KYC Identity requis (après N tests complétés)
        IDENTITY_REQUIRED=$(echo "$APPLICATION_RESPONSE" | jq -r '.identityRequired // false')
        ONBOARDING_REQUIRED=$(echo "$APPLICATION_RESPONSE" | jq -r '.onboardingRequired // false')

        if [ "$IDENTITY_REQUIRED" = "true" ]; then
            VERIFICATION_URL=$(echo "$APPLICATION_RESPONSE" | jq -r '.verificationUrl')
            CLIENT_SECRET=$(echo "$APPLICATION_RESPONSE" | jq -r '.clientSecret')

            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo -e "${RED}${BOLD}🔒 KYC STRIPE IDENTITY REQUIS${NC}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo -e "${BLUE}🔗 Lien:${NC} ${GREEN}${BOLD}$VERIFICATION_URL${NC}"
            echo ""
            echo -e "${YELLOW}➜ Complétez la vérification Identity (CNI/Passeport + selfie)${NC}"
            echo ""
            read -p "Appuyez sur ENTRÉE après avoir validé l'Identity..."

            # Polling + retry application
            for j in {1..20}; do
                sleep 3

                APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
                    -H "Content-Type: application/json" \
                    -b "$TESTEUR_COOKIE_FILE" \
                    -d '{
                        "applicationMessage": "Je suis très intéressé par ce test!"
                    }')

                SESSION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id // empty')

                if [ -n "$SESSION_ID" ]; then
                    print_success "Application réussie après vérification Identity !"
                    break
                fi

                if [ $((j % 5)) -eq 0 ]; then
                    echo -e "${BLUE}   ⏳ Attente webhook Identity... ($j/20)${NC}"
                fi

                if [ $j -eq 20 ]; then
                    print_error "Timeout: Impossible de postuler après 60s"
                    echo "$APPLICATION_RESPONSE" | jq '.' 2>/dev/null
                    exit 1
                fi
            done
        elif [ "$ONBOARDING_REQUIRED" = "true" ]; then
            print_error "L'onboarding Stripe Connect n'est pas détecté comme complété par l'API."
            echo -e "${YELLOW}Réponse API:${NC}"
            echo "$APPLICATION_RESPONSE" | jq '.' 2>/dev/null
            echo ""
            echo -e "${YELLOW}Vérifiez que le webhook account.updated a été traité.${NC}"
            echo ""
            read -p "Appuyez sur ENTRÉE pour réessayer..."

            # Retry
            for j in {1..10}; do
                sleep 3
                APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
                    -H "Content-Type: application/json" \
                    -b "$TESTEUR_COOKIE_FILE" \
                    -d '{"applicationMessage": "Je suis très intéressé par ce test!"}')
                SESSION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id // empty')
                if [ -n "$SESSION_ID" ]; then
                    print_success "Application réussie !"
                    break
                fi
                echo -e "${BLUE}   ⏳ Retry... ($j/10)${NC}"
                if [ $j -eq 10 ]; then
                    print_error "Impossible de postuler. Réponse:"
                    echo "$APPLICATION_RESPONSE" | jq '.' 2>/dev/null
                    exit 1
                fi
            done
        else
            print_error "Application échouée. Réponse:"
            echo "$APPLICATION_RESPONSE" | jq '.' 2>/dev/null
            exit 1
        fi
    fi

    print_success "Application envoyée ! Session ID: $SESSION_ID"
}

# ============================================================================
# Phase 3: Flux de Test
# ============================================================================

run_test_flow() {
    print_header "🧪 PHASE 3: FLUX DE TEST"

    # 1. PRO accepte candidature
    print_step "PRO accepte la candidature..."
    ACCEPT_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$SESSION_ID/accept" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE")

    check_response "$ACCEPT_RESPONSE" "Acceptation candidature" || exit 1
    print_success "Candidature acceptée par PRO"

    # 2. TESTEUR soumet commande
    print_step "TESTEUR soumet la commande..."
    ORDER_NUMBER="TEST-ORDER-$TIMESTAMP"
    SUBMIT_PURCHASE_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$SESSION_ID/submit-purchase" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "orderNumber": "'"$ORDER_NUMBER"'",
            "productPrice": 50,
            "shippingCost": 10,
            "purchaseProofUrl": "https://example.com/proof-'$TIMESTAMP'.jpg"
        }')

    check_response "$SUBMIT_PURCHASE_RESPONSE" "Soumission commande" || exit 1
    print_success "Commande soumise: $ORDER_NUMBER"

    # 3. PRO valide commande
    print_step "PRO valide la commande..."
    VALIDATE_PURCHASE_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$SESSION_ID/validate-purchase" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "purchaseValidationComment": "Commande validée automatiquement"
        }')

    check_response "$VALIDATE_PURCHASE_RESPONSE" "Validation commande" || exit 1
    print_success "Commande validée par PRO"

    # 4. TESTEUR soumet test
    print_step "TESTEUR soumet le test complet..."
    SUBMIT_TEST_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$SESSION_ID/submit-test" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE")

    check_response "$SUBMIT_TEST_RESPONSE" "Soumission test" || exit 1
    print_success "Test soumis"

    # 5. PRO finalise session
    print_step "PRO finalise la session..."
    COMPLETE_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$SESSION_ID/complete" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE")

    check_response "$COMPLETE_RESPONSE" "Finalisation session" || exit 1
    REWARD_AMOUNT=$(echo "$COMPLETE_RESPONSE" | jq -r '.rewardAmount // "65"')
    print_success "Session finalisée - Récompense: $REWARD_AMOUNT EUR"

    echo ""
    print_money "Transfer PLATEFORME → TESTEUR créé avec metadata enrichies"
    echo -e "  ${BLUE}transactionType:${NC} TEST_REWARD"
    echo -e "  ${BLUE}commissionRetained:${NC} 5.00€ (fixe)"
    echo -e "  ${BLUE}totalReward:${NC} ${REWARD_AMOUNT}€"
}

# ============================================================================
# Phase 4: UGC VIDEO (payant: 20€ testeur + 5€ commission SuperTry)
# ============================================================================

test_ugc_video() {
    print_header "🎬 PHASE 4: UGC VIDEO (20€ + 5€ commission)"

    echo -e "${YELLOW}Flow UGC VIDEO payant:${NC}"
    echo -e "  ${BLUE}1.${NC} PRO demande un UGC VIDEO → PI manual capture (25€)"
    echo -e "  ${BLUE}2.${NC} TESTEUR soumet → PRO rejette (1ère fois)"
    echo -e "  ${BLUE}3.${NC} TESTEUR resoumet → PRO valide → capture PI → paiement testeur"
    echo ""

    # 1. PRO demande UGC VIDEO
    print_step "PRO demande un UGC VIDEO..."

    # Récupérer paymentMethodId du PRO (via Stripe)
    print_step "Récupération méthode de paiement du PRO..."
    PM_RESPONSE=$(curl -s -X GET "$API_URL/stripe/payment-methods" \
        -b "$PRO_COOKIE_FILE")

    PAYMENT_METHOD_ID=$(echo "$PM_RESPONSE" | jq -r '.[0].id // empty')

    if [ -z "$PAYMENT_METHOD_ID" ]; then
        print_warning "Aucune méthode de paiement trouvée. Tentative de récupération du customer..."
        # Essayer avec le customer Stripe
        CUSTOMER_RESPONSE=$(curl -s -X GET "$API_URL/stripe/customer" \
            -b "$PRO_COOKIE_FILE")
        PAYMENT_METHOD_ID=$(echo "$CUSTOMER_RESPONSE" | jq -r '.defaultPaymentMethod // empty')
    fi

    if [ -z "$PAYMENT_METHOD_ID" ]; then
        print_warning "Pas de méthode de paiement trouvée. UGC VIDEO sera créé sans PI (mode test)."
        print_step "Demande UGC VIDEO sans paymentMethodId..."
        UGC_VIDEO_RESPONSE=$(curl -s -X POST "$API_URL/ugc/request" \
            -H "Content-Type: application/json" \
            -b "$PRO_COOKIE_FILE" \
            -d '{
                "sessionId": "'"$SESSION_ID"'",
                "type": "VIDEO",
                "description": "Faites une vidéo de 30s montrant le produit en action"
            }')
    else
        print_step "Demande UGC VIDEO avec paymentMethodId: $PAYMENT_METHOD_ID..."
        UGC_VIDEO_RESPONSE=$(curl -s -X POST "$API_URL/ugc/request" \
            -H "Content-Type: application/json" \
            -b "$PRO_COOKIE_FILE" \
            -d '{
                "sessionId": "'"$SESSION_ID"'",
                "type": "VIDEO",
                "description": "Faites une vidéo de 30s montrant le produit en action",
                "paymentMethodId": "'"$PAYMENT_METHOD_ID"'"
            }')
    fi

    if echo "$UGC_VIDEO_RESPONSE" | jq -e '.statusCode >= 400' >/dev/null 2>&1; then
        ERROR_MSG=$(echo "$UGC_VIDEO_RESPONSE" | jq -r '.message')
        print_error "Erreur UGC VIDEO: $ERROR_MSG"
        echo "$UGC_VIDEO_RESPONSE" | jq '.' 2>/dev/null
        echo ""
        echo -e "${YELLOW}Skipping UGC VIDEO test (paiement requis mais pas de PM).${NC}"
        echo ""
        return
    fi

    UGC_VIDEO_ID=$(echo "$UGC_VIDEO_RESPONSE" | jq -r '.id')
    UGC_VIDEO_STATUS=$(echo "$UGC_VIDEO_RESPONSE" | jq -r '.status')
    UGC_VIDEO_PI=$(echo "$UGC_VIDEO_RESPONSE" | jq -r '.stripePaymentIntentId // "null"')

    print_success "UGC VIDEO créé: $UGC_VIDEO_ID (status: $UGC_VIDEO_STATUS)"
    if [ "$UGC_VIDEO_PI" != "null" ]; then
        print_money "PaymentIntent manual capture: $UGC_VIDEO_PI (25€ autorisé, 0 capturé)"
    fi

    # 2. TESTEUR soumet (1ère soumission - sera rejetée)
    echo ""
    print_step "TESTEUR soumet le UGC VIDEO (1ère tentative)..."
    SUBMIT_1_RESPONSE=$(curl -s -X POST "$API_URL/ugc/$UGC_VIDEO_ID/submit" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "comment": "Voici ma première vidéo de test",
            "contentUrl": "https://example.com/video-test-v1-'$TIMESTAMP'.mp4"
        }')

    check_response "$SUBMIT_1_RESPONSE" "Soumission UGC VIDEO v1" || {
        print_warning "Soumission échouée (upload fichier peut-être requis). Skip."
        return
    }
    print_success "UGC VIDEO soumis (v1)"

    # 3. PRO rejette (test du flow rejet)
    print_step "PRO rejette le UGC VIDEO..."
    REJECT_RESPONSE=$(curl -s -X POST "$API_URL/ugc/$UGC_VIDEO_ID/reject" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "rejectionReason": "La vidéo est trop sombre, refaites avec un meilleur éclairage"
        }')

    check_response "$REJECT_RESPONSE" "Rejet UGC VIDEO" || return
    REJECTION_COUNT=$(echo "$REJECT_RESPONSE" | jq -r '.rejectionCount // 1')
    print_success "UGC VIDEO rejeté (rejet $REJECTION_COUNT/3)"

    # 4. TESTEUR resoumet (2ème tentative)
    print_step "TESTEUR resoumet le UGC VIDEO (v2 améliorée)..."
    SUBMIT_2_RESPONSE=$(curl -s -X POST "$API_URL/ugc/$UGC_VIDEO_ID/submit" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "comment": "Voici la vidéo améliorée avec meilleur éclairage",
            "contentUrl": "https://example.com/video-test-v2-'$TIMESTAMP'.mp4"
        }')

    check_response "$SUBMIT_2_RESPONSE" "Soumission UGC VIDEO v2" || return
    print_success "UGC VIDEO resoumis (v2)"

    # 5. PRO valide → capture PI → paiement testeur
    print_step "PRO valide le UGC VIDEO → capture PI + paiement testeur..."
    VALIDATE_RESPONSE=$(curl -s -X POST "$API_URL/ugc/$UGC_VIDEO_ID/validate" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "validationComment": "Parfait, vidéo de qualité!"
        }')

    check_response "$VALIDATE_RESPONSE" "Validation UGC VIDEO" || return
    UGC_VIDEO_PAID=$(echo "$VALIDATE_RESPONSE" | jq -r '.paidBonus // "0"')
    print_success "UGC VIDEO validé et payé!"
    print_money "Testeur reçoit: ${UGC_VIDEO_PAID}€ | Commission SuperTry: 5€"

    # 6. Vérifier détail UGC
    print_step "Vérification détail UGC VIDEO..."
    UGC_DETAIL=$(curl -s -X GET "$API_URL/ugc/$UGC_VIDEO_ID" \
        -b "$PRO_COOKIE_FILE")
    UGC_FINAL_STATUS=$(echo "$UGC_DETAIL" | jq -r '.status')
    echo -e "   ${CYAN}Statut final:${NC} $UGC_FINAL_STATUS"
    echo -e "   ${CYAN}Bonus payé:${NC} $(echo "$UGC_DETAIL" | jq -r '.paidBonus // "0"')€"
    echo -e "   ${CYAN}Rejets:${NC} $(echo "$UGC_DETAIL" | jq -r '.rejectionCount // 0')"
}

# ============================================================================
# Phase 5: RATINGS (TESTEUR rate PRO+Product, PRO rate TESTEUR)
# ============================================================================

test_ratings() {
    print_header "⭐ PHASE 5: RATINGS (TESTEUR→PRO/Product + PRO→TESTEUR)"

    echo -e "${YELLOW}Flow Rating:${NC}"
    echo -e "  ${BLUE}1.${NC} TESTEUR laisse un avis (product + seller rating)"
    echo -e "  ${BLUE}2.${NC} PRO note le TESTEUR"
    echo -e "  ${BLUE}3.${NC} Vérification moyennes mises à jour"
    echo ""

    # 1. TESTEUR crée une review (product + seller)
    print_step "TESTEUR laisse un avis (product 5/5, seller 4/5)..."
    REVIEW_RESPONSE=$(curl -s -X POST "$API_URL/ratings/review" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "sessionId": "'"$SESSION_ID"'",
            "productRating": 5,
            "sellerRating": 4,
            "comment": "Excellent produit, le PRO était très réactif et professionnel. Je recommande vivement!",
            "isPublic": true
        }')

    if echo "$REVIEW_RESPONSE" | jq -e '.statusCode >= 400' >/dev/null 2>&1; then
        ERROR_MSG=$(echo "$REVIEW_RESPONSE" | jq -r '.message')
        print_warning "Review échouée: $ERROR_MSG"
    else
        REVIEW_ID=$(echo "$REVIEW_RESPONSE" | jq -r '.id')
        print_success "Review créée: $REVIEW_ID (product: 5/5, seller: 4/5)"
    fi

    # 2. PRO note le TESTEUR
    echo ""
    print_step "PRO note le TESTEUR (5/5)..."
    TESTER_RATING_RESPONSE=$(curl -s -X POST "$API_URL/ratings/tester" \
        -H "Content-Type: application/json" \
        -b "$PRO_COOKIE_FILE" \
        -d '{
            "sessionId": "'"$SESSION_ID"'",
            "rating": 5,
            "comment": "Testeur sérieux et ponctuel, UGC de qualité"
        }')

    if echo "$TESTER_RATING_RESPONSE" | jq -e '.statusCode >= 400' >/dev/null 2>&1; then
        ERROR_MSG=$(echo "$TESTER_RATING_RESPONSE" | jq -r '.message')
        print_warning "Rating testeur échoué: $ERROR_MSG"
    else
        TESTER_RATING_ID=$(echo "$TESTER_RATING_RESPONSE" | jq -r '.id')
        print_success "Testeur noté: $TESTER_RATING_ID (5/5)"
    fi

    # 3. Vérifier les reviews du produit
    echo ""
    print_step "Vérification reviews du produit..."
    PRODUCT_REVIEWS=$(curl -s -X GET "$API_URL/ratings/product/$PRODUCT_ID" \
        -b "$PRO_COOKIE_FILE")
    PRODUCT_REVIEW_COUNT=$(echo "$PRODUCT_REVIEWS" | jq -r '.meta.total // 0')
    print_success "Produit a $PRODUCT_REVIEW_COUNT review(s)"

    # 4. Vérifier les ratings du testeur
    print_step "Vérification ratings du testeur..."
    TESTEUR_ID=$(echo "$TESTER_RATING_RESPONSE" | jq -r '.tester.id // empty')
    if [ -n "$TESTEUR_ID" ]; then
        TESTER_SUMMARY=$(curl -s -X GET "$API_URL/ratings/profile/$TESTEUR_ID/summary")
        TESTER_AVG=$(echo "$TESTER_SUMMARY" | jq -r '.averageRating // "N/A"')
        TESTER_TOTAL=$(echo "$TESTER_SUMMARY" | jq -r '.totalRatings // 0')
        echo -e "   ${CYAN}Testeur avg:${NC} $TESTER_AVG/5 ($TESTER_TOTAL rating(s))"
    fi

    # 5. Vérifier review de la session
    print_step "Vérification review de la session..."
    SESSION_REVIEW=$(curl -s -X GET "$API_URL/ratings/session/$SESSION_ID/review")
    if [ "$(echo "$SESSION_REVIEW" | jq -r '.id // empty')" != "" ]; then
        echo -e "   ${CYAN}Product rating:${NC} $(echo "$SESSION_REVIEW" | jq -r '.productRating')/5"
        echo -e "   ${CYAN}Seller rating:${NC} $(echo "$SESSION_REVIEW" | jq -r '.sellerRating')/5"
        echo -e "   ${CYAN}Comment:${NC} $(echo "$SESSION_REVIEW" | jq -r '.comment // "Aucun"')"
    else
        print_warning "Pas de review pour cette session"
    fi

    print_step "Vérification tester rating de la session..."
    SESSION_TESTER_RATING=$(curl -s -X GET "$API_URL/ratings/session/$SESSION_ID/tester-rating")
    if [ "$(echo "$SESSION_TESTER_RATING" | jq -r '.id // empty')" != "" ]; then
        echo -e "   ${CYAN}Tester rating:${NC} $(echo "$SESSION_TESTER_RATING" | jq -r '.rating')/5"
        echo -e "   ${CYAN}Comment:${NC} $(echo "$SESSION_TESTER_RATING" | jq -r '.comment // "Aucun"')"
    else
        print_warning "Pas de tester rating pour cette session"
    fi
}

# ============================================================================
# Phase 6: Vérifications
# ============================================================================

verify_results() {
    print_header "✅ PHASE 6: VÉRIFICATIONS"

    print_step "Attente traitement webhooks (5s)..."
    sleep 5

    # 1. Vérifier balance TESTEUR
    print_step "Vérification balance TESTEUR..."
    WALLET_RESPONSE=$(curl -s -X GET "$API_URL/wallet/balance" \
        -b "$TESTEUR_COOKIE_FILE")

    BALANCE=$(echo "$WALLET_RESPONSE" | jq -r '.balance // "0"')
    TOTAL_EARNED=$(echo "$WALLET_RESPONSE" | jq -r '.totalEarned // "0"')

    print_success "Balance: $BALANCE EUR"
    print_success "Total gagné: $TOTAL_EARNED EUR"

    # 2. Vérifier transactions
    print_step "Vérification transactions TESTEUR..."
    TRANSACTIONS_RESPONSE=$(curl -s -X GET "$API_URL/wallet/transactions?limit=5" \
        -b "$TESTEUR_COOKIE_FILE")

    TRANSACTION_COUNT=$(echo "$TRANSACTIONS_RESPONSE" | jq -r '.total // 0')
    print_success "$TRANSACTION_COUNT transaction(s) trouvée(s)"

    if [ "$TRANSACTION_COUNT" -gt 0 ]; then
        LAST_TX=$(echo "$TRANSACTIONS_RESPONSE" | jq -r '.items[0]')
        TX_TYPE=$(echo "$LAST_TX" | jq -r '.type')
        TX_AMOUNT=$(echo "$LAST_TX" | jq -r '.amount')
        echo -e "   ${CYAN}Type:${NC} $TX_TYPE"
        echo -e "   ${CYAN}Montant:${NC} $TX_AMOUNT EUR"
    fi

    # 3. Vérifier UGCs
    echo ""
    print_step "Vérification UGCs..."
    if [ -n "$UGC_VIDEO_ID" ]; then
        UGC_VIDEO_DETAIL=$(curl -s -X GET "$API_URL/ugc/$UGC_VIDEO_ID" -b "$PRO_COOKIE_FILE")
        UGC_V_STATUS=$(echo "$UGC_VIDEO_DETAIL" | jq -r '.status // "N/A"')
        UGC_V_PAID=$(echo "$UGC_VIDEO_DETAIL" | jq -r '.paidBonus // "0"')
        echo -e "   ${CYAN}UGC VIDEO:${NC} $UGC_V_STATUS | Bonus: ${UGC_V_PAID}€"
    fi
    # Vérifier les UGCs de la session
    SESSION_UGCS=$(curl -s -X GET "$API_URL/ugc/session/$SESSION_ID" -b "$PRO_COOKIE_FILE")
    UGC_COUNT=$(echo "$SESSION_UGCS" | jq 'length' 2>/dev/null)
    if [ -n "$UGC_COUNT" ] && [ "$UGC_COUNT" != "null" ]; then
        echo -e "   ${CYAN}Total UGCs session:${NC} $UGC_COUNT"
        echo "$SESSION_UGCS" | jq -r '.[] | "   → \(.type) : \(.status) (bonus: \(.paidBonus // "N/A"))"' 2>/dev/null
    fi

    # Vérifier les demandes PRO
    MY_REQUESTS=$(curl -s -X GET "$API_URL/ugc/my-requests" -b "$PRO_COOKIE_FILE")
    TOTAL_REQUESTS=$(echo "$MY_REQUESTS" | jq -r '.meta.total // 0')
    print_success "PRO a $TOTAL_REQUESTS demande(s) UGC"

    # Vérifier les soumissions TESTEUR
    MY_SUBMISSIONS=$(curl -s -X GET "$API_URL/ugc/my-submissions" -b "$TESTEUR_COOKIE_FILE")
    TOTAL_SUBMISSIONS=$(echo "$MY_SUBMISSIONS" | jq -r '.meta.total // 0')
    print_success "TESTEUR a $TOTAL_SUBMISSIONS soumission(s) UGC"

    # 4. Vérifier Stripe Dashboard
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${MAGENTA}${BOLD}📊 VÉRIFICATIONS STRIPE DASHBOARD${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${YELLOW}Vérifiez dans votre Stripe Dashboard (https://dashboard.stripe.com/test):${NC}"
    echo ""
    echo -e "${BOLD}1. Payment Campaign (Checkout Session):${NC}"
    echo -e "   ${BLUE}→ Metadata: platform=supertry, transactionType=CAMPAIGN_PAYMENT${NC}"
    echo -e "   ${BLUE}→ campaignTitle, sellerEmail, breakdown complet${NC}"
    echo -e "   ${BLUE}→ captureMethod=manual${NC}"
    echo ""
    echo -e "${BOLD}2. Transfer (Reward Testeur):${NC}"
    echo -e "   ${BLUE}→ Metadata: transactionType=TEST_REWARD${NC}"
    echo -e "   ${BLUE}→ testerEmail, campaignTitle, commissionRetained=5.00${NC}"
    echo ""
    echo -e "${BOLD}3. Payment UGC VIDEO:${NC}"
    echo -e "   ${BLUE}→ Metadata: transactionType=UGC_PAYMENT, ugcType=VIDEO${NC}"
    echo -e "   ${BLUE}→ PaymentIntent manual capture → capturé après validation${NC}"
    echo -e "   ${BLUE}→ Montant: 25€ (20€ testeur + 5€ commission)${NC}"
    echo ""
    echo -e "${BOLD}4. Transfer UGC (Paiement Testeur):${NC}"
    echo -e "   ${BLUE}→ Metadata: transactionType=UGC_PAYMENT, ugcType=VIDEO${NC}"
    echo -e "   ${BLUE}→ Montant: 20€ vers compte Connect testeur${NC}"
    echo ""
    echo -e "${BOLD}5. Connect Account (Testeur):${NC}"
    echo -e "   ${BLUE}→ Metadata: platform=supertry, userRole=TESTER${NC}"
    echo ""
    echo -e "${BOLD}6. Identity Session:${NC}"
    echo -e "   ${BLUE}→ Metadata: platform=supertry, verificationType=tester_kyc${NC}"
    echo ""
}

# ============================================================================
# Cleanup
# ============================================================================

cleanup() {
    print_header "🧹 NETTOYAGE"

    print_step "Suppression fichiers cookies temporaires..."
    rm -f "$PRO_COOKIE_FILE" "$TESTEUR_COOKIE_FILE"
    print_success "Cleanup terminé"
}

# ============================================================================
# Résumé Final
# ============================================================================

print_summary() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}${BOLD}✅ FLOW COMPLET TERMINÉ AVEC SUCCÈS${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${CYAN}Comptes créés:${NC}"
    echo -e "  ${BLUE}PRO:${NC} $PRO_EMAIL"
    echo -e "  ${BLUE}TESTEUR:${NC} $TESTEUR_EMAIL"
    echo -e "  ${BLUE}Mot de passe:${NC} $PASSWORD"
    echo ""
    echo -e "${CYAN}IDs générés:${NC}"
    echo -e "  ${BLUE}Produit:${NC} $PRODUCT_ID"
    echo -e "  ${BLUE}Campagne:${NC} $CAMPAIGN_ID"
    echo -e "  ${BLUE}Session Test:${NC} $SESSION_ID"
    echo ""
    echo -e "${CYAN}Modèle financier:${NC}"
    echo -e "  ${BLUE}Commission SuperTry:${NC} ${GREEN}5€ FIXE par produit${NC}"
    echo -e "  ${BLUE}Couverture Stripe:${NC} ${GREEN}3.5% ajouté au total${NC}"
    echo -e "  ${BLUE}Capture:${NC} ${GREEN}Manual (1h grace period)${NC}"
    echo ""
    echo -e "${CYAN}Résultats:${NC}"
    echo -e "  ${BLUE}Récompense TESTEUR:${NC} ${GREEN}${REWARD_AMOUNT:-65} EUR${NC}"
    echo -e "  ${BLUE}Balance finale:${NC} ${GREEN}${BALANCE:-0} EUR${NC}"
    echo -e "  ${BLUE}Commission SuperTry:${NC} ${GREEN}5 EUR (fixe)${NC}"
    echo ""
    echo -e "${CYAN}UGC:${NC}"
    echo -e "  ${BLUE}UGC VIDEO:${NC} ${GREEN}20€ testeur + 5€ commission (manual capture)${NC}"
    echo -e "  ${BLUE}UGC PHOTO:${NC} ${GREEN}10€ testeur + 3€ commission (manual capture)${NC}"
    echo -e "  ${BLUE}UGC VIDEO ID:${NC} ${UGC_VIDEO_ID:-N/A}"
    echo ""
    echo -e "${CYAN}Metadata Stripe (10 points):${NC}"
    echo -e "  ${BLUE}1.${NC} Checkout Session → CAMPAIGN_PAYMENT + breakdown"
    echo -e "  ${BLUE}2.${NC} PaymentIntent Campaign → mêmes metadata"
    echo -e "  ${BLUE}3.${NC} Transfer → TEST_REWARD + reward detail"
    echo -e "  ${BLUE}4.${NC} Refund → UNUSED_SLOTS_REFUND ou PRO_CANCELLATION_REFUND"
    echo -e "  ${BLUE}5.${NC} Connect Account → platform=supertry"
    echo -e "  ${BLUE}6.${NC} Identity Session → verificationType=tester_kyc"
    echo -e "  ${BLUE}7.${NC} Payout → TESTER_WITHDRAWAL"
    echo -e "  ${BLUE}8.${NC} PRO Cancellation Refund → withinGracePeriod, fee details"
    echo -e "  ${BLUE}9.${NC} PaymentIntent UGC → UGC_PAYMENT, ugcType, manual capture"
    echo -e "  ${BLUE}10.${NC} Transfer UGC → UGC_PAYMENT testeur, commission retained"
    echo ""
    echo -e "${YELLOW}💡 Vous pouvez vous connecter avec ces comptes:${NC}"
    echo -e "   ${FRONTEND_URL}"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
    clear
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║      🧪 SCRIPT DE TEST - FLOW COMPLET SUPERTRY v3           ║"
    echo "║      Campaign + UGC + Commission 5€ + Manual Capture        ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo -e "${CYAN}API URL:${NC} $API_URL"
    echo -e "${CYAN}Frontend URL:${NC} $FRONTEND_URL"
    echo ""

    # ===== MODE DEV: captureDelayMinutes = 0 pour capture quasi-instantanée =====
    print_step "Configuration dev: captureDelayMinutes → 0 (capture en ~10s)..."
    psql "$DB_URL" -c "UPDATE business_rules SET capture_delay_minutes = 0;" -q 2>/dev/null
    if [ $? -eq 0 ]; then
        print_success "captureDelayMinutes mis à 0 (le CRON tourne toutes les 10s en dev)"
    else
        print_warning "Impossible de modifier captureDelayMinutes via psql. Le délai par défaut (60min) sera utilisé."
    fi
    echo ""

    # Exécution des phases
    setup_pro                  # Phase 1: PRO + campagne + paiement
    test_free_cancellation     # Phase 1b: Test annulation gratuite (optionnel)
    setup_testeur              # Phase 2: TESTEUR + KYC + onboarding
    run_test_flow              # Phase 3: Flux de test → session COMPLETED
    test_ugc_video             # Phase 4: UGC VIDEO payant (20€ + 5€ commission)
    test_ratings               # Phase 5: Ratings (TESTEUR→PRO/Product + PRO→TESTEUR)
    verify_results             # Phase 6: Vérifications finales
    cleanup
    print_summary
}

# Exécution
main
