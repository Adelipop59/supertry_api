// Script de debug pour la création de produit
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';

async function debugProductCreation() {
  console.log('🔍 DEBUG - Création de produit\n');

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

    if (!loginResponse.ok) {
      console.log('❌ Échec connexion');
      console.log('Status:', loginResponse.status);
      console.log('Response:', await loginResponse.text());
      return;
    }

    const loginData = await loginResponse.json();
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    console.log('✅ Connecté');
    console.log('Cookie:', cookie);
    console.log('');

    // 2. Récupérer les catégories
    console.log('2️⃣ Récupération catégories...');
    const categoriesResponse = await fetch(`${API_URL}/categories`);
    const categories = await categoriesResponse.json();
    const categoryId = categories[0].id;
    console.log('✅ Catégorie:', categories[0].name, '(' + categoryId + ')');
    console.log('');

    // 3. Tester avec données minimales
    console.log('3️⃣ Test création produit - données minimales...');
    const minimalProduct = {
      categoryId,
      name: 'Test Produit Minimal',
      description: 'Description test',
      price: 99.99,
      shippingCost: 5.99,
    };

    console.log('📦 Données envoyées:', JSON.stringify(minimalProduct, null, 2));
    console.log('');

    const productResponse = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      credentials: 'include',
      body: JSON.stringify(minimalProduct),
    });

    console.log('📡 Réponse HTTP:');
    console.log('   Status:', productResponse.status);
    console.log('   Status Text:', productResponse.statusText);
    console.log('   Headers:', Object.fromEntries(productResponse.headers.entries()));
    console.log('');

    const responseText = await productResponse.text();
    console.log('📄 Body brut:');
    console.log(responseText);
    console.log('');

    try {
      const productData = JSON.parse(responseText);
      console.log('📋 Body parsé:');
      console.log(JSON.stringify(productData, null, 2));
      console.log('');

      if (productResponse.ok) {
        console.log('✅ Produit créé avec succès!');
        console.log('ID:', productData.id);
      } else {
        console.log('❌ Erreur de l\'API');
        if (productData.message) {
          console.log('Message:', productData.message);
        }
        if (productData.statusCode) {
          console.log('Status Code:', productData.statusCode);
        }
        if (productData.error) {
          console.log('Error:', productData.error);
        }
      }
    } catch (parseError) {
      console.log('⚠️  Impossible de parser la réponse JSON');
    }

    // 4. Test avec images en string array
    console.log('\n4️⃣ Test création produit - avec images string[]...');
    const productWithImages = {
      categoryId,
      name: 'Test Produit Avec Images',
      description: 'Description test avec images',
      price: 149.99,
      shippingCost: 7.99,
      images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
    };

    console.log('📦 Données envoyées:', JSON.stringify(productWithImages, null, 2));
    console.log('');

    const productResponse2 = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      credentials: 'include',
      body: JSON.stringify(productWithImages),
    });

    const responseText2 = await productResponse2.text();
    console.log('📡 Status:', productResponse2.status);
    console.log('📄 Body:', responseText2);
    console.log('');

    // 5. Vérifier si le user est bien attaché à la request
    console.log('5️⃣ Vérification session utilisateur...');
    const sessionResponse = await fetch(`${API_URL}/auth/session`, {
      method: 'GET',
      headers: {
        'Cookie': cookie || '',
      },
      credentials: 'include',
    });

    const sessionData = await sessionResponse.json();
    console.log('👤 User dans la session:', sessionData.user ? 'OUI' : 'NON');
    if (sessionData.user) {
      console.log('   ID:', sessionData.user.id);
      console.log('   Email:', sessionData.user.email);
      console.log('   Role:', sessionData.user.role);
    }

  } catch (error: any) {
    console.error('\n❌ ERREUR FATALE:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }
}

debugProductCreation();
