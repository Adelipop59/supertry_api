import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  AuthResponseDto,
  MessageResponseDto,
  OAuthUrlResponseDto,
  CheckEmailDto,
  CheckEmailResponseDto,
  CompleteOnboardingDto,
  ChangePasswordDto,
  RefreshTokenResponseDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Inscription classique email/password' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  async signup(
    @Body() signupDto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.signup(signupDto);

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Connexion email/password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(loginDto);

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Déconnexion' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    // Clear session cookie
    const cookie = this.authService['luciaService'].createBlankSessionCookie();
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    if (sessionId) {
      const sessionResult = await this.authService.validateSession(sessionId);
      if (sessionResult) {
        return this.authService.logout(sessionResult.user.id, sessionId);
      }
    }

    return { message: 'Déconnexion réussie' };
  }

  @Post('check-email')
  @Public()
  @ApiOperation({ summary: "Vérifier si un email existe" })
  @ApiResponse({ status: 200, type: CheckEmailResponseDto })
  async checkEmail(@Body() checkEmailDto: CheckEmailDto): Promise<CheckEmailResponseDto> {
    return this.authService.checkEmailExists(checkEmailDto.email);
  }

  @Get('oauth/:provider')
  @Public()
  @ApiOperation({ summary: 'Initier OAuth (Google/GitHub/Azure)' })
  @ApiResponse({ status: 200, type: OAuthUrlResponseDto })
  async initiateOAuth(
    @Param('provider') provider: 'google' | 'github' | 'azure',
  ): Promise<OAuthUrlResponseDto> {
    return this.authService.initiateOAuth(provider);
  }

  @Get('oauth/:provider/callback')
  @Public()
  @ApiOperation({ summary: 'Callback OAuth' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async oauthCallback(
    @Param('provider') provider: 'google' | 'github' | 'azure',
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const code = req.query.code as string;

    if (!code) {
      throw new Error('Code OAuth manquant');
    }

    const result = await this.authService.handleOAuthCallback(code, provider);

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('complete-onboarding')
  @ApiOperation({ summary: 'Finaliser onboarding (OAuth users)' })
  @ApiResponse({ status: 200 })
  async completeOnboarding(
    @Req() req: Request,
    @Body() onboardingDto: CompleteOnboardingDto,
  ): Promise<any> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new Error('Session manquante');
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new Error('Session invalide');
    }

    return this.authService.completeOnboarding(sessionResult.user.id, onboardingDto);
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Changer mot de passe' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async changePassword(
    @Req() req: Request,
    @Body() changePasswordDto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new Error('Session manquante');
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new Error('Session invalide');
    }

    const result = await this.authService.changePassword(
      sessionResult.user.id,
      changePasswordDto,
    );

    // Clear session cookie since all sessions are invalidated
    const cookie = this.authService['luciaService'].createBlankSessionCookie();
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Get('session')
  @ApiOperation({ summary: 'Vérifier session active' })
  @ApiResponse({ status: 200 })
  async checkSession(@Req() req: Request): Promise<{ user: any | null }> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      return { user: null };
    }

    const result = await this.authService.validateSession(sessionId);

    if (!result) {
      return { user: null };
    }

    // Récupérer le profil complet
    const profile = await this.authService['prismaService'].profile.findUnique({
      where: { id: result.user.id },
    });

    return { user: profile };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rafraîchir session' })
  @ApiResponse({ status: 200, type: RefreshTokenResponseDto })
  async refreshSession(@Req() req: Request): Promise<RefreshTokenResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new Error('Session manquante');
    }

    return this.authService.refreshToken(sessionId);
  }
}
