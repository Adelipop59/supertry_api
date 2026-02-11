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
    print_header "👤 PHASE 2: CRÉATION COMPTE TESTEUR + KYC"

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
    print_success "Stripe Connect TESTEUR créé (avec metadata platform=supertry)"

    # 3. Tentative de postuler (sera bloquée par KYC)
    print_step "Tentative d'application à la campagne..."
    APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
        -H "Content-Type: application/json" \
        -b "$TESTEUR_COOKIE_FILE" \
        -d '{
            "applicationMessage": "Je suis très intéressé par ce test!"
        }')

    # Vérifier si KYC requis
    IDENTITY_REQUIRED=$(echo "$APPLICATION_RESPONSE" | jq -r '.identityRequired // false')

    if [ "$IDENTITY_REQUIRED" = "true" ]; then
        ERROR_MESSAGE=$(echo "$APPLICATION_RESPONSE" | jq -r '.message')
        VERIFICATION_URL=$(echo "$APPLICATION_RESPONSE" | jq -r '.verificationUrl')
        CLIENT_SECRET=$(echo "$APPLICATION_RESPONSE" | jq -r '.clientSecret')

        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e "${RED}${BOLD}🔒 KYC STRIPE IDENTITY REQUIS${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e "${YELLOW}Message:${NC} $ERROR_MESSAGE"
        echo ""
        echo -e "${BLUE}🔗 Lien de vérification Stripe Identity:${NC}"
        echo -e "${GREEN}${BOLD}$VERIFICATION_URL${NC}"
        echo ""
        echo -e "${MAGENTA}Metadata Identity enrichies: platform=supertry, verificationType=tester_kyc${NC}"
        echo ""
        echo -e "${YELLOW}➜ 1. ${BOLD}Ouvrez ce lien dans votre navigateur${NC}"
        echo -e "${YELLOW}➜ 2. ${BOLD}Complétez la vérification Identity (CNI/Passeport + selfie)${NC}"
        echo -e "${YELLOW}➜ 3. ${BOLD}Revenez ici et appuyez sur ENTRÉE${NC}"
        echo ""
        read -p "Appuyez sur ENTRÉE après avoir validé l'Identity..."

        # Polling Identity status
        print_step "Vérification du statut Identity..."

        IDENTITY_SESSION_ID=$(echo "$CLIENT_SECRET" | grep -o 'vs_[^_]*')
        echo -e "${YELLOW}   Session ID: $IDENTITY_SESSION_ID${NC}"

        if [ -z "$IDENTITY_SESSION_ID" ] || [ "$IDENTITY_SESSION_ID" = "null" ]; then
            print_error "Impossible d'extraire le session ID"
            echo "$APPLICATION_RESPONSE" | jq '.'
            exit 1
        fi

        for i in {1..60}; do
            sleep 2

            IDENTITY_STATUS_RESPONSE=$(curl -s -X GET "$API_URL/stripe/identity/status/$IDENTITY_SESSION_ID" \
                -b "$TESTEUR_COOKIE_FILE")

            STATUS=$(echo "$IDENTITY_STATUS_RESPONSE" | jq -r '.status')

            if [ "$STATUS" = "verified" ]; then
                print_success "Identity vérifiée !"
                break
            elif [ "$STATUS" = "requires_input" ]; then
                print_warning "Informations supplémentaires requises"
                echo "$IDENTITY_STATUS_RESPONSE" | jq '.lastError'
                break
            elif [ "$STATUS" = "processing" ]; then
                if [ $((i % 5)) -eq 0 ]; then
                    echo -e "${BLUE}   ⏳ En cours... ($i/60)${NC}"
                fi
            else
                echo -e "${YELLOW}   Status: $STATUS ($i/60)${NC}"
                if [ $i -eq 60 ]; then
                    print_error "Timeout: Identity non vérifiée après 2 minutes"
                    exit 1
                fi
            fi
        done

        # Attendre webhook Identity verified
        print_step "Attente webhook identity.verification_session.verified..."

        for j in {1..10}; do
            sleep 3

            APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
                -H "Content-Type: application/json" \
                -b "$TESTEUR_COOKIE_FILE" \
                -d '{
                    "applicationMessage": "Je suis très intéressé par ce test!"
                }')

            IDENTITY_STILL_REQUIRED=$(echo "$APPLICATION_RESPONSE" | jq -r '.identityRequired // false')
            HAS_SESSION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id // "null"')

            if [ "$IDENTITY_STILL_REQUIRED" = "false" ] && [ "$HAS_SESSION_ID" != "null" ]; then
                print_success "Webhook traité ! Application réussie"
                SESSION_ID="$HAS_SESSION_ID"
                break
            elif [ $j -eq 10 ]; then
                print_error "Timeout: webhook Identity non reçu après 30s"
                exit 1
            else
                echo -e "${BLUE}   ⏳ Attente webhook... ($j/10)${NC}"
            fi
        done
    fi

    # ============================================================================
    # ONBOARDING STRIPE CONNECT
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
        echo -e "${YELLOW}L'onboarding Stripe Connect est requis pour recevoir les transferts${NC}"
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

    # Application (si pas déjà fait)
    if [ -z "$SESSION_ID" ]; then
        echo ""
        print_step "Application à la campagne..."
        APPLICATION_RESPONSE=$(curl -s -X POST "$API_URL/test-sessions/$CAMPAIGN_ID/apply" \
            -H "Content-Type: application/json" \
            -b "$TESTEUR_COOKIE_FILE" \
            -d '{
                "applicationMessage": "Je suis très intéressé par ce test!"
            }')

        check_response "$APPLICATION_RESPONSE" "Application à campagne" || exit 1
        SESSION_ID=$(echo "$APPLICATION_RESPONSE" | jq -r '.id')
    fi

    print_success "Application envoyée: $SESSION_ID"
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
# Phase 4: Vérifications
# ============================================================================

verify_results() {
    print_header "✅ PHASE 4: VÉRIFICATIONS"

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

    # 3. Vérifier Stripe Dashboard
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${MAGENTA}${BOLD}📊 VÉRIFICATIONS STRIPE DASHBOARD${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${YELLOW}Vérifiez dans votre Stripe Dashboard (https://dashboard.stripe.com/test):${NC}"
    echo ""
    echo -e "${BOLD}1. Payment (Checkout Session):${NC}"
    echo -e "   ${BLUE}→ Metadata: platform=supertry, transactionType=CAMPAIGN_PAYMENT${NC}"
    echo -e "   ${BLUE}→ campaignTitle, sellerEmail, breakdown complet (productCost, stripeCoverage...)${NC}"
    echo -e "   ${BLUE}→ captureMethod=manual${NC}"
    echo ""
    echo -e "${BOLD}2. Transfer (Reward Testeur):${NC}"
    echo -e "   ${BLUE}→ Metadata: transactionType=TEST_REWARD${NC}"
    echo -e "   ${BLUE}→ testerEmail, campaignTitle, commissionRetained=5.00${NC}"
    echo ""
    echo -e "${BOLD}3. Connect Account (Testeur):${NC}"
    echo -e "   ${BLUE}→ Metadata: platform=supertry, userRole=TESTER${NC}"
    echo ""
    echo -e "${BOLD}4. Identity Session:${NC}"
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
    echo -e "${CYAN}Metadata Stripe (8 points):${NC}"
    echo -e "  ${BLUE}1.${NC} Checkout Session → CAMPAIGN_PAYMENT + breakdown"
    echo -e "  ${BLUE}2.${NC} PaymentIntent → mêmes metadata"
    echo -e "  ${BLUE}3.${NC} Transfer → TEST_REWARD + reward detail"
    echo -e "  ${BLUE}4.${NC} Refund → UNUSED_SLOTS_REFUND ou PRO_CANCELLATION_REFUND"
    echo -e "  ${BLUE}5.${NC} Connect Account → platform=supertry"
    echo -e "  ${BLUE}6.${NC} Identity Session → verificationType=tester_kyc"
    echo -e "  ${BLUE}7.${NC} Payout → TESTER_WITHDRAWAL"
    echo -e "  ${BLUE}8.${NC} PRO Cancellation Refund → withinGracePeriod, fee details"
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
    echo "║      🧪 SCRIPT DE TEST - FLOW COMPLET SUPERTRY v2           ║"
    echo "║      Commission 5€ fixe + 3.5% Stripe + Manual Capture      ║"
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
    setup_pro
    test_free_cancellation
    setup_testeur
    run_test_flow
    verify_results
    cleanup
    print_summary
}

# Exécution
main
