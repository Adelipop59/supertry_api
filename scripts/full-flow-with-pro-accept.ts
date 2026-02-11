// Test complet du flow avec acceptation manuelle par le PRO
import { API_URL, TEST_PRO_ACCOUNT, TEST_USER_ACCOUNT } from './test-config';

interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
}

class FullFlowWithProAcceptTester {
  private results: TestResult[] = [];
  private proCookie: string = '';
  private userCookie: string = '';
  private categoryId: string = '';
  private productId: string = '';
  private campaignId: string = '';
  private sessionId: string = '';

  async run() {
    console.log('🚀 Test complet du flow SuperTry avec remboursement testeur\n');
    console.log('📧 Utilisation des comptes:');
    console.log(`   PRO: ${TEST_PRO_ACCOUNT.email}`);
    console.log(`   USER: ${TEST_USER_ACCOUNT.email}\n`);

    await this.testGetCategories();
    await this.loginPro();
    await this.createProduct();
    await this.createCampaign();
    await this.activateCampaign();
    await this.loginUser();
    await this.listCampaigns();
    await this.applyToCampaign();
    await this.loginProAgain();
    await this.acceptApplication();
    await this.validatePrice();
    await this.submitPurchase();
    await this.validatePurchase();
    await this.checkWalletAndRefund();
    await this.getSessionDetails();
    await this.getCampaignDetails();
    await this.getProductDetails();

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
        console.log(`   📋 Catégorie sélectionnée: ${response.data[0].name} (${this.categoryId})\n`);
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
        console.log(`   ✅ PRO connecté: ${TEST_PRO_ACCOUNT.email}`);
        console.log(`   🍪 Cookie de session obtenu\n`);
        this.addResult('Connexion PRO', true, { email: TEST_PRO_ACCOUNT.email });
      } else {
        throw new Error(response.data?.message || 'Échec connexion');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Connexion PRO', false, null, error.message);
    }
  }

  private async createProduct() {
    console.log('📦 3. Création d\'un produit...');
    try {
      const productData = {
        categoryId: this.categoryId,
        name: 'Casque Bluetooth Premium Test',
        description: 'Casque audio Bluetooth de haute qualité avec réduction de bruit active',
        asin: 'B0TESTPROD01',
        productUrl: 'https://amazon.fr/dp/B0TESTPROD01',
        price: 149.99,
        shippingCost: 4.99,
      };

      console.log(`   📝 Produit: ${productData.name}`);
      console.log(`   💰 Prix: ${productData.price}€`);

      const response = await this.request('POST', '/products', productData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.productId = response.data.id;
        console.log(`   ✅ Produit créé avec succès`);
        console.log(`   🆔 ID: ${this.productId}\n`);
        this.addResult('Création de produit', true, {
          id: this.productId,
          name: response.data.name,
          price: response.data.price
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création de produit', false, null, error.message);
    }
  }

  private async createCampaign() {
    console.log('🎯 4. Création d\'une campagne...');
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const campaignData = {
        title: 'Test Casque Bluetooth Premium',
        description: 'Testez notre nouveau casque Bluetooth avec réduction de bruit et donnez votre avis honnête !',
        categoryId: this.categoryId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalSlots: 5,
        autoAcceptApplications: false, // ⚠️ Acceptation manuelle
        marketplaceMode: 'PROCEDURES',
        keywords: ['casque', 'bluetooth', 'audio'],
        offer: {
          productId: this.productId,
          productName: 'Casque Bluetooth Premium Test',
          expectedPrice: 149.99,
          shippingCost: 4.99,
          priceRangeMin: 140.0,
          priceRangeMax: 160.0,
          isPriceRevealed: true,
          reimbursedPrice: true,
          reimbursedShipping: true,
          bonus: 15.0,
          quantity: 1,
        },
        procedures: [
          {
            title: 'Déballage et première impression',
            description: 'Filmez le déballage du produit',
            order: 1,
            isRequired: true,
            steps: [
              {
                title: 'Vidéo de déballage',
                description: 'Filmez l\'ouverture du colis et votre première impression',
                type: 'VIDEO',
                order: 1,
                isRequired: true,
              },
              {
                title: 'Photos du produit',
                description: 'Prenez des photos du casque sous différents angles',
                type: 'PHOTO',
                order: 2,
                isRequired: true,
              },
            ],
          },
          {
            title: 'Test des fonctionnalités',
            description: 'Testez toutes les fonctionnalités du casque',
            order: 2,
            isRequired: true,
            steps: [
              {
                title: 'Checklist des tests',
                description: 'Vérifiez tous les points',
                type: 'CHECKLIST',
                order: 1,
                isRequired: true,
                checklistItems: {
                  items: [
                    'Qualité audio',
                    'Réduction de bruit',
                    'Autonomie de la batterie',
                    'Confort d\'utilisation',
                    'Qualité du microphone'
                  ]
                },
              },
              {
                title: 'Note globale',
                description: 'Donnez une note globale au produit',
                type: 'RATING',
                order: 2,
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
            dayOfWeek: 1,
            maxUnits: 1,
            isActive: true,
          },
          {
            type: 'RECURRING',
            dayOfWeek: 3,
            maxUnits: 2,
            isActive: true,
          },
        ],
      };

      console.log(`   📝 Campagne: ${campaignData.title}`);
      console.log(`   🎁 Bonus: ${campaignData.offer.bonus}€`);
      console.log(`   👥 Places: ${campaignData.totalSlots}`);
      console.log(`   🔧 Auto-accept: ${campaignData.autoAcceptApplications ? 'OUI' : 'NON'}`);

      const response = await this.request('POST', '/campaigns', campaignData, this.proCookie);

      if (response.ok && response.data?.id) {
        this.campaignId = response.data.id;
        console.log(`   ✅ Campagne créée avec succès`);
        console.log(`   🆔 ID: ${this.campaignId}`);
        console.log(`   📊 Statut: ${response.data.status}\n`);
        this.addResult('Création de campagne', true, {
          id: this.campaignId,
          title: response.data.title,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Création de campagne', false, null, error.message);
    }
  }

  private async activateCampaign() {
    console.log('🚀 5. Activation de la campagne...');

    if (!this.campaignId) {
      console.log(`   ⚠️  Pas de campagne créée, skip\n`);
      this.addResult('Activation de la campagne', false, null, 'Pas de campagne disponible');
      return;
    }

    try {
      console.log(`   📝 Activation: ${this.campaignId}`);

      const response = await this.request(
        'POST',
        `/campaigns/${this.campaignId}/activate`,
        {},
        this.proCookie
      );

      if (response.ok && response.data?.id) {
        console.log(`   ✅ Campagne activée avec succès`);
        console.log(`   📊 Nouveau statut: ${response.data.status}\n`);
        this.addResult('Activation de la campagne', true, {
          id: this.campaignId,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Activation de la campagne', false, null, error.message);
    }
  }

  private async loginUser() {
    console.log('🔐 6. Connexion TESTEUR...');
    try {
      const response = await this.request('POST', '/auth/login', {
        email: TEST_USER_ACCOUNT.email,
        password: TEST_USER_ACCOUNT.password,
      });

      if (response.ok && response.data?.access_token) {
        this.userCookie = response.setCookie || '';
        console.log(`   ✅ TESTEUR connecté: ${TEST_USER_ACCOUNT.email}`);
        console.log(`   🍪 Cookie de session obtenu\n`);
        this.addResult('Connexion TESTEUR', true, { email: TEST_USER_ACCOUNT.email });
      } else {
        throw new Error(response.data?.message || 'Échec connexion');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Connexion TESTEUR', false, null, error.message);
    }
  }

  private async listCampaigns() {
    console.log('📋 7. Liste des campagnes disponibles...');
    try {
      const response = await this.request('GET', '/campaigns', null, this.userCookie);

      if (response.ok) {
        const campaigns = response.data?.data || response.data || [];
        console.log(`   ✅ ${campaigns.length} campagne(s) trouvée(s)`);

        if (campaigns.length > 0) {
          console.log(`   📋 Première campagne: ${campaigns[0].title}`);
        }
        console.log('');

        this.addResult('Liste des campagnes', true, { count: campaigns.length });
      } else {
        throw new Error(response.data?.message || 'Erreur récupération');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Liste des campagnes', false, null, error.message);
    }
  }

  private async applyToCampaign() {
    console.log('🙋 8. Candidature à la campagne...');

    if (!this.campaignId) {
      console.log(`   ⚠️  Pas de campagne créée, skip\n`);
      this.addResult('Candidature à la campagne', false, null, 'Pas de campagne disponible');
      return;
    }

    try {
      const applicationData = {
        applicationMessage: 'Je suis très intéressé par ce test ! J\'adore tester des produits audio et je donne toujours des avis honnêtes et détaillés.',
      };

      console.log(`   📝 Candidature pour: ${this.campaignId}`);

      const response = await this.request(
        'POST',
        `/test-sessions/${this.campaignId}/apply`,
        applicationData,
        this.userCookie
      );

      if (response.ok && response.data?.id) {
        this.sessionId = response.data.id;
        console.log(`   ✅ Candidature envoyée avec succès`);
        console.log(`   🆔 Session ID: ${this.sessionId}`);
        console.log(`   📊 Statut: ${response.data.status}`);
        console.log(`   ⏳ En attente d'acceptation par le PRO...\n`);
        this.addResult('Candidature à la campagne', true, {
          sessionId: this.sessionId,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Candidature à la campagne', false, null, error.message);
    }
  }

  private async loginProAgain() {
    console.log('🔐 9. Reconnexion PRO pour accepter...');
    try {
      // On réutilise le cookie existant si toujours valide
      if (this.proCookie) {
        console.log(`   ✅ Cookie PRO toujours actif\n`);
        this.addResult('Reconnexion PRO', true, { email: TEST_PRO_ACCOUNT.email });
      } else {
        const response = await this.request('POST', '/auth/login', {
          email: TEST_PRO_ACCOUNT.email,
          password: TEST_PRO_ACCOUNT.password,
        });

        if (response.ok && response.data?.access_token) {
          this.proCookie = response.setCookie || '';
          console.log(`   ✅ PRO reconnecté: ${TEST_PRO_ACCOUNT.email}\n`);
          this.addResult('Reconnexion PRO', true, { email: TEST_PRO_ACCOUNT.email });
        } else {
          throw new Error(response.data?.message || 'Échec connexion');
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Reconnexion PRO', false, null, error.message);
    }
  }

  private async acceptApplication() {
    console.log('✅ 10. Acceptation de la candidature par le PRO...');

    if (!this.sessionId) {
      console.log(`   ⚠️  Pas de session créée, skip\n`);
      this.addResult('Acceptation candidature', false, null, 'Pas de session disponible');
      return;
    }

    try {
      console.log(`   📝 Acceptation session: ${this.sessionId}`);

      const response = await this.request(
        'POST',
        `/test-sessions/${this.sessionId}/accept`,
        {},
        this.proCookie
      );

      if (response.ok && response.data?.id) {
        console.log(`   ✅ Candidature acceptée avec succès !`);
        console.log(`   📊 Nouveau statut: ${response.data.status}\n`);
        this.addResult('Acceptation candidature', true, {
          sessionId: this.sessionId,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Acceptation candidature', false, null, error.message);
    }
  }

  private async validatePrice() {
    console.log('💰 11. TESTEUR valide le prix...');

    if (!this.sessionId) {
      console.log(`   ⚠️  Pas de session créée, skip\n`);
      this.addResult('Validation prix', false, null, 'Pas de session disponible');
      return;
    }

    try {
      const response = await this.request(
        'POST',
        `/test-sessions/${this.sessionId}/validate-price`,
        {},
        this.userCookie
      );

      if (response.ok && response.data) {
        console.log(`   ✅ Prix validé par le testeur`);
        console.log(`   📊 Statut: ${response.data.status}\n`);
        this.addResult('Validation prix', true, {
          sessionId: this.sessionId,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Validation prix', false, null, error.message);
    }
  }

  private async submitPurchase() {
    console.log('📦 12. TESTEUR soumet preuve d\'achat...');

    if (!this.sessionId) {
      console.log(`   ⚠️  Pas de session créée, skip\n`);
      this.addResult('Soumission achat', false, null, 'Pas de session disponible');
      return;
    }

    try {
      // Prix RÉELS (moins cher que le maximum)
      const realProductPrice = 140.0; // Au lieu de 149.99€
      const realShippingCost = 3.5;   // Au lieu de 4.99€

      console.log(`   💰 Prix réel produit: ${realProductPrice}€ (max: 149.99€)`);
      console.log(`   📦 Frais réels livraison: ${realShippingCost}€ (max: 4.99€)`);

      const purchaseData = {
        orderNumber: 'AMZ-' + Date.now(),
        purchasePrice: realProductPrice,
        shippingCost: realShippingCost,
        purchaseProofUrl: 'https://example.com/proof-screenshot.png',
      };

      const response = await this.request(
        'POST',
        `/test-sessions/${this.sessionId}/submit-purchase`,
        purchaseData,
        this.userCookie
      );

      if (response.ok && response.data) {
        console.log(`   ✅ Preuve d'achat soumise`);
        console.log(`   📋 Numéro commande: ${purchaseData.orderNumber}`);
        console.log(`   📊 Statut: ${response.data.status}\n`);
        this.addResult('Soumission achat', true, {
          sessionId: this.sessionId,
          orderNumber: purchaseData.orderNumber,
          realPrice: realProductPrice,
          realShipping: realShippingCost,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Soumission achat', false, null, error.message);
    }
  }

  private async validatePurchase() {
    console.log('✅ 13. PRO valide la commande...');

    if (!this.sessionId) {
      console.log(`   ⚠️  Pas de session créée, skip\n`);
      this.addResult('Validation commande', false, null, 'Pas de session disponible');
      return;
    }

    try {
      const response = await this.request(
        'POST',
        `/test-sessions/${this.sessionId}/validate-purchase`,
        {},
        this.proCookie
      );

      if (response.ok && response.data) {
        console.log(`   ✅ Commande validée par le PRO !`);
        console.log(`   📊 Nouveau statut: ${response.data.status}\n`);
        this.addResult('Validation commande', true, {
          sessionId: this.sessionId,
          status: response.data.status
        });
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Validation commande', false, null, error.message);
    }
  }

  private async checkWalletAndRefund() {
    console.log('💸 14. Vérification wallet et remboursement...');

    try {
      const walletResponse = await this.request('GET', '/wallet/me', null, this.userCookie);

      if (walletResponse.ok && walletResponse.data) {
        console.log(`   💰 Wallet TESTEUR:`);
        console.log(`      - Balance disponible: ${walletResponse.data.balance}€`);
        console.log(`      - Balance en attente: ${walletResponse.data.pendingBalance}€`);

        const transactionsResponse = await this.request('GET', '/wallet/me/transactions', null, this.userCookie);

        if (transactionsResponse.ok && transactionsResponse.data) {
          const rewardTransaction = transactionsResponse.data.find(
            (t: any) => t.type === 'TEST_REWARD' && t.testSessionId === this.sessionId
          );

          if (rewardTransaction) {
            console.log(`\n   ✅ Transaction de remboursement trouvée:`);
            console.log(`      - Montant: ${rewardTransaction.amount}€`);
            console.log(`      - Type: ${rewardTransaction.type}`);
            console.log(`      - Status: ${rewardTransaction.status}`);
            console.log(`\n   📊 Calcul attendu: 140€ (produit) + 3.5€ (frais) + 15€ (bonus) = 158.5€`);

            this.addResult('Vérification wallet', true, {
              balance: walletResponse.data.balance,
              transaction: rewardTransaction
            });
          } else {
            console.log(`\n   ⚠️  Aucune transaction de remboursement trouvée`);
            this.addResult('Vérification wallet', false, null, 'Transaction non trouvée');
          }
        }
      } else {
        throw new Error(walletResponse.data?.message || 'Erreur récupération wallet');
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Vérification wallet', false, null, error.message);
    }
  }

  private async getSessionDetails() {
    console.log('🔍 15. Récupération des détails de la session...');

    if (!this.sessionId) {
      console.log(`   ⚠️  Pas de session créée, skip\n`);
      this.addResult('Détails session', false, null, 'Pas de session disponible');
      return;
    }

    try {
      const response = await this.request('GET', `/test-sessions/${this.sessionId}`, null, this.proCookie);

      if (response.ok && response.data) {
        console.log(`   ✅ Session récupérée\n`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 DÉTAILS DE LA SESSION DE TEST');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('═══════════════════════════════════════════════════════════\n');
        this.addResult('Détails session', true, response.data);
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Détails session', false, null, error.message);
    }
  }

  private async getCampaignDetails() {
    console.log('🔍 16. Récupération des détails de la campagne...');

    if (!this.campaignId) {
      console.log(`   ⚠️  Pas de campagne créée, skip\n`);
      this.addResult('Détails campagne', false, null, 'Pas de campagne disponible');
      return;
    }

    try {
      const response = await this.request('GET', `/campaigns/${this.campaignId}`, null, this.proCookie);

      if (response.ok && response.data) {
        console.log(`   ✅ Campagne récupérée\n`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎯 DÉTAILS DE LA CAMPAGNE');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('═══════════════════════════════════════════════════════════\n');
        this.addResult('Détails campagne', true, response.data);
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Détails campagne', false, null, error.message);
    }
  }

  private async getProductDetails() {
    console.log('🔍 17. Récupération des détails du produit...');

    if (!this.productId) {
      console.log(`   ⚠️  Pas de produit créé, skip\n`);
      this.addResult('Détails produit', false, null, 'Pas de produit disponible');
      return;
    }

    try {
      const response = await this.request('GET', `/products/${this.productId}`, null, this.proCookie);

      if (response.ok && response.data) {
        console.log(`   ✅ Produit récupéré\n`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📦 DÉTAILS DU PRODUIT');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('═══════════════════════════════════════════════════════════\n');
        this.addResult('Détails produit', true, response.data);
      } else {
        throw new Error(response.data?.message || `HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Erreur: ${error.message}\n`);
      this.addResult('Détails produit', false, null, error.message);
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
      console.log('✨ Le flow complet avec acceptation manuelle fonctionne parfaitement !\n');
    } else {
      console.log('⚠️  Certains tests ont échoué.');
      console.log(`💡 ${successCount} sur ${totalCount} étapes validées.\n`);
    }

    // Résumé des IDs créés
    if (this.productId || this.campaignId || this.sessionId) {
      console.log('📋 Ressources créées:');
      if (this.productId) {
        console.log(`   📦 Produit: ${this.productId}`);
      }
      if (this.campaignId) {
        console.log(`   🎯 Campagne: ${this.campaignId}`);
      }
      if (this.sessionId) {
        console.log(`   🎟️  Session: ${this.sessionId}`);
      }
      console.log('');
    }
  }
}

// Exécution
const tester = new FullFlowWithProAcceptTester();
tester.run().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
