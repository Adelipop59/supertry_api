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
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MediaService, MediaFolder, MediaType } from './media.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Upload un seul fichier
   */
  @Post('upload')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
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
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 10)) // Max 10 fichiers
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
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async deleteFile(@Param('path') key: string) {
    await this.mediaService.delete(key);
    return { message: 'File deleted successfully', key };
  }

  /**
   * Générer une URL signée pour accès temporaire
   */
  @Get('signed-url/*path')
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
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
  @Roles(UserRole.USER, UserRole.PRO, UserRole.ADMIN)
  async checkExists(@Param('path') key: string) {
    const exists = await this.mediaService.exists(key);
    return { exists, key };
  }
}
