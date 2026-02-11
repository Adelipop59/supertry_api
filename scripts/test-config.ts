// Configuration des comptes de test fixes à utiliser dans tous les tests

export const API_URL = 'http://localhost:3000/api/v1';

export const TEST_PRO_ACCOUNT = {
  email: 'pro.vendor@test.com',
  password: 'TestPass123!',
  role: 'PRO' as const,
  firstName: 'Marc',
  lastName: 'Vendeur',
  phone: '+33612345678',
  companyName: 'TestShop SARL',
  siret: '12345678901234',
  countries: ['FR'],
};

export const TEST_USER_ACCOUNT = {
  email: 'user.tester@test.com',
  password: 'TestPass123!',
  role: 'USER' as const,
  country: 'FR',
};
