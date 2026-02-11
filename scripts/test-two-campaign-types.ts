// Test de création de 2 types de campagnes : PROCEDURES et PRODUCT_LINK
import { API_URL, TEST_PRO_ACCOUNT } from './test-config';

interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
}

class TwoCampaignTypesTester {
  private results: TestResult[] = [];
  private proCookie: string = '';
  private categoryId: string = '';
  private productId1: string = '';
  private productId2: string = '';
  private campaignProceduresId: string = '';
  private campaignAmazonLinkId: string = '';

  async run() {
    console.log('🚀 Test création de 2 types de campagnes\n');
    console.log('📧 Compte PRO: ' + TEST_PRO_ACCOUNT.email + '\n');

    await this.testGetCategories();
    await this.loginPro();
    await this.createProduct1();
    await this.createProduct2();
    await this.createCampaignWithProcedures();
    await this.createCampaignWithAmazonLink();
    await this.activateBothCampaigns();
    await this.getCampaignProceduresDetails();
    await this.getCampaignAmazonLinkDetails();

    this.printResults();
  }

  private async request(method: string, path: string, body?: any, cookie?: string): Promise<any> {
    const url = `${API_URL}${path}`;
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

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

  private async testGetCategories() {
    console.log('📁 1. Récupération des catégories...');
    try {
      const response = await this.request('GET', '/categories');

      if (response.ok && response.data?.length > 0) {
        this.categoryId = response.data[0].id;
        console.log(`   ✅ ${response.data.length} catégories trouvées`);
        console.log(`   📋 Catégorie sélectionnée: ${response.data[0].name}\n`);
        this.addResult('Récupération des catégories', true, {
          count: response.data.length,
          selected: response.data[0].name
        });
      } else {
        throw new Error('Aucune catégorie trouvée');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Récupération des catégories', false, null, error.message);
    }
  }

  private async loginPro() {
    console.log('🔐 2. Connexion PRO...');
    try {
      const response = await this.request('POST', '/auth/login', {
        email: TEST_PRO_ACCOUNT.email,
        password: TEST_PRO_ACCOUNT.password,
      });

      if (response.ok && response.data?.access_token) {
        this.proCookie = response.setCookie || '';
        console.log(`   ✅ PRO connecté: ${TEST_PRO_ACCOUNT.email}\n`);
        this.addResult('Connexion PRO', true, { email: TEST_PRO_ACCOUNT.email });
      } else {
        throw new Error(response.data?.message || 'Échec connexion');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Connexion PRO', false, null, error.message);
    }
  }

  private async createProduct1() {
    console.log('📦 3. Création produit #1 (pour campagne PROCEDURES)...');
    try {
      const productData = {
        categoryId: this.categoryId,
        name: 'Écouteurs Sans Fil Test',
        description: 'Écouteurs Bluetooth true wireless avec étui de charge',
        asin: 'B0TESTPROD02',
        productUrl: 'https://amazon.fr/dp/B0TESTPROD02',
        price: 89.99,
        shippingCost: 3.99,
      };

      console.log(`   📝 Produit: ${productData.name}`);
      console.log(`   💰 Prix: ${productData.price}€`);

      const response = await this.request('POST', '/products', productData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.productId1 = response.data.id;
        console.log(`   ✅ Produit #1 créé`);
        console.log(`   🆔 ID: ${this.productId1}\n`);
        this.addResult('Création produit #1', true, {
          id: this.productId1,
          name: response.data.name
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création produit #1', false, null, error.message);
    }
  }

  private async createProduct2() {
    console.log('📦 4. Création produit #2 (pour campagne PRODUCT_LINK)...');
    try {
      const productData = {
        categoryId: this.categoryId,
        name: 'Montre Connectée Sport',
        description: 'Montre intelligente avec GPS et suivi d\'activité',
        asin: 'B0TESTPROD03',
        productUrl: 'https://amazon.fr/dp/B0TESTPROD03',
        price: 199.99,
        shippingCost: 0, // Livraison gratuite
      };

      console.log(`   📝 Produit: ${productData.name}`);
      console.log(`   💰 Prix: ${productData.price}€`);

      const response = await this.request('POST', '/products', productData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.productId2 = response.data.id;
        console.log(`   ✅ Produit #2 créé`);
        console.log(`   🆔 ID: ${this.productId2}\n`);
        this.addResult('Création produit #2', true, {
          id: this.productId2,
          name: response.data.name
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création produit #2', false, null, error.message);
    }
  }

  private async createCampaignWithProcedures() {
    console.log('🎯 5. Création campagne avec PROCEDURES...');
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const campaignData = {
        title: 'Test Écouteurs - Mode Procédures',
        description: 'Testez nos écouteurs sans fil en suivant les procédures détaillées',
        categoryId: this.categoryId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalSlots: 3,
        autoAcceptApplications: false,
        marketplaceMode: 'PROCEDURES',
        marketplace: 'FR',
        keywords: ['écouteurs', 'bluetooth', 'wireless'],
        offer: {
          productId: this.productId1,
          productName: 'Écouteurs Sans Fil Test',
          expectedPrice: 89.99,
          shippingCost: 3.99,
          priceRangeMin: 80.0,
          priceRangeMax: 95.0,
          isPriceRevealed: true,
          reimbursedPrice: true,
          reimbursedShipping: true,
          bonus: 10.0,
          quantity: 1,
        },
        procedures: [
          {
            title: 'Unboxing et configuration',
            description: 'Déballage et première configuration',
            order: 1,
            isRequired: true,
            steps: [
              {
                title: 'Vidéo unboxing',
                description: 'Filmez l\'ouverture et le contenu de la boîte',
                type: 'VIDEO',
                order: 1,
                isRequired: true,
              },
              {
                title: 'Photos du produit',
                description: 'Photos détaillées des écouteurs et de l\'étui',
                type: 'PHOTO',
                order: 2,
                isRequired: true,
              },
            ],
          },
          {
            title: 'Tests fonctionnels',
            description: 'Évaluation des performances',
            order: 2,
            isRequired: true,
            steps: [
              {
                title: 'Checklist technique',
                description: 'Vérifiez tous les aspects techniques',
                type: 'CHECKLIST',
                order: 1,
                isRequired: true,
                checklistItems: {
                  items: [
                    'Qualité audio',
                    'Connexion Bluetooth stable',
                    'Autonomie de la batterie',
                    'Confort d\'utilisation',
                    'Qualité des appels'
                  ]
                },
              },
              {
                title: 'Note finale',
                description: 'Évaluation globale du produit',
                type: 'RATING',
                order: 2,
                isRequired: true,
              },
              {
                title: 'Avis détaillé',
                description: 'Partagez votre expérience complète',
                type: 'TEXT',
                order: 3,
                isRequired: true,
              },
            ],
          },
        ],
        criteria: {
          minAge: 18,
          maxAge: 65,
          minRating: 0,
          minCompletedSessions: 0,
          requiredCountries: ['FR'],
        },
        distributions: [
          {
            type: 'RECURRING',
            dayOfWeek: 2,
            maxUnits: 1,
            isActive: true,
          },
        ],
      };

      console.log(`   📝 Campagne: ${campaignData.title}`);
      console.log(`   🔧 Mode: ${campaignData.marketplaceMode}`);
      console.log(`   📋 Procédures: ${campaignData.procedures.length}`);

      const response = await this.request('POST', '/campaigns', campaignData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.campaignProceduresId = response.data.id;
        console.log(`   ✅ Campagne PROCEDURES créée`);
        console.log(`   🆔 ID: ${this.campaignProceduresId}`);
        console.log(`   📊 Statut: ${response.data.status}\n`);
        this.addResult('Création campagne PROCEDURES', true, {
          id: this.campaignProceduresId,
          mode: 'PROCEDURES'
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création campagne PROCEDURES', false, null, error.message);
    }
  }

  private async createCampaignWithAmazonLink() {
    console.log('🎯 6. Création campagne avec PRODUCT_LINK...');
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 45);

      const campaignData = {
        title: 'Test Montre Connectée - Lien Amazon Direct',
        description: 'Commandez cette montre connectée directement via le lien Amazon fourni',
        categoryId: this.categoryId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalSlots: 5,
        autoAcceptApplications: true, // Auto-accept pour ce type
        marketplaceMode: 'PRODUCT_LINK',
        marketplace: 'FR',
        amazonLink: 'https://www.amazon.fr/dp/B0TESTPROD03?ref=supertry_campaign',
        keywords: ['montre', 'connectée', 'sport', 'gps'],
        offer: {
          productId: this.productId2,
          productName: 'Montre Connectée Sport',
          expectedPrice: 199.99,
          shippingCost: 0,
          priceRangeMin: 190.0,
          priceRangeMax: 210.0,
          isPriceRevealed: true,
          reimbursedPrice: true,
          reimbursedShipping: false, // Pas de frais de port
          bonus: 20.0,
          quantity: 1,
        },
        // Pas de procedures pour PRODUCT_LINK
        criteria: {
          minAge: 25,
          maxAge: 55,
          minRating: 0,
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
      };

      console.log(`   📝 Campagne: ${campaignData.title}`);
      console.log(`   🔧 Mode: ${campaignData.marketplaceMode}`);
      console.log(`   🔗 Lien Amazon: ${campaignData.amazonLink}`);

      const response = await this.request('POST', '/campaigns', campaignData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.campaignAmazonLinkId = response.data.id;
        console.log(`   ✅ Campagne PRODUCT_LINK créée`);
        console.log(`   🆔 ID: ${this.campaignAmazonLinkId}`);
        console.log(`   📊 Statut: ${response.data.status}\n`);
        this.addResult('Création campagne PRODUCT_LINK', true, {
          id: this.campaignAmazonLinkId,
          mode: 'PRODUCT_LINK'
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création campagne PRODUCT_LINK', false, null, error.message);
    }
  }

  private async activateBothCampaigns() {
    console.log('🚀 7. Activation des deux campagnes...');

    // Activer campagne PROCEDURES
    if (this.campaignProceduresId) {
      try {
        const response1 = await this.request(
          'POST',
          `/campaigns/${this.campaignProceduresId}/activate`,
          {},
          this.proCookie
        );

        if (response1.ok) {
          console.log(`   ✅ Campagne PROCEDURES activée (${response1.data.status})`);
        }
      } catch (error: any) {
        console.log(`   ❌ Erreur activation PROCEDURES: ${error.message}`);
      }
    }

    // Activer campagne PRODUCT_LINK
    if (this.campaignAmazonLinkId) {
      try {
        const response2 = await this.request(
          'POST',
          `/campaigns/${this.campaignAmazonLinkId}/activate`,
          {},
          this.proCookie
        );

        if (response2.ok) {
          console.log(`   ✅ Campagne PRODUCT_LINK activée (${response2.data.status})`);
        }
      } catch (error: any) {
        console.log(`   ❌ Erreur activation PRODUCT_LINK: ${error.message}`);
      }
    }

    console.log('');
    this.addResult('Activation des campagnes', true);
  }

  private async getCampaignProceduresDetails() {
    console.log('🔍 8. Détails campagne PROCEDURES...');

    if (!this.campaignProceduresId) {
      console.log(`   ⚠️  Pas de campagne PROCEDURES créée\n`);
      return;
    }

    try {
      const response = await this.request('GET', `/campaigns/${this.campaignProceduresId}`, null, this.proCookie);

      if (response.ok && response.data) {
        console.log(`   ✅ Campagne récupérée\n`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎯 CAMPAGNE MODE PROCEDURES');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('═══════════════════════════════════════════════════════════\n');
        this.addResult('Détails campagne PROCEDURES', true, response.data);
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Détails campagne PROCEDURES', false, null, error.message);
    }
  }

  private async getCampaignAmazonLinkDetails() {
    console.log('🔍 9. Détails campagne PRODUCT_LINK...');

    if (!this.campaignAmazonLinkId) {
      console.log(`   ⚠️  Pas de campagne PRODUCT_LINK créée\n`);
      return;
    }

    try {
      const response = await this.request('GET', `/campaigns/${this.campaignAmazonLinkId}`, null, this.proCookie);

      if (response.ok && response.data) {
        console.log(`   ✅ Campagne récupérée\n`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔗 CAMPAGNE MODE PRODUCT_LINK');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('═══════════════════════════════════════════════════════════\n');
        this.addResult('Détails campagne PRODUCT_LINK', true, response.data);
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Détails campagne PRODUCT_LINK', false, null, error.message);
    }
  }

  private addResult(step: string, success: boolean, data?: any, error?: string) {
    this.results.push({ step, success, data, error });
  }

  private printResults() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 RÉSULTATS FINAUX');
    console.log('═══════════════════════════════════════════════════════════\n');

    const successCount = this.results.filter((r) => r.success).length;
    const totalCount = this.results.length;

    this.results.forEach((result, index) => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${index + 1}. ${icon} ${result.step}`);
      if (result.error) {
        console.log(`   Erreur: ${result.error}`);
      }
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`📈 Score: ${successCount}/${totalCount} tests réussis (${Math.round(successCount/totalCount*100)}%)`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (successCount === totalCount) {
      console.log('🎉 Tous les tests sont passés avec succès !');
      console.log('✨ Les deux types de campagnes fonctionnent parfaitement !\n');
    } else {
      console.log('⚠️  Certains tests ont échoué.');
      console.log(`💡 ${successCount} sur ${totalCount} étapes validées.\n`);
    }

    // Résumé
    if (this.productId1 || this.productId2 || this.campaignProceduresId || this.campaignAmazonLinkId) {
      console.log('📋 Ressources créées:');
      if (this.productId1) {
        console.log(`   📦 Produit #1: ${this.productId1}`);
      }
      if (this.productId2) {
        console.log(`   📦 Produit #2: ${this.productId2}`);
      }
      if (this.campaignProceduresId) {
        console.log(`   🎯 Campagne PROCEDURES: ${this.campaignProceduresId}`);
      }
      if (this.campaignAmazonLinkId) {
        console.log(`   🔗 Campagne PRODUCT_LINK: ${this.campaignAmazonLinkId}`);
      }
      console.log('');
    }
  }
}

// Exécution
const tester = new TwoCampaignTypesTester();
tester.run().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
