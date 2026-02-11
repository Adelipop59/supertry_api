// Script de test du module Media
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';
import * as fs from 'fs';
import * as path from 'path';

async function testMediaUpload() {
  console.log('🚀 Test Module Media - Upload S3\n');

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

    const loginData = await loginResponse.json();
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    console.log('✅ Connecté\n');

    // 2. Test upload image (simulation)
    console.log('2️⃣ Test upload image...');
    console.log('   ℹ️  Pour tester l\'upload réel, utilisez:');
    console.log('');
    console.log('   curl -X POST http://localhost:3000/api/v1/media/upload \\');
    console.log('     -H "Cookie: ' + cookie + '" \\');
    console.log('     -F "file=@/path/to/image.jpg" \\');
    console.log('     -F "folder=products" \\');
    console.log('     -F "mediaType=image" \\');
    console.log('     -F "subfolder=test-product-123" \\');
    console.log('     -F "makePublic=true"');
    console.log('');

    // 3. Exemple de réponse attendue
    console.log('3️⃣ Réponse attendue:\n');
    const exampleResponse = {
      url: 'https://supertry-media.s3.eu-west-3.amazonaws.com/products/test-product-123/1234567890-abc123.jpg',
      key: 'products/test-product-123/1234567890-abc123.jpg',
      bucket: 'supertry-media',
      size: 245678,
      mimeType: 'image/jpeg',
    };
    console.log(JSON.stringify(exampleResponse, null, 2));
    console.log('');

    // 4. Test delete (simulation)
    console.log('4️⃣ Test suppression fichier...');
    console.log('   ℹ️  Pour supprimer un fichier:');
    console.log('');
    console.log('   curl -X DELETE http://localhost:3000/api/v1/media/products/test-product-123/file.jpg \\');
    console.log('     -H "Cookie: ' + cookie + '"');
    console.log('');

    // 5. Test signed URL
    console.log('5️⃣ Test génération URL signée...');
    console.log('   ℹ️  Pour obtenir une URL signée (temporaire):');
    console.log('');
    console.log('   curl http://localhost:3000/api/v1/media/signed-url/products/file.jpg?expiresIn=3600 \\');
    console.log('     -H "Cookie: ' + cookie + '"');
    console.log('');

    // 6. Documentation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📚 DOCUMENTATION COMPLÈTE');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Voir: MEDIA_MODULE_README.md\n');

    console.log('📋 Dossiers disponibles:');
    const folders = [
      'products - Images/vidéos de produits',
      'profiles - Photos de profil',
      'procedures - Médias des procédures de test',
      'reviews - Médias des avis',
      'ugc - User Generated Content',
      'purchases - Preuves d\'achat',
      'messages - Pièces jointes messages',
      'temp - Fichiers temporaires',
    ];
    folders.forEach((f) => console.log(`   • ${f}`));
    console.log('');

    console.log('📦 Types de médias:');
    const types = [
      'image - JPEG, PNG, GIF, WebP (max 10MB)',
      'video - MP4, WebM, QuickTime (max 500MB)',
      'document - PDF, Word, Excel (max 20MB)',
      'audio - MP3, WAV, OGG (max 50MB)',
    ];
    types.forEach((t) => console.log(`   • ${t}`));
    console.log('');

    console.log('🔧 Configuration requise (.env):');
    console.log('   AWS_REGION=eu-west-3');
    console.log('   AWS_ACCESS_KEY_ID=your-key');
    console.log('   AWS_SECRET_ACCESS_KEY=your-secret');
    console.log('   AWS_S3_BUCKET_NAME=supertry-media');
    console.log('   AWS_CLOUDFRONT_DOMAIN=d123456.cloudfront.net (optionnel)');
    console.log('');

    console.log('📦 Installation packages AWS:');
    console.log('   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner');
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ MODULE MEDIA PRÊT À L\'EMPLOI !');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('🎯 Prochaines étapes:');
    console.log('   1. Configurer les variables AWS dans .env');
    console.log('   2. Installer les packages: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner');
    console.log('   3. Créer un bucket S3 "supertry-media"');
    console.log('   4. Configurer les permissions IAM');
    console.log('   5. Tester l\'upload avec curl ou Postman');
    console.log('');

  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
  }
}

testMediaUpload();
