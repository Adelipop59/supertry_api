import {
  Controller,
  Get,
  Patch,
  Put,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateLanguageDto } from './dto/update-language.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiAuthResponses, ApiNotFoundErrorResponse, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('countries')
  @Public()
  @ApiOperation({ summary: 'Récupérer la liste des pays disponibles' })
  @ApiResponse({ status: 200, description: 'Liste des pays récupérée avec succès',
  })
  async getAvailableCountries() {
    return this.usersService.getAvailableCountries();
  }

  @Get('me')
  @ApiOperation({ summary: 'Récupérer mon profil complet' })
  @ApiResponse({ status: 200, description: 'Profil récupéré avec succès' })
  @ApiAuthResponses()
  async getMe(@CurrentUser('id') userId: string) {
    return this.usersService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Modifier mon profil' })
  @ApiResponse({ status: 200, description: 'Profil mis à jour avec succès' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(userId, updateUserDto);
  }

  @Patch('me/language')
  @ApiOperation({ summary: 'Changer ma langue préférée' })
  @ApiResponse({ status: 200, description: 'Langue mise à jour avec succès' })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async updateLanguage(
    @CurrentUser('id') userId: string,
    @Body() updateLanguageDto: UpdateLanguageDto,
  ) {
    return this.usersService.updateLanguage(userId, updateLanguageDto.language);
  }

  @Put('me/avatar')
  @ApiOperation({ summary: 'Uploader ou mettre à jour mon avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Avatar mis à jour avec succès' })
  @ApiAuthResponses()
  @UseInterceptors(FileInterceptor('file'))
  async updateAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.updateAvatar(userId, file);
  }

  @Get(':id')
  @ApiOperation({ summary: "Récupérer le profil public d'un utilisateur" })
  @ApiResponse({ status: 200, description: 'Profil public récupéré avec succès' })
  @ApiAuthResponses()
  @ApiNotFoundErrorResponse()
  async getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
