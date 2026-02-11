// Test avec le bon format de données
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';

async function testProductCreation() {
  console.log('🔧 Test création produit - Format corrigé\n');

  try {
    // 1. Login
    console.log('1️⃣ Connexion...');
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_PRO_ACCOUNT.email,
        password: TEST_PRO_ACCOUNT.password,
      }),
    });

    const loginData = await loginResponse.json();
    const fullCookie = loginResponse.headers.get('set-cookie');
    const cookie = fullCookie?.split(';')[0];

    console.log('✅ Connecté');
    console.log('Full Set-Cookie:', fullCookie);
    console.log('Cookie extrait:', cookie);
    console.log('');

    // 2. Catégories
    const categoriesResponse = await fetch(`${API_URL}/categories`);
    const categories = await categoriesResponse.json();
    const categoryId = categories[0].id;

    // 3. Test SANS images (null)
    console.log('2️⃣ Test 1: Sans images (images = null)...');
    const product1 = {
      categoryId,
      name: 'Test Sans Images',
      description: 'Description test',
      price: 99.99,
      shippingCost: 5.99,
      images: null,
    };

    const response1 = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify(product1),
    });

    console.log('Status:', response1.status);
    const data1 = await response1.json();
    console.log('Response:', data1);
    console.log('');

    // 4. Test SANS le champ images (omis)
    console.log('3️⃣ Test 2: Sans le champ images (omis)...');
    const product2 = {
      categoryId,
      name: 'Test Champ Omis',
      description: 'Description test 2',
      price: 149.99,
      shippingCost: 7.99,
    };

    const response2 = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie || '',
      },
      body: JSON.stringify(product2),
    });

    console.log('Status:', response2.status);
    const data2 = await response2.json();
    console.log('Response:', JSON.stringify(data2, null, 2));
    console.log('');

    if (response2.ok) {
      console.log('✅ SUCCÈS ! Produit créé:', data2.id);
    } else {
      console.log('❌ Échec');
    }

  } catch (error: any) {
    console.error('❌ Erreur fatale:', error.message);
  }
}

testProductCreation();
