# 📸 Module Media - Documentation

Module de gestion des médias (images, vidéos, documents) avec AWS S3.

## 🚀 Configuration

### Variables d'environnement (.env)

```env
# AWS S3 Configuration
AWS_REGION=eu-west-3
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_S3_BUCKET_NAME=supertry-media

# Optionnel: CloudFront (pour CDN)
AWS_CLOUDFRONT_DOMAIN=d123456789.cloudfront.net
```

### Installation des dépendances

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D @types/multer
```

## 📁 Structure des dossiers S3

```
supertry-media/
├── products/           # Images/vidéos de produits
│   ├── {productId}/
│   │   ├── 1234567890-abc123.jpg
│   │   └── 1234567891-def456.mp4
├── profiles/           # Photos de profil
│   ├── {userId}/
│   │   └── 1234567890-abc123.jpg
├── procedures/         # Médias des procédures
│   ├── {sessionId}/
│   │   ├── step-1/
│   │   │   ├── video.mp4
│   │   │   └── photo.jpg
├── reviews/            # Médias des avis
├── ugc/                # User Generated Content
├── purchases/          # Preuves d'achat
├── messages/           # Pièces jointes messages
└── temp/               # Fichiers temporaires
```

## 🎯 Types de médias supportés

### Images (max 10MB)
- JPEG, JPG, PNG, GIF, WebP, SVG

### Vidéos (max 500MB)
- MP4, MPEG, QuickTime, AVI, WebM

### Documents (max 20MB)
- PDF, Word, Excel, TXT, CSV

### Audio (max 50MB)
- MP3, WAV, OGG, WebM

## 📝 Utilisation

### 1. Via l'API REST

#### Upload un fichier

```bash
POST /api/v1/media/upload
Content-Type: multipart/form-data

{
  "file": <binary>,
  "folder": "products",
  "mediaType": "image",
  "subfolder": "product-123",      # Optionnel
  "customFilename": "cover.jpg",   # Optionnel
  "makePublic": true               # Optionnel
}
```

**Réponse:**
```json
{
  "url": "https://d123456789.cloudfront.net/products/product-123/cover.jpg",
  "key": "products/product-123/cover.jpg",
  "bucket": "supertry-media",
  "size": 245678,
  "mimeType": "image/jpeg"
}
```

#### Upload plusieurs fichiers

```bash
POST /api/v1/media/upload-multiple
Content-Type: multipart/form-data

{
  "files": [<binary>, <binary>, ...],
  "folder": "procedures",
  "mediaType": "image",
  "subfolder": "session-abc123"
}
```

#### Supprimer un fichier

```bash
DELETE /api/v1/media/products/product-123/cover.jpg
```

#### Obtenir une URL signée (temporaire)

```bash
GET /api/v1/media/signed-url/products/product-123/cover.jpg?expiresIn=7200
```

**Réponse:**
```json
{
  "url": "https://supertry-media.s3.eu-west-3.amazonaws.com/products/...",
  "expiresIn": 7200
}
```

#### Vérifier l'existence d'un fichier

```bash
GET /api/v1/media/exists/products/product-123/cover.jpg
```

---

### 2. Via le Service (dans le code)

#### Injection du service

```typescript
import { MediaService, MediaFolder, MediaType } from '../media/media.service';

@Injectable()
export class ProductsService {
  constructor(private mediaService: MediaService) {}
}
```

#### Upload une image de produit

```typescript
async uploadProductImage(
  file: Express.Multer.File,
  productId: string,
): Promise<string> {
  const result = await this.mediaService.upload(
    file,
    MediaFolder.PRODUCTS,
    MediaType.IMAGE,
    {
      subfolder: productId,
      makePublic: true,
    },
  );

  return result.url;
}
```

#### Upload plusieurs images

```typescript
async uploadProductImages(
  files: Express.Multer.File[],
  productId: string,
): Promise<string[]> {
  const results = await this.mediaService.uploadMultiple(
    files,
    MediaFolder.PRODUCTS,
    MediaType.IMAGE,
    {
      subfolder: productId,
      makePublic: true,
    },
  );

  return results.map((r) => r.url);
}
```

#### Upload depuis un buffer

```typescript
async uploadFromBuffer(
  buffer: Buffer,
  filename: string,
  productId: string,
): Promise<string> {
  const result = await this.mediaService.uploadFromBuffer(
    buffer,
    filename,
    'image/jpeg',
    MediaFolder.PRODUCTS,
    MediaType.IMAGE,
    {
      subfolder: productId,
      makePublic: true,
    },
  );

  return result.url;
}
```

#### Supprimer un fichier

```typescript
async deleteProductImage(imageUrl: string): Promise<void> {
  const key = this.mediaService.extractKeyFromUrl(imageUrl);

  if (key) {
    await this.mediaService.delete(key);
  }
}
```

#### Supprimer plusieurs fichiers

```typescript
async deleteProductImages(imageUrls: string[]): Promise<void> {
  const keys = imageUrls
    .map(url => this.mediaService.extractKeyFromUrl(url))
    .filter(key => key !== null) as string[];

  await this.mediaService.deleteMultiple(keys);
}
```

#### Générer une URL signée

```typescript
async getSecureImageUrl(imageUrl: string): Promise<string> {
  const key = this.mediaService.extractKeyFromUrl(imageUrl);

  if (!key) {
    throw new Error('Invalid image URL');
  }

  return this.mediaService.getSignedUrl(key, 3600); // 1 heure
}
```

#### Vérifier si un fichier existe

```typescript
async checkImageExists(imageUrl: string): Promise<boolean> {
  const key = this.mediaService.extractKeyFromUrl(imageUrl);

  if (!key) {
    return false;
  }

  return this.mediaService.exists(key);
}
```

---

## 🔐 Sécurité

### Fichiers publics vs privés

```typescript
// Public (accessible sans authentification)
await mediaService.upload(file, MediaFolder.PRODUCTS, MediaType.IMAGE, {
  makePublic: true,
});

// Privé (nécessite URL signée)
await mediaService.upload(file, MediaFolder.PURCHASES, MediaType.IMAGE, {
  makePublic: false, // Par défaut
});
```

### URLs signées pour fichiers privés

```typescript
// Générer une URL temporaire (expire après 1h)
const signedUrl = await mediaService.getSignedUrl('purchases/proof.jpg', 3600);
```

---

## 📊 Validation automatique

Le module valide automatiquement:

✅ **Type MIME** - Seuls les types autorisés sont acceptés
✅ **Taille du fichier** - Limites par type de média
✅ **Extensions** - Basées sur le MIME type

---

## 🌍 CDN CloudFront (optionnel)

Si configuré, toutes les URLs utilisent CloudFront:

```
Sans CloudFront:
https://supertry-media.s3.eu-west-3.amazonaws.com/products/cover.jpg

Avec CloudFront:
https://d123456789.cloudfront.net/products/cover.jpg
```

---

## 🛠️ Exemples pratiques

### Upload photo de profil

```typescript
@Post('avatar')
@UseInterceptors(FileInterceptor('avatar'))
async uploadAvatar(
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser('id') userId: string,
) {
  const result = await this.mediaService.upload(
    file,
    MediaFolder.PROFILES,
    MediaType.IMAGE,
    {
      subfolder: userId,
      customFilename: 'avatar.jpg',
      makePublic: true,
    },
  );

  // Mettre à jour le profil
  await this.profileService.updateAvatar(userId, result.url);

  return result;
}
```

### Upload vidéo de procédure

```typescript
async uploadProcedureVideo(
  file: Express.Multer.File,
  sessionId: string,
  stepId: string,
) {
  return this.mediaService.upload(
    file,
    MediaFolder.PROCEDURES,
    MediaType.VIDEO,
    {
      subfolder: `${sessionId}/step-${stepId}`,
      makePublic: false, // Privé
    },
  );
}
```

### Upload preuve d'achat

```typescript
async uploadPurchaseProof(
  file: Express.Multer.File,
  sessionId: string,
) {
  return this.mediaService.upload(
    file,
    MediaFolder.PURCHASES,
    MediaType.IMAGE,
    {
      subfolder: sessionId,
      makePublic: false, // Privé (sensible)
    },
  );
}
```

---

## 🔄 Migration des fichiers existants

Si tu as déjà des fichiers stockés localement ou ailleurs:

```typescript
import * as fs from 'fs';

async migrateLocalFiles() {
  const localFiles = fs.readdirSync('./uploads/products');

  for (const filename of localFiles) {
    const buffer = fs.readFileSync(`./uploads/products/${filename}`);

    await this.mediaService.uploadFromBuffer(
      buffer,
      filename,
      'image/jpeg',
      MediaFolder.PRODUCTS,
      MediaType.IMAGE,
      { makePublic: true },
    );
  }
}
```

---

## 📦 Enums disponibles

### MediaFolder
- `PRODUCTS` - Produits
- `PROFILES` - Profils utilisateurs
- `PROCEDURES` - Procédures de test
- `REVIEWS` - Avis
- `UGC` - User Generated Content
- `PURCHASES` - Preuves d'achat
- `MESSAGES` - Pièces jointes messages
- `TEMP` - Temporaires

### MediaType
- `IMAGE` - Images (max 10MB)
- `VIDEO` - Vidéos (max 500MB)
- `DOCUMENT` - Documents (max 20MB)
- `AUDIO` - Audio (max 50MB)

---

## ❌ Gestion des erreurs

Le service lance des exceptions:

```typescript
try {
  await mediaService.upload(file, folder, mediaType);
} catch (error) {
  if (error.message.includes('Invalid file type')) {
    // Type de fichier non supporté
  }
  if (error.message.includes('File too large')) {
    // Fichier trop volumineux
  }
}
```

---

## 🎯 TODO / Améliorations futures

- [ ] Compression automatique des images
- [ ] Génération de thumbnails
- [ ] Scan antivirus des fichiers
- [ ] Watermarking automatique
- [ ] Conversion vidéo (différentes qualités)
- [ ] Statistiques d'utilisation du stockage
