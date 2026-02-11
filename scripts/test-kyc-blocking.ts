import { readFileSync } from 'fs';

// Lire le .env
const envContent = readFileSync('.env', 'utf-8');
const envVars = envContent.split('\n').reduce((acc, line) => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    acc[key.trim()] = valueParts.join('=').trim();
  }
  return acc;
}, {} as Record<string, string>);

const API_URL = 'http://localhost:3000/api/v1';
let testerCookie = '';

async function request(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_URL}${path}`;
  const headers: any = {
    'Content-Type': 'application/json',
  };

  if (testerCookie) {
    headers['Cookie'] = testerCookie;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const setCookie = response.headers.get('set-cookie');

  if (setCookie) {
    testerCookie = setCookie;
  }

  const data = await response.json();

  if (!response.ok) {
    throw data;
  }

  return data;
}

async function testKycBlocking() {
  console.log('\n🧪 Test: KYC bloque les candidatures\n');

  // 1. Créer un nouveau TESTEUR
  console.log('=== 1. Création nouveau TESTEUR ===');
  const email = `testeur-kyc-${Date.now()}@example.com`;
  console.log(`Email: ${email}`);

  try {
    await request('POST', '/auth/signup', {
      email,
      password: 'Test1234!',
      role: 'USER',
      firstName: 'Test',
      lastName: 'KYC',
      country: 'FR',
    });
    console.log('✅ TESTEUR créé\n');
  } catch (error: any) {
    console.error('❌ Erreur création:', error.message);
    process.exit(1);
  }

  // 2. Récupérer une campagne active
  console.log('=== 2. Récupération campagnes actives ===');
  let campaignId = '';
  try {
    const campaigns = await request('GET', '/campaigns?status=ACTIVE&page=1&limit=1');
    if (campaigns.items && campaigns.items.length > 0) {
      campaignId = campaigns.items[0].id;
      console.log(`✅ Campagne trouvée: ${campaignId}\n`);
    } else {
      console.log('⚠️  Aucune campagne active trouvée');
      console.log('   Crée une campagne active d\'abord\n');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('❌ Erreur récupération campagnes:', error.message);
    process.exit(1);
  }

  // 3. Tenter de postuler SANS KYC (doit échouer)
  console.log('=== 3. Tentative de candidature SANS KYC ===');
  try {
    await request('POST', `/test-sessions/apply/${campaignId}`, {
      motivation: 'Je veux tester ce produit',
    });

    console.log('❌ ERREUR: La candidature a réussi alors que le KYC n\'est pas complété !');
    console.log('   Le TESTEUR devrait être bloqué jusqu\'à ce qu\'il complète son KYC\n');
    process.exit(1);
  } catch (error: any) {
    if (error.message === 'Complete KYC to apply to campaigns' && error.kycRequired === true) {
      console.log('✅ Candidature bloquée comme prévu !');
      console.log(`   Message: "${error.message}"`);
      console.log(`   KYC Required: ${error.kycRequired}`);

      if (error.onboardingUrl) {
        console.log(`   Onboarding URL: ${error.onboardingUrl.substring(0, 50)}...`);
      }

      console.log('\n🎉 Le KYC bloque bien les candidatures sans vérification !');
      process.exit(0);
    } else {
      console.log('❌ Erreur inattendue:', error.message);
      console.log('   Details:', JSON.stringify(error, null, 2));
      process.exit(1);
    }
  }
}

testKycBlocking().catch((err) => {
  console.error('❌ Erreur globale:', err.message);
  process.exit(1);
});
