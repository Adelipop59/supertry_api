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
      'image/svg+xml',
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
    this.region = this.configService.get<string>('AWS_REGION', 'eu-west-3');
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', '');
    this.cloudFrontDomain = this.configService.get<string>('AWS_CLOUDFRONT_DOMAIN');

    if (!this.bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
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

  // ==================== PRIVATE METHODS ====================

  private validateMimeType(mimeType: string, mediaType: MediaType): void {
    const allowedTypes = this.ALLOWED_MIME_TYPES[mediaType];

    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types for ${mediaType}: ${allowedTypes.join(', ')}`,
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

  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${randomString}${ext}`;
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

    // Sinon utiliser l'URL S3 standard
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
