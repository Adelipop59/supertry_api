import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Lucia, Session, User } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Google, GitHub } from 'arctic';
import * as argon2 from '@node-rs/argon2';

export interface DatabaseUserAttributes {
  id: string;
  email: string;
  role: string | null;
  firstName: string | null;
  lastName: string | null;
  isOnboarded: boolean;
  isActive: boolean;
  authProvider: string | null;
}

@Injectable()
export class LuciaService implements OnModuleInit {
  private lucia: Lucia;
  public google: Google;
  public github: GitHub;
  public azure: any;

  constructor(
    private prismaService: PrismaService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // Initialize Lucia adapter with Prisma
    const adapter = new PrismaAdapter(
      this.prismaService.luciaSession as any,
      this.prismaService.profile as any,
    );

    // Initialize Lucia
    this.lucia = new Lucia(adapter, {
      sessionCookie: {
        expires: false,
        attributes: {
          secure: this.configService.get('NODE_ENV') === 'production',
        },
      },
      getUserAttributes: (attributes: any) => {
        return {
          id: attributes.id,
          email: attributes.email,
          role: attributes.role,
          firstName: attributes.firstName,
          lastName: attributes.lastName,
          isOnboarded: attributes.isOnboarded,
          isActive: attributes.isActive,
          authProvider: attributes.authProvider,
        };
      },
    });

    // Initialize OAuth providers
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    // Google OAuth
    const googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    const googleClientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    if (googleClientId && googleClientSecret) {
      this.google = new Google(
        googleClientId,
        googleClientSecret,
        `${frontendUrl}/auth/callback/google`,
      );
    }

    // GitHub OAuth
    const githubClientId = this.configService.get<string>('GITHUB_CLIENT_ID', '');
    const githubClientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET', '');
    if (githubClientId && githubClientSecret) {
      this.github = new GitHub(githubClientId, githubClientSecret, `${frontendUrl}/auth/callback/github`);
    }

    // Azure AD OAuth - Disabled for now (AzureAD not available in arctic 3.7.0)
    // const azureTenantId = this.configService.get<string>('AZURE_TENANT_ID', '');
    // const azureClientId = this.configService.get<string>('AZURE_CLIENT_ID', '');
    // const azureClientSecret = this.configService.get<string>('AZURE_CLIENT_SECRET', '');
    // if (azureTenantId && azureClientId && azureClientSecret) {
    //   this.azure = new AzureAD(
    //     azureTenantId,
    //     azureClientId,
    //     azureClientSecret,
    //     `${frontendUrl}/auth/callback/azure`,
    //   );
    // }
  }

  getLucia(): Lucia {
    return this.lucia;
  }

  async createSession(userId: string): Promise<Session> {
    return this.lucia.createSession(userId, {});
  }

  async validateSession(
    sessionId: string,
  ): Promise<{ user: User; session: Session } | { user: null; session: null }> {
    return this.lucia.validateSession(sessionId);
  }

  async invalidateSession(sessionId: string): Promise<void> {
    return this.lucia.invalidateSession(sessionId);
  }

  async invalidateUserSessions(userId: string): Promise<void> {
    return this.lucia.invalidateUserSessions(userId);
  }

  createSessionCookie(sessionId: string): {
    name: string;
    value: string;
    attributes: Record<string, any>;
  } {
    return this.lucia.createSessionCookie(sessionId);
  }

  createBlankSessionCookie(): {
    name: string;
    value: string;
    attributes: Record<string, any>;
  } {
    return this.lucia.createBlankSessionCookie();
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async createGoogleAuthorizationURL(state: string): Promise<URL> {
    if (!this.google) {
      throw new Error('Google OAuth is not configured');
    }
    const codeVerifier = ''; // TODO: Generate proper code verifier
    return await this.google.createAuthorizationURL(state, codeVerifier, ['email', 'profile']);
  }

  async createGitHubAuthorizationURL(state: string): Promise<URL> {
    if (!this.github) {
      throw new Error('GitHub OAuth is not configured');
    }
    return await this.github.createAuthorizationURL(state, ['user:email']);
  }

  async createAzureAuthorizationURL(state: string): Promise<URL> {
    if (!this.azure) {
      throw new Error('Azure OAuth is not configured');
    }
    return await this.azure.createAuthorizationURL(state, {
      scopes: ['openid', 'profile', 'email'],
    });
  }

  async validateGoogleAuthorizationCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: Date;
  }> {
    if (!this.google) {
      throw new Error('Google OAuth is not configured');
    }
    const codeVerifier = ''; // TODO: Use same verifier from authorization
    const tokens = await this.google.validateAuthorizationCode(code, codeVerifier);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.refreshToken(),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
    };
  }

  async validateGitHubAuthorizationCode(code: string): Promise<{
    accessToken: string;
  }> {
    if (!this.github) {
      throw new Error('GitHub OAuth is not configured');
    }
    const tokens = await this.github.validateAuthorizationCode(code);
    return {
      accessToken: tokens.accessToken(),
    };
  }

  async validateAzureAuthorizationCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: Date;
  }> {
    if (!this.azure) {
      throw new Error('Azure OAuth is not configured');
    }
    return await this.azure.validateAuthorizationCode(code);
  }

  async fetchGoogleUser(accessToken: string): Promise<{
    sub: string;
    email: string;
    email_verified: boolean;
    name: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
  }> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Google user info');
    }

    return response.json();
  }

  async fetchGitHubUser(accessToken: string): Promise<{
    id: number;
    login: string;
    email: string | null;
    name: string | null;
    avatar_url: string;
  }> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'SuperTry-API',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch GitHub user info');
    }

    const user = await response.json();

    if (!user.email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'SuperTry-API',
        },
      });

      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        const primaryEmail = emails.find((e: any) => e.primary && e.verified)?.email;
        user.email = primaryEmail || null;
      }
    }

    return user;
  }

  async fetchAzureUser(accessToken: string): Promise<{
    sub: string;
    email: string;
    name: string;
    given_name?: string;
    family_name?: string;
  }> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Azure AD user info');
    }

    const user = await response.json();

    return {
      sub: user.id,
      email: user.mail || user.userPrincipalName,
      name: user.displayName,
      given_name: user.givenName,
      family_name: user.surname,
    };
  }
}
