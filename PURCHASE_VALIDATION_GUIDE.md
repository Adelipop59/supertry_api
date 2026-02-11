# Guide: Validation d'achat par le PRO

## 📋 Vue d'ensemble

Lors de la validation d'achat, le **PRO** peut:
1. **Valider tel quel** les montants saisis par le TESTEUR
2. **Corriger les montants** si le TESTEUR a fait une erreur
3. **Ajouter un commentaire** pour expliquer la correction

## 🔄 Flow complet

### Mode PROCEDURES

```
1. TESTEUR complète les procédures → PROCEDURES_COMPLETED
2. TESTEUR valide le prix du produit → PRICE_VALIDATED
3. TESTEUR achète et soumet:
   - orderNumber: "123-456-789"
   - productPrice: 45.00 (ce que le testeur a payé)
   - shippingCost: 3.00 (ce que le testeur a payé)
   - purchaseProofUrl: "https://..." (facture/preuve)
   → Status: PURCHASE_SUBMITTED

4. PRO vérifie la preuve d'achat et peut:

   A) Valider tel quel (testeur a bien saisi):
      POST /test-sessions/:id/validate-purchase
      Body: {} (vide ou omis)

   B) Corriger le prix produit uniquement:
      POST /test-sessions/:id/validate-purchase
      Body: {
        "productPrice": 47.00,
        "purchaseValidationComment": "Prix corrigé d'après la facture"
      }

   C) Corriger prix + frais de port:
      POST /test-sessions/:id/validate-purchase
      Body: {
        "productPrice": 47.00,
        "shippingCost": 4.50,
        "purchaseValidationComment": "Montants corrigés d'après la preuve"
      }

   → Status: PURCHASE_VALIDATED

5. Les montants FINAUX utilisés pour le remboursement sont ceux du PRO (ou du testeur si non modifiés)
```

## 🎯 Cas d'usage

### Cas 1: Testeur a bien saisi (le plus fréquent)

**TESTEUR soumet:**
```json
{
  "orderNumber": "123-456-789",
  "productPrice": 45.00,
  "shippingCost": 3.00,
  "purchaseProofUrl": "https://example.com/proof.pdf"
}
```

**PRO valide (facture confirme 45€ + 3€):**
```bash
POST /api/v1/test-sessions/:id/validate-purchase
# Body vide ou {}
```

**Remboursement final:**
- Prix produit: 45.00€
- Frais port: 3.00€
- Bonus: 10.00€
- **TOTAL: 58.00€**

---

### Cas 2: Testeur s'est trompé sur le prix

**TESTEUR soumet:**
```json
{
  "orderNumber": "123-456-789",
  "productPrice": 45.00,  // ❌ Erreur! La facture dit 47€
  "shippingCost": 3.00,
  "purchaseProofUrl": "https://example.com/proof.pdf"
}
```

**PRO corrige après avoir vu la facture:**
```json
POST /api/v1/test-sessions/:id/validate-purchase
{
  "productPrice": 47.00,
  "purchaseValidationComment": "Prix corrigé d'après la facture Amazon"
}
```

**Remboursement final:**
- Prix produit: 47.00€ ✅ (corrigé par PRO)
- Frais port: 3.00€
- Bonus: 10.00€
- **TOTAL: 60.00€**

---

### Cas 3: Testeur s'est trompé sur les deux montants

**TESTEUR soumet:**
```json
{
  "orderNumber": "123-456-789",
  "productPrice": 45.00,  // ❌ Facture dit 47€
  "shippingCost": 3.00,   // ❌ Facture dit 4.50€
  "purchaseProofUrl": "https://example.com/proof.pdf"
}
```

**PRO corrige les deux:**
```json
POST /api/v1/test-sessions/:id/validate-purchase
{
  "productPrice": 47.00,
  "shippingCost": 4.50,
  "purchaseValidationComment": "Montants corrigés selon la facture"
}
```

**Remboursement final:**
- Prix produit: 47.00€ ✅ (corrigé par PRO)
- Frais port: 4.50€ ✅ (corrigé par PRO)
- Bonus: 10.00€
- **TOTAL: 61.50€**

---

### Cas 4: Communication via chat avant validation

**Scénario:**
1. TESTEUR soumet avec productPrice=45€, shippingCost=3€
2. PRO voit sur la facture: 47€ produit + 4.50€ port
3. PRO envoie message dans le chat: "Bonjour, je vois 47€ sur la facture, pas 45€. Peux-tu vérifier?"
4. TESTEUR répond: "Ah oui désolé, j'ai oublié les taxes!"
5. PRO corrige et valide:

```json
POST /api/v1/test-sessions/:id/validate-purchase
{
  "productPrice": 47.00,
  "shippingCost": 4.50,
  "purchaseValidationComment": "Montants corrigés après échange avec le testeur (taxes incluses)"
}
```

## 📊 DTO: ValidatePurchaseDto

```typescript
export class ValidatePurchaseDto {
  // Optionnel: PRO peut override le prix produit
  @IsOptional()
  @IsNumber()
  @Min(0)
  productPrice?: number;

  // Optionnel: PRO peut override les frais de port
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  // Optionnel: PRO peut ajouter un commentaire
  @IsOptional()
  @IsString()
  @MaxLength(500)
  purchaseValidationComment?: string;
}
```

## ⚙️ Logique backend

```typescript
async validatePurchase(
  sessionId: string,
  sellerId: string,
  dto?: ValidatePurchaseDto,
): Promise<TestSessionResponseDto> {
  // Vérifications...

  const updateData: any = {
    status: SessionStatus.PURCHASE_VALIDATED,
    purchaseValidatedAt: new Date(),
  };

  // Si PRO fournit un nouveau prix, on l'utilise
  if (dto?.productPrice !== undefined) {
    updateData.productPrice = dto.productPrice;
  }
  // Sinon, on garde celui du TESTEUR

  // Pareil pour les frais de port
  if (dto?.shippingCost !== undefined) {
    updateData.shippingCost = dto.shippingCost;
  }

  // Commentaire optionnel
  if (dto?.purchaseValidationComment) {
    updateData.purchaseValidationComment = dto.purchaseValidationComment;
  }

  return await this.prisma.testSession.update({
    where: { id: sessionId },
    data: updateData,
  });
}
```

## 🔒 Sécurité

### ✅ Avantages de cette approche:

1. **Le PRO a le dernier mot**: Il voit la preuve d'achat et peut corriger les erreurs
2. **Traçabilité**: Le `purchaseValidationComment` permet d'expliquer les modifications
3. **Flexibilité**: Le PRO peut valider rapidement (body vide) ou corriger si besoin
4. **Protection contre la fraude**: Le TESTEUR ne peut pas mentir sur les montants

### ⚠️ Points d'attention:

1. **Montants MAX toujours respectés**: Le système devrait vérifier que les montants corrigés ne dépassent pas les max de l'offre
2. **Historique**: On pourrait logger les modifications (montant avant/après) dans l'audit
3. **Notification**: Le TESTEUR devrait être notifié si les montants sont modifiés

## 📝 Exemple de script de test

```typescript
// Test avec correction de montants
async function validatePurchaseWithCorrection() {
  // TESTEUR soumet avec erreur
  await request('POST', `/test-sessions/${sessionId}/submit-purchase`, {
    orderNumber: '123-456',
    productPrice: 45.00,  // Erreur
    shippingCost: 3.00,   // OK
    purchaseProofUrl: 'https://...',
  }, true);

  // PRO corrige le prix
  await request('POST', `/test-sessions/${sessionId}/validate-purchase`, {
    productPrice: 47.00,  // Corrigé
    purchaseValidationComment: 'Prix corrigé selon facture',
  });

  // Le remboursement utilisera 47€ + 3€ + 10€ = 60€
}
```

## 🎉 Résumé

- ✅ TESTEUR soumet les montants qu'il a payés
- ✅ PRO vérifie la preuve d'achat
- ✅ PRO peut corriger si erreur
- ✅ Les montants FINAUX (après validation PRO) sont utilisés pour le remboursement
- ✅ Traçabilité via `purchaseValidationComment`
- ✅ Communication via chat avant validation si besoin
