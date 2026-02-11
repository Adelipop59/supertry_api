import { PrismaClient } from '@prisma/client';

async function checkTesterWallet() {
  const prisma = new PrismaClient();
  console.log('🔍 Vérification du wallet et transactions du TESTEUR\n');

  // Trouver le testeur (Profile, pas User)
  const tester = await prisma.profile.findFirst({
    where: { email: 'tester-test@example.com' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      stripeConnectAccountId: true,
    },
  });

  if (!tester) {
    console.log('❌ Testeur non trouvé');
    return;
  }

  console.log(`✅ Testeur trouvé: ${tester.firstName} ${tester.lastName}`);
  console.log(`   Profile ID: ${tester.id}`);
  console.log(`   Email: ${tester.email}`);
  console.log(`   Stripe Connect: ${tester.stripeConnectAccountId || 'Non configuré'}\n`);

  // Récupérer le wallet
  const wallet = await prisma.wallet.findUnique({
    where: { userId: tester.id },
  });

  if (!wallet) {
    console.log('❌ Wallet non trouvé\n');
  } else {
    console.log('💰 WALLET:');
    console.log(`   Balance disponible: ${wallet.balance}€`);
    console.log(`   Balance en attente: ${wallet.pendingBalance}€`);
    console.log(`   Total gagné: ${wallet.totalEarned}€`);
    console.log(`   Total retiré: ${wallet.totalWithdrawn}€\n`);
  }

  // Récupérer les transactions
  const transactions = await prisma.transaction.findMany({
    where: { walletId: tester.id },
    orderBy: { createdAt: 'desc' },
    include: {
      session: {
        select: {
          id: true,
          status: true,
          campaign: {
            select: {
              title: true,
            },
          },
        },
      },
    },
  });

  console.log(`📊 TRANSACTIONS (${transactions.length} total):\n`);

  if (transactions.length === 0) {
    console.log('   Aucune transaction trouvée\n');
  } else {
    for (const tx of transactions) {
      console.log(`   ${tx.type} - ${tx.amount}€`);
      console.log(`   Status: ${tx.status}`);
      console.log(`   Raison: ${tx.reason}`);
      if (tx.stripeTransferId) {
        console.log(`   Stripe Transfer ID: ${tx.stripeTransferId}`);
      }
      if (tx.session) {
        console.log(`   Campagne: ${tx.session.campaign.title}`);
        console.log(`   Session: ${tx.session.id} (${tx.session.status})`);
      }
      console.log(`   Date: ${tx.createdAt}`);
      console.log();
    }
  }

  // Récupérer les sessions du testeur
  const sessions = await prisma.testSession.findMany({
    where: { testerId: tester.id },
    orderBy: { createdAt: 'desc' },
    include: {
      campaign: {
        select: {
          title: true,
        },
      },
    },
  });

  console.log(`📋 SESSIONS DE TEST (${sessions.length} total):\n`);

  for (const session of sessions) {
    console.log(`   Session ID: ${session.id}`);
    console.log(`   Campagne: ${session.campaign.title}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Prix produit: ${session.productPrice || 'N/A'}€`);
    console.log(`   Frais shipping: ${session.shippingCost || 'N/A'}€`);
    console.log(`   Reward Amount: ${session.rewardAmount || 'N/A'}€`);
    console.log(`   Créé: ${session.createdAt}`);
    console.log(`   Complété: ${session.completedAt || 'Non complété'}`);
    console.log();
  }
}

checkTesterWallet()
  .then(async () => {
    console.log('✅ Vérification terminée');
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  });
