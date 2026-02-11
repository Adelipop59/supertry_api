// Script de nettoyage des données de test via l'API

interface CleanupResult {
  action: string;
  success: boolean;
  details?: any;
  error?: string;
}

class TestDataCleaner {
  private results: CleanupResult[] = [];
  private API_URL = 'http://localhost:3000/api/v1';
  private proCookie: string = '';
  private proProfiles: any[] = [];
  private userProfiles: any[] = [];

  async run() {
    console.log('🧹 Démarrage du nettoyage des données de test\n');

    await this.loginAsTestPro();
    await this.deleteTestProducts();
    await this.deleteTestCampaigns();
    await this.logoutPro();
    await this.deleteTestProfiles();

    this.printResults();
  }

  private async request(method: string, path: string, body?: any, cookie?: string): Promise<any> {
    const url = `${this.API_URL}${path}`;
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      let data;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      const setCookie = response.headers.get('set-cookie');

      return {
        ok: response.ok,
        status: response.status,
        data,
        setCookie
      };
    } catch (error: any) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: error.message
      };
    }
  }

  private async loginAsTestPro() {
    console.log('🔐 Tentative de connexion avec un compte PRO de test...');

    // On essaie de se connecter avec un email de test connu
    const testEmail = 'pro.test.cleanup@test.com';

    // D'abord on crée le compte si besoin
    const signupResp = await this.request('POST', '/auth/signup', {
      email: testEmail,
      password: 'testpass123',
      role: 'PRO',
      firstName: 'Cleanup',
      lastName: 'User',
      phone: '+33612345678',
      companyName: 'Cleanup Co',
      siret: '12345678901234',
      countries: ['FR'],
    });

    if (signupResp.ok) {
      this.proCookie = signupResp.setCookie || '';
      console.log('✅ Compte PRO de nettoyage créé');
      this.addResult('Créer compte PRO de nettoyage', true, { email: testEmail });
    } else {
      // Si le compte existe déjà, on se connecte
      const loginResp = await this.request('POST', '/auth/login', {
        email: testEmail,
        password: 'testpass123',
      });

      if (loginResp.ok) {
        this.proCookie = loginResp.setCookie || '';
        console.log('✅ Connecté avec compte PRO de nettoyage');
        this.addResult('Connexion compte PRO de nettoyage', true, { email: testEmail });
      } else {
        console.log('❌ Impossible de se connecter');
        this.addResult('Connexion compte PRO de nettoyage', false, null, 'Échec connexion');
      }
    }
  }

  private async deleteTestProducts() {
    console.log('\n📦 Suppression des produits de test...');

    // Récupérer tous les produits
    const response = await this.request('GET', '/products?limit=100');

    if (!response.ok) {
      console.log('❌ Impossible de récupérer les produits');
      this.addResult('Récupération des produits', false, null, response.data?.message);
      return;
    }

    const products = response.data?.data || response.data || [];
    console.log(`📋 ${products.length} produits trouvés au total`);

    // Filtrer les produits de test
    const testProducts = products.filter((p: any) =>
      p.name?.includes('Test') ||
      p.name?.includes('test') ||
      p.asin?.includes('TEST')
    );

    console.log(`🎯 ${testProducts.length} produits de test identifiés`);

    if (testProducts.length === 0) {
      console.log('✅ Aucun produit de test à supprimer');
      this.addResult('Suppression des produits de test', true, { count: 0 });
      return;
    }

    let deleted = 0;
    let failed = 0;

    for (const product of testProducts) {
      console.log(`  🗑️  Suppression: ${product.name} (${product.id})`);

      const delResp = await this.request('DELETE', `/products/${product.id}`, null, this.proCookie);

      if (delResp.ok || delResp.status === 204) {
        console.log(`    ✅ Supprimé`);
        deleted++;
      } else {
        console.log(`    ❌ Échec: ${delResp.data?.message || 'Erreur inconnue'}`);
        failed++;
      }
    }

    console.log(`\n📊 Produits: ${deleted} supprimés, ${failed} échoués`);
    this.addResult('Suppression des produits de test', failed === 0, {
      total: testProducts.length,
      deleted,
      failed
    });
  }

  private async deleteTestCampaigns() {
    console.log('\n🎯 Suppression des campagnes de test...');

    // Récupérer toutes les campagnes
    const response = await this.request('GET', '/campaigns?limit=100');

    if (!response.ok) {
      console.log('❌ Impossible de récupérer les campagnes');
      this.addResult('Récupération des campagnes', false, null, response.data?.message);
      return;
    }

    const campaigns = response.data?.data || response.data || [];
    console.log(`📋 ${campaigns.length} campagnes trouvées au total`);

    // Filtrer les campagnes de test
    const testCampaigns = campaigns.filter((c: any) =>
      c.title?.includes('Test') ||
      c.title?.includes('test') ||
      c.title?.includes('Campagne Test')
    );

    console.log(`🎯 ${testCampaigns.length} campagnes de test identifiées`);

    if (testCampaigns.length === 0) {
      console.log('✅ Aucune campagne de test à supprimer');
      this.addResult('Suppression des campagnes de test', true, { count: 0 });
      return;
    }

    let deleted = 0;
    let failed = 0;

    for (const campaign of testCampaigns) {
      console.log(`  🗑️  Suppression: ${campaign.title} (${campaign.id})`);

      const delResp = await this.request('DELETE', `/campaigns/${campaign.id}`, null, this.proCookie);

      if (delResp.ok || delResp.status === 204) {
        console.log(`    ✅ Supprimé`);
        deleted++;
      } else {
        console.log(`    ❌ Échec: ${delResp.data?.message || 'Erreur inconnue'}`);
        failed++;
      }
    }

    console.log(`\n📊 Campagnes: ${deleted} supprimées, ${failed} échouées`);
    this.addResult('Suppression des campagnes de test', failed === 0, {
      total: testCampaigns.length,
      deleted,
      failed
    });
  }

  private async logoutPro() {
    console.log('\n🚪 Déconnexion du compte PRO...');

    const response = await this.request('POST', '/auth/logout', null, this.proCookie);

    if (response.ok) {
      console.log('✅ Déconnecté');
      this.addResult('Déconnexion PRO', true);
    } else {
      console.log('⚠️  Échec déconnexion (pas grave)');
      this.addResult('Déconnexion PRO', false, null, 'Non critique');
    }
  }

  private async deleteTestProfiles() {
    console.log('\n👤 Suppression des profils de test...');
    console.log('⚠️  Note: La suppression de profils via API nécessite des permissions ADMIN');
    console.log('   Les profils de test restants devront être supprimés manuellement en base\n');

    // Liste des emails de test à supprimer (si l'API le permet)
    const testEmails = [
      'pro.test.cleanup@test.com',
      // On pourrait lister d'autres emails connus ici
    ];

    console.log(`📋 ${testEmails.length} profils de test à nettoyer`);

    // Note: Il faudrait une route API pour supprimer les profils
    // Pour l'instant on log juste ce qui devrait être fait
    this.addResult('Suppression des profils de test', false, null,
      'Nécessite accès direct à la base de données ou API admin');
  }

  private addResult(action: string, success: boolean, details?: any, error?: string) {
    this.results.push({ action, success, details, error });
  }

  private printResults() {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('📊 RÉSULTATS DU NETTOYAGE');
    console.log('═══════════════════════════════════════════════════════════\n');

    const successCount = this.results.filter((r) => r.success).length;
    const totalCount = this.results.length;

    this.results.forEach((result, index) => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${index + 1}. ${icon} ${result.action}`);
      if (result.details) {
        console.log(`   Détails:`, JSON.stringify(result.details, null, 2));
      }
      if (result.error) {
        console.log(`   Erreur: ${result.error}`);
      }
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📈 Score: ${successCount}/${totalCount} actions réussies`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (successCount === totalCount) {
      console.log('🎉 Nettoyage terminé avec succès !');
    } else {
      console.log('⚠️  Nettoyage terminé avec quelques erreurs.');
    }

    console.log('\n💡 Pour supprimer les profils de test restants en base:');
    console.log('   npx prisma studio');
    console.log('   Ou via SQL: DELETE FROM profiles WHERE email LIKE \'%test%\';');
  }
}

// Exécution
const cleaner = new TestDataCleaner();
cleaner.run().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
