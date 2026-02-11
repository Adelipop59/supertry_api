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

const accountId = process.argv[2] || 'acct_1SxPcGRLFB6dJfmG';

async function activateAccount() {
  console.log(`Activation du compte ${accountId}...`);

  try {
    // Mettre à jour le compte avec des infos minimales pour le test
    const account = await stripe.accounts.update(accountId, {
      business_type: 'individual',
      individual: {
        first_name: 'Test',
        last_name: 'User',
        email: 'pro-test1@example.com',
        dob: {
          day: 1,
          month: 1,
          year: 1990,
        },
        address: {
          line1: '123 Test St',
          city: 'Paris',
          postal_code: '75001',
          country: 'FR',
        },
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: '127.0.0.1',
      },
    });

    console.log('✅ Compte mis à jour');
    console.log('Capabilities:', account.capabilities);
    console.log('charges_enabled:', account.charges_enabled);
    console.log('payouts_enabled:', account.payouts_enabled);
    console.log('details_submitted:', account.details_submitted);
  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
    if (error.raw) {
      console.error('Details:', JSON.stringify(error.raw, null, 2));
    }
  }
}

activateAccount().then(() => process.exit(0));
