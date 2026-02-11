// Test création campagne multi-marketplace
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';

async function testMultiMarketplaceCampaign() {
  console.log('🚀 Test création campagne MULTI-MARKETPLACE\n');

  try {
    // 1. Login PRO
    console.log('1️⃣ Connexion PRO...');
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_PRO_ACCOUNT.email,
        password: TEST_PRO_ACCOUNT.password,
      }),
    });

    const loginData = await loginResponse.json();
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    console.log('✅ Connecté\n');

    // 2. Récupérer catégories
    console.log('2️⃣ Récupération des catégories...');
    const categoriesResponse = await fetch(`${API_URL}/categories`);
    const categories = await categoriesResponse.json();
    const categoryId = categories[0].id;
    console.log(`✅ Catégorie: ${categories[0].name}\n`);

    // 3. Créer un produit
    console.log('3️⃣ Création du produit...');
    const productData = {
      categoryId,
      name: 'Clavier Gaming Mécanique RGB',
      description: 'Clavier mécanique avec rétroéclairage RGB et switches Cherry MX',
      asin: 'B0TESTPROD10',
      productUrl: 'https://amazon.fr/dp/B0TESTPROD10',
      price: 129.99,
      shippingCost: 5.99,
    };

    const productResponse = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify(productData),
    });

    const product = await productResponse.json();
    console.log(`✅ Produit créé: ${product.id}\n`);

    // 4. Créer campagne MULTI-MARKETPLACE
    console.log('4️⃣ Création campagne multi-marketplace...');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 60);

    const campaignData = {
      title: 'Test Clavier Gaming - Europe Multi-Pays',
      description: 'Testez notre clavier gaming dans toute l\'Europe ! Disponible sur Amazon FR, DE, UK, ES, IT.',
      categoryId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalSlots: 10,
      autoAcceptApplications: false,
      marketplaceMode: 'PROCEDURES',
      marketplaces: ['FR', 'DE', 'UK', 'ES', 'IT'], // ✅ Multi-marketplace !
      keywords: ['clavier', 'gaming', 'mécanique', 'rgb'],
      offer: {
        productId: product.id,
        productName: 'Clavier Gaming Mécanique RGB',
        expectedPrice: 129.99,
        shippingCost: 5.99,
        priceRangeMin: 120.0,
        priceRangeMax: 140.0,
        isPriceRevealed: true,
        reimbursedPrice: true,
        reimbursedShipping: true,
        bonus: 25.0,
        quantity: 1,
      },
      procedures: [
        {
          title: 'Déballage et installation',
          description: 'Unboxing et première configuration',
          order: 1,
          isRequired: true,
          steps: [
            {
              title: 'Vidéo unboxing',
              description: 'Filmez le déballage complet',
              type: 'VIDEO',
              order: 1,
              isRequired: true,
            },
            {
              title: 'Photos détaillées',
              description: 'Photos du clavier sous différents angles',
              type: 'PHOTO',
              order: 2,
              isRequired: true,
            },
          ],
        },
        {
          title: 'Tests approfondis',
          description: 'Testez toutes les fonctionnalités',
          order: 2,
          isRequired: true,
          steps: [
            {
              title: 'Checklist gaming',
              description: 'Vérifiez tous les aspects',
              type: 'CHECKLIST',
              order: 1,
              isRequired: true,
              checklistItems: {
                items: [
                  'Qualité des switches',
                  'RGB personnalisable',
                  'Logiciel de configuration',
                  'Confort de frappe',
                  'Solidité de construction',
                  'Performance en gaming'
                ]
              },
            },
            {
              title: 'Note globale',
              description: 'Évaluez le produit',
              type: 'RATING',
              order: 2,
              isRequired: true,
            },
          ],
        },
      ],
      criteria: {
        minAge: 18,
        maxAge: 50,
        minRating: 0,
        minCompletedSessions: 0,
        requiredCountries: ['FR', 'DE', 'UK', 'ES', 'IT'], // ✅ Mêmes pays que marketplaces
      },
      distributions: [
        {
          type: 'RECURRING',
          dayOfWeek: 1, // Lundi
          maxUnits: 3,
          isActive: true,
        },
        {
          type: 'RECURRING',
          dayOfWeek: 4, // Jeudi
          maxUnits: 3,
          isActive: true,
        },
      ],
    };

    console.log('   📝 Campagne:', campaignData.title);
    console.log('   🌍 Marketplaces:', campaignData.marketplaces.join(', '));
    console.log('   🌍 Pays autorisés:', campaignData.criteria.requiredCountries.join(', '));
    console.log('   💰 Bonus:', campaignData.offer.bonus + '€');
    console.log('   👥 Places:', campaignData.totalSlots);

    const campaignResponse = await fetch(`${API_URL}/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify(campaignData),
    });

    if (!campaignResponse.ok) {
      const error = await campaignResponse.json();
      throw new Error(JSON.stringify(error, null, 2));
    }

    const campaign = await campaignResponse.json();
    console.log(`\n✅ Campagne créée: ${campaign.id}`);
    console.log(`   📊 Statut: ${campaign.status}\n`);

    // 5. Activer la campagne
    console.log('5️⃣ Activation de la campagne...');
    const activateResponse = await fetch(`${API_URL}/campaigns/${campaign.id}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify({}),
    });

    const activatedCampaign = await activateResponse.json();
    console.log(`✅ Campagne activée: ${activatedCampaign.status}\n`);

    // 6. Récupérer les détails complets
    console.log('6️⃣ Récupération des détails...');
    const detailsResponse = await fetch(`${API_URL}/campaigns/${campaign.id}`, {
      headers: {
        'Cookie': cookie || '',
      },
    });

    const details = await detailsResponse.json();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 CAMPAGNE MULTI-MARKETPLACE CRÉÉE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📋 Informations générales:');
    console.log(`   ID: ${details.id}`);
    console.log(`   Titre: ${details.title}`);
    console.log(`   Statut: ${details.status}`);
    console.log(`   Mode: ${details.marketplaceMode}`);
    console.log(`   Places totales: ${details.totalSlots}`);
    console.log(`   Places disponibles: ${details.availableSlots}`);
    console.log(`   Escrow: ${details.escrowAmount}€\n`);

    console.log('🌍 Multi-marketplace:');
    console.log(`   Marketplaces Amazon: [${details.marketplaces.join(', ')}]`);
    console.log(`   Nombre de pays: ${details.marketplaces.length}\n`);

    console.log('🎯 Critères d\'éligibilité:');
    console.log(`   Âge: ${details.criteria.minAge} - ${details.criteria.maxAge} ans`);
    console.log(`   Pays autorisés: [${details.criteria.requiredCountries.join(', ')}]`);
    console.log(`   Nombre de testeurs éligibles: ${details.criteria.requiredCountries.length} pays\n`);

    console.log('💰 Offre:');
    const offer = details.offers[0];
    console.log(`   Produit: ${offer.productName}`);
    console.log(`   Prix attendu: ${offer.expectedPrice}€`);
    console.log(`   Frais de port: ${offer.shippingCost}€`);
    console.log(`   Bonus testeur: ${offer.bonus}€`);
    console.log(`   Total par testeur: ${parseFloat(offer.expectedPrice) + parseFloat(offer.shippingCost) + parseFloat(offer.bonus)}€\n`);

    console.log('📋 Procédures:');
    details.procedures.forEach((proc: any, index: number) => {
      console.log(`   ${index + 1}. ${proc.title} (${proc.steps.length} étapes)`);
      proc.steps.forEach((step: any, stepIndex: number) => {
        console.log(`      ${stepIndex + 1}. ${step.title} [${step.type}]`);
      });
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ TEST RÉUSSI !');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📊 Résumé:');
    console.log(`   ✅ Produit créé: ${product.id}`);
    console.log(`   ✅ Campagne créée: ${campaign.id}`);
    console.log(`   ✅ Marketplaces: ${details.marketplaces.length} pays`);
    console.log(`   ✅ Testeurs éligibles: ${details.criteria.requiredCountries.length} pays`);
    console.log(`   ✅ Statut: ${details.status}\n`);

    console.log('🌍 La campagne est maintenant disponible pour les testeurs de:');
    details.criteria.requiredCountries.forEach((country: string) => {
      const flags: any = { FR: '🇫🇷', DE: '🇩🇪', UK: '🇬🇧', ES: '🇪🇸', IT: '🇮🇹' };
      console.log(`   ${flags[country] || '🌍'} ${country}`);
    });
    console.log('');

  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

testMultiMarketplaceCampaign();
