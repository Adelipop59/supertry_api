import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function createMissingWallets() {
  console.log('🔧 Création des wallets manquants pour les users existants\n');

  // Trouver tous les profiles PRO et USER qui ont un stripeConnectAccountId mais pas de wallet
  const profilesWithoutWallet = await prisma.profile.findMany({
    where: {
      role: { in: ['PRO', 'USER'] },
      stripeConnectAccountId: { not: null },
    },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
    },
  });

  console.log(`📊 Trouvé ${profilesWithoutWallet.length} profiles PRO/USER avec Stripe Connect`);

  let created = 0;
  let skipped = 0;

  for (const profile of profilesWithoutWallet) {
    // Vérifier si wallet existe déjà
    const existingWallet = await prisma.wallet.findUnique({
      where: { userId: profile.id },
    });

    if (existingWallet) {
      console.log(`⏭️  ${profile.email} - Wallet existe déjà`);
      skipped++;
      continue;
    }

    // Créer le wallet
    try {
      await prisma.wallet.create({
        data: {
          userId: profile.id,
          balance: new Decimal(0),
          pendingBalance: new Decimal(0),
          totalEarned: new Decimal(0),
          totalWithdrawn: new Decimal(0),
        },
      });

      console.log(`✅ ${profile.email} (${profile.role}) - Wallet créé`);
      created++;
    } catch (error) {
      console.error(`❌ ${profile.email} - Erreur: ${error.message}`);
    }
  }

  console.log(`\n📊 Résumé:`);
  console.log(`   Créés: ${created}`);
  console.log(`   Déjà existants: ${skipped}`);
  console.log(`   Total traités: ${profilesWithoutWallet.length}`);
}

createMissingWallets()
  .then(() => {
    console.log('\n✅ Migration terminée');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Erreur:', error);
    process.exit(1);
  });
