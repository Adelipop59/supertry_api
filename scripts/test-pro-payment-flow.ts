// Test flow: PRO Signup → Product → Campaign → Stripe Payment
const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';

let sessionCookie: string = '';
let userId: string = '';
let categoryId: string = '';
let productId: string = '';
let campaignId: string = '';

/**
 * Helper: Make HTTP request with cookie support
 */
async function request(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_URL}${path}`;
  const headers: any = {
    'Content-Type': 'application/json',
  };

  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      sessionCookie = setCookie.split(';')[0]; // Extract session cookie
    }

    if (!response.ok) {
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    return data;
  } catch (error: any) {
    throw error;
  }
}

/**
 * 1. Créer un compte PRO avec Stripe Connect automatique
 */
async function createProAccount() {
  console.log('\n=== 1. Création compte PRO ===');

  const email = `pro-test-${Date.now()}@example.com`;
  const password = 'Test1234!';

  const signupData = {
    email,
    password,
    role: 'PRO',
    firstName: 'Jean',
    lastName: 'Dupont',
    companyName: 'Test Company',
    siret: '12345678901234',
    countries: ['FR', 'BE'],
  };

  console.log(`📧 Email: ${email}`);
  console.log(`🔑 Password: ${password}`);

  try {
    const response = await request('POST', '/auth/signup', signupData);
    userId = response.profile.id;
    console.log('✅ Compte PRO créé avec succès');
    console.log(`👤 User ID: ${userId}`);
    console.log(`🔗 Stripe Connect créé automatiquement`);
  } catch (error: any) {
    console.error('❌ Erreur création compte:', error.message);
    throw error;
  }
}

/**
 * 2. Récupérer une catégorie
 */
async function getCategory() {
  console.log('\n=== 2. Récupération catégorie ===');

  try {
    const categories = await request('GET', '/categories');
    if (categories && categories.length > 0) {
      categoryId = categories[0].id;
      console.log(`✅ Catégorie: ${categories[0].name} (${categoryId})`);
    } else {
      throw new Error('Aucune catégorie disponible');
    }
  } catch (error: any) {
    console.error('❌ Erreur récupération catégorie:', error.message);
    throw error;
  }
}

/**
 * 3. Créer un produit
 */
async function createProduct() {
  console.log('\n=== 3. Création produit ===');

  const productData = {
    name: 'Test Product - iPhone 15 Pro',
    description: 'Produit de test pour campagne',
    price: 50.0,
    shippingCost: 5.0,
    categoryId,
  };

  try {
    const product = await request('POST', '/products', productData);
    productId = product.id;
    console.log('✅ Produit créé');
    console.log(`📦 Product ID: ${productId}`);
    console.log(`📝 Title: ${product.title}`);
  } catch (error: any) {
    console.error('❌ Erreur création produit:', error.message);
    throw error;
  }
}

/**
 * 4. Créer une campagne avec lien Amazon
 */
async function createCampaign() {
  console.log('\n=== 4. Création campagne ===');

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const campaignData = {
    title: 'Test Campaign - Paiement Stripe',
    description: 'Campagne de test pour paiement Stripe',
    categoryId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    totalSlots: 5,
    autoAcceptApplications: true,
    marketplaceMode: 'PRODUCT_LINK',
    amazonLink: 'https://www.amazon.fr/dp/B0CHX1W1XY',
    keywords: ['test', 'stripe', 'paiement'],
    offer: {
      productId,
      productName: 'Test Product - iPhone 15 Pro',
      expectedPrice: 50.0,
      shippingCost: 5.0,
      priceRangeMin: 45.0,
      priceRangeMax: 55.0,
      isPriceRevealed: true,
      reimbursedPrice: true,
      reimbursedShipping: true,
      bonus: 10.0,
      quantity: 1,
    },
    distributions: [
      {
        type: 'RECURRING',
        dayOfWeek: 1,
        maxUnits: 5,
        isActive: true,
      },
    ],
  };

  try {
    const campaign = await request('POST', '/campaigns', campaignData);
    campaignId = campaign.id;
    console.log('✅ Campagne créée');
    console.log(`📋 Campaign ID: ${campaignId}`);
    console.log(`📝 Title: ${campaign.title}`);
    console.log(`📊 Status: ${campaign.status}`);
    console.log(`🔢 Total Slots: ${campaign.totalSlots}`);
  } catch (error: any) {
    console.error('❌ Erreur création campagne:', error.message);
    throw error;
  }
}

/**
 * 5. Calculer l'escrow de la campagne
 */
async function calculateEscrow() {
  console.log('\n=== 5. Calcul escrow ===');

  try {
    const escrow = await request('GET', `/payments/campaigns/${campaignId}/escrow`);
    console.log('✅ Escrow calculé');
    console.log(`💰 Coût produit: ${escrow.productCost}€`);
    console.log(`📦 Frais livraison: ${escrow.shippingCost}€`);
    console.log(`🎁 Bonus testeur: ${escrow.testerBonus}€`);
    console.log(`💳 Commission SuperTry: ${escrow.supertryCommission}€`);
    console.log(`👤 Par testeur: ${escrow.perTester}€`);
    console.log(`💵 TOTAL À PAYER: ${escrow.total}€`);
    return escrow;
  } catch (error: any) {
    console.error('❌ Erreur calcul escrow:', error.message);
    throw error;
  }
}

/**
 * 6. Générer le lien de paiement Stripe Checkout
 */
async function generatePaymentLink() {
  console.log('\n=== 6. Génération lien paiement Stripe ===');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  const checkoutData = {
    successUrl: `${frontendUrl}/campaigns/${campaignId}/payment-success`,
    cancelUrl: `${frontendUrl}/campaigns/${campaignId}/payment-cancel`,
  };

  try {
    const response = await request('POST', `/campaigns/${campaignId}/checkout-session`, checkoutData);
    const { checkoutUrl, sessionId, amount } = response;

    console.log('✅ Checkout Session créée');
    console.log(`💳 Session ID: ${sessionId}`);
    console.log(`💵 Montant: ${amount / 100}€`);
    console.log(`\n🔗 LIEN DE PAIEMENT STRIPE:`);
    console.log(`${checkoutUrl}`);
    console.log(`\n⚠️  En mode TEST, utilisez les cartes de test Stripe:`);
    console.log(`   - Carte qui fonctionne: 4242 4242 4242 4242`);
    console.log(`   - Date expiration: n'importe quelle date future`);
    console.log(`   - CVC: n'importe quel 3 chiffres`);

    return checkoutUrl;
  } catch (error: any) {
    console.error('❌ Erreur génération paiement:', error.message);
    throw error;
  }
}

/**
 * 7. Vérifier l'activation après paiement
 */
async function checkActivation() {
  console.log('\n=== 7. Vérification activation (après paiement) ===');
  console.log('⚠️  Cette étape nécessite que vous ayez payé via le lien Stripe ci-dessus');
  console.log('💡 Utilisez la carte de test: 4242 4242 4242 4242');
  console.log('\n⏸️  Appuyez sur ENTER une fois le paiement effectué...');

  // Attendre input utilisateur
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  try {
    const campaign = await request('GET', `/campaigns/${campaignId}`);
    console.log(`\n📊 Statut campagne: ${campaign.status}`);

    if (campaign.status === 'ACTIVE') {
      console.log('✅ Campagne ACTIVE - Paiement confirmé !');
    } else if (campaign.status === 'PENDING_PAYMENT') {
      console.log('⏳ Campagne PENDING_PAYMENT - En attente confirmation paiement');
    } else {
      console.log(`⚠️  Statut: ${campaign.status}`);
    }

    // Vérifier le wallet
    const wallet = await request('GET', '/wallet/me');
    console.log(`\n💰 Wallet Balance: ${wallet.balance}€`);
    console.log(`⏳ Pending Balance (escrow): ${wallet.pendingBalance}€`);
  } catch (error: any) {
    console.error('❌ Erreur vérification:', error.message);
  }
}

/**
 * Main flow
 */
async function main() {
  console.log('🚀 Test Flow: PRO Signup → Product → Campaign → Stripe Payment\n');
  console.log('================================================');

  try {
    await createProAccount();
    await getCategory();
    await createProduct();
    await createCampaign();
    await calculateEscrow();
    await generatePaymentLink();
    await checkActivation();

    console.log('\n✅ Flow de test terminé avec succès !');
    console.log('================================================\n');
  } catch (error: any) {
    console.error('\n❌ Erreur dans le flow:', error.message);
    process.exit(1);
  }
}

// Run
main();
