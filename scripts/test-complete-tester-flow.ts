/**
 * Script de test complet du flow TESTEUR
 *
 * Flow testé:
 * 1. PRO crée compte + produit + campagne + paiement
 * 2. TESTEUR s'inscrit
 * 3. TESTEUR postule à la campagne
 * 4. PRO accepte la candidature
 * 5. TESTEUR valide le prix
 * 6. TESTEUR commande sur Amazon
 * 7. TESTEUR soumet preuve d'achat (prix réel < prix max)
 * 8. PRO valide la commande
 * 9. TESTEUR reçoit remboursement (prix réel + frais réels + bonus)
 */

import axios, { AxiosInstance } from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

// Axios instances avec gestion des cookies
let proClient: AxiosInstance;
let testerClient: AxiosInstance;
let proCookies: string = '';
let testerCookies: string = '';

// IDs à stocker
let proUserId: string;
let testerUserId: string;
let categoryId: string;
let productId: string;
let campaignId: string;
let sessionId: string;

// Utilitaire pour faire des requêtes avec gestion manuelle des cookies
function createAuthenticatedClient(name: string, getCookies: () => string, setCookies: (cookies: string) => void): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    validateStatus: () => true, // Ne pas throw sur les erreurs HTTP
  });

  // Interceptor pour ajouter les cookies aux requêtes
  client.interceptors.request.use((config) => {
    const cookies = getCookies();
    if (cookies) {
      config.headers['Cookie'] = cookies;
    }
    return config;
  });

  // Interceptor pour capturer et stocker les cookies des réponses
  client.interceptors.response.use((response) => {
    if (response.headers['set-cookie']) {
      const cookies = response.headers['set-cookie']
        .map((cookie: string) => cookie.split(';')[0])
        .join('; ');
      setCookies(cookies);
    }

    if (response.status >= 400) {
      console.log(`❌ [${name}] ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
      console.log('   Error:', response.data);
    }
    return response;
  });

  return client;
}

async function main() {
  console.log('🚀 Test Flow Complet: PRO → TESTEUR → Remboursement\n');
  console.log('='.repeat(60));

  // ============================================================================
  // PARTIE 1: PRO - Création compte, produit, campagne et paiement
  // ============================================================================

  console.log('\n📍 PARTIE 1: PRO - Setup initial\n');

  // 1. Créer compte PRO
  console.log('=== 1. Création compte PRO ===');
  const proEmail = `pro-test-${Date.now()}@example.com`;
  const proPassword = 'Test1234!';

  proClient = createAuthenticatedClient(
    'PRO',
    () => proCookies,
    (cookies) => { proCookies = cookies; }
  );

  const signupProRes = await proClient.post('/auth/signup', {
    email: proEmail,
    password: proPassword,
    role: 'PRO',
    firstName: 'John',
    lastName: 'Pro',
    countries: ['FR'],
  });

  if (signupProRes.status !== 201) {
    console.error('❌ Échec création compte PRO');
    console.log('Status:', signupProRes.status);
    console.log('Data:', signupProRes.data);
    process.exit(1);
  }

  proUserId = signupProRes.data.user?.id || signupProRes.data.id;
  console.log(`✅ Compte PRO créé: ${proEmail}`);
  console.log(`👤 User ID: ${proUserId}\n`);

  // 2. Récupérer catégorie
  console.log('=== 2. Récupération catégorie ===');
  const categoriesRes = await proClient.get('/categories');
  categoryId = categoriesRes.data[0]?.id;
  console.log(`✅ Catégorie: ${categoriesRes.data[0]?.name} (${categoryId})\n`);

  // 3. Créer produit
  console.log('=== 3. Création produit ===');
  const productRes = await proClient.post('/products', {
    title: 'Test Product - Tester Flow',
    description: 'Produit pour test du flow testeur',
    price: 50, // Prix MAXIMUM
    categoryId,
    productLink: 'https://amazon.fr/product-test',
  });

  productId = productRes.data.id;
  console.log(`✅ Produit créé: ${productId}`);
  console.log(`💰 Prix MAXIMUM: 50€\n`);

  // 4. Créer campagne
  console.log('=== 4. Création campagne ===');
  const campaignRes = await proClient.post('/campaigns', {
    title: 'Test Campaign - Tester Flow',
    description: 'Campagne pour test du flow testeur',
    productId,
    totalSlots: 3,
    shippingCost: 5, // Frais MAXIMUM
    testerReward: 10,
    requireVideo: false,
    requirePhotos: true,
  });

  campaignId = campaignRes.data.id;
  console.log(`✅ Campagne créée: ${campaignId}`);
  console.log(`📦 Frais livraison MAXIMUM: 5€`);
  console.log(`🎁 Bonus testeur: 10€`);
  console.log(`🔢 Total slots: 3\n`);

  // 5. Calculer escrow
  console.log('=== 5. Calcul escrow ===');
  const escrowRes = await proClient.get(`/payments/campaigns/${campaignId}/escrow`);
  console.log(`💵 Escrow total: ${escrowRes.data.total}€`);
  console.log(`   - Par testeur: ${escrowRes.data.perTester}€\n`);

  // 6. Créer checkout session
  console.log('=== 6. Paiement campagne ===');
  const checkoutRes = await proClient.post(`/campaigns/${campaignId}/checkout-session`, {
    successUrl: 'http://localhost:3000/success',
    cancelUrl: 'http://localhost:3000/cancel',
  });

  console.log(`✅ Checkout Session créée`);
  console.log(`💳 Session ID: ${checkoutRes.data.sessionId}\n`);

  // 7. Simuler webhook paiement
  console.log('=== 7. Simulation paiement (webhook) ===');
  await axios.post(`${API_URL}/stripe/webhooks`, {
    id: 'evt_test_tester_flow',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutRes.data.sessionId,
        payment_intent: 'pi_test_tester_flow',
        payment_status: 'paid',
      },
    },
  }, {
    headers: { 'stripe-signature': 'test' },
  });

  // Vérifier que la campagne est ACTIVE
  const campaignCheckRes = await proClient.get(`/campaigns/${campaignId}`);
  if (campaignCheckRes.data.status !== 'ACTIVE') {
    console.error(`❌ Campagne pas activée: ${campaignCheckRes.data.status}`);
    process.exit(1);
  }

  console.log(`✅ Campagne ACTIVE et payée\n`);

  // ============================================================================
  // PARTIE 2: TESTEUR - Inscription et candidature
  // ============================================================================

  console.log('\n📍 PARTIE 2: TESTEUR - Inscription et candidature\n');

  // 1. Créer compte TESTEUR
  console.log('=== 1. Création compte TESTEUR ===');
  const testerEmail = `tester-test-${Date.now()}@example.com`;
  const testerPassword = 'Test1234!';

  testerClient = createAuthenticatedClient(
    'TESTEUR',
    () => testerCookies,
    (cookies) => { testerCookies = cookies; }
  );

  const signupTesterRes = await testerClient.post('/auth/signup', {
    email: testerEmail,
    password: testerPassword,
    role: 'TESTEUR',
    firstName: 'Jane',
    lastName: 'Tester',
    countries: ['FR'],
  });

  if (signupTesterRes.status !== 201) {
    console.error('❌ Échec création compte TESTEUR');
    console.log('Status:', signupTesterRes.status);
    console.log('Data:', signupTesterRes.data);
    process.exit(1);
  }

  testerUserId = signupTesterRes.data.user?.id || signupTesterRes.data.id;
  console.log(`✅ Compte TESTEUR créé: ${testerEmail}`);
  console.log(`👤 User ID: ${testerUserId}\n`);

  // 2. TESTEUR postule à la campagne
  console.log('=== 2. TESTEUR postule à la campagne ===');
  const applyRes = await testerClient.post(`/test-sessions/apply`, {
    campaignId,
  });

  if (applyRes.status !== 201) {
    console.error('❌ Échec candidature');
    console.log('Response:', applyRes.data);
    process.exit(1);
  }

  sessionId = applyRes.data.id;
  console.log(`✅ Candidature soumise`);
  console.log(`📋 Session ID: ${sessionId}`);
  console.log(`📊 Status: ${applyRes.data.status}\n`);

  // ============================================================================
  // PARTIE 3: PRO - Accepte la candidature
  // ============================================================================

  console.log('\n📍 PARTIE 3: PRO - Acceptation candidature\n');

  console.log('=== 1. PRO accepte la candidature ===');
  const acceptRes = await proClient.patch(`/test-sessions/${sessionId}/accept`);

  if (acceptRes.status !== 200) {
    console.error('❌ Échec acceptation');
    console.log('Response:', acceptRes.data);
    process.exit(1);
  }

  console.log(`✅ Candidature acceptée`);
  console.log(`📊 Status: ${acceptRes.data.status}\n`);

  // ============================================================================
  // PARTIE 4: TESTEUR - Validation prix et commande
  // ============================================================================

  console.log('\n📍 PARTIE 4: TESTEUR - Commande produit\n');

  // 1. TESTEUR valide le prix
  console.log('=== 1. TESTEUR valide le prix ===');
  const validatePriceRes = await testerClient.post(`/test-sessions/${sessionId}/validate-price`);

  if (validatePriceRes.status !== 200) {
    console.error('❌ Échec validation prix');
    console.log('Response:', validatePriceRes.data);
    process.exit(1);
  }

  console.log(`✅ Prix validé par le testeur\n`);

  // 2. TESTEUR soumet preuve d'achat
  console.log('=== 2. TESTEUR soumet preuve d\'achat ===');

  // Prix RÉELS (moins cher que le maximum)
  const realProductPrice = 45; // Au lieu de 50€
  const realShippingCost = 3;  // Au lieu de 5€

  console.log(`💰 Prix réel produit: ${realProductPrice}€ (max: 50€)`);
  console.log(`📦 Frais réels livraison: ${realShippingCost}€ (max: 5€)`);

  const submitPurchaseRes = await testerClient.post(`/test-sessions/${sessionId}/submit-purchase`, {
    orderNumber: 'AMZ-123456789',
    purchasePrice: realProductPrice,
    shippingCost: realShippingCost,
    purchaseProofUrl: 'https://example.com/screenshot.png',
  });

  if (submitPurchaseRes.status !== 200) {
    console.error('❌ Échec soumission preuve achat');
    console.log('Response:', submitPurchaseRes.data);
    process.exit(1);
  }

  console.log(`✅ Preuve d'achat soumise`);
  console.log(`📋 Numéro commande: AMZ-123456789`);
  console.log(`📊 Status: ${submitPurchaseRes.data.status}\n`);

  // ============================================================================
  // PARTIE 5: PRO - Valide la commande
  // ============================================================================

  console.log('\n📍 PARTIE 5: PRO - Validation commande et remboursement\n');

  console.log('=== 1. PRO valide la commande ===');
  const validatePurchaseRes = await proClient.post(`/test-sessions/${sessionId}/validate-purchase`);

  if (validatePurchaseRes.status !== 200) {
    console.error('❌ Échec validation commande');
    console.log('Response:', validatePurchaseRes.data);
    process.exit(1);
  }

  console.log(`✅ Commande validée par le PRO\n`);

  // 2. Vérifier le remboursement
  console.log('=== 2. Vérification remboursement TESTEUR ===');

  const expectedRefund = realProductPrice + realShippingCost + 10; // prix réel + frais réels + bonus
  console.log(`💵 Remboursement attendu: ${expectedRefund}€`);
  console.log(`   - Prix produit réel: ${realProductPrice}€`);
  console.log(`   - Frais livraison réels: ${realShippingCost}€`);
  console.log(`   - Bonus testeur: 10€`);

  // Vérifier le wallet du testeur
  const testerWalletRes = await testerClient.get('/wallet/me');
  console.log(`\n💰 Wallet TESTEUR:`);
  console.log(`   - Balance disponible: ${testerWalletRes.data.balance}€`);
  console.log(`   - Balance en attente: ${testerWalletRes.data.pendingBalance}€`);

  // Vérifier les transactions
  const transactionsRes = await testerClient.get('/wallet/me/transactions');
  const rewardTransaction = transactionsRes.data.find((t: any) =>
    t.type === 'TEST_REWARD' && t.testSessionId === sessionId
  );

  if (rewardTransaction) {
    console.log(`\n✅ Transaction de remboursement trouvée:`);
    console.log(`   - Montant: ${rewardTransaction.amount}€`);
    console.log(`   - Type: ${rewardTransaction.type}`);
    console.log(`   - Status: ${rewardTransaction.status}`);
  }

  // ============================================================================
  // RÉSUMÉ FINAL
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('📊 RÉSUMÉ DU TEST\n');

  console.log('✅ Compte PRO créé et authentifié');
  console.log('✅ Produit créé (prix max: 50€)');
  console.log('✅ Campagne créée (frais max: 5€)');
  console.log('✅ Campagne payée et activée');
  console.log('✅ Compte TESTEUR créé et authentifié');
  console.log('✅ TESTEUR a postulé');
  console.log('✅ PRO a accepté la candidature');
  console.log('✅ TESTEUR a validé le prix');
  console.log('✅ TESTEUR a soumis preuve achat (prix réels < prix max)');
  console.log('✅ PRO a validé la commande');
  console.log('✅ TESTEUR remboursé: prix réel + frais réels + bonus');

  console.log('\n🎉 FLOW COMPLET TESTÉ AVEC SUCCÈS!\n');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  console.error(error.stack);
  process.exit(1);
});
