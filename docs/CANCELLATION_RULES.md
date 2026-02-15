# Règles Métier - Système d'Annulation SuperTry

Ce document définit toutes les règles métier pour le système d'annulation des campagnes et sessions de test.

## Table des Matières

1. [Annulations par le TESTEUR](#annulations-par-le-testeur)
2. [Annulations par le PRO](#annulations-par-le-pro)
3. [Annulations par ADMIN](#annulations-par-admin)
4. [Système de Litiges](#système-de-litiges)
5. [Règles de Ban](#règles-de-ban)
6. [Commissions et Remboursements](#commissions-et-remboursements)

---

## Annulations par le TESTEUR

### Règle 1 : Annulation avant acceptation (PENDING)

**Conditions :**
- Session status : `PENDING` (en attente d'acceptation par le PRO)
- Aucun engagement n'a été pris

**Conséquences :**
- ✅ Aucune pénalité
- ✅ Slot libéré pour d'autres testeurs
- ✅ Aucun impact sur le profil du testeur
- ✅ Aucune transaction financière

**Justification :** Le testeur peut changer d'avis avant que le PRO n'accepte sa candidature.

---

### Règle 2 : Annulation après acceptation (ACCEPTED)

**Conditions :**
- Session status : `ACCEPTED` (acceptée par le PRO)
- Le testeur n'a pas encore validé le prix

**Conséquences :**

#### Cas A : < 1h après acceptation (Grace Period)
- ✅ Aucune pénalité
- ✅ Slot libéré immédiatement
- ✅ Aucune transaction financière
- ✅ Pas de ban

#### Cas B : > 1h après acceptation
- ⚠️ Ban immédiat de **14 jours**
- ⚠️ Le testeur ne peut plus voir ni postuler à aucune campagne pendant 14 jours
- ✅ Slot libéré pour d'autres testeurs
- ✅ Aucune transaction financière (le testeur n'a rien dépensé)

**Justification :** Après 1h, le PRO a commencé à compter sur ce testeur. Le ban dissuade les annulations tardives.

---

### Règle 3 : Annulation après validation du prix (PRICE_VALIDATED)

**Conditions :**
- Session status : `PRICE_VALIDATED`
- Le testeur a validé le prix mais n'a pas encore commandé

**Conséquences :**
- Identiques à la **Règle 2, Cas B**
- ⚠️ Ban de 14 jours
- ✅ Slot libéré
- ✅ Aucune transaction financière

**Justification :** Le testeur s'était engagé à commander, mais ne l'a pas fait.

---

### Règle 4 : Annulation après achat validé (PURCHASE_VALIDATED)

**Conditions :**
- Session status : `PURCHASE_VALIDATED`
- Le testeur a **déjà commandé et payé** le produit
- Le PRO a validé le numéro de commande

**Conséquences financières :**

| Composant | Montant | Qui paie |
|-----------|---------|----------|
| Remboursement produit | Prix réel payé | Escrow → Testeur |
| Remboursement shipping | Frais réels payés | Escrow → Testeur |
| Bonus testeur | 5€ | Escrow → Testeur |
| **Total testeur reçoit** | **Produit + Shipping + 5€** | **Escrow → Testeur** |
| Commission SuperTry | 2.50€ (50% de 5€) | Escrow → SuperTry |
| **Coût total pour PRO** | **Produit + Shipping + 7.50€** | **Escrow** |

**Autres conséquences :**
- ⚠️ **Ban de 14 jours** (le testeur ne voit plus aucune campagne)
- ✅ **Testeur garde le produit physique** (pas de retour à gérer)
- ✅ Slot libéré pour d'autres testeurs
- ✅ Session marquée `CANCELLED`

**Exemple chiffré :**
```
Produit acheté : 50€
Shipping : 5€
Bonus : 5€

Remboursement testeur : 50€ + 5€ + 5€ = 60€
Commission SuperTry : 2.50€ (50% au lieu de 5€)
Coût PRO : 60€ + 2.50€ = 62.50€

Testeur garde le produit d'une valeur de ~50€
```

**Justification :**
- Le testeur est remboursé car il a dépensé son argent
- Il garde le produit pour simplifier la logistique (pas de retour)
- Ban de 14 jours pour dissuader les annulations tardives
- SuperTry prend 50% de commission pour compenser partiellement les frais

---

## Annulations par le PRO

### Règle 5 : Annulation < 1h après paiement (Grace Period)

**Conditions :**
- Campaign status : `PENDING_ACTIVATION`
- Moins de 1h écoulée depuis le paiement
- Campagne **invisible** aux testeurs pendant cette période

**Conséquences :**
- ✅ Remboursement COMPLET sans frais (100% de l'escrow)
- ✅ Stripe Refund direct vers la carte du PRO
- ✅ Aucune pénalité
- ✅ PlatformWallet : escrowBalance -= montant total
- ✅ Campaign status → `CANCELLED`

**Justification :** Grace period pour permettre au PRO de changer d'avis sans frais.

---

### Règle 6 : Annulation > 1h après paiement (campagne active)

**Conditions :**
- Campaign status : `ACTIVE`
- Plus de 1h écoulée depuis le paiement
- Campagne visible aux testeurs

#### Cas A : Aucun testeur accepté

**Conséquences :**
- Remboursement : **90% de l'escrow restant**
- Frais d'annulation : **10% de l'escrow restant**
- PlatformWallet :
  - escrowBalance -= escrow restant
  - commissionBalance += 10% (frais)
- Campaign status → `CANCELLED`

**Exemple chiffré :**
```
Escrow total : 1000€
Sessions complétées : 0
Escrow restant : 1000€

Remboursement PRO : 900€
Frais SuperTry : 100€ (10%)
```

#### Cas B : Testeurs acceptés sans validation de prix

**Conséquences :**

1. **Pour chaque testeur en status ACCEPTED :**
   - Testeur reçoit **5€ de compensation**
   - Transaction : `TESTER_COMPENSATION`
   - Stripe transfer : 5€ → Testeur Connect account
   - Session marquée `CANCELLED`

2. **Pour le PRO :**
   - Remboursement : Escrow restant - (5€ × nb testeurs) - 10% frais
   - Frais : 10% de l'escrow des produits non attribués

**Exemple chiffré :**
```
Escrow total : 1000€ (10 testeurs × 100€)
Sessions complétées : 0
Testeurs acceptés : 3
Escrow restant : 1000€

Compensation testeurs : 3 × 5€ = 15€
Base remboursement : 1000€ - 15€ = 985€
Frais 10% : 98.50€
Remboursement PRO : 886.50€

Distribution :
- Testeurs acceptés : 15€
- PRO : 886.50€
- SuperTry : 98.50€
```

#### Cas C : Testeurs avec prix validé (PRICE_VALIDATED ou après)

**Conséquences :**

1. **Pour chaque testeur >= PRICE_VALIDATED :**
   - Testeur reçoit : Produit + Shipping + 5€
   - Session marquée `CANCELLED`
   - Même calcul que pour annulation testeur post-achat

2. **Pour le PRO :**
   - Remboursement : Escrow restant - compensations testeurs - 10% frais

**Exemple chiffré :**
```
Escrow total : 1000€ (10 slots × 100€)
Sessions complétées : 2 (déjà payées)
Testeurs PRICE_VALIDATED : 2 (50€ produit + 5€ shipping chacun)
Testeurs ACCEPTED : 1
Slots non utilisés : 5

Coût sessions complétées : 2 × 100€ = 200€
Escrow restant : 800€

Compensation testeurs PRICE_VALIDATED : 2 × (50€ + 5€ + 5€) = 120€
Compensation testeurs ACCEPTED : 1 × 5€ = 5€
Total compensations : 125€

Base remboursement : 800€ - 125€ = 675€
Frais 10% sur non-attribués : 500€ × 10% = 50€
Remboursement PRO : 625€

Distribution :
- Testeurs PRICE_VALIDATED : 120€
- Testeur ACCEPTED : 5€
- PRO : 625€
- SuperTry : 50€
```

---

## Annulations par ADMIN

### Règle 7 : Annulation par ADMIN

**Conditions :**
- Seuls les utilisateurs avec rôle `ADMIN` peuvent effectuer cette action
- Peut être effectuée à tout moment, quel que soit le statut

**Conséquences :**
- Applique les **mêmes règles que pour les annulations PRO** (Règles 5 & 6)
- **Log d'audit obligatoire** avec :
  - ID admin
  - Raison de l'annulation (champ `cancellationReason` obligatoire)
  - Timestamp
- Notification envoyée au PRO
- Compensations testeurs selon les règles applicables

**Justification :** Les admins peuvent intervenir pour résoudre des litiges ou problèmes exceptionnels.

---

## Système de Litiges

### Règle 8 : Création d'un litige

**Qui peut créer un litige :**
- ✅ TESTEUR (pour une session où il est impliqué)
- ✅ PRO (pour une session de sa campagne)
- ❌ ADMIN (les admins résolvent, ne créent pas)

**Conditions :**
- La session existe et n'est pas déjà en litige
- L'utilisateur est directement impliqué (testeur OU PRO de la session)

**Conséquences :**
- Session status → `DISPUTED`
- Notification envoyée à :
  - Tous les ADMIN
  - La partie adverse (si testeur crée → notifie PRO, et vice-versa)
- Champs mis à jour :
  - `disputedAt` : timestamp
  - `disputeReason` : raison du litige
- Session **gelée** : aucune action ne peut être effectuée tant que le litige n'est pas résolu

**Exemple de raisons de litige :**
- Testeur : "Le PRO n'a pas validé ma commande alors que le numéro est correct"
- PRO : "Le testeur n'a pas suivi les procédures de test"
- Testeur : "Le PRO refuse de valider sans raison valable"

---

### Règle 9 : Résolution d'un litige

**Qui peut résoudre :**
- ✅ ADMIN uniquement
- ❌ Testeur et PRO ne peuvent PAS résoudre leurs propres litiges

**Types de résolution :**

#### A. Remboursement complet au testeur (`refund_tester`)
- Testeur reçoit : Produit + Shipping + Bonus
- PRO : Pas de remboursement
- Commission SuperTry : 0€ (litige favorable au testeur)

#### B. Remboursement complet au PRO (`refund_pro`)
- Testeur : Aucun paiement
- PRO : Récupère le montant de cette session de l'escrow
- Commission SuperTry : 0€ (litige favorable au PRO)

#### C. Remboursement partiel (`partial_refund`)
- ADMIN spécifie un montant personnalisé
- Répartition selon la décision admin

#### D. Aucun remboursement (`no_refund`)
- Status quo maintenu
- Session marquée COMPLETED ou CANCELLED selon décision

**Conséquences :**
- Champs mis à jour :
  - `disputeResolvedAt` : timestamp
  - `disputeResolution` : décision admin
- Notifications envoyées à :
  - Testeur
  - PRO
- Transaction créée si remboursement : type `DISPUTE_RESOLUTION`
- Session status mis à jour selon résolution

---

## Règles de Ban

### Règle 10 : Ban temporaire des testeurs

**Durée :** **14 jours** (uniforme, pas d'escalade)

**Déclencheurs :**
- Annulation après acceptation (> 1h)
- Annulation après validation de prix
- Annulation après achat validé

**Mécanisme :**
- Champ `bannedUntil` dans la table `Profile`
- `bannedUntil` = maintenant + 14 jours
- Le testeur ne peut plus :
  - Voir les campagnes actives
  - Postuler à de nouvelles campagnes
  - Accéder aux listes de campagnes

**Levée du ban :**
- Automatique après expiration de `bannedUntil`
- Aucune action manuelle requise
- Le testeur peut immédiatement repostuler

**Compteur d'annulations :**
- Champ `cancellationCount` incrémenté à chaque annulation
- Champ `lastCancellationAt` mis à jour
- **Pas d'escalade** : toujours 14 jours, peu importe le nombre d'annulations

---

## Commissions et Remboursements

### Règle 11 : Commissions SuperTry

**Commission normale (test complété) :**
- 5€ fixe par test

**Commission sur annulation testeur post-achat :**
- **2.50€** (50% de la commission normale)
- Type transaction : `CANCELLATION_COMMISSION`

**Commission sur annulation PRO :**
- **10%** de l'escrow des produits non attribués
- Type transaction : `CANCELLATION_COMMISSION`

**Commission sur litiges :**
- **0€** si litige résolu
- Pas de commission prélevée en cas de litige

---

### Règle 12 : Méthodes de remboursement

**Remboursement PRO :**
- Méthode : **Stripe Refund**
- Destination : Carte bancaire originale du PRO
- Délai : 5-10 jours ouvrés
- Type transaction : `CAMPAIGN_REFUND`

**Remboursement Testeur :**
- Méthode : **Stripe Transfer**
- Destination : Compte Stripe Connect du testeur
- Délai : Immédiat (si source_transaction utilisée)
- Type transaction : `TESTER_CANCELLATION_REFUND`

**Compensation Testeur :**
- Méthode : **Stripe Transfer**
- Destination : Compte Stripe Connect du testeur
- Montant : 5€
- Type transaction : `TESTER_COMPENSATION`

---

### Règle 13 : Gestion de l'escrow

**PlatformWallet :**
- `escrowBalance` : Montant bloqué pour les campagnes actives
- `commissionBalance` : Commissions collectées

**Mise à jour escrow lors d'annulation :**

1. **Annulation PRO :**
   ```typescript
   escrowBalance -= (remboursement PRO + compensations testeurs + frais)
   commissionBalance += frais d'annulation (10%)
   ```

2. **Annulation Testeur post-achat :**
   ```typescript
   escrowBalance -= (remboursement testeur + commission SuperTry)
   commissionBalance += commission SuperTry (2.50€)
   ```

3. **Annulation PRO grace period :**
   ```typescript
   escrowBalance -= montant total
   commissionBalance += 0€ (pas de frais)
   ```

---

## Cas Particuliers

### Règle 14 : Produit physique déjà commandé

**Principe :** Le testeur **garde toujours le produit**

**Justification :**
- Gérer les retours serait trop complexe logistiquement
- Vérification de l'état du produit impossible
- Frais de retour à gérer
- Délais trop longs

**Compensation :** Le testeur garde le produit, ce qui compense partiellement l'annulation tardive et le ban de 14 jours.

---

### Règle 15 : Campagne PENDING_ACTIVATION

**Invisibilité :**
- Campagne **totalement invisible** aux testeurs
- N'apparaît dans **aucune liste** (recherche, catégories, suggestions)
- Aucun testeur ne peut postuler

**Durée :** 1h maximum

**Transition automatique :**
- Un job cron vérifie toutes les campagnes avec `activationGracePeriodEndsAt` dépassé
- Si dépassé : status → `ACTIVE`
- Campagne devient alors visible

---

### Règle 16 : Annulation avec sessions en cours

**Interdiction :**
- Une campagne ne peut **PAS** être annulée s'il existe des sessions en cours :
  - `PENDING`
  - `ACCEPTED`
  - `IN_PROGRESS`
  - `PRICE_VALIDATED`
  - `PURCHASE_SUBMITTED`
  - `PURCHASE_VALIDATED`

**Erreur retournée :**
```
"Cannot cancel campaign with X active test session(s).
Wait for sessions to complete or be cancelled."
```

**Solution :** Le PRO doit attendre que :
- Les testeurs annulent eux-mêmes
- Les sessions se terminent (COMPLETED)
- Ou contacter les testeurs pour négocier

---

## Résumé des Flux Financiers

### Flux 1 : Testeur annule post-achat
```
Escrow (PRO) → Testeur (remboursement) : 60€
Escrow (PRO) → SuperTry (commission) : 2.50€
Total coût PRO : 62.50€
Testeur garde le produit (~50€ de valeur)
```

### Flux 2 : PRO annule avec testeurs acceptés
```
Escrow → Testeurs acceptés (compensation) : 5€ × N
Escrow → PRO (remboursement) : reste - 10% frais
Escrow → SuperTry (frais) : 10% du restant
```

### Flux 3 : PRO annule grace period
```
Escrow → PRO (remboursement) : 100% escrow
Aucuns frais
```

### Flux 4 : Litige résolu pro
```
Testeur : 0€
PRO récupère : montant session
SuperTry : 0€
```

---

## Notifications

### Événements notifiés :

1. **CAMPAIGN_CANCELLED** : PRO annule → email à tous les testeurs impliqués
2. **SESSION_CANCELLED_BY_TESTER** : Testeur annule → email au PRO
3. **SESSION_CANCELLED_BY_PRO** : PRO annule session → email au testeur
4. **DISPUTE_CREATED** : Litige créé → email ADMIN + partie adverse
5. **DISPUTE_RESOLVED** : Litige résolu → email testeur + PRO
6. **TESTER_BANNED** : Testeur banni → email au testeur avec date de levée
7. **CANCELLATION_REFUND_PROCESSED** : Remboursement traité → email bénéficiaire

---

## Historique et Traçabilité

**Audit Logs obligatoires :**
- Toutes les annulations enregistrées dans `audit_logs`
- Catégorie : `CAMPAIGN` ou `SESSION`
- Détails : montants, raisons, acteurs

**Transactions :**
- Toutes les opérations financières enregistrées dans `transactions`
- Stripe IDs conservés pour réconciliation
- Metadata riches pour traçabilité

---

**Version :** 1.0
**Dernière mise à jour :** 2026-02-09
**Auteur :** SuperTry Team
