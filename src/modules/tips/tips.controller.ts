import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ApiAuthResponses,
  ApiValidationErrorResponse,
} from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTipDto } from './dto/create-tip.dto';
import { TipFilterDto } from './dto/tip-filter.dto';
import { TipsService } from './tips.service';

@ApiTags('Tips')
@Controller('tips')
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  // ============================================================================
  // POST /tips — PRO envoie un tip à un testeur (paiement immédiat)
  // ============================================================================

  @Post()
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Envoyer un tip à un testeur',
    description:
      'Le PRO envoie un pourboire au testeur lié à une session. Paiement Stripe immédiat + commission SuperTry, transfert direct vers le compte Connect du testeur.',
  })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async createTip(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTipDto,
  ) {
    return this.tipsService.createTip(userId, dto);
  }

  // ============================================================================
  // GET /tips/sent — PRO liste les tips qu'il a envoyés
  // ============================================================================

  @Get('sent')
  @Roles(UserRole.PRO, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Lister mes tips envoyés',
    description: 'Le PRO récupère ses tips avec filtres et pagination',
  })
  @ApiAuthResponses()
  async listSent(
    @CurrentUser('id') userId: string,
    @Query() filterDto: TipFilterDto,
  ) {
    return this.tipsService.listSent(userId, filterDto);
  }

  // ============================================================================
  // GET /tips/received — Testeur liste les tips reçus
  // ============================================================================

  @Get('received')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Lister mes tips reçus',
    description:
      'Le testeur récupère les tips reçus avec filtres et pagination',
  })
  @ApiAuthResponses()
  async listReceived(
    @CurrentUser('id') userId: string,
    @Query() filterDto: TipFilterDto,
  ) {
    return this.tipsService.listReceived(userId, filterDto);
  }
}
