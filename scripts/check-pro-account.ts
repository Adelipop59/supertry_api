import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env', 'utf-8');
const envVars = envContent.split('\n').reduce((acc, line) => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    acc[key.trim()] = valueParts.join('=').trim();
  }
  return acc;
}, {} as Record<string, string>);

const prisma = new PrismaClient();
const stripe = new Stripe(envVars.STRIPE_SECRET_KEY, {
  apiVersion: '2026-01-28.clover',
});

async function checkProAccount() {
  const profile = await prisma.profile.findFirst({
    where: { email: envVars.TEST_PRO_EMAIL },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      stripeConnectAccountId: true,
    },
  });

  if (!profile) {
    console.log('❌ Profile not found');
    process.exit(1);
  }

  console.log('\n👤 Profile Info:');
  console.log('   Email:', profile.email);
  console.log('   Stripe Account ID:', profile.stripeConnectAccountId);

  if (profile.stripeConnectAccountId) {
    const account = await stripe.accounts.retrieve(profile.stripeConnectAccountId);
    console.log('\n📊 Stripe Account Status:');
    console.log('   Type:', account.type);
    console.log('   Capabilities:');
    console.log('     - card_payments:', account.capabilities?.card_payments);
    console.log('     - transfers:', account.capabilities?.transfers);
    console.log('   charges_enabled:', account.charges_enabled);
    console.log('   payouts_enabled:', account.payouts_enabled);
    console.log('   details_submitted:', account.details_submitted);
    
    if (account.requirements) {
      console.log('\n📋 Requirements:');
      console.log('   currently_due:', account.requirements.currently_due);
      console.log('   eventually_due:', account.requirements.eventually_due);
      console.log('   past_due:', account.requirements.past_due);
    }
  }

  await prisma.$disconnect();
}

checkProAccount().then(() => process.exit(0));
