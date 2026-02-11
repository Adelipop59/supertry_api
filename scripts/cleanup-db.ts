// Script de nettoyage direct en base de données
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 Nettoyage de la base de données\n');

  try {
    // 1. Compter les profils de test
    console.log('📊 Analyse des données de test...');

    const testProfiles = await prisma.profile.findMany({
      where: {
        OR: [
          { email: { contains: 'test.com' } },
          { email: { contains: '.test@' } },
        ],
      },
      include: {
        products: true,
        campaigns: true,
      },
    });

    console.log(`\n📋 Trouvé:`);
    console.log(`   - ${testProfiles.length} profils de test`);
    console.log(`   - ${testProfiles.reduce((sum, p) => sum + p.products.length, 0)} produits de test`);
    console.log(`   - ${testProfiles.reduce((sum, p) => sum + p.campaigns.length, 0)} campagnes de test\n`);

    if (testProfiles.length === 0) {
      console.log('✅ Aucune donnée de test à supprimer');
      return;
    }

    // Afficher les profils à supprimer
    console.log('📝 Profils qui seront supprimés:');
    testProfiles.forEach((profile, i) => {
      console.log(`   ${i + 1}. ${profile.email} (${profile.role}) - ${profile.products.length} produits, ${profile.campaigns.length} campagnes`);
    });

    console.log('\n🗑️  Suppression en cours...\n');

    // 2. Supprimer les produits (cascade supprimera offers, reviews, etc.)
    for (const profile of testProfiles) {
      if (profile.products.length > 0) {
        console.log(`  📦 Suppression de ${profile.products.length} produits de ${profile.email}...`);
        await prisma.product.deleteMany({
          where: { sellerId: profile.id },
        });
        console.log(`     ✅ Produits supprimés`);
      }
    }

    // 3. Supprimer les campagnes (cascade supprimera offers, procedures, etc.)
    for (const profile of testProfiles) {
      if (profile.campaigns.length > 0) {
        console.log(`  🎯 Suppression de ${profile.campaigns.length} campagnes de ${profile.email}...`);
        await prisma.campaign.deleteMany({
          where: { sellerId: profile.id },
        });
        console.log(`     ✅ Campagnes supprimées`);
      }
    }

    // 4. Supprimer les ProfileCountry
    console.log(`  🌍 Suppression des associations de pays...`);
    await prisma.profileCountry.deleteMany({
      where: {
        profileId: {
          in: testProfiles.map(p => p.id),
        },
      },
    });
    console.log(`     ✅ Associations supprimées`);

    // 5. Supprimer les sessions Lucia
    console.log(`  🔐 Suppression des sessions...`);
    await prisma.luciaSession.deleteMany({
      where: {
        userId: {
          in: testProfiles.map(p => p.id),
        },
      },
    });
    console.log(`     ✅ Sessions supprimées`);

    // 6. Supprimer les OAuthAccounts
    console.log(`  🔗 Suppression des comptes OAuth...`);
    await prisma.oAuthAccount.deleteMany({
      where: {
        userId: {
          in: testProfiles.map(p => p.id),
        },
      },
    });
    console.log(`     ✅ Comptes OAuth supprimés`);

    // 7. Supprimer les wallets
    console.log(`  💰 Suppression des portefeuilles...`);
    await prisma.wallet.deleteMany({
      where: {
        userId: {
          in: testProfiles.map(p => p.id),
        },
      },
    });
    console.log(`     ✅ Portefeuilles supprimés`);

    // 8. Supprimer les profils
    console.log(`  👤 Suppression des ${testProfiles.length} profils...`);
    const deleted = await prisma.profile.deleteMany({
      where: {
        id: {
          in: testProfiles.map(p => p.id),
        },
      },
    });
    console.log(`     ✅ ${deleted.count} profils supprimés`);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 Nettoyage terminé avec succès !');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📊 Résumé:`);
    console.log(`   - ${deleted.count} profils supprimés`);
    console.log(`   - Toutes les données associées supprimées\n`);

  } catch (error) {
    console.error('❌ Erreur lors du nettoyage:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanup()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
