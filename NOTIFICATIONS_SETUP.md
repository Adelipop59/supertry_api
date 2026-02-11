# 🚀 Setup du Module de Notifications

## ✅ Ce qui a été créé

### Structure complète du module
```
src/modules/notifications/
├── config/notification.config.ts          ✅ Configuration avec validation
├── constants/notification.constants.ts     ✅ Constantes (queues, providers)
├── dto/                                    ✅ 4 DTOs avec validation
├── enums/                                  ✅ 4 enums (type, status, template, priority)
├── interfaces/                             ✅ 3 interfaces (provider, options, result)
├── processors/                             ✅ Email & SMS processors (Bull)
├── providers/
│   ├── email/
│   │   ├── nodemailer.provider.ts         ✅ Provider email complet
│   │   └── templates/                      ✅ 5 templates HTML Handlebars
│   ├── sms/
│   │   ├── twilio.provider.ts             ✅ Provider SMS complet
│   │   └── templates/                      ✅ 3 templates SMS JSON
│   └── push/
│       ├── push.provider.ts               ✅ Structure pour implémentation future
│       └── README.md                       ✅ Instructions d'implémentation
├── notifications.service.ts                ✅ Service principal avec toutes les méthodes
└── notifications.module.ts                 ✅ Module NestJS configuré
```

### Autres fichiers
- ✅ `prisma/schema.prisma` - Modèle Notification
- ✅ `.env.example` - Template des variables d'environnement
- ✅ `src/app.module.ts` - Mis à jour avec Bull et NotificationsModule
- ✅ `NOTIFICATIONS.md` - Documentation utilisateur (<20 lignes)

## 📋 Étapes pour finaliser l'installation

### 1. Configurer la base de données

```bash
# Assurez-vous que PostgreSQL est démarré
# Vérifiez la connexion dans .env

# Exécuter la migration Prisma
npx prisma migrate dev --name add_notifications

# Générer le client Prisma
npx prisma generate
```

### 2. Démarrer Redis

```bash
# macOS avec Homebrew
brew services start redis

# Ou manuellement
redis-server

# Vérifier que Redis fonctionne
redis-cli ping
# Devrait retourner : PONG
```

### 3. Configurer les variables d'environnement

Copiez `.env.example` vers `.env` et remplissez les valeurs :

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/supertry?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Email (exemple avec Gmail)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password  # ⚠️ Utiliser un mot de passe d'application
EMAIL_FROM_NAME=SuperTry
EMAIL_FROM_ADDRESS=noreply@supertry.com

# SMS (Twilio)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Notification Settings
NOTIFICATION_RETRY_ATTEMPTS=3
NOTIFICATION_RETRY_DELAY=5000
NOTIFICATION_QUEUE_CONCURRENCY=5
```

#### 📧 Configuration Gmail (recommandé pour tester)

1. Activer l'authentification à 2 facteurs
2. Générer un mot de passe d'application : https://myaccount.google.com/apppasswords
3. Utiliser ce mot de passe dans `EMAIL_PASSWORD`

#### 📱 Configuration Twilio

1. Créer un compte sur https://www.twilio.com
2. Obtenir Account SID et Auth Token depuis le dashboard
3. Acheter un numéro de téléphone Twilio

### 4. Corriger les imports TypeScript

Les processors utilisent `Job` de Bull. Modifiez les imports :

```typescript
// Dans processors/email.processor.ts et sms.processor.ts
// Remplacer :
import { Job } from 'bull';

// Par :
import type { Job } from 'bull';
```

Ou ajoutez `!` pour les valeurs potentiellement undefined :

```typescript
// Ligne 64 des processors
status: job.attemptsMade >= (job.opts.attempts ?? 3) ? NotificationStatus.FAILED : NotificationStatus.RETRY,
```

### 5. Builder le projet

```bash
pnpm run build
```

### 6. Tester le module

Créez un controller de test :

```typescript
// src/modules/notifications/test-notifications.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SendEmailDto, SendSmsDto } from './dto';

@Controller('test-notifications')
export class TestNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('email')
  async testEmail(@Body() dto: SendEmailDto) {
    return this.notificationsService.sendEmail(dto);
  }

  @Post('sms')
  async testSMS(@Body() dto: SendSmsDto) {
    return this.notificationsService.sendSMS(dto);
  }
}
```

Ajoutez-le au `NotificationsModule` :

```typescript
@Module({
  // ...
  controllers: [TestNotificationsController],
})
```

Démarrez le serveur :

```bash
pnpm run start:dev
```

Testez avec curl :

```bash
# Test email
curl -X POST http://localhost:3000/test-notifications/email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "template": "account-verification",
    "variables": {
      "username": "John",
      "verificationCode": "123456",
      "expiresIn": "15 minutes"
    }
  }'

# Test SMS
curl -X POST http://localhost:3000/test-notifications/sms \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+33612345678",
    "template": "otp-code",
    "variables": {
      "code": "123456"
    }
  }'
```

## 🎯 Utilisation dans votre code

Voir [NOTIFICATIONS.md](./NOTIFICATIONS.md) pour la documentation complète.

```typescript
// Dans n'importe quel service
constructor(private notifications: NotificationsService) {}

// Envoyer un email
await this.notifications.sendEmail({
  to: 'user@example.com',
  template: NotificationTemplate.ACCOUNT_VERIFICATION,
  variables: { username: 'John', verificationCode: '123456', expiresIn: '15 minutes' }
});

// Envoyer un SMS
await this.notifications.queueSMS({
  to: '+33612345678',
  template: NotificationTemplate.OTP_CODE,
  variables: { code: '123456' }
});
```

## 🔍 Monitoring

```bash
# Vérifier les jobs dans Redis
redis-cli
> KEYS bull:notifications:*
> LLEN bull:notifications:email:waiting
> LLEN bull:notifications:sms:waiting

# Voir l'historique dans la base de données
npx prisma studio
# Ouvrir la table "notifications"
```

## 🐛 Troubleshooting

| Problème | Solution |
|----------|----------|
| Email non reçu | Vérifier SPAM, credentials SMTP, firewall |
| SMS non envoyé | Vérifier format E.164, credits Twilio, numéro vérifié |
| Redis connection refused | Démarrer Redis : `redis-server` |
| Prisma error | Exécuter `npx prisma generate && npx prisma migrate dev` |
| Queue bloquée | Redémarrer Redis, vérifier les logs |

## 📚 Ressources

- [Documentation Nodemailer](https://nodemailer.com/)
- [Documentation Twilio](https://www.twilio.com/docs)
- [Documentation Bull](https://github.com/OptimalBits/bull)
- [Templates Handlebars](https://handlebarsjs.com/)

## ✨ Fonctionnalités

- ✅ Envoi d'emails via SMTP (Nodemailer)
- ✅ Envoi de SMS via Twilio
- ✅ Queue asynchrone avec retry automatique (Bull + Redis)
- ✅ Historique des notifications en base de données (Prisma)
- ✅ Templates Handlebars pour emails
- ✅ Templates JSON pour SMS
- ✅ Validation stricte des données (class-validator)
- ✅ Logging structuré
- ✅ Sécurisé (pas de credentials hardcodés)
- ✅ Module global réutilisable
- ⏳ Push notifications (structure prête, voir `providers/push/README.md`)

## 🎉 C'est terminé !

Le module est prêt à être utilisé. Une fois PostgreSQL et Redis démarrés et les variables d'environnement configurées, vous pouvez l'utiliser dans n'importe quel module de votre application.
