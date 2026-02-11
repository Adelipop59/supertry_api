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

const accountId = process.argv[2];

if (!accountId) {
  console.error('❌ Usage: npx tsx complete-account-setup.ts <account_id>');
  process.exit(1);
}

async function completeSetup() {
  console.log(`\n🔨 Complétion du setup pour ${accountId}...`);

  // Ajouter external_account (compte bancaire test)
  console.log('\n1️⃣ Ajout du compte bancaire...');
  const bankAccount = await stripe.accounts.createExternalAccount(accountId, {
    external_account: {
      object: 'bank_account',
      country: 'FR',
      currency: 'eur',
      account_holder_name: 'Test User',
      account_holder_type: 'individual',
      account_number: 'FR1420041010050500013M02606', // IBAN test France
    },
  });
  console.log(`✅ Compte bancaire ajouté: ${bankAccount.id}`);

  // Mettre à jour avec TOS acceptance
  console.log('\n2️⃣ Acceptation des TOS...');
  const updatedAccount = await stripe.accounts.update(accountId, {
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: '127.0.0.1',
    },
  });

  console.log(`\n✅ Setup complété!`);
  console.log(`\n--- Statut final ---`);
  console.log(`Details Submitted: ${updatedAccount.details_submitted}`);
  console.log(`Charges Enabled: ${updatedAccount.charges_enabled}`);
  console.log(`Payouts Enabled: ${updatedAccount.payouts_enabled}`);
  console.log(`\nCapabilities:`);
  console.log(JSON.stringify(updatedAccount.capabilities, null, 2));

  console.log(`\n--- Requirements ---`);
  console.log(`Currently Due: ${updatedAccount.requirements?.currently_due?.length || 0} champs`);
  if (updatedAccount.requirements?.currently_due?.length) {
    console.log(updatedAccount.requirements.currently_due);
  }
}

completeSetup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Erreur:', err.message);
    if (err.raw) {
      console.error('Details:', JSON.stringify(err.raw, null, 2));
    }
    process.exit(1);
  });
