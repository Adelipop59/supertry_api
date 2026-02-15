# 🚀 Configuration AWS S3 pour SuperTry

## 1. Créer un bucket S3

### Via AWS Console
1. Aller sur **S3** dans AWS Console
2. Cliquer sur **Create bucket**
3. Nom du bucket: `supertry-media`
4. Région: `eu-west-3` (Paris) ou votre région préférée
5. **Block Public Access settings**: Décocher si vous voulez des fichiers publics
6. Cliquer sur **Create bucket**

### Via AWS CLI
```bash
aws s3 mb s3://supertry-media --region eu-west-3
```

---

## 2. Configurer CORS (pour uploads depuis le front)

### Dans S3 Console
1. Sélectionner le bucket `supertry-media`
2. Aller dans l'onglet **Permissions**
3. Scroll jusqu'à **Cross-origin resource sharing (CORS)**
4. Ajouter cette configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://yourdomain.com"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

---

## 3. Créer un utilisateur IAM avec permissions

### Via AWS Console

1. Aller sur **IAM** → **Users** → **Add users**
2. Nom d'utilisateur: `supertry-s3-user`
3. **Access key - Programmatic access** ✅
4. Cliquer sur **Next: Permissions**
5. Cliquer sur **Attach policies directly**
6. Créer une nouvelle policy inline:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObjectAcl",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::supertry-media",
        "arn:aws:s3:::supertry-media/*"
      ]
    }
  ]
}
```

7. Cliquer sur **Next** puis **Create user**
8. **⚠️ IMPORTANT**: Copier l'**Access key ID** et le **Secret access key**

### Via AWS CLI

```bash
# Créer l'utilisateur
aws iam create-user --user-name supertry-s3-user

# Créer une policy
cat > s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObjectAcl",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::supertry-media",
        "arn:aws:s3:::supertry-media/*"
      ]
    }
  ]
}
EOF

# Attacher la policy
aws iam put-user-policy --user-name supertry-s3-user --policy-name SuperTryS3Access --policy-document file://s3-policy.json

# Créer les clés d'accès
aws iam create-access-key --user-name supertry-s3-user
```

---

## 4. Configuration .env

Ajouter dans `.env`:

```env
# AWS S3 Configuration
AWS_REGION=eu-west-3
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_S3_BUCKET_NAME=supertry-media

# Optionnel: CloudFront CDN
AWS_CLOUDFRONT_DOMAIN=
```

---

## 5. (Optionnel) Configurer CloudFront CDN

CloudFront améliore la performance en mettant en cache les fichiers.

### Créer une distribution CloudFront

1. Aller sur **CloudFront** → **Create distribution**
2. **Origin domain**: Sélectionner `supertry-media.s3.eu-west-3.amazonaws.com`
3. **Origin access**: Sélectionner **Origin access control settings (recommended)**
4. Créer un OAC (Origin Access Control)
5. **Default cache behavior**:
   - Viewer protocol policy: **Redirect HTTP to HTTPS**
   - Allowed HTTP methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
   - Cache policy: **CachingOptimized**
6. Cliquer sur **Create distribution**

### Après création

1. Copier le **Distribution domain name** (ex: `d111111abcdef8.cloudfront.net`)
2. Ajouter dans `.env`:
   ```env
   AWS_CLOUDFRONT_DOMAIN=d111111abcdef8.cloudfront.net
   ```

### Mettre à jour la bucket policy

CloudFront aura besoin d'accéder au bucket. AWS va générer automatiquement la policy.

---

## 6. Structure des dossiers recommandée

```
supertry-media/
├── products/
│   └── {productId}/
│       ├── main.jpg
│       ├── gallery-1.jpg
│       └── video.mp4
├── profiles/
│   └── {userId}/
│       └── avatar.jpg
├── procedures/
│   └── {sessionId}/
│       ├── step-1/
│       │   ├── video.mp4
│       │   └── screenshot.jpg
│       └── step-2/
├── reviews/
├── ugc/
│   └── {sessionId}/
├── purchases/
│   └── {sessionId}/
│       └── proof.jpg
├── messages/
└── temp/
```

---

## 7. Politique de lifecycle (nettoyage automatique)

Pour supprimer automatiquement les fichiers temporaires:

1. Aller sur le bucket `supertry-media`
2. **Management** → **Create lifecycle rule**
3. Nom: `Delete temp files after 7 days`
4. Scope: **Limit to prefix** → `temp/`
5. **Lifecycle rule actions**:
   - ✅ Expire current versions of objects
   - Days after object creation: `7`
6. Cliquer sur **Create rule**

---

## 8. Sécurité - Bonnes pratiques

### ✅ Toujours faire:
- Utiliser IAM avec permissions minimales
- Activer le versioning sur le bucket (pour récupération)
- Activer le logging (pour audit)
- Utiliser des URLs signées pour les fichiers sensibles
- Configurer CORS correctement
- Utiliser CloudFront pour le CDN

### ❌ Ne jamais faire:
- Rendre public des fichiers sensibles (preuves d'achat, etc.)
- Partager les clés AWS dans le code
- Donner des permissions `s3:*` (trop large)
- Oublier de configurer CORS

---

## 9. Monitoring et coûts

### Estimer les coûts

**Stockage S3** (eu-west-3):
- Premiers 50 TB: $0.023 par GB/mois
- 100 GB = ~$2.30/mois

**Transfert de données**:
- Download: Premiers 10 TB = $0.09 par GB
- Upload: Gratuit

**CloudFront** (optionnel):
- Premiers 10 TB: $0.085 par GB

**Exemple**: 100 GB stockage + 500 GB transfer = ~$50/mois

### Activer le monitoring

1. Bucket → **Metrics** → **Request metrics**
2. Activer CloudWatch pour suivre:
   - Nombre de requêtes
   - Taille du bucket
   - Erreurs 4xx/5xx

---

## 10. Tester la configuration

```bash
# Installer les packages
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Tester l'upload
curl -X POST http://localhost:3000/api/v1/media/upload \
  -H "Cookie: auth_session=YOUR_SESSION" \
  -F "file=@test-image.jpg" \
  -F "folder=temp" \
  -F "mediaType=image" \
  -F "makePublic=true"

# Vérifier le fichier sur S3
aws s3 ls s3://supertry-media/temp/
```

---

## 🆘 Troubleshooting

### Erreur: "Access Denied"
- Vérifier les credentials AWS dans `.env`
- Vérifier les permissions IAM
- Vérifier que le bucket existe

### Erreur: "CORS error"
- Configurer CORS sur le bucket S3
- Vérifier les origines autorisées

### Erreur: "File too large"
- Vérifier les limites dans `MediaService`
- Augmenter si nécessaire

### Upload lent
- Utiliser CloudFront
- Utiliser des uploads multipart pour gros fichiers
- Choisir une région proche de vos utilisateurs

---

## 📚 Ressources

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/)
- [CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
