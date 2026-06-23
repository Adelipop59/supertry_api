import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as path from 'path';
import sharp from 'sharp';

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  AUDIO = 'audio',
}

export enum MediaFolder {
  PRODUCTS = 'products',
  PROFILES = 'profiles',
  PROCEDURES = 'procedures',
  REVIEWS = 'reviews',
  UGC = 'ugc',
  PURCHASES = 'purchases',
  MESSAGES = 'messages',
  DISPUTES = 'disputes',
  TEMP = 'temp',
}

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class MediaService {
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;
  private cloudFrontDomain?: string;
  private s3Endpoint?: string;

  // Tailles max par type (en octets)
  private readonly MAX_SIZES = {
    [MediaType.IMAGE]: 10 * 1024 * 1024, // 10MB
    [MediaType.VIDEO]: 500 * 1024 * 1024, // 500MB
    [MediaType.DOCUMENT]: 20 * 1024 * 1024, // 20MB
    [MediaType.AUDIO]: 50 * 1024 * 1024, // 50MB
  };

  // MIME types autorisés
  private readonly ALLOWED_MIME_TYPES = {
    [MediaType.IMAGE]: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      // SEC-E10 : SVG retiré (vecteur XSS stocké). Ne pas réautoriser sans
      // sanitisation serveur + service via domaine isolé / Content-Disposition.
    ],
    [MediaType.VIDEO]: [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
    ],
    [MediaType.DOCUMENT]: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
    ],
    [MediaType.AUDIO]: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
    ],
  };

  constructor(private configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_S3_REGION', 'eu-west-3');
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', '');
    this.cloudFrontDomain = this.configService.get<string>('AWS_CLOUDFRONT_DOMAIN');

    if (!this.bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    this.s3Endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');

    this.s3Client = new S3Client({
      region: this.region,
      ...(this.s3Endpoint && { endpoint: this.s3Endpoint }),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
      forcePathStyle: !!this.s3Endpoint,
    });
  }

  /**
   * Upload un fichier vers S3
   */
  async upload(
    file: Express.Multer.File,
    folder: MediaFolder,
    mediaType: MediaType,
    options?: {
      subfolder?: string;
      customFilename?: string;
      makePublic?: boolean;
    },
  ): Promise<UploadResult> {
    // Validation du type MIME
    this.validateMimeType(file.mimetype, mediaType);

    // Validation de la signature binaire réelle (anti-spoofing)
    this.validateMagicBytes(file.buffer, mediaType);

    // Validation de la taille
    this.validateFileSize(file.size, mediaType);

    // Générer le nom de fichier et le chemin
    const filename = options?.customFilename || this.generateFilename(file.originalname);
    const key = this.buildKey(folder, filename, options?.subfolder);

    // Upload vers S3
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: options?.makePublic ? 'public-read' : 'private',
      Metadata: {
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      },
    });

    await this.s3Client.send(command);

    // Construire l'URL
    const url = this.buildUrl(key);

    return {
      url,
      key,
      bucket: this.bucketName,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  /**
   * Upload plusieurs fichiers
   */
  async uploadMultiple(
    files: Express.Multer.File[],
    folder: MediaFolder,
    mediaType: MediaType,
    options?: {
      subfolder?: string;
      makePublic?: boolean;
    },
  ): Promise<UploadResult[]> {
    const uploadPromises = files.map((file) =>
      this.upload(file, folder, mediaType, options),
    );

    return Promise.all(uploadPromises);
  }

  /**
   * Upload depuis un buffer
   */
  async uploadFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    folder: MediaFolder,
    mediaType: MediaType,
    options?: {
      subfolder?: string;
      makePublic?: boolean;
    },
  ): Promise<UploadResult> {
    // Validation du type MIME
    this.validateMimeType(mimeType, mediaType);

    // Validation de la signature binaire réelle (anti-spoofing)
    this.validateMagicBytes(buffer, mediaType);

    // Validation de la taille
    this.validateFileSize(buffer.length, mediaType);

    // Générer le chemin
    const key = this.buildKey(folder, filename, options?.subfolder);

    // Upload vers S3
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: options?.makePublic ? 'public-read' : 'private',
      Metadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    await this.s3Client.send(command);

    const url = this.buildUrl(key);

    return {
      url,
      key,
      bucket: this.bucketName,
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Supprimer un fichier
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Supprimer plusieurs fichiers
   */
  async deleteMultiple(keys: string[]): Promise<void> {
    const deletePromises = keys.map((key) => this.delete(key));
    await Promise.all(deletePromises);
  }

  /**
   * Générer une URL signée (pour accès temporaire)
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Génère une URL signée d'UPLOAD (PUT) pour un upload direct navigateur → S3 (P3.1).
   * Le serveur impose la key et le Content-Type ; le client envoie les octets directement.
   */
  async getUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      ACL: 'private',
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Métadonnées d'un objet (taille, type) — null si absent.
   */
  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const res = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch {
      return null;
    }
  }

  /**
   * Valide la signature binaire réelle d'un objet déjà uploadé (P3.1 + P3.2).
   * Récupère uniquement les premiers octets via une requête Range, puis applique
   * le sniff de catégorie. Permet de conserver l'anti-spoofing en upload direct S3.
   */
  async validateUploadedObject(
    key: string,
    mediaType: MediaType,
  ): Promise<void> {
    // 1. Existence + taille
    const meta = await this.head(key);
    if (!meta) {
      throw new BadRequestException(`Uploaded object not found: ${key}`);
    }
    this.validateFileSize(meta.size, mediaType);
    if (meta.contentType) this.validateMimeType(meta.contentType, mediaType);

    // 2. Magic bytes (premiers octets seulement)
    try {
      const res = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key, Range: 'bytes=0-31' }),
      );
      const bytes = await res.Body?.transformToByteArray();
      if (bytes && bytes.length >= 12) {
        this.validateMagicBytes(Buffer.from(bytes), mediaType);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Si la lecture Range échoue (objet absent, etc.), on ne bloque pas sur le magic-byte
    }
  }

  /**
   * Générer des URLs signées pour plusieurs keys
   */
  async getSignedUrls(keys: string[], expiresIn: number = 3600): Promise<string[]> {
    return Promise.all(keys.map((key) => this.getSignedUrl(key, expiresIn)));
  }

  /**
   * Générer une URL publique pour un fichier (ACL public-read)
   */
  getPublicUrl(key: string): string {
    return this.buildUrl(key);
  }

  /**
   * Générer des URLs publiques pour plusieurs keys
   */
  getPublicUrls(keys: string[]): string[] {
    return keys.map((key) => this.buildUrl(key));
  }

  /**
   * Vérifier si un fichier existe
   */
  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extraire la clé S3 depuis une URL
   */
  extractKeyFromUrl(url: string): string | null {
    try {
      // CloudFront URL
      if (this.cloudFrontDomain && url.includes(this.cloudFrontDomain)) {
        return url.split(this.cloudFrontDomain + '/')[1];
      }

      // Supabase Storage URL: .../object/public/{bucket}/{key}
      const supabaseMatch = url.match(/\/object\/public\/[^/]+\/(.+)$/);
      if (supabaseMatch) {
        return supabaseMatch[1];
      }

      // S3 URL standard
      if (url.includes('.s3.')) {
        const parts = url.split('.s3.');
        if (parts.length > 1) {
          const afterS3 = parts[1].split('/');
          return afterS3.slice(1).join('/');
        }
      }

      // S3 URL path-style
      if (url.includes('s3.amazonaws.com')) {
        const parts = url.split('s3.amazonaws.com/');
        if (parts.length > 1) {
          const afterDomain = parts[1].split('/');
          return afterDomain.slice(1).join('/');
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Compresse une image : redimensionne + convertit en WebP
   */
  async compressImage(
    buffer: Buffer,
    options: { maxWidth?: number; quality?: number } = {},
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const { maxWidth = 1920, quality = 80 } = options;

    const compressed = await sharp(buffer)
      .resize(maxWidth, undefined, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    return { buffer: compressed, mimeType: 'image/webp' };
  }

  /**
   * Génère une version floue + compressée d'un buffer image
   */
  async generateBlurredImage(
    buffer: Buffer,
    options: { sigma?: number; maxWidth?: number; quality?: number } = {},
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const { sigma = 20, maxWidth = 800, quality = 50 } = options;

    const blurred = await sharp(buffer)
      .resize(maxWidth, undefined, { fit: 'inside', withoutEnlargement: true })
      .blur(sigma)
      .webp({ quality })
      .toBuffer();

    return { buffer: blurred, mimeType: 'image/webp' };
  }

  /**
   * Génère un nom de fichier unique (timestamp + random hex + extension)
   */
  generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${randomString}${ext}`;
  }

  // ==================== PRIVATE METHODS ====================

  private validateMimeType(mimeType: string, mediaType: MediaType): void {
    const allowedTypes = this.ALLOWED_MIME_TYPES[mediaType];

    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types for ${mediaType}: ${allowedTypes.join(', ')}`,
      );
    }
  }

  /**
   * Détecte la catégorie réelle d'un fichier via sa signature binaire (magic bytes),
   * indépendamment du Content-Type déclaré par le client (qui est falsifiable).
   * Retourne 'image' | 'video' | null (inconnu).
   */
  private sniffCategory(buffer: Buffer): 'image' | 'video' | null {
    if (!buffer || buffer.length < 12) return null;
    const hex = buffer.subarray(0, 16).toString('hex').toLowerCase();
    const ascii4 = buffer.subarray(0, 4).toString('latin1');
    const brand = buffer.subarray(4, 8).toString('latin1'); // boîte ISO-BMFF

    // Images
    if (hex.startsWith('ffd8ff')) return 'image'; // JPEG
    if (hex.startsWith('89504e470d0a1a0a')) return 'image'; // PNG
    if (ascii4 === 'GIF8') return 'image'; // GIF
    if (ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
    if (hex.startsWith('424d')) return 'image'; // BMP
    const head = buffer.subarray(0, 256).toString('latin1').trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image'; // SVG

    // Vidéos
    if (brand === 'ftyp') return 'video'; // MP4 / MOV / M4V
    if (hex.startsWith('1a45dfa3')) return 'video'; // WebM / MKV (EBML)
    if (ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'AVI ') return 'video';
    if (hex.startsWith('000001ba') || hex.startsWith('000001b3')) return 'video'; // MPEG-PS/ES

    return null;
  }

  /**
   * Vérifie que la signature binaire correspond à la catégorie attendue.
   * Bloque les fichiers dont le contenu réel contredit le type (ex. exécutable
   * renommé en .mp4, ou image envoyée comme vidéo). Tolère les formats non
   * reconnus pour ne pas rejeter des conteneurs légitimes plus rares.
   */
  private validateMagicBytes(buffer: Buffer, mediaType: MediaType): void {
    if (mediaType !== MediaType.IMAGE && mediaType !== MediaType.VIDEO) return;
    const detected = this.sniffCategory(buffer);
    if (detected && detected !== mediaType) {
      throw new BadRequestException(
        `File content does not match the declared type (${mediaType}).`,
      );
    }
  }

  private validateFileSize(size: number, mediaType: MediaType): void {
    const maxSize = this.MAX_SIZES[mediaType];

    if (size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
      const fileSizeMB = (size / (1024 * 1024)).toFixed(2);
      throw new BadRequestException(
        `File too large. Max size for ${mediaType}: ${maxSizeMB}MB (uploaded: ${fileSizeMB}MB)`,
      );
    }
  }

  private buildKey(folder: MediaFolder, filename: string, subfolder?: string): string {
    const parts: string[] = [folder];

    if (subfolder) {
      parts.push(subfolder);
    }

    parts.push(filename);

    return parts.join('/');
  }

  private buildUrl(key: string): string {
    // Si CloudFront est configuré, utiliser CloudFront
    if (this.cloudFrontDomain) {
      return `https://${this.cloudFrontDomain}/${key}`;
    }

    // Si un endpoint S3 custom est configuré (ex: Supabase Storage)
    // Endpoint: https://xxx.storage.supabase.co/storage/v1/s3
    // Public URL: https://xxx.storage.supabase.co/storage/v1/object/public/{bucket}/{key}
    if (this.s3Endpoint) {
      const baseUrl = this.s3Endpoint.replace(/\/s3\/?$/, '');
      return `${baseUrl}/object/public/${this.bucketName}/${key}`;
    }

    // Sinon utiliser l'URL S3 standard AWS
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
