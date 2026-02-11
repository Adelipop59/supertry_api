import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Démarrage du seed...');

  // 1. Business Rules
  console.log('📊 Création des business rules...');
  await prisma.businessRules.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      commissionFixedFee: 5.0,
      stripeFeePercent: 0.035,
      captureDelayMinutes: 60,
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      testerBonus: 5.0,
      supertryCommission: 5.0,
      commissionFixedFee: 5.0,
      stripeFeePercent: 0.035,
      captureDelayMinutes: 60,
      ugcVideoPrice: 20.0,
      ugcVideoCommission: 5.0,
      ugcPhotoPrice: 10.0,
      ugcPhotoCommission: 3.0,
      enableTips: true,
      tipCommissionPercent: 10.0,
      campaignActivationGracePeriodMinutes: 60,
      campaignCancellationFeePercent: 10.0,
      testerCancellationBanDays: 14,
      testerCancellationCommissionPercent: 50.0,
      testerCompensationOnProCancellation: 5.0,
      kycRequiredAfterTests: 3,
    },
  });
  console.log('✅ Business rules créées');

  // 2. Pays
  console.log('🌍 Création des pays...');
  const countries = [
    { code: 'FR', name: 'France', nameEn: 'France', nameFr: 'France', region: 'Europe', isActive: true },
    { code: 'DE', name: 'Allemagne', nameEn: 'Germany', nameFr: 'Allemagne', region: 'Europe', isActive: true },
    { code: 'BE', name: 'Belgique', nameEn: 'Belgium', nameFr: 'Belgique', region: 'Europe', isActive: true },
    { code: 'ES', name: 'Espagne', nameEn: 'Spain', nameFr: 'Espagne', region: 'Europe', isActive: true },
    { code: 'IT', name: 'Italie', nameEn: 'Italy', nameFr: 'Italie', region: 'Europe', isActive: true },
    { code: 'UK', name: 'Royaume-Uni', nameEn: 'United Kingdom', nameFr: 'Royaume-Uni', region: 'Europe', isActive: true },
    { code: 'US', name: 'États-Unis', nameEn: 'United States', nameFr: 'États-Unis', region: 'Americas', isActive: false },
  ];

  for (const country of countries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: country,
      create: country,
    });
  }
  console.log(`✅ ${countries.length} pays créés`);

  // 3. Catégories
  console.log('📁 Création des catégories...');
  const categories = [
    { name: 'Électronique', slug: 'electronique', description: 'Smartphones, ordinateurs, accessoires tech', icon: '📱' },
    { name: 'Maison & Cuisine', slug: 'maison-cuisine', description: 'Ustensiles, décoration, électroménager', icon: '🏠' },
    { name: 'Beauté & Santé', slug: 'beaute-sante', description: 'Cosmétiques, soins, produits de santé', icon: '💄' },
    { name: 'Sport & Fitness', slug: 'sport-fitness', description: 'Équipements sportifs, vêtements de sport', icon: '⚽' },
    { name: 'Mode & Accessoires', slug: 'mode-accessoires', description: 'Vêtements, chaussures, bijoux', icon: '👗' },
    { name: 'Alimentation', slug: 'alimentation', description: 'Produits alimentaires, boissons', icon: '🍕' },
    { name: 'Jouets & Enfants', slug: 'jouets-enfants', description: 'Jouets, vêtements enfants, puériculture', icon: '🧸' },
    { name: 'Livres & Média', slug: 'livres-media', description: 'Livres, films, musique', icon: '📚' },
    { name: 'Jardin & Extérieur', slug: 'jardin-exterieur', description: 'Outils de jardinage, mobilier extérieur', icon: '🌳' },
    { name: 'Auto & Moto', slug: 'auto-moto', description: 'Accessoires auto, équipements moto', icon: '🚗' },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
  }
  console.log(`✅ ${categories.length} catégories créées`);

  // 4. Platform Wallet
  console.log('💰 Création du Platform Wallet...');
  await prisma.platformWallet.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      escrowBalance: 0,
      commissionBalance: 0,
      currency: 'EUR',
      totalReceived: 0,
      totalTransferred: 0,
      totalCommissions: 0,
    },
  });
  console.log('✅ Platform Wallet créé');

  console.log('🎉 Seed terminé avec succès !');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
