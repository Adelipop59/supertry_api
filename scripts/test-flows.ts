interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
}

class FlowTester {
  private results: TestResult[] = [];
  private proCookie: string = '';
  private userCookie: string = '';
  private proProfile: any = null;
  private userProfile: any = null;
  private categoryId: string = '';
  private productId: string = '';
  private campaignId: string = '';
  private API_URL = 'http://localhost:3000/api/v1';

  async run() {
    console.log('🚀 Démarrage des tests de flow\n');

    await this.testGetCategories();
    await this.testProSignup();
    await this.testProLogin();
    await this.testCreateProduct();
    await this.testCreateCampaign();
    await this.testUserSignup();
    await this.testUserLogin();
    await this.testGetCampaigns();

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

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    // Extract cookies from response
    const setCookie = response.headers.get('set-cookie');

    return { data, setCookie };
  }

  private async testGetCategories() {
    try {
      console.log('📁 Test: Récupération des catégories...');
      const { data } = await this.request('GET', '/categories');

      if (data && data.length > 0) {
        this.categoryId = data[0].id;
        this.addResult('Récupération des catégories', true, { count: data.length, firstCategory: data[0].name });
        console.log(`✅ ${data.length} catégories trouvées`);
      } else {
        throw new Error('Aucune catégorie trouvée');
      }
    } catch (error: any) {
      this.addResult('Récupération des catégories', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testProSignup() {
    try {
      console.log('\n👔 Test: Inscription PRO...');
      const { data, setCookie } = await this.request('POST', '/auth/signup', {
        email: `pro.test.${Date.now()}@test.com`,
        password: 'testpass123',
        role: 'PRO',
        firstName: 'Jean',
        lastName: 'Vendeur',
        phone: '+33612345678',
        companyName: 'SuperSeller SARL',
        siret: '12345678901234',
        countries: ['FR'],
      });

      if (data.access_token && data.profile) {
        this.proCookie = setCookie || '';
        this.proProfile = data.profile;
        this.addResult('Inscription PRO', true, { email: this.proProfile.email, role: this.proProfile.role });
        console.log('✅ PRO inscrit:', this.proProfile.email);
      } else {
        throw new Error('Réponse invalide');
      }
    } catch (error: any) {
      this.addResult('Inscription PRO', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testProLogin() {
    try {
      console.log('\n🔐 Test: Connexion PRO...');
      const { data, setCookie } = await this.request('POST', '/auth/login', {
        email: this.proProfile.email,
        password: 'testpass123',
      });

      if (data.access_token) {
        this.proCookie = setCookie || this.proCookie;
        this.addResult('Connexion PRO', true, { email: data.profile.email });
        console.log('✅ PRO connecté');
      } else {
        throw new Error('Token manquant');
      }
    } catch (error: any) {
      this.addResult('Connexion PRO', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testCreateProduct() {
    try {
      console.log('\n📦 Test: Création de produit...');
      const { data } = await this.request('POST', '/products', {
        categoryId: this.categoryId,
        name: 'Smartphone Test Pro Max',
        description: 'Un smartphone de test incroyable avec toutes les fonctionnalités',
        asin: 'B0TEST1234',
        productUrl: 'https://amazon.fr/dp/B0TEST1234',
        price: 299.99,
        shippingCost: 5.99,
        images: [
          { url: 'https://example.com/image1.jpg', order: 1, isPrimary: true },
        ],
      }, this.proCookie);

      if (data && data.id) {
        this.productId = data.id;
        this.addResult('Création de produit', true, { productId: this.productId, name: data.name });
        console.log('✅ Produit créé:', data.name);
      } else {
        throw new Error('ID produit manquant');
      }
    } catch (error: any) {
      this.addResult('Création de produit', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testCreateCampaign() {
    try {
      console.log('\n🎯 Test: Création de campagne...');
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const { data } = await this.request('POST', '/campaigns', {
        title: 'Campagne Test Smartphone',
        description: 'Testez notre nouveau smartphone et donnez votre avis !',
        categoryId: this.categoryId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalSlots: 10,
        autoAcceptApplications: false,
        marketplaceMode: 'PROCEDURES',
        marketplace: 'FR',
        keywords: ['smartphone', 'tech', 'android'],
        offer: {
          productId: this.productId,
          expectedPrice: 299.99,
          shippingCost: 5.99,
          priceRangeMin: 280.0,
          priceRangeMax: 320.0,
          isPriceRevealed: false,
          reimbursedPrice: true,
          reimbursedShipping: true,
          bonus: 10.0,
          quantity: 1,
        },
        procedures: [
          {
            title: 'Déballage du produit',
            description: 'Filmez le déballage complet du smartphone',
            order: 1,
            isRequired: true,
            steps: [
              {
                title: 'Vidéo de déballage',
                description: 'Filmez l\'ouverture du colis et du produit',
                type: 'VIDEO',
                order: 1,
                isRequired: true,
              },
            ],
          },
          {
            title: 'Test des fonctionnalités',
            description: 'Testez toutes les fonctionnalités du smartphone',
            order: 2,
            isRequired: true,
            steps: [
              {
                title: 'Checklist des tests',
                description: 'Vérifiez tous les points',
                type: 'CHECKLIST',
                order: 1,
                isRequired: true,
                checklistItems: ['Qualité photo', 'Autonomie', 'Performance', 'Son'],
              },
            ],
          },
        ],
        criteria: {
          minAge: 18,
          maxAge: 65,
          minRating: 4.0,
          minCompletedSessions: 0,
          requiredCountries: ['FR'],
        },
        distributions: [
          {
            type: 'RECURRING',
            dayOfWeek: 1,
            maxUnits: 2,
            isActive: true,
          },
          {
            type: 'RECURRING',
            dayOfWeek: 4,
            maxUnits: 2,
            isActive: true,
          },
        ],
      }, this.proCookie);

      if (data && data.id) {
        this.campaignId = data.id;
        this.addResult('Création de campagne', true, { campaignId: this.campaignId, title: data.title });
        console.log('✅ Campagne créée:', data.title);
      } else {
        throw new Error('ID campagne manquant');
      }
    } catch (error: any) {
      this.addResult('Création de campagne', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testUserSignup() {
    try {
      console.log('\n👤 Test: Inscription TESTEUR...');
      const { data, setCookie } = await this.request('POST', '/auth/signup', {
        email: `testeur.${Date.now()}@test.com`,
        password: 'testpass123',
        role: 'USER',
        country: 'FR',
      });

      if (data.access_token && data.profile) {
        this.userCookie = setCookie || '';
        this.userProfile = data.profile;
        this.addResult('Inscription TESTEUR', true, { email: this.userProfile.email, role: this.userProfile.role });
        console.log('✅ TESTEUR inscrit:', this.userProfile.email);
      } else {
        throw new Error('Réponse invalide');
      }
    } catch (error: any) {
      this.addResult('Inscription TESTEUR', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testUserLogin() {
    try {
      console.log('\n🔐 Test: Connexion TESTEUR...');
      const { data, setCookie } = await this.request('POST', '/auth/login', {
        email: this.userProfile.email,
        password: 'testpass123',
      });

      if (data.access_token) {
        this.userCookie = setCookie || this.userCookie;
        this.addResult('Connexion TESTEUR', true, { email: data.profile.email });
        console.log('✅ TESTEUR connecté');
      } else {
        throw new Error('Token manquant');
      }
    } catch (error: any) {
      this.addResult('Connexion TESTEUR', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private async testGetCampaigns() {
    try {
      console.log('\n📋 Test: Liste des campagnes...');
      const { data } = await this.request('GET', '/campaigns');

      if (data) {
        this.addResult('Liste des campagnes', true, { count: data.total || data.length });
        console.log('✅ Campagnes récupérées');
      } else {
        throw new Error('Réponse invalide');
      }
    } catch (error: any) {
      this.addResult('Liste des campagnes', false, null, error.message);
      console.log('❌ Erreur:', error.message);
    }
  }

  private addResult(step: string, success: boolean, data?: any, error?: string) {
    this.results.push({ step, success, data, error });
  }

  private printResults() {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('📊 RÉSULTATS DES TESTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const successCount = this.results.filter((r) => r.success).length;
    const totalCount = this.results.length;

    this.results.forEach((result, index) => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${index + 1}. ${icon} ${result.step}`);
      if (result.data) {
        console.log(`   Données:`, JSON.stringify(result.data, null, 2));
      }
      if (result.error) {
        console.log(`   Erreur: ${result.error}`);
      }
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📈 Score: ${successCount}/${totalCount} tests réussis`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (successCount === totalCount) {
      console.log('🎉 Tous les tests sont passés avec succès !');
    } else {
      console.log('⚠️  Certains tests ont échoué, vérifiez les erreurs ci-dessus.');
    }
  }
}

// Exécution
const tester = new FlowTester();
tester.run().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
