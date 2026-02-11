import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

/**
 * Script de migration pour BLOQUER les payouts automatiques
 *
 * Pourquoi c'est CRITIQUE ?
 * - Modèle "Separate Charges and Transfers": l'argent arrive sur compte plateforme
 * - AVANT de répartir aux testeurs, l'argent DOIT rester sur Stripe
 * - Si Stripe fait un payout auto vers IBAN → argent sort → impossible de payer testeurs
 *
 * Solution: interval: 'manual' = désactive payouts automatiques
 */
async function fixStripePayoutsManual() {
  console.log('🔧 MIGRATION: Bloquer payouts automatiques pour "Separate Charges and Transfers"\n');

  // 1. Récupérer tous les comptes Connect
  const profiles = await prisma.profile.findMany({
    where: {
      stripeConnectAccountId: {
        not: null,
      },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      stripeConnectAccountId: true,
    },
  });

  console.log(`📋 Trouvé ${profiles.length} comptes Connect à mettre à jour\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const profile of profiles) {
    console.log(`\n👤 ${profile.firstName} ${profile.lastName} (${profile.email}) - ${profile.role}`);
    console.log(`   Account ID: ${profile.stripeConnectAccountId}`);

    try {
      // Récupérer l'état actuel
      const account = await stripe.accounts.retrieve(profile.stripeConnectAccountId!);

      console.log(`   Payout schedule actuel: ${account.settings?.payouts?.schedule?.interval || 'auto (default)'}`);

      // Mettre à jour UNIQUEMENT si pas déjà en 'manual'
      if (account.settings?.payouts?.schedule?.interval !== 'manual') {
        console.log(`   ⚙️  Mise à jour vers 'manual'...`);

        await stripe.accounts.update(profile.stripeConnectAccountId!, {
          settings: {
            payouts: {
              schedule: {
                interval: 'manual',
              },
            },
          },
        });

        // Vérifier
        const updatedAccount = await stripe.accounts.retrieve(profile.stripeConnectAccountId!);
        console.log(`   ✅ Nouveau schedule: ${updatedAccount.settings?.payouts?.schedule?.interval}`);
        successCount++;
      } else {
        console.log(`   ✅ Déjà en 'manual', aucune action nécessaire`);
        successCount++;
      }
    } catch (error: any) {
      console.error(`   ❌ Erreur: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Succès: ${successCount}`);
  console.log(`❌ Erreurs: ${errorCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 2. IMPORTANT: Vérifier le compte PLATEFORME
  console.log('\n🏦 VÉRIFICATION DU COMPTE PLATEFORME (le plus important!)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const balance = await stripe.balance.retrieve();
    console.log(`💰 Balance plateforme:`);
    console.log(`   Available: ${balance.available[0]?.amount / 100 || 0}€`);
    console.log(`   Pending: ${balance.pending[0]?.amount / 100 || 0}€`);

    // Note: Le compte plateforme n'a pas de settings.payouts dans l'API
    // Il faut configurer les payouts manuellement via Dashboard Stripe
    console.log('\n⚠️  ACTION REQUISE:');
    console.log('   1. Aller sur https://dashboard.stripe.com/settings/payouts');
    console.log('   2. Désactiver "Automatic payouts"');
    console.log('   3. OU configurer "Manual payouts only"');
    console.log('   4. Cela garantit que l\'argent reste sur Stripe pour transfers/refunds\n');
  } catch (error: any) {
    console.error(`❌ Impossible de récupérer la balance: ${error.message}`);
  }

  console.log('✅ Migration terminée!\n');
}

fixStripePayoutsManual()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Erreur fatale:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
