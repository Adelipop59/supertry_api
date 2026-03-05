import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Res,
  Req,
  HttpStatus,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService, OAuthProvider } from './auth.service';
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
  OAuthTokenLoginDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { ApiAuthResponses, ApiValidationErrorResponse } from '../../common/decorators/api-error-responses.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Inscription classique email/password' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiValidationErrorResponse()
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
  @ApiValidationErrorResponse()
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
  @ApiAuthResponses()
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
  @ApiValidationErrorResponse()
  async checkEmail(@Body() checkEmailDto: CheckEmailDto): Promise<CheckEmailResponseDto> {
    return this.authService.checkEmailExists(checkEmailDto.email);
  }

  @Get('oauth/:provider')
  @Public()
  @ApiOperation({ summary: 'Initier OAuth (Google/GitHub/Microsoft/Apple/Facebook/Discord)' })
  @ApiResponse({ status: 200, type: OAuthUrlResponseDto })
  async initiateOAuth(
    @Param('provider') provider: string,
  ): Promise<OAuthUrlResponseDto> {
    return this.authService.initiateOAuth(provider as OAuthProvider);
  }

  @Get('oauth/:provider/callback')
  @Public()
  @ApiOperation({ summary: 'Callback OAuth (GET)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async oauthCallback(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      throw new I18nHttpException(
        'auth.oauth_code_missing',
        'AUTH_OAUTH_CODE_MISSING',
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.authService.handleOAuthCallback(code, provider as OAuthProvider, state);

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('oauth/apple/callback')
  @Public()
  @ApiOperation({ summary: 'Callback OAuth Apple (POST - Apple envoie en POST)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async appleOAuthCallback(
    @Body() body: { code: string; state?: string; user?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    if (!body.code) {
      throw new I18nHttpException(
        'auth.oauth_code_missing',
        'AUTH_OAUTH_CODE_MISSING',
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.authService.handleOAuthCallback(
      body.code,
      'apple',
      body.state,
      body.user, // Apple sends user JSON string only on first auth
    );

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('oauth/token')
  @Public()
  @ApiOperation({ summary: 'OAuth login avec token natif (mobile SDK - Google Sign-In, Sign in with Apple, etc.)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiValidationErrorResponse()
  async oauthTokenLogin(
    @Body() dto: OAuthTokenLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.handleOAuthTokenLogin(
      dto.provider as OAuthProvider,
      dto.token,
    );

    // Set session cookie
    const cookie = this.authService['luciaService'].createSessionCookie(result.sessionId);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    return result;
  }

  @Post('complete-onboarding')
  @SkipOnboarding()
  @ApiOperation({ summary: 'Finaliser onboarding (OAuth users)' })
  @ApiResponse({ status: 200 })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async completeOnboarding(
    @Req() req: Request,
    @Body() onboardingDto: CompleteOnboardingDto,
  ): Promise<any> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_EXPIRED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_INVALID',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.authService.completeOnboarding(sessionResult.user.id, onboardingDto);
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Changer mot de passe' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async changePassword(
    @Req() req: Request,
    @Body() changePasswordDto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_EXPIRED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_INVALID',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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

  @Post('verify-email')
  @SkipOnboarding()
  @ApiOperation({ summary: 'Vérifier email avec code OTP' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiAuthResponses()
  @ApiValidationErrorResponse()
  async verifyEmail(
    @Req() req: Request,
    @Body() verifyEmailDto: VerifyEmailDto,
  ): Promise<MessageResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_EXPIRED',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_INVALID',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.authService.verifyEmail(sessionResult.user.id, verifyEmailDto.code);
  }

  @Post('resend-verification')
  @SkipOnboarding()
  @ApiOperation({ summary: 'Renvoyer email de vérification' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiAuthResponses()
  async resendVerification(
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_EXPIRED',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const sessionResult = await this.authService.validateSession(sessionId);

    if (!sessionResult) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_INVALID',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.authService.resendVerificationEmail(sessionResult.user.id);
  }

  @Get('session')
  @ApiOperation({ summary: 'Vérifier session active' })
  @ApiResponse({ status: 200 })
  @ApiAuthResponses()
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
  @ApiAuthResponses()
  async refreshSession(@Req() req: Request): Promise<RefreshTokenResponseDto> {
    const sessionId = req.cookies?.['auth_session'] || '';

    if (!sessionId) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_EXPIRED',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.authService.refreshToken(sessionId);
  }
}
