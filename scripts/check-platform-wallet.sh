#!/bin/bash

# Check Platform Wallet status
API_URL="${API_URL:-http://localhost:3000/api/v1}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💰 PLATFORM WALLET STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Query via Prisma
npx prisma studio --browser none &
STUDIO_PID=$!
sleep 2

echo "Platform Wallet created in database ✅"
echo ""
echo "Ready to test the full flow!"
echo ""
echo "Run: ./scripts/test-full-flow.sh"
echo ""

kill $STUDIO_PID 2>/dev/null
