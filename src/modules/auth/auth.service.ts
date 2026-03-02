import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { LuciaService } from '../lucia/lucia.service';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
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
        throw new BadRequestException(
          `Un compte existe déjà avec cet email via ${existingProfile.authProvider}. Connectez-vous avec ce provider.`,
        );
      }
      throw new BadRequestException('An account already exists with this email');
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
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!profile.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!profile.passwordHash) {
      throw new UnauthorizedException(
        'This account uses OAuth login. Please use the appropriate provider.',
      );
    }

    const isValid = await this.luciaService.verifyPassword(
      profile.passwordHash,
      password,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
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
    return { message: 'Logged out successfully' };
  }

  /**
   * Refresh token
   */
  async refreshToken(sessionId: string): Promise<RefreshTokenResponseDto> {
    const result = await this.luciaService.validateSession(sessionId);

    if (!result.session) {
      throw new UnauthorizedException('Invalid session');
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
      throw new BadRequestException('Cannot change password');
    }

    const isValid = await this.luciaService.verifyPassword(
      profile.passwordHash,
      changePasswordDto.oldPassword,
    );

    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
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

    return { message: 'Password changed successfully' };
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
          throw new BadRequestException('Unsupported OAuth provider');
      }
    } catch (error) {
      throw new BadRequestException(`OAuth failed: ${error.message}`);
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
      throw new BadRequestException(`OAuth callback failed: ${error.message}`);
    }

    if (!userEmail) {
      throw new BadRequestException('Email not provided by OAuth provider');
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
          throw new BadRequestException(`Token-based login not supported for provider: ${provider}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Token verification failed: ${error.message}`);
    }

    if (!userEmail) {
      throw new BadRequestException('Email not provided by OAuth provider');
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
      throw new NotFoundException('Profile not found');
    }

    if (profile.isOnboarded) {
      throw new BadRequestException('Profile already completed');
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
        throw new UnauthorizedException('Ce compte a été désactivé.');
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
        throw new UnauthorizedException('Ce compte a été désactivé.');
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
      throw new BadRequestException('Cannot create ADMIN users via signup.');
    }

    if (role === 'PRO') {
      if (!data.firstName || !data.lastName) {
        throw new BadRequestException('First name and last name are required for PRO');
      }

      if (!data.countries || data.countries.length === 0) {
        throw new BadRequestException('At least one country is required for PRO');
      }

      const validCountries = await this.prismaService.country.findMany({
        where: { code: { in: data.countries } },
      });

      if (validCountries.length !== data.countries.length) {
        throw new BadRequestException('Invalid country code(s)');
      }

      const availableCountries = await this.checkCountriesAvailability(data.countries);
      if (availableCountries.length === 0) {
        throw new BadRequestException('No selected country is available');
      }
    }

    if (!role || role === 'USER') {
      if (!data.country) {
        throw new BadRequestException('Country code is required for USER');
      }

      const countryData = await this.prismaService.country.findUnique({
        where: { code: data.country },
      });

      if (!countryData) {
        throw new BadRequestException('Invalid country code');
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
   * Helper: Generate random state for OAuth
   */
  private generateRandomState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
