/**
 * Script pour vérifier si le testeur a bien reçu son paiement sur Stripe Connect
 * Affiche des logs détaillés de chaque étape du processus de transfert
 */

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

async function verifyTesterPayment(testSessionId?: string) {
  console.log('🔍 VÉRIFICATION DU PAIEMENT TESTEUR\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // 1. Trouver la dernière session COMPLETED
    let session;
    if (testSessionId) {
      session = await prisma.testSession.findUnique({
        where: { id: testSessionId },
        include: {
          campaign: {
            include: { offers: true },
          },
          tester: {
            select: {
              id: true,
              email: true,
              firstName: true,
              stripeConnectAccountId: true,
              stripeIdentityVerified: true,
            },
          },
        },
      });
    } else {
      session = await prisma.testSession.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { updatedAt: 'desc' },
        include: {
          campaign: {
            include: { offers: true },
          },
          tester: {
            select: {
              id: true,
              email: true,
              firstName: true,
              stripeConnectAccountId: true,
              stripeIdentityVerified: true,
            },
          },
        },
      });
    }

    if (!session) {
      console.log('❌ Aucune session COMPLETED trouvée\n');
      return;
    }

    console.log(`📋 SESSION TROUVÉE: ${session.id}`);
    console.log(`   Testeur: ${session.tester.email}`);
    console.log(`   Campagne: ${session.campaign.title}`);
    console.log(`   Status: ${session.status}\n`);

    // 2. Vérifier le compte Stripe Connect du testeur
    console.log('🔐 VÉRIFICATION COMPTE STRIPE CONNECT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!session.tester.stripeConnectAccountId) {
      console.log('❌ ERREUR: Le testeur n\'a PAS de compte Stripe Connect');
      console.log('   → Le compte Connect doit être créé lors de l\'inscription\n');
      return;
    }

    console.log(`✅ Compte Connect ID: ${session.tester.stripeConnectAccountId}`);
    console.log(`✅ Identity vérifié: ${session.tester.stripeIdentityVerified ? 'OUI' : 'NON'}\n`);

    // 3. Récupérer les infos du compte Stripe
    let stripeAccount;
    try {
      stripeAccount = await stripe.accounts.retrieve(session.tester.stripeConnectAccountId);
      console.log('📊 DÉTAILS DU COMPTE STRIPE:');
      console.log(`   charges_enabled: ${stripeAccount.charges_enabled}`);
      console.log(`   payouts_enabled: ${stripeAccount.payouts_enabled}`);
      console.log(`   details_submitted: ${stripeAccount.details_submitted}`);
      console.log(`   payouts_schedule: ${stripeAccount.settings?.payouts?.schedule?.interval || 'default'}`);

      if (stripeAccount.requirements?.currently_due && stripeAccount.requirements.currently_due.length > 0) {
        console.log(`   ⚠️  Requirements manquants: ${stripeAccount.requirements.currently_due.join(', ')}`);
      }
      console.log('');
    } catch (error: any) {
      console.log(`❌ ERREUR lors de la récupération du compte: ${error.message}\n`);
      return;
    }

    // 4. Chercher la transaction dans la DB
    console.log('💾 TRANSACTION DANS LA BASE DE DONNÉES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const transaction = await prisma.transaction.findFirst({
      where: {
        sessionId: session.id,
        type: 'TEST_REWARD',
      },
    });

    if (!transaction) {
      console.log('❌ ERREUR: Aucune transaction TEST_REWARD trouvée dans la DB');
      console.log('   → Le paiement n\'a pas été traité par processTestCompletion()\n');
      return;
    }

    console.log(`✅ Transaction trouvée: ${transaction.id}`);
    console.log(`   Montant: ${transaction.amount}€`);
    console.log(`   Status: ${transaction.status}`);
    console.log(`   Stripe Transfer ID: ${transaction.stripeTransferId || 'N/A'}`);
    console.log(`   Date: ${transaction.createdAt}\n`);

    // 5. Vérifier le transfer Stripe
    if (!transaction.stripeTransferId) {
      console.log('❌ ERREUR CRITIQUE: Transaction sans stripeTransferId');
      console.log('   → Le transfer Stripe n\'a pas été créé !\n');
      console.log('🔍 ANALYSE DE LA CAUSE:');
      console.log('   1. Vérifier les logs API au moment de la completion');
      console.log('   2. Le compte Connect était-il valide ?');
      console.log('   3. Y a-t-il eu une erreur lors de stripe.transfers.create() ?\n');
      return;
    }

    console.log('💸 VÉRIFICATION DU TRANSFER STRIPE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const transfer = await stripe.transfers.retrieve(transaction.stripeTransferId);

      console.log(`✅ Transfer trouvé: ${transfer.id}`);
      console.log(`   Montant: ${transfer.amount / 100}€`);
      console.log(`   Destination: ${transfer.destination}`);
      console.log(`   Status: ${transfer.reversed ? '❌ REVERSED' : '✅ ACTIF'}`);
      console.log(`   Date création: ${new Date(transfer.created * 1000).toISOString()}`);

      if (transfer.destination_payment) {
        console.log(`   Payment ID: ${transfer.destination_payment}\n`);
      }

      // 6. Vérifier la balance du compte Connect
      console.log('💰 BALANCE DU COMPTE CONNECT TESTEUR');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const balance = await stripe.balance.retrieve({
        stripeAccount: session.tester.stripeConnectAccountId,
      });

      console.log(`   Available: ${balance.available[0]?.amount / 100 || 0}€`);
      console.log(`   Pending: ${balance.pending[0]?.amount / 100 || 0}€`);
      console.log('');

      // 7. Vérifier les payouts
      console.log('🏦 HISTORIQUE DES PAYOUTS (vers IBAN)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const payouts = await stripe.payouts.list(
        { limit: 5 },
        { stripeAccount: session.tester.stripeConnectAccountId }
      );

      if (payouts.data.length === 0) {
        console.log('⚠️  Aucun payout trouvé');
        console.log('   → L\'argent est sur le compte Stripe mais pas encore viré vers l\'IBAN');
        console.log(`   → Payouts: ${stripeAccount.settings?.payouts?.schedule?.interval || 'automatic'}\n`);
      } else {
        payouts.data.forEach((payout) => {
          console.log(`\n   Payout ${payout.id}:`);
          console.log(`      Montant: ${payout.amount / 100}€`);
          console.log(`      Status: ${payout.status}`);
          console.log(`      Date: ${new Date(payout.created * 1000).toISOString()}`);
          console.log(`      Arrival: ${payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : 'N/A'}`);
        });
        console.log('');
      }

      // 8. Vérifier le wallet dans la DB
      console.log('👛 WALLET DANS LA BASE DE DONNÉES');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const wallet = await prisma.wallet.findUnique({
        where: { userId: session.testerId },
      });

      if (wallet) {
        console.log(`   Balance: ${wallet.balance}€`);
        console.log(`   Pending: ${wallet.pendingBalance}€`);
        console.log(`   Total Earned: ${wallet.totalEarned}€`);
        console.log(`   Total Withdrawn: ${wallet.totalWithdrawn}€\n`);
      } else {
        console.log('   ❌ Wallet non trouvé dans la DB\n');
      }

      // RÉSUMÉ
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ RÉSUMÉ - PAIEMENT TESTEUR');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Transfer Stripe: ${transfer.id} (${transfer.amount / 100}€)`);
      console.log(`Balance Stripe Connect: ${balance.available[0]?.amount / 100 || 0}€ available, ${balance.pending[0]?.amount / 100 || 0}€ pending`);
      console.log(`Wallet DB: ${wallet?.balance || 0}€`);
      console.log('');

      if (balance.available[0]?.amount > 0) {
        console.log('💡 L\'argent est DISPONIBLE sur le compte Stripe Connect');
        console.log('   Le testeur peut demander un retrait vers son IBAN\n');
      } else if (balance.pending[0]?.amount > 0) {
        console.log('⏳ L\'argent est EN ATTENTE (pending) sur Stripe');
        console.log('   Il sera disponible après la période de sécurité Stripe\n');
      } else {
        console.log('⚠️  Aucun argent sur le compte Connect');
        console.log('   Vérifier si un payout a déjà été effectué\n');
      }

    } catch (error: any) {
      console.log(`❌ ERREUR lors de la récupération du transfer:`);
      console.log(`   ${error.message}`);
      console.log(`   Type: ${error.type}`);
      console.log(`   Code: ${error.code}\n`);

      if (error.code === 'resource_missing') {
        console.log('🔍 DIAGNOSTIC:');
        console.log('   Le stripeTransferId existe dans la DB mais pas sur Stripe');
        console.log('   → Transfer ID peut-être incorrect ou supprimé\n');
      }
    }

  } catch (error: any) {
    console.log(`\n❌ ERREUR GÉNÉRALE: ${error.message}\n`);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

// Exécution
const sessionId = process.argv[2]; // Optionnel: passer un session ID spécifique
verifyTesterPayment(sessionId)
  .then(() => {
    console.log('✅ Vérification terminée\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  });
