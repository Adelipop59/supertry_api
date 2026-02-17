import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MediaService, MediaFolder, MediaType } from './media.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Upload un seul fichier
   */
  @Post('upload')
  @ApiOperation({ summary: 'Uploader un fichier unique vers le stockage S3' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Fichier uploadé avec succès' })
  @ApiResponse({ status: 400, description: 'Fichier invalide ou paramètres manquants' })
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadDto: UploadFileDto,
  ) {
    return this.mediaService.upload(file, uploadDto.folder, uploadDto.mediaType, {
      subfolder: uploadDto.subfolder,
      customFilename: uploadDto.customFilename,
      makePublic: uploadDto.makePublic,
    });
  }

  /**
   * Upload plusieurs fichiers
   */
  @Post('upload-multiple')
  @ApiOperation({ summary: 'Uploader plusieurs fichiers (max 10) vers le stockage S3' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Fichiers uploadés avec succès' })
  @ApiResponse({ status: 400, description: 'Fichiers invalides ou paramètres manquants' })
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 10)) // Max 10 fichiers
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadDto: UploadFileDto,
  ) {
    return this.mediaService.uploadMultiple(files, uploadDto.folder, uploadDto.mediaType, {
      subfolder: uploadDto.subfolder,
      makePublic: uploadDto.makePublic,
    });
  }

  /**
   * Supprimer un fichier par sa clé S3
   */
  @Delete('delete/*path')
  @ApiOperation({ summary: 'Supprimer un fichier par sa clé S3' })
  @ApiResponse({ status: 200, description: 'Fichier supprimé avec succès' })
  @ApiResponse({ status: 404, description: 'Fichier non trouvé' })
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async deleteFile(@Param('path') key: string) {
    await this.mediaService.delete(key);
    return { message: 'File deleted successfully', key };
  }

  /**
   * Générer une URL signée pour accès temporaire
   */
  @Get('signed-url/*path')
  @ApiOperation({ summary: 'Générer une URL signée pour un accès temporaire au fichier' })
  @ApiQuery({ name: 'expiresIn', required: false, description: 'Durée de validité en secondes (défaut: 3600)', example: '3600' })
  @ApiResponse({ status: 200, description: 'URL signée générée avec succès' })
  @ApiResponse({ status: 404, description: 'Fichier non trouvé' })
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getSignedUrl(
    @Param('path') key: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const expiration = expiresIn ? parseInt(expiresIn, 10) : 3600;
    const url = await this.mediaService.getSignedUrl(key, expiration);
    return { url, expiresIn: expiration };
  }

  /**
   * Vérifier si un fichier existe
   */
  @Get('exists/*path')
  @ApiOperation({ summary: 'Vérifier si un fichier existe dans le stockage S3' })
  @ApiResponse({ status: 200, description: 'Résultat de la vérification' })
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @ApiAuthResponses()
  async checkExists(@Param('path') key: string) {
    const exists = await this.mediaService.exists(key);
    return { exists, key };
  }
}
