import Stripe from 'stripe';

// Lire le .env manuellement
import { readFileSync } from 'fs';
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

stripe.accounts.retrieve(accountId).then((acc) => {
  console.log('Account ID:', acc.id);
  console.log('Email:', acc.email);
  console.log('Type:', acc.type);
  console.log('Business Type:', acc.business_type);
  console.log('\n--- Capabilities ---');
  console.log(JSON.stringify(acc.capabilities, null, 2));
  console.log('\n--- Status Flags ---');
  console.log('charges_enabled:', acc.charges_enabled);
  console.log('payouts_enabled:', acc.payouts_enabled);
  console.log('details_submitted:', acc.details_submitted);
  console.log('\n--- Individual Info ---');
  console.log(JSON.stringify(acc.individual, null, 2));
  console.log('\n--- Business Profile ---');
  console.log(JSON.stringify(acc.business_profile, null, 2));
  console.log('\n--- Requirements ---');
  console.log(JSON.stringify(acc.requirements, null, 2));
  process.exit(0);
}).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
