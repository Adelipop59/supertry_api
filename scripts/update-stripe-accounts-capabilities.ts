import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

async function updateStripeAccountsCapabilities() {
  console.log('🔧 Mise à jour des capabilities des comptes Stripe Connect\n');

  // Récupérer tous les profiles avec stripeConnectAccountId
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
      stripeConnectAccountId: true,
    },
  });

  console.log(`📋 Trouvé ${profiles.length} comptes Connect à mettre à jour\n`);

  for (const profile of profiles) {
    console.log(`\n👤 ${profile.firstName} ${profile.lastName} (${profile.email})`);
    console.log(`   Account ID: ${profile.stripeConnectAccountId}`);

    try {
      // Récupérer l'état actuel du compte
      const account = await stripe.accounts.retrieve(profile.stripeConnectAccountId!);

      console.log(`   Capabilities actuelles:`);
      console.log(`     - card_payments: ${account.capabilities?.card_payments}`);
      console.log(`     - transfers: ${account.capabilities?.transfers}`);

      // Mettre à jour les capabilities si nécessaire
      if (account.capabilities?.transfers !== 'active') {
        console.log(`   ⚙️  Mise à jour des capabilities...`);

        await stripe.accounts.update(profile.stripeConnectAccountId!, {
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });

        console.log(`   ✅ Capabilities mises à jour!`);

        // Vérifier à nouveau
        const updatedAccount = await stripe.accounts.retrieve(profile.stripeConnectAccountId!);
        console.log(`   Nouvelles capabilities:`);
        console.log(`     - card_payments: ${updatedAccount.capabilities?.card_payments}`);
        console.log(`     - transfers: ${updatedAccount.capabilities?.transfers}`);
      } else {
        console.log(`   ✅ Capabilities déjà actives`);
      }
    } catch (error: any) {
      console.error(`   ❌ Erreur: ${error.message}`);
    }
  }

  console.log('\n✅ Mise à jour terminée!\n');
}

updateStripeAccountsCapabilities()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Erreur:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
