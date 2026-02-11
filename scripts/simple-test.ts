// Test simple pour déboguer l'auth

async function testAuth() {
  console.log('🧪 Test simple d\'authentification\n');

  // 1. Inscription PRO
  console.log('1. Inscription PRO...');
  const signupResponse = await fetch('http://localhost:3000/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `pro.simple.${Date.now()}@test.com`,
      password: 'testpass123',
      role: 'PRO',
      firstName: 'Jean',
      lastName: 'Vendeur',
      phone: '+33612345678',
      companyName: 'SuperSeller SARL',
      siret: '12345678901234',
      countries: ['FR'],
    }),
  });

  const signupData = await signupResponse.json();
  const cookies = signupResponse.headers.get('set-cookie');

  console.log('✅ Réponse signup:', {
    status: signupResponse.status,
    profile: signupData.profile?.email,
    cookies: cookies ? 'Présent' : 'Absent',
  });

  if (!cookies) {
    console.log('❌ Pas de cookie reçu !');
    return;
  }

  // Extraire le cookie auth_session
  const authCookie = cookies.split(';')[0];
  console.log('🍪 Cookie:', authCookie);

  // 2. Récupérer les catégories
  console.log('\n2. Récupération des catégories...');
  const categoriesResponse = await fetch('http://localhost:3000/api/v1/categories', {
    method: 'GET',
  });
  const categories = await categoriesResponse.json();
  console.log(`✅ ${categories.length} catégories trouvées`);
  const categoryId = categories[0].id;

  // 3. Créer un produit AVEC le cookie
  console.log('\n3. Création de produit...');
  const productResponse = await fetch('http://localhost:3000/api/v1/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie,
    },
    body: JSON.stringify({
      categoryId,
      name: 'Test Product Simple',
      description: 'Description du produit de test',
      price: 99.99,
      shippingCost: 5.99,
      images: ['https://example.com/image1.jpg'],
    }),
  });

  const productData = await productResponse.json();

  console.log('Réponse produit:', {
    status: productResponse.status,
    data: productData,
  });

  if (productResponse.ok) {
    console.log('✅ Produit créé:', productData.name);
  } else {
    console.log('❌ Erreur:', productData);
  }
}

testAuth().catch(console.error);
