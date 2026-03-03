# Guide i18n Backend - Pour l'agent IA Frontend

## Principe

Le backend gere la traduction de **tous les messages** (erreurs, succes, notifications). Le frontend recoit des messages **deja traduits** dans la langue de l'utilisateur. Le frontend n'a PAS besoin de fichiers de traduction pour les messages backend.

---

## 1. Definir la langue de l'utilisateur

### Header `x-lang` (priorite maximale)

Envoyer sur **chaque requete HTTP** :

```
x-lang: fr
```

Valeurs acceptees : `fr`, `en`, `es`, `de`, `it`, `pt`

### Ordre de resolution cote backend

1. Header `x-lang` (override explicite)
2. `profile.preferredLanguage` de l'utilisateur authentifie
3. Header `Accept-Language`
4. Fallback : `fr`

### Changer la langue preferee (persistant)

```
PATCH /users/me/language
Body: { "language": "EN" }
```

Valeurs enum : `FR`, `EN`, `ES`, `DE`, `IT`, `PT`

Apres cet appel, meme sans header `x-lang`, le backend utilisera cette langue.

---

## 2. Format des reponses erreur

**Toutes** les erreurs suivent ce format :

```json
{
  "statusCode": 404,
  "message": "Cette campagne n'existe pas ou a ete supprimee.",
  "error": "Not Found",
  "errorCode": "CAMPAIGN_NOT_FOUND",
  "timestamp": "2026-03-03T12:00:00.000Z",
  "path": "/campaigns/abc123"
}
```

### Champs

| Champ | Type | Description |
|-------|------|-------------|
| `statusCode` | `number` | Code HTTP (400, 401, 403, 404, 409, 500) |
| `message` | `string \| string[]` | Message traduit, pret a afficher a l'utilisateur. Array pour les erreurs de validation |
| `error` | `string` | Nom HTTP standard (`Bad Request`, `Not Found`, etc.) |
| `errorCode` | `string?` | Code machine unique pour le frontend (toujours present sauf anciennes erreurs) |
| `timestamp` | `string` | ISO 8601 |
| `path` | `string` | URL de la requete |

### Champs supplementaires (selon contexte)

Certaines erreurs incluent des champs extra a la racine :

```json
{
  "statusCode": 400,
  "message": "Une verification d'identite est necessaire.",
  "errorCode": "SESSION_KYC_REQUIRED",
  "identityRequired": true,
  "verificationUrl": "https://...",
  "clientSecret": "vs_..."
}
```

| Champ extra | Quand | Usage |
|-------------|-------|-------|
| `identityRequired: true` | `SESSION_KYC_REQUIRED`, `SESSION_STRIPE_REQUIRED` | Afficher le flow de verification Stripe Identity |
| `onboardingRequired: true` | `SESSION_ONBOARDING_REQUIRED` | Rediriger vers l'onboarding Stripe Connect |
| `verificationBlocked: true` | `SESSION_IDENTITY_BLOCKED` | Afficher message "compte en cours de verification" |
| `verificationUrl` | `SESSION_KYC_REQUIRED` | URL pour lancer la verification Identity |
| `clientSecret` | `SESSION_KYC_REQUIRED` | Secret pour le SDK Stripe Identity |

---

## 3. Comment utiliser `errorCode` dans le frontend

Le `message` est **toujours affichable** directement a l'utilisateur. Le `errorCode` sert a declencher des **actions specifiques** cote frontend :

```typescript
try {
  await api.post('/test-sessions/apply', { campaignId });
} catch (error) {
  const { errorCode, message } = error.response.data;

  switch (errorCode) {
    case 'SESSION_KYC_REQUIRED':
      // Ouvrir le flow Stripe Identity avec verificationUrl/clientSecret
      openIdentityVerification(error.response.data);
      break;

    case 'SESSION_ONBOARDING_REQUIRED':
      // Rediriger vers l'onboarding Stripe Connect
      navigateTo('/stripe/onboarding');
      break;

    case 'SESSION_STRIPE_REQUIRED':
      // Demander a l'utilisateur de creer son compte Stripe
      navigateTo('/stripe/setup');
      break;

    case 'SESSION_BANNED':
      // Afficher le message (contient deja la date de fin)
      showBanScreen(message);
      break;

    default:
      // Afficher le message traduit directement
      showToast(message);
  }
}
```

---

## 4. Erreurs de validation (422 / 400)

Les erreurs `class-validator` renvoient un **array** de messages :

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "phone must be a valid phone number"
  ],
  "error": "Bad Request"
}
```

Gerer les deux cas :

```typescript
const messages = Array.isArray(data.message) ? data.message : [data.message];
```

---

## 5. Codes erreur par domaine

### Auth

| errorCode | Quand | Action frontend suggeree |
|-----------|-------|--------------------------|
| `AUTH_INVALID_CREDENTIALS` | Login echoue | Afficher message sur le form |
| `AUTH_EMAIL_EXISTS` | Signup email deja pris | Proposer login |
| `AUTH_EMAIL_LINKED_OAUTH` | Email lie a OAuth | Afficher le provider dans le message |
| `AUTH_OAUTH_REQUIRED` | Compte OAuth, tentative login mot de passe | Rediriger vers OAuth du provider |
| `AUTH_ACCOUNT_DISABLED` | Compte desactive | Afficher message + lien support |
| `AUTH_SESSION_EXPIRED` | Session expiree | Rediriger vers login |
| `AUTH_SESSION_INVALID` | Session invalide | Rediriger vers login |
| `AUTH_INCORRECT_PASSWORD` | Changement mot de passe | Afficher message sur le champ |
| `AUTH_CANNOT_CHANGE_PASSWORD` | Compte OAuth | Cacher le formulaire mot de passe |
| `AUTH_PROFILE_COMPLETED` | Profil deja complete | Ignorer, rediriger vers home |
| `PROFILE_INCOMPLETE` | Profil non complete | Rediriger vers completion profil |

### Session (test)

| errorCode | Quand | Action frontend suggeree |
|-----------|-------|--------------------------|
| `SESSION_KYC_REQUIRED` | Verification identite requise | Ouvrir Stripe Identity (voir champs extra) |
| `SESSION_STRIPE_REQUIRED` | Pas de compte Stripe | Rediriger vers creation Stripe |
| `SESSION_ONBOARDING_REQUIRED` | Onboarding Stripe incomplet | Rediriger vers onboarding |
| `SESSION_BANNED` | Utilisateur temporairement banni | Afficher message (date incluse) |
| `SESSION_IDENTITY_BLOCKED` | Verification en cours | Afficher message attente |
| `SESSION_INVALID_STATUS` | Action impossible dans cet etat | Toast message |
| `SESSION_NOT_OWNER` | Pas proprietaire | Toast message |
| `CAMPAIGN_NO_SLOTS` | Plus de places | Desactiver bouton postuler |
| `CAMPAIGN_NOT_ACTIVE` | Campagne non active | Retour a la liste |

### Campagne

| errorCode | Quand |
|-----------|-------|
| `CAMPAIGN_NOT_FOUND` | Campagne inexistante/supprimee |
| `CAMPAIGN_NOT_OWNER` | Pas proprietaire |
| `CAMPAIGN_ONLY_DRAFT` | Seuls les brouillons peuvent etre actives |
| `CAMPAIGN_PAYMENT_AUTHORIZED` | Paiement deja en cours |
| `CAMPAIGN_ALREADY_CANCELLED` | Deja annulee |

### Stripe / Paiement

| errorCode | Quand |
|-----------|-------|
| `STRIPE_NO_ACCOUNT` | Pas de compte Stripe Connect |
| `STRIPE_WEBHOOK_INVALID` | Webhook invalide (ignorer cote frontend) |
| `PAYMENT_FAILED` | Echec paiement |
| `PAYMENT_REFUND_FAILED` | Echec remboursement |

### Generiques

| errorCode | Quand |
|-----------|-------|
| `FORBIDDEN` | Permissions insuffisantes |
| `NOT_FOUND` | Element introuvable (Prisma) |
| `DUPLICATE_ENTRY` | Doublon (Prisma unique constraint) |
| `INTERNAL_ERROR` | Erreur serveur inattendue |

---

## 6. Traduction du contenu utilisateur (LibreTranslate)

Pour traduire du contenu genere par les utilisateurs (messages chat, descriptions) :

### Traduire un texte

```
POST /translate
Body: {
  "text": "Bonjour, comment ca va ?",
  "targetLang": "en",
  "sourceLang": "auto"   // optionnel, detection automatique
}

Response: {
  "translatedText": "Hello, how are you?",
  "detectedSourceLang": "fr"
}
```

### Traduire un lot de textes

```
POST /translate/batch
Body: {
  "texts": ["Bonjour", "Au revoir"],
  "targetLang": "en"
}

Response: {
  "translatedTexts": ["Hello", "Goodbye"]
}
```

### Verifier la disponibilite

```
GET /translate/status

Response: { "available": true }
```

> **Note** : Ces endpoints sont authentifies. Le service peut etre indisponible si LibreTranslate n'est pas lance.

---

## 7. Resume : ce que le frontend doit faire

1. **Envoyer `x-lang`** sur chaque requete (ou appeler `PATCH /users/me/language` une fois)
2. **Afficher `message`** directement a l'utilisateur (c'est deja traduit et user-friendly)
3. **Utiliser `errorCode`** pour les actions programmatiques (redirection, affichage conditionnel)
4. **Gerer les champs extra** (`identityRequired`, `onboardingRequired`, etc.) pour les flows specifiques
5. **Ne PAS hardcoder** de messages d'erreur cote frontend — tout vient du backend
