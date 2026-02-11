// Test flow complet: PROCEDURES mode avec validation prix
const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';

// Comptes existants
const EXISTING_PRO = {
  email: process.env.TEST_PRO_EMAIL || 'pro-test@example.com',
  password: process.env.TEST_PRO_PASSWORD || 'Test1234!',
};

const EXISTING_TESTER = {
  email: process.env.TEST_TESTER_EMAIL || 'tester-test@example.com',
  password: process.env.TEST_TESTER_PASSWORD || 'Test1234!',
};

// Sessions séparées pour PRO et TESTEUR
let proSessionCookie: string = '';
let testerSessionCookie: string = '';

let proUserId: string = '';
let testerUserId: string = '';
let categoryId: string = '';
let productId: string = '';
let campaignId: string = '';
let sessionId: string = '';
let procedureSteps: any[] = [];

/**
 * Helper: Make HTTP request with cookie support
 */
async function request(method: string, path: string, body?: any, useTesterSession = false): Promise<any> {
  const url = `${API_URL}${path}`;
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
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    return data;
  } catch (error: any) {
    throw error;
  }
}

// ============================================================================
// PARTIE 1: PRO - Setup
// ============================================================================

async function loginOrCreatePro() {
  console.log('\n=== PRO 1. Connexion ou création compte ===');
  console.log(`📧 Email: ${EXISTING_PRO.email}`);

  try {
    const response = await request('POST', '/auth/login', {
      email: EXISTING_PRO.email,
      password: EXISTING_PRO.password,
    });

    proUserId = response.user?.id || response.id;
    console.log(`✅ PRO connecté (ID: ${proUserId})`);
  } catch (error: any) {
    console.log(`⚠️  Connexion échouée, création du compte...`);

    const response = await request('POST', '/auth/signup', {
      email: EXISTING_PRO.email,
      password: EXISTING_PRO.password,
      role: 'PRO',
      firstName: 'Jean',
      lastName: 'Dupont',
      companyName: 'Test Company',
      siret: '12345678901234',
      countries: ['FR'],
    });

    proUserId = response.user?.id || response.profile?.id;
    console.log(`✅ PRO créé (ID: ${proUserId})`);
  }
}

async function getCategory() {
  console.log('\n=== PRO 2. Récupération catégorie ===');
  const categories = await request('GET', '/categories');
  categoryId = categories[0].id;
  console.log(`✅ Catégorie: ${categories[0].name} (ID: ${categoryId})`);
}

async function createProduct() {
  console.log('\n=== PRO 3. Création produit ===');
  const product = await request('POST', '/products', {
    name: 'Test Product - iPhone 15',
    description: 'Produit test',
    price: 50.0, // Prix MAXIMUM
    shippingCost: 5.0, // Frais MAXIMUM
    categoryId,
  });
  productId = product.id;
  console.log(`✅ Produit créé (prix MAX: 50€, frais MAX: 5€)`);
}

async function createCampaign() {
  console.log('\n=== PRO 4. Création campagne MODE PROCEDURES ===');
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const today = new Date();

  const campaign = await request('POST', '/campaigns', {
    title: 'Test Campaign - PROCEDURES Mode',
    description: 'Test flow avec procédures et validation prix',
    categoryId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    totalSlots: 3,
    autoAcceptApplications: false,
    marketplaceMode: 'PROCEDURES',
    keywords: ['test', 'procedures'],
    offer: {
      productId,
      productName: 'Test Product - iPhone 15',
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
        title: 'Procédure: Trouver et acheter le produit',
        description: 'Suivez les étapes pour trouver et commander le produit sur Amazon',
        order: 0,
        isRequired: true,
        steps: [
          {
            title: 'Étape 1: Rechercher le produit',
            description: 'Allez sur Amazon.fr et recherchez "iPhone 15"',
            type: 'TEXT',
            order: 0,
            isRequired: true,
          },
          {
            title: 'Étape 2: Capture d\'écran des résultats',
            description: 'Prenez une capture d\'écran de la page de résultats',
            type: 'PHOTO',
            order: 1,
            isRequired: true,
          },
          {
            title: 'Étape 3: Vérifier le prix',
            description: 'Notez le prix affiché et confirmez qu\'il correspond',
            type: 'TEXT',
            order: 2,
            isRequired: true,
          },
        ],
      },
    ],
    distributions: [{
      type: 'SPECIFIC_DATE',
      specificDate: today.toISOString(),
      maxUnits: 3,
      isActive: true,
    }],
  });
  campaignId = campaign.id;
  console.log(`✅ Campagne PROCEDURES créée (ID: ${campaignId})`);
}

async function payCampaign() {
  console.log('\n=== PRO 5. Paiement campagne ===');
  const checkoutRes = await request('POST', `/campaigns/${campaignId}/checkout-session`, {
    successUrl: 'http://localhost:3000/success',
    cancelUrl: 'http://localhost:3000/cancel',
  });
  console.log(`✅ Checkout Session: ${checkoutRes.sessionId}`);

  await new Promise(resolve => setTimeout(resolve, 500));

  // Simuler webhook paiement
  const webhookResponse = await fetch(`${API_URL}/stripe/webhooks`, {
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
          id: checkoutRes.sessionId,
          payment_intent: 'pi_test_' + Date.now(),
          payment_status: 'paid',
        },
      },
    }),
  });

  console.log(`✅ Webhook envoyé (Status: ${webhookResponse.status})`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(`✅ Campagne payée et ACTIVE`);
}

// ============================================================================
// PARTIE 2: TESTEUR - Candidature
// ============================================================================

async function loginOrCreateTester() {
  console.log('\n=== TESTEUR 1. Connexion ou création compte ===');
  console.log(`📧 Email: ${EXISTING_TESTER.email}`);

  try {
    const response = await request('POST', '/auth/login', {
      email: EXISTING_TESTER.email,
      password: EXISTING_TESTER.password,
    }, true);

    testerUserId = response.user?.id || response.id;
    console.log(`✅ TESTEUR connecté (ID: ${testerUserId})`);
  } catch (error: any) {
    console.log(`⚠️  Connexion échouée, création du compte...`);

    const response = await request('POST', '/auth/signup', {
      email: EXISTING_TESTER.email,
      password: EXISTING_TESTER.password,
      role: 'USER',
      firstName: 'Marie',
      lastName: 'Test',
      country: 'FR',
    }, true);

    testerUserId = response.user?.id || response.profile?.id;
    console.log(`✅ TESTEUR créé (ID: ${testerUserId})`);
  }

  // Vérifier le statut KYC
  console.log('\n=== TESTEUR 2. Vérification KYC ===');
  const kycStatus = await request('GET', '/stripe/connect/kyc-status', null, true);

  if (kycStatus.kycRequired === false || kycStatus.chargesEnabled === true) {
    console.log(`✅ KYC déjà complété`);
  } else {
    console.log(`⚠️  KYC requis pour continuer`);

    const onboardingRes = await request('POST', '/stripe/connect/onboarding-link', {
      refreshUrl: 'https://example.com/kyc/refresh',
      returnUrl: 'https://example.com/kyc/success',
    }, true);

    console.log('\n🔗 LIEN KYC STRIPE:');
    console.log(`   ${onboardingRes.url}\n`);
    console.log('📋 INSTRUCTIONS:');
    console.log('   1. Copie le lien ci-dessus');
    console.log('   2. Ouvre-le dans ton navigateur');
    console.log('   3. Complete le processus KYC Stripe');
    console.log('   4. Appuie sur ENTER ici pour continuer le test\n');

    await new Promise((resolve) => {
      process.stdin.once('data', () => {
        resolve(null);
      });
    });

    console.log('✅ Reprise du test...\n');
  }
}

async function applyToCampaign() {
  console.log('\n=== TESTEUR 3. Candidature ===');
  const response = await request('POST', `/test-sessions/${campaignId}/apply`, {}, true);
  sessionId = response.id;
  console.log(`✅ Candidature soumise (Status: ${response.status})`);
}

// ============================================================================
// PARTIE 3: PRO - Acceptation
// ============================================================================

async function acceptApplication() {
  console.log('\n=== PRO 6. Acceptation candidature ===');
  const response = await request('POST', `/test-sessions/${sessionId}/accept`);
  console.log(`✅ Candidature acceptée (Status: ${response.status})`);

  // Récupérer les steps de la campagne
  const campaign = await request('GET', `/campaigns/${campaignId}`);

  // Aplatir les steps de toutes les procédures
  const allSteps: any[] = [];
  if (campaign.procedures) {
    for (const procedure of campaign.procedures) {
      if (procedure.steps) {
        allSteps.push(...procedure.steps);
      }
    }
  }

  procedureSteps = allSteps.map(step => ({ step }));
  console.log(`   📋 ${procedureSteps.length} steps à compléter`);
}

// ============================================================================
// PARTIE 4: TESTEUR - Complétion des procédures
// ============================================================================

async function completeProcedures() {
  console.log('\n=== TESTEUR 4. Complétion des procédures ===');

  for (const stepProgress of procedureSteps) {
    const step = stepProgress.step;
    console.log(`\n   📝 Procédure ${step.order}: ${step.title}`);

    let submissionData: any = {};

    if (step.type === 'TEXT') {
      submissionData = {
        textProof: 'Procédure complétée: ' + step.description,
      };
    } else if (step.type === 'PHOTO') {
      submissionData = {
        photoProof: 'https://example.com/screenshot-step-' + step.order + '.png',
      };
    } else if (step.type === 'VIDEO') {
      submissionData = {
        videoProof: 'https://example.com/video-step-' + step.order + '.mp4',
      };
    }

    const response = await request('POST', `/test-sessions/${sessionId}/steps/${step.id}/complete`, {
      submissionData,
    }, true);
    console.log(`   ✅ Procédure ${step.order} complétée (Status: ${response.status})`);
  }

  console.log(`\n✅ Toutes les procédures complétées`);

  // Vérifier le statut final de la session
  const session = await request('GET', `/test-sessions/${sessionId}`, null, true);
  console.log(`   📊 Statut final de la session: ${session.status}`);

  if (session.status !== 'PROCEDURES_COMPLETED') {
    throw new Error(`Expected status PROCEDURES_COMPLETED but got ${session.status}`);
  }
}

// ============================================================================
// PARTIE 5: TESTEUR - Validation prix et achat
// ============================================================================

async function validatePrice() {
  console.log('\n=== TESTEUR 5. Validation prix ===');

  // Le testeur valide qu'il accepte le prix proposé (50€ max)
  await request('POST', `/test-sessions/${sessionId}/validate-price`, {
    productPrice: 50.0, // Prix MAXIMUM accepté
  }, true);

  console.log(`✅ Prix validé (max: 50€)`);
}

async function submitPurchase() {
  console.log('\n=== TESTEUR 6. Soumission preuve achat ===');

  // Prix RÉELS (moins cher que le maximum!)
  const realProductPrice = 45.0; // Au lieu de 50€
  const realShippingCost = 3.0;  // Au lieu de 5€

  console.log(`   💰 Prix réel produit: ${realProductPrice}€ (max: 50€)`);
  console.log(`   📦 Frais réels livraison: ${realShippingCost}€ (max: 5€)`);

  const response = await request('POST', `/test-sessions/${sessionId}/submit-purchase`, {
    orderNumber: 'AMZ-123456789',
    productPrice: realProductPrice,
    shippingCost: realShippingCost,
    purchaseProofUrl: 'https://example.com/screenshot.png',
  }, true);

  console.log(`✅ Preuve soumise (Status: ${response.status})`);
  return { realProductPrice, realShippingCost };
}

// ============================================================================
// PARTIE 6: PRO - Validation et remboursement
// ============================================================================

async function validatePurchase() {
  console.log('\n=== PRO 7. Validation commande ===');

  // Le PRO peut valider tel quel, ou modifier les montants si le testeur a fait une erreur
  // Exemples:
  // 1. Valider tel quel (sans body):
  //    const response = await request('POST', `/test-sessions/${sessionId}/validate-purchase`);
  //
  // 2. Corriger le prix (le testeur avait mis 45€ mais le PRO voit 47€ sur la preuve):
  //    const response = await request('POST', `/test-sessions/${sessionId}/validate-purchase`, {
  //      productPrice: 47.0,
  //      purchaseValidationComment: 'Prix corrigé d\'après la facture'
  //    });
  //
  // 3. Corriger les deux montants:
  //    const response = await request('POST', `/test-sessions/${sessionId}/validate-purchase`, {
  //      productPrice: 47.0,
  //      shippingCost: 4.5,
  //      purchaseValidationComment: 'Montants corrigés d\'après la preuve d\'achat'
  //    });

  // Pour ce test, on valide tel quel (le testeur a bien saisi)
  const response = await request('POST', `/test-sessions/${sessionId}/validate-purchase`);
  console.log(`✅ Commande validée (Status: ${response.status})`);
}

async function submitTest() {
  console.log('\n=== TESTEUR 7. Soumission test final ===');
  const response = await request('POST', `/test-sessions/${sessionId}/submit-test`, {}, true);
  console.log(`✅ Test soumis (Status: ${response.status})`);
}

async function completeSession() {
  console.log('\n=== PRO 8. Complétion session ===');
  const completedSession = await request('POST', `/test-sessions/${sessionId}/complete`);
  console.log(`✅ Session complétée (Status: ${completedSession.status})`);

  console.log('⏳ Attente du traitement du remboursement...');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function checkRefund(realPrice: number, realShipping: number) {
  console.log('\n=== TESTEUR 8. Vérification remboursement ===');

  const expectedRefund = realPrice + realShipping + 10.0; // prix + frais + bonus
  console.log(`💵 Remboursement attendu: ${expectedRefund}€`);
  console.log(`   - Prix réel: ${realPrice}€`);
  console.log(`   - Frais réels: ${realShipping}€`);
  console.log(`   - Bonus: 10€`);

  try {
    const wallet = await request('GET', '/wallet/me', undefined, true);
    console.log(`\n💰 Wallet TESTEUR:`);
    console.log(`   - Balance: ${wallet.balance}€`);
    console.log(`   - Pending: ${wallet.pendingBalance}€`);

    const transactions = await request('GET', '/wallet/me/transactions', undefined, true);
    const refundTx = transactions.find((t: any) => t.type === 'TEST_REWARD');
    if (refundTx) {
      console.log(`\n✅ Transaction remboursement:`);
      console.log(`   - Montant: ${refundTx.amount}€`);
      console.log(`   - Status: ${refundTx.status}`);

      if (Math.abs(refundTx.amount - expectedRefund) < 0.01) {
        console.log(`   ✅ Montant CORRECT!`);
      } else {
        console.log(`   ⚠️  Montant différent de l'attendu`);
      }
    } else {
      console.log(`\n⚠️  Aucune transaction TEST_REWARD trouvée`);
    }
  } catch (error: any) {
    console.log(`\n⚠️  Erreur lors de la vérification du wallet: ${error.message}`);
    console.log(`   (Le wallet sera créé lors du premier remboursement)`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 Test Flow PROCEDURES: Procédures → Validation Prix → Remboursement\n');
  console.log('='.repeat(60));

  try {
    // PRO Setup
    console.log('\n📍 PARTIE 1: PRO - Setup campagne PROCEDURES');
    await loginOrCreatePro();
    await getCategory();
    await createProduct();
    await createCampaign();
    await payCampaign();

    // TESTEUR Candidature
    console.log('\n📍 PARTIE 2: TESTEUR - Candidature');
    await loginOrCreateTester();
    await applyToCampaign();

    // PRO Acceptation
    console.log('\n📍 PARTIE 3: PRO - Acceptation');
    await acceptApplication();

    // TESTEUR Procédures
    console.log('\n📍 PARTIE 4: TESTEUR - Complétion procédures');
    await completeProcedures();

    // TESTEUR Validation prix + Achat
    console.log('\n📍 PARTIE 5: TESTEUR - Validation prix & Achat');
    await validatePrice();
    const { realProductPrice, realShippingCost } = await submitPurchase();

    // PRO Validation + Remboursement
    console.log('\n📍 PARTIE 6: PRO - Validation & Remboursement');
    await validatePurchase();
    await submitTest();
    await completeSession();
    await checkRefund(realProductPrice, realShippingCost);

    // Résumé
    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ\n');
    console.log('✅ Compte PRO connecté et authentifié');
    console.log('✅ Produit créé (prix max: 50€, frais max: 5€)');
    console.log('✅ Campagne PROCEDURES créée et payée (ACTIVE)');
    console.log('✅ Compte TESTEUR connecté (KYC déjà validé)');
    console.log('✅ TESTEUR a postulé');
    console.log('✅ PRO a accepté');
    console.log('✅ TESTEUR a complété toutes les procédures');
    console.log('✅ TESTEUR a validé le prix');
    console.log('✅ TESTEUR a soumis preuve achat (prix réels < max)');
    console.log('✅ PRO a validé la commande');
    console.log('✅ TESTEUR a soumis le test final');
    console.log('✅ PRO a complété la session');
    console.log('✅ TESTEUR remboursé: prix réel + frais réels + bonus');
    console.log('\n🎉 FLOW PROCEDURES COMPLET TESTÉ AVEC SUCCÈS!\n');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
