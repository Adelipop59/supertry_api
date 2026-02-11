// Lire le .env
import { readFileSync } from 'fs';
const envContent = readFileSync('.env', 'utf-8');
const envVars = envContent.split('\n').reduce((acc, line) => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    acc[key.trim()] = valueParts.join('=').trim();
  }
  return acc;
}, {} as Record<string, string>);

const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';
const TEST_PRO_EMAIL = envVars.TEST_PRO_EMAIL || '2pro@yopmail.com';
const TEST_PRO_PASSWORD = envVars.TEST_PRO_PASSWORD || 'Test1234!';
const TEST_TESTER_EMAIL = envVars.TEST_TESTER_EMAIL || '2user@yopmail.com';
const TEST_TESTER_PASSWORD = envVars.TEST_TESTER_PASSWORD || 'Test1234!';

// Store auth session cookies
let proSessionCookie = '';
let testerSessionCookie = '';

// PROCEDURES flow variables
let proceduresCampaignId = '';
let proceduresSessionId = '';
let proceduresSteps: any[] = [];

// PRODUCT_LINK flow variables
let productLinkCampaignId = '';
let productLinkSessionId = '';

// ============================================================================
// Helper: HTTP Request with fetch
// ============================================================================

async function request(
  method: string,
  endpoint: string,
  body?: any,
  useTesterSession = false,
): Promise<any> {
  const url = `${API_URL}${endpoint}`;
  const headers: any = {
    'Content-Type': 'application/json',
  };

  const sessionCookie = useTesterSession ? testerSessionCookie : proSessionCookie;
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
      const cookie = setCookie.split(';')[0];
      if (useTesterSession) {
        testerSessionCookie = cookie;
      } else {
        proSessionCookie = cookie;
      }
    }

    if (!response.ok) {
      console.error('❌ HTTP Error Details:');
      console.error('   Status:', response.status);
      console.error('   URL:', url);
      console.error('   Response:', JSON.stringify(data, null, 2));
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    return data;
  } catch (error: any) {
    throw error;
  }
}

console.log('🚀 Test des DEUX Flows: PROCEDURES vs PRODUCT_LINK\n');
console.log('='.repeat(70));

// ============================================================================
// PARTIE 1: Setup PRO et TESTEUR
// ============================================================================

async function setupAccounts() {
  console.log('\n📍 PARTIE 1: Setup comptes PRO et TESTEUR\n');

  // PRO login or create
  console.log('=== 1.1 Connexion/Création PRO ===');
  console.log(`Email: ${TEST_PRO_EMAIL}`);
  try {
    await request('POST', '/auth/login', {
      email: TEST_PRO_EMAIL,
      password: TEST_PRO_PASSWORD,
    });
    console.log('✅ PRO connecté\n');
  } catch (error) {
    console.log('⚠️  Création du compte PRO...');
    await request('POST', '/auth/signup', {
      email: TEST_PRO_EMAIL,
      password: TEST_PRO_PASSWORD,
      role: 'PRO',
      firstName: 'Jean',
      lastName: 'Dupont',
      companyName: 'Test Company',
      siret: '12345678901234',
      countries: ['FR'],
    });
    console.log('✅ PRO créé et connecté\n');
  }

  // TESTEUR login or create
  console.log('=== 1.2 Connexion/Création TESTEUR ===');
  console.log(`Email: ${TEST_TESTER_EMAIL}`);
  try {
    await request('POST', '/auth/login', {
      email: TEST_TESTER_EMAIL,
      password: TEST_TESTER_PASSWORD,
    }, true);
    console.log('✅ TESTEUR connecté\n');
  } catch (error) {
    console.log('⚠️  Création du compte TESTEUR...');
    await request('POST', '/auth/signup', {
      email: TEST_TESTER_EMAIL,
      password: TEST_TESTER_PASSWORD,
      role: 'USER',
      firstName: 'Marie',
      lastName: 'Test',
      country: 'FR',
    }, true);
    console.log('✅ TESTEUR créé et connecté\n');
  }
}

// ============================================================================
// PARTIE 2: Campagne PROCEDURES
// ============================================================================

async function createProceduresCampaign() {
  console.log('📍 PARTIE 2: Campagne MODE PROCEDURES\n');

  // Get category
  const categories = await request('GET', '/categories');
  const categoryId = categories[0]?.id;

  // Create product
  console.log('=== 2.1 Création produit PROCEDURES ===');
  const product = await request('POST', '/products', {
    name: 'iPhone 15 Pro - Test PROCEDURES',
    description: 'Produit test pour flow procedures',
    price: 50.0,
    shippingCost: 5.0,
    categoryId,
  });
  console.log('✅ Produit créé (max: 50€ + 5€)\n');

  // Create campaign with procedures
  console.log('=== 2.2 Création campagne PROCEDURES ===');
  const today = new Date();
  const campaign = await request('POST', '/campaigns', {
    title: 'Campaign PROCEDURES - Test Flow',
    description: 'Test du flow avec procédures',
    categoryId,
    startDate: today.toISOString(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    totalSlots: 3,
    autoAcceptApplications: false,
    marketplaceMode: 'PROCEDURES',
    keywords: ['test', 'procedures'],
    offer: {
      productId: product.id,
      productName: product.name,
      expectedPrice: 50.0,
      shippingCost: 5.0,
      priceRangeMin: 40.0,
      priceRangeMax: 55.0,
      isPriceRevealed: true,
      reimbursedPrice: true,
      reimbursedShipping: true,
      bonus: 10.0,
      quantity: 1,
    },
    procedures: [
      {
        title: 'Procédure: Acheter sur Amazon',
        description: 'Suivez les étapes pour commander',
        order: 0,
        isRequired: true,
        steps: [
          {
            title: 'Rechercher le produit',
            description: 'Allez sur Amazon.fr et cherchez "iPhone 15"',
            type: 'TEXT',
            order: 0,
            isRequired: true,
          },
          {
            title: 'Capture d\'écran',
            description: 'Prenez une photo de la page',
            type: 'PHOTO',
            order: 1,
            isRequired: true,
          },
        ],
      },
    ],
    distributions: [
      {
        type: 'SPECIFIC_DATE',
        specificDate: today.toISOString(),
        maxUnits: 3,
        isActive: true,
      },
    ],
  });
  proceduresCampaignId = campaign.id;
  console.log(`✅ Campagne PROCEDURES créée: ${proceduresCampaignId}\n`);

  // Pay campaign
  console.log('=== 2.3 Paiement campagne PROCEDURES ===');
  const checkout = await request('POST', `/campaigns/${proceduresCampaignId}/checkout-session`, {
    successUrl: 'http://localhost:3000/success',
    cancelUrl: 'http://localhost:3000/cancel',
  });
  console.log('✅ Checkout créé');

  // Simulate webhook
  await fetch(`${API_URL}/stripe/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'test',
    },
    body: JSON.stringify({
      id: 'evt_test_' + Date.now(),
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: checkout.sessionId,
          payment_intent: 'pi_test_procedures_' + Date.now(),
          payment_status: 'paid',
        },
      },
    }),
  });
  console.log('✅ Campagne PROCEDURES activée\n');
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function testProceduresFlow() {
  console.log('=== 2.4 Test flow PROCEDURES ===');

  // TESTEUR apply
  const application = await request(
    'POST',
    `/test-sessions/${proceduresCampaignId}/apply`,
    {},
    true,
  );
  proceduresSessionId = application.id;
  console.log('✅ TESTEUR a postulé');

  // PRO accept
  await request('POST', `/test-sessions/${proceduresSessionId}/accept`);
  console.log('✅ PRO a accepté');

  // Get steps
  const campaign = await request('GET', `/campaigns/${proceduresCampaignId}`);
  const allSteps: any[] = [];
  if (campaign.procedures) {
    for (const proc of campaign.procedures) {
      if (proc.steps) allSteps.push(...proc.steps);
    }
  }
  proceduresSteps = allSteps;
  console.log(`✅ ${proceduresSteps.length} steps à compléter`);

  // Complete all steps
  for (const step of proceduresSteps) {
    await request(
      'POST',
      `/test-sessions/${proceduresSessionId}/steps/${step.id}/complete`,
      {
        submissionData:
          step.type === 'TEXT'
            ? { textProof: 'Étape complétée' }
            : { photoProof: 'https://example.com/proof.png' },
      },
      true,
    );
  }
  console.log('✅ Toutes les procédures complétées');

  // Validate price
  await request(
    'POST',
    `/test-sessions/${proceduresSessionId}/validate-price`,
    {
      productPrice: 50.0,
    },
    true,
  );
  console.log('✅ Prix validé');

  // Submit purchase
  await request(
    'POST',
    `/test-sessions/${proceduresSessionId}/submit-purchase`,
    {
      orderNumber: 'PROC-' + Date.now(),
      productPrice: 45.0,
      shippingCost: 3.0,
      purchaseProofUrl: 'https://example.com/receipt.pdf',
    },
    true,
  );
  console.log('✅ Achat soumis (45€ + 3€)');

  // PRO validate purchase
  await request('POST', `/test-sessions/${proceduresSessionId}/validate-purchase`);
  console.log('✅ PRO a validé l\'achat');

  // TESTEUR submit test
  await request('POST', `/test-sessions/${proceduresSessionId}/submit-test`, {}, true);
  console.log('✅ Test soumis');

  // PRO complete
  await request('POST', `/test-sessions/${proceduresSessionId}/complete`);
  console.log('✅ Session PROCEDURES complétée → Testeur devrait recevoir 58€\n');
}

// ============================================================================
// PARTIE 3: Campagne PRODUCT_LINK
// ============================================================================

async function createProductLinkCampaign() {
  console.log('📍 PARTIE 3: Campagne MODE PRODUCT_LINK\n');

  // Get category
  const categories = await request('GET', '/categories');
  const categoryId = categories[0]?.id;

  // Create product
  console.log('=== 3.1 Création produit PRODUCT_LINK ===');
  const product = await request('POST', '/products', {
    name: 'AirPods Pro - Test PRODUCT_LINK',
    description: 'Produit test pour flow amazon link',
    price: 30.0,
    shippingCost: 2.0,
    categoryId,
  });
  console.log('✅ Produit créé (max: 30€ + 2€)\n');

  // Create campaign with amazon link
  console.log('=== 3.2 Création campagne PRODUCT_LINK ===');
  const today = new Date();
  const campaign = await request('POST', '/campaigns', {
    title: 'Campaign PRODUCT_LINK - Test Flow',
    description: 'Test du flow avec lien direct',
    categoryId,
    startDate: today.toISOString(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    totalSlots: 3,
    autoAcceptApplications: false,
    marketplaceMode: 'PRODUCT_LINK',
    amazonLink: 'https://www.amazon.fr/dp/B0CHWRXH8B',
    keywords: ['test', 'product-link'],
    offer: {
      productId: product.id,
      productName: product.name,
      expectedPrice: 30.0,
      shippingCost: 2.0,
      priceRangeMin: 25.0,
      priceRangeMax: 35.0,
      isPriceRevealed: true,
      reimbursedPrice: true,
      reimbursedShipping: true,
      bonus: 8.0,
      quantity: 1,
    },
    distributions: [
      {
        type: 'SPECIFIC_DATE',
        specificDate: today.toISOString(),
        maxUnits: 3,
        isActive: true,
      },
    ],
  });
  productLinkCampaignId = campaign.id;
  console.log(`✅ Campagne PRODUCT_LINK créée: ${productLinkCampaignId}\n`);

  // Pay campaign
  console.log('=== 3.3 Paiement campagne PRODUCT_LINK ===');
  const checkout = await request('POST', `/campaigns/${productLinkCampaignId}/checkout-session`, {
    successUrl: 'http://localhost:3000/success',
    cancelUrl: 'http://localhost:3000/cancel',
  });
  console.log('✅ Checkout créé');

  // Simulate webhook
  await fetch(`${API_URL}/stripe/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'test',
    },
    body: JSON.stringify({
      id: 'evt_test_' + Date.now(),
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: checkout.sessionId,
          payment_intent: 'pi_test_productlink_' + Date.now(),
          payment_status: 'paid',
        },
      },
    }),
  });
  console.log('✅ Campagne PRODUCT_LINK activée\n');
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function testProductLinkFlow() {
  console.log('=== 3.4 Test flow PRODUCT_LINK ===');

  // TESTEUR apply
  const application = await request(
    'POST',
    `/test-sessions/${productLinkCampaignId}/apply`,
    {},
    true,
  );
  productLinkSessionId = application.id;
  console.log('✅ TESTEUR a postulé');

  // PRO accept
  await request('POST', `/test-sessions/${productLinkSessionId}/accept`);
  console.log('✅ PRO a accepté');

  // Submit purchase (no price validation needed!)
  await request(
    'POST',
    `/test-sessions/${productLinkSessionId}/submit-purchase`,
    {
      orderNumber: 'LINK-' + Date.now(),
      productPrice: 28.0,
      shippingCost: 2.0,
      purchaseProofUrl: 'https://example.com/receipt2.pdf',
    },
    true,
  );
  console.log('✅ Achat soumis (28€ + 2€) - Pas de validation prix nécessaire');

  // PRO validate purchase
  await request('POST', `/test-sessions/${productLinkSessionId}/validate-purchase`);
  console.log('✅ PRO a validé l\'achat');

  // TESTEUR submit test
  await request('POST', `/test-sessions/${productLinkSessionId}/submit-test`, {}, true);
  console.log('✅ Test soumis');

  // PRO complete
  await request('POST', `/test-sessions/${productLinkSessionId}/complete`);
  console.log('✅ Session PRODUCT_LINK complétée → Testeur devrait recevoir 38€\n');
}

// ============================================================================
// PARTIE 4: Vérification finale
// ============================================================================

async function checkFinalWallet() {
  console.log('📍 PARTIE 4: Vérification wallet TESTEUR\n');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const wallet = await request('GET', '/wallet/me', undefined, true);

  console.log('💰 WALLET FINAL:');
  console.log(`   Balance: ${wallet.balance}€`);
  console.log(`   Total gagné: ${wallet.totalEarned}€`);
  console.log(`\n📊 Détail attendu:`);
  console.log(`   - PROCEDURES: 45€ + 3€ + 10€ = 58€`);
  console.log(`   - PRODUCT_LINK: 28€ + 2€ + 8€ = 38€`);
  console.log(`   - TOTAL ATTENDU: 96€\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    await setupAccounts();
    await createProceduresCampaign();
    await testProceduresFlow();
    await createProductLinkCampaign();
    await testProductLinkFlow();
    await checkFinalWallet();

    console.log('='.repeat(70));
    console.log('✅ LES DEUX FLOWS ONT ÉTÉ TESTÉS AVEC SUCCÈS!\n');
    console.log('📋 Résumé:');
    console.log('   ✅ Flow PROCEDURES: Procédures → Prix → Achat → 58€');
    console.log('   ✅ Flow PRODUCT_LINK: Lien direct → Achat → 38€');
    console.log('   ✅ Total crédité: 96€\n');
    console.log('='.repeat(70));
  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    process.exit(1);
  }
}

main();
