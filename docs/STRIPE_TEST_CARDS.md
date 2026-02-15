# Cartes de Test Stripe - Guide Complet

## Problème : "Insufficient Available Funds" en Mode Test

### Contexte

En mode test Stripe, **toutes les cartes ne se comportent pas de la même manière** concernant la disponibilité des fonds dans le balance du compte plateforme.

### Différence entre les cartes de test

| Carte | Comportement | Utilisation |
|-------|--------------|-------------|
| `4242 4242 4242 4242` | ✅ Payment réussit<br>❌ Fonds en "pending"<br>❌ **PAS disponibles pour transfers** | Tests basiques de paiement |
| `4000 0000 0000 0077` | ✅ Payment réussit<br>✅ Fonds immédiatement disponibles<br>✅ **Disponibles pour transfers** | **Tests de flux complet avec transfers** |

## Pourquoi utiliser `4000 0000 0000 0077` ?

### Le Flow SuperTry

```
1. PRO paie la campagne (350€)
   ↓ Argent arrive sur le compte PLATEFORME

2. TESTEUR complète le test
   ↓ Transfer de 65€ du compte PLATEFORME → compte TESTEUR

3. ❌ ERREUR si fonds pas disponibles !
```

### Avec la carte `4242 4242 4242 4242`

```bash
❌ Échec du Transfer
Error: "You have insufficient available funds in your Stripe account"
```

**Pourquoi ?** Les fonds du paiement PRO sont en "pending" et ne sont pas encore disponibles pour faire des transfers.

### Avec la carte `4000 0000 0000 0077`

```bash
✅ Transfer réussi
Transfer: tr_xxx - 65€ → acct_testeur
```

**Pourquoi ?** Cette carte simule un paiement dont les fonds sont **immédiatement disponibles**, comme ce serait le cas en production après le délai de disponibilité Stripe (2-7 jours).

## En Production

En production, le comportement est le suivant :

1. **PRO paie la campagne** → Les fonds arrivent sur le compte plateforme
2. **Délai Stripe** → Les fonds deviennent disponibles après 2-7 jours (selon le pays et le type de compte)
3. **TESTEUR complète le test** → Transfer possible car les fonds sont disponibles

## Solution pour les Tests

### Option 1 : Utiliser la bonne carte de test ✅ **RECOMMANDÉ**

Utilisez **toujours** la carte `4000 0000 0000 0077` pour les paiements de campagnes en mode test.

```bash
# Dans le script test-full-flow.sh
Carte de test: 4000 0000 0000 0077
```

### Option 2 : Attendre en production

En production, configurez un délai minimum entre :
- Le paiement de la campagne par le PRO
- La possibilité pour les testeurs de compléter leurs tests

Cela laisse le temps aux fonds de devenir disponibles.

## Cartes de Test Stripe - Référence Complète

### Cartes pour tester le balance disponible

| Carte | Description |
|-------|-------------|
| `4000 0000 0000 0077` | ✅ Fonds immédiatement disponibles (balance) |
| `4000 0000 0000 3220` | ⚠️ 3D Secure requis + fonds disponibles |

### Cartes de test standard

| Carte | Description |
|-------|-------------|
| `4242 4242 4242 4242` | Payment réussi (Visa) |
| `5555 5555 5555 4444` | Payment réussi (Mastercard) |
| `3782 822463 10005` | Payment réussi (American Express) |

### Cartes pour tester les erreurs

| Carte | Description |
|-------|-------------|
| `4000 0000 0000 0002` | ❌ Carte déclinée |
| `4000 0000 0000 9995` | ❌ Fonds insuffisants |
| `4000 0000 0000 0069` | ❌ Carte expirée |

## Mise à Jour du Script de Test

Le script `test-full-flow.sh` a été mis à jour pour utiliser automatiquement la carte `4000 0000 0000 0077`.

```bash
./scripts/test-full-flow.sh
```

## Vérifier le Balance Stripe

Pour vérifier votre balance Stripe actuel :

```bash
./scripts/check-stripe-balances.sh
```

## Documentation Stripe

- [Cartes de test](https://stripe.com/docs/testing)
- [Available Balance](https://stripe.com/docs/testing#available-balance)
- [Transfers](https://stripe.com/docs/connect/transfers)

## Résumé

> **⚠️ IMPORTANT**
> Pour tester le **flux complet SuperTry** (paiement PRO → transfer TESTEUR), vous **DEVEZ** utiliser la carte `4000 0000 0000 0077`.
>
> La carte classique `4242 4242 4242 4242` ne fonctionnera **PAS** car les fonds ne sont pas immédiatement disponibles pour les transfers.

---

**Date de dernière mise à jour :** 2026-02-09
