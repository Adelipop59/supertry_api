// Script pour créer des comptes de test fixes

const API_URL = 'http://localhost:3000/api/v1';

async function createTestAccounts() {
  console.log('🔧 Création des comptes de test fixes\n');

  // Compte PRO fixe
  const PRO_ACCOUNT = {
    email: 'pro.vendor@test.com',
    password: 'TestPass123!',
    role: 'PRO',
    firstName: 'Marc',
    lastName: 'Vendeur',
    phone: '+33612345678',
    companyName: 'TestShop SARL',
    siret: '12345678901234',
    countries: ['FR'],
  };

  // Compte USER fixe
  const USER_ACCOUNT = {
    email: 'user.tester@test.com',
    password: 'TestPass123!',
    role: 'USER',
    country: 'FR',
  };

  try {
    // Créer le PRO
    console.log('👔 Création du compte PRO...');
    const proResponse = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PRO_ACCOUNT),
    });

    if (proResponse.ok) {
      const proData = await proResponse.json();
      console.log('✅ Compte PRO créé:', proData.profile.email);
    } else {
      const error = await proResponse.json();
      if (error.message?.includes('existe déjà')) {
        console.log('⚠️  Compte PRO existe déjà');
      } else {
        console.log('❌ Erreur PRO:', error.message);
      }
    }

    // Créer le USER
    console.log('\n👤 Création du compte TESTEUR...');
    const userResponse = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USER_ACCOUNT),
    });

    if (userResponse.ok) {
      const userData = await userResponse.json();
      console.log('✅ Compte TESTEUR créé:', userData.profile.email);
    } else {
      const error = await userResponse.json();
      if (error.message?.includes('existe déjà')) {
        console.log('⚠️  Compte TESTEUR existe déjà');
      } else {
        console.log('❌ Erreur USER:', error.message);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📝 COMPTES DE TEST DISPONIBLES');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('👔 PRO:');
    console.log(`   Email: ${PRO_ACCOUNT.email}`);
    console.log(`   Password: ${PRO_ACCOUNT.password}`);
    console.log(`   Entreprise: ${PRO_ACCOUNT.companyName}\n`);
    console.log('👤 TESTEUR:');
    console.log(`   Email: ${USER_ACCOUNT.email}`);
    console.log(`   Password: ${USER_ACCOUNT.password}\n`);
    console.log('💡 Utilisez ces identifiants dans vos tests');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error: any) {
    console.error('❌ Erreur fatale:', error.message);
    process.exit(1);
  }
}

createTestAccounts();
