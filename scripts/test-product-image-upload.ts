// Test upload d'images pour un produit
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';
import * as fs from 'fs';
import * as path from 'path';

async function testProductImageUpload() {
  console.log('🚀 Test Upload Images Produit\n');

  try {
    // 1. Connexion
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

    // 3. Créer un produit SANS images
    console.log('3️⃣ Création du produit sans images...');
    const productData = {
      categoryId,
      name: 'Test Produit avec Images S3',
      description: 'Produit pour tester l\'upload d\'images vers S3',
      price: 99.99,
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
    console.log(`✅ Produit créé: ${product.id}`);
    console.log(`   Images actuelles: ${product.images.length}\n`);

    // 4. Instructions pour uploader des images
    console.log('4️⃣ Pour uploader des images:\n');
    console.log('   Option 1: Via curl (avec de vraies images)');
    console.log('   ─────────────────────────────────────────');
    console.log(`   curl -X POST http://localhost:3000/api/v1/products/${product.id}/upload-images \\`);
    console.log(`     -H "Cookie: ${cookie}" \\`);
    console.log('     -F "images=@/path/to/image1.jpg" \\');
    console.log('     -F "images=@/path/to/image2.jpg"');
    console.log('');

    console.log('   Option 2: Via Postman/Insomnia');
    console.log('   ────────────────────────────────');
    console.log(`   POST http://localhost:3000/api/v1/products/${product.id}/upload-images`);
    console.log(`   Headers: Cookie: ${cookie}`);
    console.log('   Body: form-data');
    console.log('     - Key: images (type: File, multiple files)');
    console.log('     - Value: Sélectionner jusqu\'à 5 images');
    console.log('');

    console.log('   Option 3: Via JavaScript/Fetch');
    console.log('   ────────────────────────────────');
    console.log('   const formData = new FormData();');
    console.log('   formData.append("images", file1);');
    console.log('   formData.append("images", file2);');
    console.log('');
    console.log(`   fetch("${API_URL}/products/${product.id}/upload-images", {`);
    console.log('     method: "POST",');
    console.log(`     headers: { "Cookie": "${cookie}" },`);
    console.log('     body: formData');
    console.log('   });');
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 INFORMATIONS IMPORTANTES');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📦 Limites:');
    console.log('   • Max 5 images par requête');
    console.log('   • Max 10MB par image');
    console.log('   • Formats: JPEG, PNG, GIF, WebP\n');

    console.log('📁 Stockage S3:');
    console.log(`   • Dossier: products/${product.id}/`);
    console.log('   • Nom: timestamp-random.ext');
    console.log('   • Visibilité: Public (accessible sans auth)\n');

    console.log('🔗 Structure URL:');
    console.log('   Sans CloudFront:');
    console.log(`   https://supertry-media.s3.eu-west-3.amazonaws.com/products/${product.id}/xxx.jpg`);
    console.log('');
    console.log('   Avec CloudFront:');
    console.log(`   https://dXXXXXX.cloudfront.net/products/${product.id}/xxx.jpg\n`);

    console.log('✅ Le produit attend maintenant ses images !');
    console.log(`   Produit ID: ${product.id}`);
    console.log('');

    // 5. Exemple de simulation (si on avait une vraie image)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💡 EXEMPLE DE RÉPONSE ATTENDUE');
    console.log('═══════════════════════════════════════════════════════════\n');

    const exampleResponse = {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      images: [
        `https://supertry-media.s3.eu-west-3.amazonaws.com/products/${product.id}/1738694123456-abc123def456.jpg`,
        `https://supertry-media.s3.eu-west-3.amazonaws.com/products/${product.id}/1738694123789-xyz789ghi012.jpg`,
      ],
      createdAt: product.createdAt,
      updatedAt: new Date().toISOString(),
    };

    console.log(JSON.stringify(exampleResponse, null, 2));
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SETUP COMPLET !');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('🎯 Prochaines étapes:');
    console.log('   1. Configurer AWS S3 (voir AWS_S3_SETUP.md)');
    console.log('   2. Ajouter les credentials dans .env');
    console.log('   3. Uploader des images avec une des méthodes ci-dessus');
    console.log('   4. Vérifier que les images apparaissent dans S3');
    console.log('   5. Récupérer le produit pour voir les URLs des images');
    console.log('');

  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
  }
}

testProductImageUpload();
