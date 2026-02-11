import Stripe from 'stripe';
import { readFileSync } from 'fs';

// Lire le .env manuellement
const envContent = readFileSync('.env', 'utf-8');
const envVars = envContent.split('\n').reduce((acc, line) => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    acc[key.trim()] = valueParts.join('=').trim();
  }
  return acc;
}, {} as Record<string, string>);

const stripe = new Stripe(envVars.STRIPE_SECRET_KEY, {
  apiVersion: '2026-01-28.clover',
});

async function createTestAccount() {
  const email = `test-new-${Date.now()}@example.com`;

  console.log(`\n🔨 Création d'un nouveau compte Stripe Connect...`);
  console.log(`Email: ${email}`);

  const account = await stripe.accounts.create({
    type: 'express',
    country: 'FR',
    email: email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    individual: {
      first_name: 'Test',
      last_name: 'User',
      email: email,
      dob: {
        day: 1,
        month: 1,
        year: 1990,
      },
      address: {
        line1: '123 Test Street',
        city: 'Paris',
        postal_code: '75001',
        country: 'FR',
      },
      phone: '+33612345678',
    },
    business_profile: {
      mcc: '5734',
      url: 'https://supertry.com',
    },
  });

  console.log(`\n✅ Compte créé: ${account.id}`);
  console.log(`\n--- Statut immédiat ---`);
  console.log(`Business Type: ${account.business_type}`);
  console.log(`Details Submitted: ${account.details_submitted}`);
  console.log(`Charges Enabled: ${account.charges_enabled}`);
  console.log(`Payouts Enabled: ${account.payouts_enabled}`);
  console.log(`\nCapabilities:`);
  console.log(JSON.stringify(account.capabilities, null, 2));

  console.log(`\n--- Requirements ---`);
  console.log(`Currently Due: ${account.requirements?.currently_due?.length || 0} champs`);
  if (account.requirements?.currently_due?.length) {
    console.log(account.requirements.currently_due);
  }
}

createTestAccount()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  });
