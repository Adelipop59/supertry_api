# Guide de Démarrage Rapide - Module Audit

## Étapes pour démarrer

### 1. Démarrer la base de données
```bash
npx prisma dev
```

### 2. Appliquer les migrations
```bash
npx prisma migrate dev --name add-audit-logs
npx prisma generate
```

### 3. Démarrer l'application
```bash
pnpm start:dev
```

### 4. Tester le module
```bash
# L'application tourne sur http://localhost:3000

# Tester un endpoint (génère un log automatique)
curl http://localhost:3000

# Voir les logs d'audit
curl http://localhost:3000/audit

# Voir les statistiques
curl http://localhost:3000/audit/stats
```

## Fichiers créés

✅ Schéma Prisma : `prisma/schema.prisma` (modèle AuditLog + enum AuditCategory)
✅ Service : `src/modules/audit/audit.service.ts`
✅ Controller : `src/modules/audit/audit.controller.ts`
✅ Module : `src/modules/audit/audit.module.ts`
✅ Scheduler : `src/modules/audit/audit.scheduler.ts`
✅ Intercepteur : `src/common/interceptors/audit.interceptor.ts`
✅ Décorateur : `src/common/decorators/audit.decorator.ts`
✅ DTOs : `src/modules/audit/dto/`
✅ Configuration : `src/app.module.ts` (intercepteur global)

## Fonctionnalités

✅ Enregistrement automatique de toutes les requêtes HTTP
✅ Enregistrement manuel via décorateur @Audit()
✅ API REST pour consulter les logs
✅ Cleanup automatique tous les jours à 3h (90 jours)
✅ Conforme RGPD (données minimales)
✅ Module global (utilisable partout sans import)

## Documentation complète

Voir [AUDIT_MODULE_README.md](AUDIT_MODULE_README.md) pour la documentation détaillée.
