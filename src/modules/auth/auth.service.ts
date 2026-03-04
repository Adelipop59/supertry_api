import {
  Injectable,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { I18nHttpException } from '../../common/exceptions/i18n.exception';
import { LuciaService } from '../lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplate } from '../notifications/enums/notification-template.enum';
import {
  SignupDto,
  LoginDto,
  AuthResponseDto,
  RefreshTokenResponseDto,
  MessageResponseDto,
  OAuthUrlResponseDto,
  CompleteOnboardingDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { Session } from 'lucia';
import { decodeIdToken } from 'arctic';

export type OAuthProvider = 'google' | 'github' | 'microsoft' | 'apple' | 'facebook' | 'discord';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private luciaService: LuciaService,
    private prismaService: PrismaService,
    private usersService: UsersService,
    private stripeService: StripeService,
    private walletService: WalletService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Signup - Inscription classique email/password
   */
  async signup(signupDto: SignupDto): Promise<AuthResponseDto & { sessionId: string }> {
    const { email, password, role, country, countries, ...profileData } = signupDto;

    // Validate role-specific requirements
    await this.validateRoleRequirements(role, { ...profileData, country, countries });

    // Check if email exists
    const existingProfile = await this.prismaService.profile.findUnique({
      where: { email },
    });

    if (existingProfile) {
      if (existingProfile.authProvider) {
        throw new I18nHttpException(
          'auth.email_linked_oauth',
          'AUTH_EMAIL_LINKED_OAUTH',
          HttpStatus.BAD_REQUEST,
          { provider: existingProfile.authProvider },
        );
      }
      throw new I18nHttpException(
        'auth.email_already_exists',
        'AUTH_EMAIL_EXISTS',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Hash password
    const passwordHash = await this.luciaService.hashPassword(password);

    // Create profile
    // USER: seul email + country, nom/prénom/téléphone/DOB seront remplis depuis Stripe Connect après onboarding
    // PRO: email + firstName + lastName + countries
    const profile = await this.usersService.createProfile({
      email,
      role: role || 'USER',
      country,
      firstName: profileData.firstName || '',
      lastName: profileData.lastName || '',
      companyName: profileData.companyName,
      siret: profileData.siret,
    });

    // Update with password hash
    await this.prismaService.profile.update({
      where: { id: profile.id },
      data: { passwordHash },
    });

    // Create ProfileCountry for PRO
    if (role === 'PRO' && countries) {
      await this.prismaService.profileCountry.createMany({
        data: countries.map((countryCode) => ({
          profileId: profile.id,
          countryCode,
        })),
      });
    }

    // Create Stripe Connect account ONLY for USER (TESTEUR)
    // PRO doesn't need Connect: they pay with card and receive refunds on same card
    // Pas de données individual pré-remplies : Stripe collectera tout pendant l'onboarding
    if (role === 'USER') {
      try {
        const stripeAccount = await this.stripeService.createConnectAccount(
          email,
          country || 'FR',
          'express',
        );

        await this.prismaService.profile.update({
          where: { id: profile.id },
          data: { stripeConnectAccountId: stripeAccount.id },
        });

        this.logger.log(`Stripe Connect account created for TESTEUR ${email}: ${stripeAccount.id}`);
      } catch (error) {
        this.logger.error(`Failed to create Stripe Connect account for ${email}: ${error.message}`);
        // Don't fail signup if Stripe Connect creation fails
      }
    }

    // Create Wallet for PRO and USER
    if (role === 'PRO' || role === 'USER') {
      try {
        await this.walletService.createWallet(profile.id);
        this.logger.log(`Wallet created for ${email}`);
      } catch (error) {
        this.logger.error(`Failed to create Wallet for ${email}: ${error.message}`);
        // Don't fail signup if Wallet creation fails
      }
    }

    // Generate OTP and send verification email
    const otpCode = this.generateOTPCode();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prismaService.profile.update({
      where: { id: profile.id },
      data: {
        emailVerificationCode: otpCode,
        emailVerificationExpiresAt: otpExpiresAt,
      },
    });

    // Send verification email (sync - critical)
    try {
      await this.notificationsService.sendEmail({
        to: email,
        template: NotificationTemplate.ACCOUNT_VERIFICATION,
        variables: {
          username: profileData.firstName || email.split('@')[0],
          verificationCode: otpCode,
          expiresIn: '15 minutes',
        },
      });
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}: ${error.message}`);
    }

    // Queue welcome email (async - non-critical)
    try {
      const welcomeTemplate = role === 'PRO'
        ? NotificationTemplate.WELCOME_PRO
        : NotificationTemplate.WELCOME_TESTER;

      await this.notificationsService.queueEmail({
        to: email,
        template: welcomeTemplate,
        variables: {
          username: profileData.firstName || email.split('@')[0],
          email,
          companyName: profileData.companyName,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to queue welcome email for ${email}: ${error.message}`);
    }

    // Create session
    const session = await this.luciaService.createSession(profile.id);

    this.logger.log(`User ${email} created successfully`);

    return {
      access_token: session.id,
      refresh_token: session.id,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 30, // 30 days
      sessionId: session.id,
      profile: this.mapProfileToResponse(profile),
    };
  }

  /**
   * Login - Connexion email/password
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto & { sessionId: string }> {
    const { email, password } = loginDto;

    const profile = await this.prismaService.profile.findUnique({
      where: { email },
    });

    if (!profile) {
      throw new I18nHttpException(
        'auth.invalid_credentials',
        'AUTH_INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!profile.isActive) {
      throw new I18nHttpException(
        'auth.account_disabled',
        'AUTH_ACCOUNT_DISABLED',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!profile.passwordHash) {
      throw new I18nHttpException(
        'auth.oauth_login_required',
        'AUTH_OAUTH_REQUIRED',
        HttpStatus.UNAUTHORIZED,
        { provider: profile.authProvider || 'OAuth' },
      );
    }

    const isValid = await this.luciaService.verifyPassword(
      profile.passwordHash,
      password,
    );

    if (!isValid) {
      throw new I18nHttpException(
        'auth.invalid_credentials',
        'AUTH_INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = await this.luciaService.createSession(profile.id);

    return {
      access_token: session.id,
      refresh_token: session.id,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 30,
      sessionId: session.id,
      profile: this.mapProfileToResponse(profile),
    };
  }

  /**
   * Logout
   */
  async logout(userId: string, sessionId: string): Promise<MessageResponseDto> {
    await this.luciaService.invalidateSession(sessionId);
    this.logger.log(`User ${userId} logged out`);
    return { message: 'Déconnexion réussie.' };
  }

  /**
   * Refresh token
   */
  async refreshToken(sessionId: string): Promise<RefreshTokenResponseDto> {
    const result = await this.luciaService.validateSession(sessionId);

    if (!result.session) {
      throw new I18nHttpException(
        'auth.session_expired',
        'AUTH_SESSION_INVALID',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return {
      access_token: result.session.id,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 30,
    };
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    const profile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (!profile || !profile.passwordHash) {
      throw new I18nHttpException(
        'auth.cannot_change_password',
        'AUTH_CANNOT_CHANGE_PASSWORD',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isValid = await this.luciaService.verifyPassword(
      profile.passwordHash,
      changePasswordDto.oldPassword,
    );

    if (!isValid) {
      throw new I18nHttpException(
        'auth.incorrect_password',
        'AUTH_INCORRECT_PASSWORD',
        HttpStatus.BAD_REQUEST,
      );
    }

    const newPasswordHash = await this.luciaService.hashPassword(
      changePasswordDto.newPassword,
    );

    await this.prismaService.profile.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Invalidate all sessions
    await this.luciaService.invalidateUserSessions(userId);

    return { message: 'Mot de passe modifié avec succès.' };
  }

  /**
   * Initiate OAuth
   */
  async initiateOAuth(
    provider: OAuthProvider,
  ): Promise<OAuthUrlResponseDto> {
    const state = this.generateRandomState();

    let url: URL;

    try {
      switch (provider) {
        case 'google':
          url = this.luciaService.createGoogleAuthorizationURL(state);
          break;
        case 'github':
          url = this.luciaService.createGitHubAuthorizationURL(state);
          break;
        case 'microsoft':
          url = this.luciaService.createMicrosoftAuthorizationURL(state);
          break;
        case 'apple':
          url = this.luciaService.createAppleAuthorizationURL(state);
          break;
        case 'facebook':
          url = this.luciaService.createFacebookAuthorizationURL(state);
          break;
        case 'discord':
          url = this.luciaService.createDiscordAuthorizationURL(state);
          break;
        default:
          throw new I18nHttpException(
            'auth.unsupported_provider',
            'AUTH_UNSUPPORTED_PROVIDER',
            HttpStatus.BAD_REQUEST,
          );
      }
    } catch (error) {
      if (error instanceof I18nHttpException) throw error;
      throw new I18nHttpException(
        'auth.oauth_failed',
        'AUTH_OAUTH_FAILED',
        HttpStatus.BAD_REQUEST,
        { provider },
      );
    }

    return {
      url: url.toString(),
      provider,
      state,
    };
  }

  /**
   * Handle OAuth callback - AVEC LIAISON AUTOMATIQUE DES COMPTES
   */
  async handleOAuthCallback(
    code: string,
    provider: OAuthProvider,
    state?: string,
    appleUser?: string,
  ): Promise<AuthResponseDto & { sessionId: string }> {
    let providerUserId: string;
    let userEmail: string;
    let firstName: string | undefined;
    let lastName: string | undefined;

    // Validate code and fetch user info
    try {
      switch (provider) {
        case 'google': {
          const tokens = await this.luciaService.validateGoogleAuthorizationCode(code, state!);
          const googleUser = await this.luciaService.fetchGoogleUser(tokens.accessToken);
          providerUserId = googleUser.sub;
          userEmail = googleUser.email;
          firstName = googleUser.given_name;
          lastName = googleUser.family_name;
          break;
        }
        case 'github': {
          const tokens = await this.luciaService.validateGitHubAuthorizationCode(code);
          const githubUser = await this.luciaService.fetchGitHubUser(tokens.accessToken);
          providerUserId = githubUser.id.toString();
          userEmail = githubUser.email || '';
          const nameParts = githubUser.name?.split(' ') || [];
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(' ') || undefined;
          break;
        }
        case 'microsoft': {
          const tokens = await this.luciaService.validateMicrosoftAuthorizationCode(code, state!);
          const msUser = await this.luciaService.fetchMicrosoftUser(tokens.accessToken);
          providerUserId = msUser.sub;
          userEmail = msUser.email;
          firstName = msUser.given_name;
          lastName = msUser.family_name;
          break;
        }
        case 'apple': {
          const tokens = await this.luciaService.validateAppleAuthorizationCode(code);
          const appleClaims = this.luciaService.parseAppleIdToken(tokens.idToken);
          providerUserId = appleClaims.sub;
          userEmail = appleClaims.email || '';
          // Apple sends name only on first auth, via POST body
          if (appleUser) {
            try {
              const userData = JSON.parse(appleUser);
              firstName = userData.name?.firstName;
              lastName = userData.name?.lastName;
            } catch { /* ignore parse errors */ }
          }
          break;
        }
        case 'facebook': {
          const tokens = await this.luciaService.validateFacebookAuthorizationCode(code);
          const fbUser = await this.luciaService.fetchFacebookUser(tokens.accessToken);
          providerUserId = fbUser.id;
          userEmail = fbUser.email || '';
          firstName = fbUser.first_name;
          lastName = fbUser.last_name;
          break;
        }
        case 'discord': {
          const tokens = await this.luciaService.validateDiscordAuthorizationCode(code, state!);
          const dcUser = await this.luciaService.fetchDiscordUser(tokens.accessToken);
          providerUserId = dcUser.id;
          userEmail = dcUser.email || '';
          const dcNameParts = dcUser.global_name?.split(' ') || [dcUser.username];
          firstName = dcNameParts[0];
          lastName = dcNameParts.slice(1).join(' ') || undefined;
          break;
        }
      }
    } catch (error) {
      if (error instanceof I18nHttpException) throw error;
      throw new I18nHttpException(
        'auth.oauth_callback_failed',
        'AUTH_OAUTH_CALLBACK_FAILED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!userEmail) {
      throw new I18nHttpException(
        'auth.email_not_provided',
        'AUTH_EMAIL_NOT_PROVIDED',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`OAuth callback: ${userEmail}, provider: ${provider}`);

    const profile = await this.findOrCreateOAuthProfile(
      provider,
      providerUserId!,
      userEmail,
      firstName,
      lastName,
    );

    // Create session
    const session = await this.luciaService.createSession(profile.id);

    return {
      access_token: session.id,
      refresh_token: session.id,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 30,
      sessionId: session.id,
      profile: this.mapProfileToResponse(profile),
    };
  }

  /**
   * Handle OAuth token login - Pour les SDK natifs mobile (Google Sign-In, Sign in with Apple, etc.)
   */
  async handleOAuthTokenLogin(
    provider: OAuthProvider,
    token: string,
  ): Promise<AuthResponseDto & { sessionId: string }> {
    let providerUserId: string;
    let userEmail: string;
    let firstName: string | undefined;
    let lastName: string | undefined;

    try {
      switch (provider) {
        case 'google': {
          // Verify Google ID token via Google's tokeninfo endpoint
          const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
          if (!response.ok) throw new Error('Invalid Google ID token');
          const payload = await response.json();
          providerUserId = payload.sub;
          userEmail = payload.email;
          firstName = payload.given_name;
          lastName = payload.family_name;
          break;
        }
        case 'apple': {
          // Apple ID tokens can be decoded
          const claims = decodeIdToken(token) as {
            sub: string;
            email?: string;
          };
          providerUserId = claims.sub;
          userEmail = claims.email || '';
          break;
        }
        case 'facebook': {
          // Facebook uses access tokens, verify via /me
          const response = await fetch(
            `https://graph.facebook.com/v19.0/me?fields=id,email,first_name,last_name`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!response.ok) throw new Error('Invalid Facebook token');
          const user = await response.json();
          providerUserId = user.id;
          userEmail = user.email || '';
          firstName = user.first_name;
          lastName = user.last_name;
          break;
        }
        default:
          throw new I18nHttpException(
            'auth.token_login_unsupported',
            'AUTH_TOKEN_UNSUPPORTED',
            HttpStatus.BAD_REQUEST,
          );
      }
    } catch (error) {
      if (error instanceof I18nHttpException) throw error;
      throw new I18nHttpException(
        'auth.token_verification_failed',
        'AUTH_TOKEN_VERIFICATION_FAILED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!userEmail) {
      throw new I18nHttpException(
        'auth.email_not_provided',
        'AUTH_EMAIL_NOT_PROVIDED',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`OAuth token login: ${userEmail}, provider: ${provider}`);

    const profile = await this.findOrCreateOAuthProfile(
      provider,
      providerUserId!,
      userEmail,
      firstName,
      lastName,
    );

    // Create session
    const session = await this.luciaService.createSession(profile.id);

    return {
      access_token: session.id,
      refresh_token: session.id,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 30,
      sessionId: session.id,
      profile: this.mapProfileToResponse(profile),
    };
  }

  /**
   * Complete onboarding - For OAuth users
   */
  async completeOnboarding(
    userId: string,
    onboardingDto: CompleteOnboardingDto,
  ): Promise<any> {
    const { role, country, countries, ...profileData } = onboardingDto;

    const profile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new I18nHttpException(
        'auth.profile_not_found',
        'AUTH_PROFILE_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (profile.isOnboarded) {
      throw new I18nHttpException(
        'auth.profile_already_completed',
        'AUTH_PROFILE_COMPLETED',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate role-specific requirements
    await this.validateRoleRequirements(role, { ...profileData, country, countries });

    // Update profile
    const updatedProfile = await this.prismaService.profile.update({
      where: { id: userId },
      data: {
        role,
        country,
        firstName: profileData.firstName || profile.firstName,
        lastName: profileData.lastName || profile.lastName,
        phone: profileData.phone,
        birthDate: profileData.dateOfBirth ? new Date(profileData.dateOfBirth) : profile.birthDate,
        companyName: profileData.companyName,
        siret: profileData.siret,
        isOnboarded: true,
      },
    });

    // Create ProfileCountry for PRO
    if (role === 'PRO' && countries) {
      await this.prismaService.profileCountry.createMany({
        data: countries.map((countryCode) => ({
          profileId: updatedProfile.id,
          countryCode,
        })),
      });
    }

    // Create Stripe Connect + Wallet for OAuth users who chose USER role
    if (role === 'USER' && !updatedProfile.stripeConnectAccountId) {
      try {
        const stripeAccount = await this.stripeService.createConnectAccount(
          updatedProfile.email,
          country || 'FR',
          'express',
        );
        await this.prismaService.profile.update({
          where: { id: userId },
          data: { stripeConnectAccountId: stripeAccount.id },
        });
        this.logger.log(`Stripe Connect created for OAuth USER ${updatedProfile.email}: ${stripeAccount.id}`);
      } catch (error) {
        this.logger.error(`Failed to create Stripe Connect for OAuth USER ${updatedProfile.email}: ${error.message}`);
      }
    }

    // Create Wallet if not exists
    if (role === 'PRO' || role === 'USER') {
      try {
        await this.walletService.createWallet(updatedProfile.id);
        this.logger.log(`Wallet created for ${updatedProfile.email}`);
      } catch (error) {
        this.logger.error(`Failed to create Wallet for ${updatedProfile.email}: ${error.message}`);
      }
    }

    this.logger.log(`User ${updatedProfile.email} completed onboarding as ${role}`);

    return updatedProfile;
  }

  /**
   * Verify email with OTP code
   */
  async verifyEmail(userId: string, code: string): Promise<MessageResponseDto> {
    const profile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new I18nHttpException(
        'auth.profile_not_found',
        'AUTH_PROFILE_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (profile.emailVerifiedAt) {
      throw new I18nHttpException(
        'auth.email_already_verified',
        'AUTH_EMAIL_ALREADY_VERIFIED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!profile.emailVerificationCode || !profile.emailVerificationExpiresAt) {
      throw new I18nHttpException(
        'auth.no_verification_pending',
        'AUTH_NO_VERIFICATION_PENDING',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (new Date() > profile.emailVerificationExpiresAt) {
      throw new I18nHttpException(
        'auth.verification_code_expired',
        'AUTH_VERIFICATION_CODE_EXPIRED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (profile.emailVerificationCode !== code) {
      throw new I18nHttpException(
        'auth.invalid_verification_code',
        'AUTH_INVALID_VERIFICATION_CODE',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prismaService.profile.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: new Date(),
        isVerified: true,
        emailVerificationCode: null,
        emailVerificationExpiresAt: null,
      },
    });

    this.logger.log(`Email verified for user ${userId}`);

    return { message: 'Email vérifié avec succès.' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(userId: string): Promise<MessageResponseDto> {
    const profile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new I18nHttpException(
        'auth.profile_not_found',
        'AUTH_PROFILE_NOT_FOUND',
        HttpStatus.NOT_FOUND,
      );
    }

    if (profile.emailVerifiedAt) {
      throw new I18nHttpException(
        'auth.email_already_verified',
        'AUTH_EMAIL_ALREADY_VERIFIED',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Rate limit: 60s cooldown
    if (profile.emailVerificationExpiresAt) {
      const codeGeneratedAt = new Date(profile.emailVerificationExpiresAt.getTime() - 15 * 60 * 1000);
      const elapsedSeconds = (Date.now() - codeGeneratedAt.getTime()) / 1000;
      if (elapsedSeconds < 60) {
        throw new I18nHttpException(
          'auth.verification_rate_limit',
          'AUTH_VERIFICATION_RATE_LIMIT',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const otpCode = this.generateOTPCode();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prismaService.profile.update({
      where: { id: userId },
      data: {
        emailVerificationCode: otpCode,
        emailVerificationExpiresAt: otpExpiresAt,
      },
    });

    await this.notificationsService.sendEmail({
      to: profile.email,
      template: NotificationTemplate.ACCOUNT_VERIFICATION,
      variables: {
        username: profile.firstName || profile.email.split('@')[0],
        verificationCode: otpCode,
        expiresIn: '15 minutes',
      },
    });

    this.logger.log(`Verification email resent to ${profile.email}`);

    return { message: 'Email de vérification renvoyé.' };
  }

  /**
   * Check email exists
   */
  async checkEmailExists(
    email: string,
  ): Promise<{ exists: boolean; email: string; role?: any }> {
    const profile = await this.prismaService.profile.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (profile) {
      return {
        exists: true,
        email,
        role: profile.role,
      };
    }

    return {
      exists: false,
      email,
      role: undefined,
    };
  }

  /**
   * Validate session
   */
  async validateSession(sessionId: string): Promise<{
    user: any;
    session: Session;
  } | null> {
    const result = await this.luciaService.validateSession(sessionId);

    if (!result.user || !result.session) {
      return null;
    }

    return {
      user: result.user,
      session: result.session,
    };
  }

  /**
   * Find or create a profile for an OAuth login, with automatic account linking
   */
  private async findOrCreateOAuthProfile(
    provider: string,
    providerUserId: string,
    userEmail: string,
    firstName?: string,
    lastName?: string,
  ): Promise<any> {
    // Check if OAuth account already exists
    const existingOAuthAccount = await this.prismaService.oAuthAccount.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId: providerUserId,
        },
      },
      include: { user: true },
    });

    if (existingOAuthAccount) {
      // OAuth account exists - check if active
      if (!existingOAuthAccount.user.isActive) {
        throw new I18nHttpException(
          'auth.account_disabled',
          'AUTH_ACCOUNT_DISABLED',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.logger.log(`Existing OAuth account found for ${userEmail}`);
      return existingOAuthAccount.user;
    }

    // Check if email already exists (LIAISON AUTOMATIQUE)
    const existingProfile = await this.prismaService.profile.findUnique({
      where: { email: userEmail },
    });

    if (existingProfile) {
      // Check if active
      if (!existingProfile.isActive) {
        throw new I18nHttpException(
          'auth.account_disabled',
          'AUTH_ACCOUNT_DISABLED',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Email exists - LINK OAUTH ACCOUNT
      this.logger.log(`Linking ${provider} to existing account: ${userEmail}`);

      await this.prismaService.oAuthAccount.create({
        data: {
          provider,
          providerId: providerUserId,
          userId: existingProfile.id,
        },
      });

      if (!existingProfile.authProvider) {
        await this.prismaService.profile.update({
          where: { id: existingProfile.id },
          data: { authProvider: provider },
        });
      }

      return existingProfile;
    }

    // Create new profile for OAuth user
    this.logger.log(`Creating new profile for OAuth user: ${userEmail}`);

    const profile = await this.usersService.createProfile({
      email: userEmail,
      role: undefined, // Must complete onboarding
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      authProvider: provider,
      isOnboarded: false, // IMPORTANT: Must complete onboarding
    });

    // Create OAuth account link
    await this.prismaService.oAuthAccount.create({
      data: {
        provider,
        providerId: providerUserId,
        userId: profile.id,
      },
    });

    return profile;
  }

  /**
   * Helper: Validate role-specific requirements (PRO/USER)
   */
  private async validateRoleRequirements(
    role: string | undefined,
    data: { firstName?: string; lastName?: string; country?: string; countries?: string[] },
  ): Promise<void> {
    if (role === 'ADMIN') {
      throw new I18nHttpException(
        'auth.cannot_create_admin',
        'AUTH_CANNOT_CREATE_ADMIN',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (role === 'PRO') {
      if (!data.firstName || !data.lastName) {
        throw new I18nHttpException(
          'auth.missing_pro_fields',
          'AUTH_MISSING_PRO_FIELDS',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!data.countries || data.countries.length === 0) {
        throw new I18nHttpException(
          'auth.missing_pro_country',
          'AUTH_MISSING_COUNTRY',
          HttpStatus.BAD_REQUEST,
        );
      }

      const validCountries = await this.prismaService.country.findMany({
        where: { code: { in: data.countries } },
      });

      if (validCountries.length !== data.countries.length) {
        throw new I18nHttpException(
          'auth.invalid_country',
          'AUTH_INVALID_COUNTRY',
          HttpStatus.BAD_REQUEST,
        );
      }

      const availableCountries = await this.checkCountriesAvailability(data.countries);
      if (availableCountries.length === 0) {
        throw new I18nHttpException(
          'auth.country_not_available',
          'AUTH_COUNTRY_NOT_AVAILABLE',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (!role || role === 'USER') {
      if (!data.country) {
        throw new I18nHttpException(
          'auth.country_required',
          'AUTH_COUNTRY_REQUIRED',
          HttpStatus.BAD_REQUEST,
        );
      }

      const countryData = await this.prismaService.country.findUnique({
        where: { code: data.country },
      });

      if (!countryData) {
        throw new I18nHttpException(
          'auth.invalid_country',
          'AUTH_INVALID_COUNTRY',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  /**
   * Helper: Map profile to auth response format
   */
  private mapProfileToResponse(profile: any) {
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role as any,
      firstName: profile.firstName || undefined,
      lastName: profile.lastName || undefined,
      phone: profile.phone || undefined,
      companyName: profile.companyName || undefined,
      siret: profile.siret || undefined,
      isActive: profile.isActive,
      isVerified: profile.isVerified,
      emailVerifiedAt: profile.emailVerifiedAt || undefined,
      verificationStatus: profile.verificationStatus || undefined,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /**
   * Helper: Check countries availability (delegates to UsersService)
   */
  private async checkCountriesAvailability(countries: string[]): Promise<string[]> {
    return this.usersService.checkCountriesAvailability(countries);
  }

  /**
   * Helper: Generate 6-digit OTP code
   */
  private generateOTPCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Helper: Generate random state for OAuth
   */
  private generateRandomState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
