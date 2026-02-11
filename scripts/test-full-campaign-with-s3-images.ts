// Test complet: Produit avec images S3 + Campagne
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';

async function testFullCampaignWithS3Images() {
  console.log('🚀 Test Complet: Campagne avec Produit + Images S3\n');

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
      name: 'Smartphone Gaming Pro',
      description: 'Smartphone haute performance pour gaming avec écran 120Hz et processeur Snapdragon',
      asin: 'B0SMARTPHONE01',
      productUrl: 'https://amazon.fr/dp/B0SMARTPHONE01',
      price: 599.99,
      shippingCost: 0,
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
    console.log(`✅ Produit créé: ${product.id}`);
    console.log(`   Nom: ${product.name}`);
    console.log(`   Prix: ${product.price}€\n`);

    // 4. Simuler l'ajout d'images (normalement fait via upload de fichiers)
    console.log('4️⃣ Simulation ajout images S3...');
    console.log('   ⚠️  Pour ajouter de vraies images, utilisez:');
    console.log(`   POST /api/v1/products/${product.id}/upload-images`);
    console.log('   Avec form-data: images=@fichier.jpg\n');

    // Simuler des URLs S3 (normalement générées par S3)
    const fakeS3Images = [
      `https://supertry-media.s3.eu-west-3.amazonaws.com/products/${product.id}/1738694400000-abc123def456.jpg`,
      `https://supertry-media.s3.eu-west-3.amazonaws.com/products/${product.id}/1738694400001-ghi789jkl012.jpg`,
    ];

    // Ajouter les images au produit (via l'ancienne route qui accepte des URLs)
    const addImagesResponse = await fetch(`${API_URL}/products/${product.id}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify({ images: fakeS3Images }),
    });

    const productWithImages = await addImagesResponse.json();
    console.log(`✅ Images ajoutées: ${productWithImages.images.length}\n`);

    // 5. Créer une campagne avec ce produit
    console.log('5️⃣ Création de la campagne...');
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 45);

    const campaignData = {
      title: 'Test Smartphone Gaming - Campagne Europe',
      description: 'Testez le nouveau smartphone gaming avec photos et vidéos !',
      categoryId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalSlots: 8,
      autoAcceptApplications: false,
      marketplaceMode: 'PROCEDURES',
      marketplaces: ['FR', 'DE', 'ES'],
      keywords: ['smartphone', 'gaming', 'performance'],
      offer: {
        productId: product.id,
        productName: product.name,
        expectedPrice: product.price,
        shippingCost: product.shippingCost,
        priceRangeMin: 580.0,
        priceRangeMax: 620.0,
        isPriceRevealed: true,
        reimbursedPrice: true,
        reimbursedShipping: true,
        bonus: 50.0,
        quantity: 1,
      },
      procedures: [
        {
          title: 'Unboxing et Setup',
          description: 'Déballage et configuration initiale',
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
              title: 'Photos du contenu',
              description: 'Photos du smartphone et accessoires',
              type: 'PHOTO',
              order: 2,
              isRequired: true,
            },
          ],
        },
        {
          title: 'Tests Gaming',
          description: 'Tester les performances gaming',
          order: 2,
          isRequired: true,
          steps: [
            {
              title: 'Checklist gaming',
              description: 'Vérifiez tous les aspects gaming',
              type: 'CHECKLIST',
              order: 1,
              isRequired: true,
              checklistItems: {
                items: [
                  'Fluidité 120Hz',
                  'Température sous charge',
                  'Autonomie en gaming',
                  'Qualité audio',
                  'Gestion tactile'
                ]
              },
            },
            {
              title: 'Note finale',
              description: 'Évaluation globale',
              type: 'RATING',
              order: 2,
              isRequired: true,
            },
          ],
        },
      ],
      criteria: {
        minAge: 18,
        maxAge: 45,
        minRating: 0,
        minCompletedSessions: 0,
        requiredCountries: ['FR', 'DE', 'ES'],
      },
      distributions: [
        {
          type: 'RECURRING',
          dayOfWeek: 2,
          maxUnits: 3,
          isActive: true,
        },
        {
          type: 'RECURRING',
          dayOfWeek: 5,
          maxUnits: 3,
          isActive: true,
        },
      ],
    };

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
    console.log(`✅ Campagne créée: ${campaign.id}`);
    console.log(`   Statut: ${campaign.status}\n`);

    // 6. Activer la campagne
    console.log('6️⃣ Activation de la campagne...');
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

    // 7. Récupérer les détails complets
    console.log('7️⃣ Récupération des détails...\n');

    const campaignDetailsResponse = await fetch(`${API_URL}/campaigns/${campaign.id}`, {
      headers: { 'Cookie': cookie || '' },
    });
    const campaignDetails = await campaignDetailsResponse.json();

    const productDetailsResponse = await fetch(`${API_URL}/products/${product.id}`);
    const productDetails = await productDetailsResponse.json();

    // 8. Afficher les objets condensés
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📦 PRODUIT (condensé)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const productCondensed = {
      id: productDetails.id,
      name: productDetails.name,
      description: productDetails.description,
      price: productDetails.price,
      shippingCost: productDetails.shippingCost,
      images: productDetails.images,
      imagesCount: productDetails.images.length,
      category: productDetails.category?.name,
      seller: `${productDetails.seller?.firstName} ${productDetails.seller?.lastName}`,
      isActive: productDetails.isActive,
    };

    console.log(JSON.stringify(productCondensed, null, 2));
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 CAMPAGNE (condensé)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const campaignCondensed = {
      id: campaignDetails.id,
      title: campaignDetails.title,
      status: campaignDetails.status,
      marketplaceMode: campaignDetails.marketplaceMode,
      marketplaces: campaignDetails.marketplaces,
      totalSlots: campaignDetails.totalSlots,
      availableSlots: campaignDetails.availableSlots,
      escrowAmount: campaignDetails.escrowAmount + '€',
      autoAcceptApplications: campaignDetails.autoAcceptApplications,

      offer: {
        productId: campaignDetails.offers[0].productId,
        productName: campaignDetails.offers[0].productName,
        expectedPrice: campaignDetails.offers[0].expectedPrice + '€',
        bonus: campaignDetails.offers[0].bonus + '€',
        quantity: campaignDetails.offers[0].quantity,
      },

      procedures: campaignDetails.procedures.map((p: any) => ({
        title: p.title,
        stepsCount: p.steps.length,
        steps: p.steps.map((s: any) => `${s.title} [${s.type}]`),
      })),

      criteria: {
        age: `${campaignDetails.criteria.minAge}-${campaignDetails.criteria.maxAge} ans`,
        countries: campaignDetails.criteria.requiredCountries,
      },

      distributions: campaignDetails.distributions.map((d: any) => ({
        dayOfWeek: d.dayOfWeek,
        maxUnits: d.maxUnits,
      })),
    };

    console.log(JSON.stringify(campaignCondensed, null, 2));
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ TEST RÉUSSI !');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📊 Résumé:');
    console.log(`   ✅ Produit: ${product.id}`);
    console.log(`   ✅ Images S3: ${productDetails.images.length}`);
    console.log(`   ✅ Campagne: ${campaign.id}`);
    console.log(`   ✅ Marketplaces: ${campaignDetails.marketplaces.join(', ')}`);
    console.log(`   ✅ Statut: ${campaignDetails.status}`);
    console.log('');

    console.log('🌍 La campagne est disponible pour:');
    campaignDetails.criteria.requiredCountries.forEach((country: string) => {
      const flags: any = { FR: '🇫🇷', DE: '🇩🇪', ES: '🇪🇸', IT: '🇮🇹', UK: '🇬🇧' };
      console.log(`   ${flags[country] || '🌍'} ${country}`);
    });
    console.log('');

    console.log('📸 Images du produit:');
    productDetails.images.forEach((img: string, i: number) => {
      console.log(`   ${i + 1}. ${img}`);
    });
    console.log('');

  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

testFullCampaignWithS3Images();
