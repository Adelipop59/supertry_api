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
      throw new BadRequestException('An account already exists with this email');
    }

    // Hash password
    const passwordHash = await this.luciaService.hashPassword(password);

    // Create profile
    const profile = await this.usersService.createProfile({
      email,
      role: role || 'USER',
      country,
      firstName: profileData.firstName || '',
      lastName: profileData.lastName || '',
      phone: profileData.phone,
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
    if (role === 'USER') {
      try {
        const stripeAccount = await this.stripeService.createConnectAccount(
          email,
          country || 'FR', // Default to FR if no country
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
    provider: 'google' | 'github' | 'azure',
  ): Promise<OAuthUrlResponseDto> {
    const state = this.generateRandomState();

    let url: URL;

    try {
      switch (provider) {
        case 'google':
          url = await this.luciaService.createGoogleAuthorizationURL(state);
          break;
        case 'github':
          url = await this.luciaService.createGitHubAuthorizationURL(state);
          break;
        case 'azure':
          url = await this.luciaService.createAzureAuthorizationURL(state);
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
    provider: 'google' | 'github' | 'azure',
  ): Promise<AuthResponseDto & { sessionId: string }> {
    let providerUserId: string;
    let userEmail: string;
    let firstName: string | undefined;
    let lastName: string | undefined;

    // Validate code and fetch user info
    try {
      switch (provider) {
        case 'google': {
          const tokens = await this.luciaService.validateGoogleAuthorizationCode(code);
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
        case 'azure': {
          const tokens = await this.luciaService.validateAzureAuthorizationCode(code);
          const azureUser = await this.luciaService.fetchAzureUser(tokens.accessToken);
          providerUserId = azureUser.sub;
          userEmail = azureUser.email;
          firstName = azureUser.given_name;
          lastName = azureUser.family_name;
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

    let profile;

    if (existingOAuthAccount) {
      // OAuth account exists - return existing profile
      profile = existingOAuthAccount.user;
      this.logger.log(`Existing OAuth account found for ${userEmail}`);
    } else {
      // Check if email already exists (LIAISON AUTOMATIQUE)
      const existingProfile = await this.prismaService.profile.findUnique({
        where: { email: userEmail },
      });

      if (existingProfile) {
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

        profile = existingProfile;
      } else {
        // Create new profile for OAuth user
        this.logger.log(`Creating new profile for OAuth user: ${userEmail}`);

        profile = await this.usersService.createProfile({
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
      }
    }

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
