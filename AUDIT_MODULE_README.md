# Module d'Audit - Documentation

Module générique d'audit qui enregistre **tous les mouvements** de l'application (inscription, connexion, logout, actions futures) dans une base de données PostgreSQL.

## Caractéristiques

- **Enregistrement automatique** : Intercepteur global qui capture toutes les requêtes HTTP
- **Enregistrement manuel** : Décorateur `@Audit()` pour enrichir les logs
- **Conforme RGPD** : Données minimales (userId, action, timestamp), rétention 90 jours
- **Cleanup automatique** : Cron job quotidien qui supprime les logs > 90 jours
- **API REST** : Endpoints pour consulter, filtrer et gérer les logs
- **Générique** : Utilisable par tous les modules futurs (produits, campagnes, etc.)

---

## Installation et Configuration

### 1. Démarrer la base de données

Votre projet utilise **Prisma Postgres** (développement local).

```bash
# Démarrer la base de données Prisma Postgres
npx prisma dev

# Ou si vous utilisez une autre base PostgreSQL
# Assurez-vous qu'elle tourne sur le port configuré dans .env
```

### 2. Appliquer les migrations

```bash
# Créer et appliquer la migration pour le module audit
npx prisma migrate dev --name add-audit-logs

# Vérifier que la table audit_logs a été créée
npx prisma studio
```

### 3. Vérifier la configuration

Le fichier [.env](.env) contient déjà `DATABASE_URL`. Vérifiez qu'elle pointe vers votre base de données.

---

## Structure du Module

```
src/
├── database/
│   ├── prisma.service.ts      # Service de connexion DB
│   └── prisma.module.ts       # Module global Prisma
│
├── modules/audit/
│   ├── audit.module.ts        # Module principal (Global)
│   ├── audit.service.ts       # Logique métier
│   ├── audit.controller.ts    # API REST
│   ├── audit.scheduler.ts     # Cron jobs cleanup
│   └── dto/
│       ├── audit-filter.dto.ts      # Filtres de recherche
│       └── create-audit.dto.ts      # DTO de création
│
├── common/
│   ├── interceptors/
│   │   └── audit.interceptor.ts     # Intercepteur global
│   └── decorators/
│       └── audit.decorator.ts       # Décorateur @Audit()
│
└── app.module.ts              # Configuration globale
```

---

## Schéma de Base de Données

### Enum `AuditCategory`

```typescript
enum AuditCategory {
  AUTH       // Authentification (login, logout, signup)
  USER       // Actions utilisateur (update profile, etc.)
  ADMIN      // Actions administrateur
  PRODUCT    // Actions sur produits (futurs modules)
  CAMPAIGN   // Actions sur campagnes
  SESSION    // Actions sur sessions
  WALLET     // Actions sur portefeuilles
  MESSAGE    // Actions sur messages
  SYSTEM     // Actions système
  OTHER      // Autres actions
}
```

### Table `audit_logs`

| Colonne      | Type           | Description                                      |
| ------------ | -------------- | ------------------------------------------------ |
| id           | UUID           | Identifiant unique                               |
| user_id      | UUID (nullable)| ID de l'utilisateur (null pour actions système) |
| category     | AuditCategory  | Catégorie de l'action                            |
| action       | String         | Description de l'action (ex: "LOGIN_SUCCESS")    |
| details      | JSON (nullable)| Données additionnelles                           |
| created_at   | DateTime       | Date de création                                 |

**Index** : `userId`, `category`, `createdAt`, `action` (pour performances)

---

## Utilisation

### 1. Enregistrement Automatique (Intercepteur)

L'intercepteur `AuditInterceptor` est **déjà configuré globalement** dans [app.module.ts](src/app.module.ts). Il capture automatiquement toutes les requêtes HTTP.

**Aucune action requise** - tous les mouvements sont enregistrés automatiquement !

```typescript
// Exemple: Une requête GET /users/123
// Génère automatiquement un log:
{
  userId: "user-id-from-jwt",
  category: "USER",
  action: "GET_USERS",
  details: { method: "GET", url: "/users/123", statusCode: 200 }
}
```

### 2. Enregistrement Manuel (Décorateur)

Utilisez le décorateur `@Audit()` pour **enrichir** les logs automatiques :

```typescript
import { Controller, Post } from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditCategory } from '@prisma/client';

@Controller('auth')
export class AuthController {
  @Post('login')
  @Audit({ category: AuditCategory.AUTH, action: 'LOGIN_SUCCESS' })
  async login() {
    // ...
  }

  @Post('signup')
  @Audit({ category: AuditCategory.AUTH, action: 'SIGNUP_SUCCESS' })
  async signup() {
    // ...
  }
}
```

### 3. Enregistrement Programmatique

Injectez `AuditService` dans n'importe quel service :

```typescript
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly auditService: AuditService) {}

  async createProduct(userId: string, data: any) {
    const product = await this.prisma.product.create({ data });

    // Log l'action manuellement
    await this.auditService.log(
      userId,
      AuditCategory.PRODUCT,
      'PRODUCT_CREATED',
      { productId: product.id, name: product.name }
    );

    return product;
  }
}
```

---

## API REST

### Endpoints disponibles

```
POST   /audit                - Créer log manuel (ADMIN only)
GET    /audit                - Liste tous logs (ADMIN, pagination, filtres)
GET    /audit/me             - Logs de l'utilisateur connecté
GET    /audit/stats          - Statistiques agrégées (ADMIN)
DELETE /audit/cleanup        - Cleanup manuel (ADMIN)
```

### Exemples d'utilisation

#### 1. Lister tous les logs (avec filtres)

```bash
GET /audit?category=AUTH&limit=20&offset=0
```

Réponse :
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "user-id",
      "category": "AUTH",
      "action": "LOGIN_SUCCESS",
      "details": { "method": "POST", "url": "/auth/login" },
      "createdAt": "2026-02-03T12:00:00Z",
      "user": {
        "email": "user@example.com",
        "firstName": "John"
      }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

#### 2. Récupérer les logs d'un utilisateur

```bash
GET /audit/me?userId=user-123
```

#### 3. Obtenir les statistiques

```bash
GET /audit/stats?startDate=2026-01-01&endDate=2026-02-01
```

Réponse :
```json
{
  "totalLogs": 1250,
  "byCategory": {
    "AUTH": 450,
    "USER": 300,
    "PRODUCT": 200,
    "OTHER": 300
  },
  "recentActions": [
    { "action": "LOGIN_SUCCESS", "count": 120 },
    { "action": "PROFILE_UPDATED", "count": 80 }
  ]
}
```

#### 4. Cleanup manuel

```bash
DELETE /audit/cleanup?days=30
```

Réponse :
```json
{
  "message": "Cleaned up 450 audit logs older than 30 days",
  "deletedCount": 450
}
```

---

## Cleanup Automatique (RGPD)

Le module inclut un **cron job** qui s'exécute automatiquement :

- **Quotidien** : Tous les jours à 3h du matin (supprime logs > 90 jours)
- **Hebdomadaire** : Tous les dimanches à minuit (optionnel)

Configuration dans [audit.scheduler.ts](src/modules/audit/audit.scheduler.ts).

Pour **désactiver** le cleanup automatique, commentez les méthodes dans `AuditScheduler`.

---

## Conformité RGPD

✅ **Base légale** : Intérêt légitime (sécurité) - Article 6.1.f RGPD
✅ **Données minimales** : userId (anonyme), action, timestamp uniquement
✅ **Droit d'accès** : L'utilisateur peut consulter ses logs via `GET /audit/me`
✅ **Droit à l'effacement** : Cleanup automatique après 90 jours
⚠️ **Obligation** : Mentionner dans la politique de confidentialité

---

## Exemples d'Intégration

### Intégration dans un module Auth

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditCategory } from '@prisma/client';

@Controller('auth')
export class AuthController {
  @Post('login')
  @Audit({ category: AuditCategory.AUTH, action: 'LOGIN_SUCCESS' })
  async login(@Body() loginDto: LoginDto) {
    // Login logic...
    return { token: 'jwt-token' };
  }

  @Post('logout')
  @Audit({ category: AuditCategory.AUTH, action: 'LOGOUT' })
  async logout() {
    // Logout logic...
    return { message: 'Logged out successfully' };
  }
}
```

### Intégration dans un module User

```typescript
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async updateProfile(userId: string, data: UpdateProfileDto) {
    const updated = await this.prisma.profile.update({
      where: { id: userId },
      data,
    });

    // Log la modification
    await this.auditService.log(
      userId,
      AuditCategory.USER,
      'PROFILE_UPDATED',
      { fields: Object.keys(data) }
    );

    return updated;
  }
}
```

---

## Tester le Module

### 1. Démarrer l'application

```bash
pnpm start:dev
```

### 2. Tester l'enregistrement automatique

Faites une requête à n'importe quel endpoint :

```bash
curl http://localhost:3000/users
```

Vérifiez que le log a été créé :

```bash
# Ouvrir Prisma Studio
npx prisma studio

# Aller dans la table audit_logs
# Vous devriez voir un log "GET_USERS"
```

### 3. Tester les endpoints d'audit

```bash
# Lister les logs
curl http://localhost:3000/audit

# Obtenir les stats
curl http://localhost:3000/audit/stats

# Cleanup manuel
curl -X DELETE http://localhost:3000/audit/cleanup?days=1
```

---

## Prochaines Étapes

1. **Sécuriser les endpoints** : Ajouter des guards pour limiter l'accès aux ADMIN
2. **Extraire userId automatiquement** : Intégrer avec votre système d'auth (Lucia)
3. **Ajouter des catégories** : Étendre `AuditCategory` selon vos modules futurs
4. **Monitoring** : Intégrer avec un système de monitoring (Sentry, DataDog, etc.)

---

## Questions Fréquentes

**Q: Comment ajouter une nouvelle catégorie ?**
R: Ajoutez-la dans l'enum `AuditCategory` dans [schema.prisma](prisma/schema.prisma), puis lancez `npx prisma migrate dev`.

**Q: Comment désactiver le logging pour certains endpoints ?**
R: L'intercepteur skip déjà les endpoints `/audit`. Ajoutez vos propres conditions dans `audit.interceptor.ts`.

**Q: Les logs ralentissent-ils l'application ?**
R: Non, le logging est en mode **fire-and-forget** (asynchrone). Les erreurs de logging ne bloquent jamais la réponse.

**Q: Puis-je modifier la durée de rétention ?**
R: Oui, modifiez le paramètre dans `audit.scheduler.ts` (90 jours par défaut).

---

## Support

Pour toute question ou problème, consultez :
- [Plan d'implémentation](.claude/plans/glistening-mixing-hummingbird.md)
- [Documentation Prisma](https://www.prisma.io/docs)
- [Documentation NestJS](https://docs.nestjs.com)
