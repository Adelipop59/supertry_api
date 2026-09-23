import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Lucia, Session, User } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';

import { PrismaService } from '../../database/prisma.service';
import {
  Google,
  GitHub,
  MicrosoftEntraId,
  Apple,
  Facebook,
  Discord,
  generateCodeVerifier,
  decodeIdToken,
} from 'arctic';
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
  public microsoft: MicrosoftEntraId;
  public apple: Apple;
  public facebook: Facebook;
  public discord: Discord;

  // PKCE code verifier storage (in-memory, keyed by state)
  private codeVerifiers: Map<string, { verifier: string; expiresAt: number }> = new Map();

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

    // Microsoft (Entra ID) OAuth
    const microsoftTenantId = this.configService.get<string>('MICROSOFT_TENANT_ID', '');
    const microsoftClientId = this.configService.get<string>('MICROSOFT_CLIENT_ID', '');
    const microsoftClientSecret = this.configService.get<string>('MICROSOFT_CLIENT_SECRET', '');
    if (microsoftTenantId && microsoftClientId && microsoftClientSecret) {
      this.microsoft = new MicrosoftEntraId(
        microsoftTenantId,
        microsoftClientId,
        microsoftClientSecret,
        `${frontendUrl}/auth/callback/microsoft`,
      );
    }

    // Apple Sign In
    const appleClientId = this.configService.get<string>('APPLE_CLIENT_ID', '');
    const appleTeamId = this.configService.get<string>('APPLE_TEAM_ID', '');
    const appleKeyId = this.configService.get<string>('APPLE_KEY_ID', '');
    const applePrivateKey = this.configService.get<string>('APPLE_PRIVATE_KEY', '');
    if (appleClientId && appleTeamId && appleKeyId && applePrivateKey) {
      const encoder = new TextEncoder();
      this.apple = new Apple(
        appleClientId,
        appleTeamId,
        appleKeyId,
        encoder.encode(applePrivateKey.replace(/\\n/g, '\n')),
        `${frontendUrl}/auth/callback/apple`,
      );
    }

    // Facebook OAuth
    const facebookAppId = this.configService.get<string>('FACEBOOK_APP_ID', '');
    const facebookAppSecret = this.configService.get<string>('FACEBOOK_APP_SECRET', '');
    if (facebookAppId && facebookAppSecret) {
      this.facebook = new Facebook(
        facebookAppId,
        facebookAppSecret,
        `${frontendUrl}/auth/callback/facebook`,
      );
    }

    // Discord OAuth
    const discordClientId = this.configService.get<string>('DISCORD_CLIENT_ID', '');
    const discordClientSecret = this.configService.get<string>('DISCORD_CLIENT_SECRET', '');
    if (discordClientId && discordClientSecret) {
      this.discord = new Discord(
        discordClientId,
        discordClientSecret,
        `${frontendUrl}/auth/callback/discord`,
      );
    }
  }

  // ─── PKCE Code Verifier Management ────────────────────────────────

  private storeCodeVerifier(state: string, verifier: string): void {
    this.codeVerifiers.set(state, {
      verifier,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });
    this.cleanupExpiredVerifiers();
  }

  private retrieveCodeVerifier(state: string): string {
    const entry = this.codeVerifiers.get(state);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codeVerifiers.delete(state);
      throw new Error('Code verifier expired or not found');
    }
    this.codeVerifiers.delete(state);
    return entry.verifier;
  }

  private cleanupExpiredVerifiers(): void {
    const now = Date.now();
    for (const [key, value] of this.codeVerifiers) {
      if (value.expiresAt < now) this.codeVerifiers.delete(key);
    }
  }

  // ─── Lucia Session Management ─────────────────────────────────────

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

  // ─── Password Hashing ─────────────────────────────────────────────

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

  // ─── Google OAuth ─────────────────────────────────────────────────

  createGoogleAuthorizationURL(state: string): URL {
    if (!this.google) {
      throw new Error('Google OAuth is not configured');
    }
    const codeVerifier = generateCodeVerifier();
    this.storeCodeVerifier(state, codeVerifier);
    return this.google.createAuthorizationURL(state, codeVerifier, ['email', 'profile']);
  }

  async validateGoogleAuthorizationCode(code: string, state: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: Date;
  }> {
    if (!this.google) {
      throw new Error('Google OAuth is not configured');
    }
    const codeVerifier = this.retrieveCodeVerifier(state);
    const tokens = await this.google.validateAuthorizationCode(code, codeVerifier);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
    };
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

  // ─── GitHub OAuth ─────────────────────────────────────────────────

  createGitHubAuthorizationURL(state: string): URL {
    if (!this.github) {
      throw new Error('GitHub OAuth is not configured');
    }
    return this.github.createAuthorizationURL(state, ['user:email']);
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

  // ─── Microsoft (Entra ID) OAuth ───────────────────────────────────

  createMicrosoftAuthorizationURL(state: string): URL {
    if (!this.microsoft) {
      throw new Error('Microsoft OAuth is not configured');
    }
    const codeVerifier = generateCodeVerifier();
    this.storeCodeVerifier(state, codeVerifier);
    return this.microsoft.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
  }

  async validateMicrosoftAuthorizationCode(code: string, state: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: Date;
  }> {
    if (!this.microsoft) {
      throw new Error('Microsoft OAuth is not configured');
    }
    const codeVerifier = this.retrieveCodeVerifier(state);
    const tokens = await this.microsoft.validateAuthorizationCode(code, codeVerifier);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
    };
  }

  async fetchMicrosoftUser(accessToken: string): Promise<{
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
      throw new Error('Failed to fetch Microsoft user info');
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

  // ─── Apple OAuth ──────────────────────────────────────────────────

  createAppleAuthorizationURL(state: string): URL {
    if (!this.apple) {
      throw new Error('Apple OAuth is not configured');
    }
    return this.apple.createAuthorizationURL(state, ['name', 'email']);
  }

  async validateAppleAuthorizationCode(code: string): Promise<{
    idToken: string;
    accessToken: string;
  }> {
    if (!this.apple) {
      throw new Error('Apple OAuth is not configured');
    }
    const tokens = await this.apple.validateAuthorizationCode(code);
    return {
      idToken: tokens.idToken(),
      accessToken: tokens.accessToken(),
    };
  }

  parseAppleIdToken(idToken: string): {
    sub: string;
    email?: string;
  } {
    const claims = decodeIdToken(idToken) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
    };
    return {
      sub: claims.sub,
      email: claims.email,
    };
  }

  // ─── Facebook OAuth ───────────────────────────────────────────────

  createFacebookAuthorizationURL(state: string): URL {
    if (!this.facebook) {
      throw new Error('Facebook OAuth is not configured');
    }
    return this.facebook.createAuthorizationURL(state, ['email', 'public_profile']);
  }

  async validateFacebookAuthorizationCode(code: string): Promise<{
    accessToken: string;
  }> {
    if (!this.facebook) {
      throw new Error('Facebook OAuth is not configured');
    }
    const tokens = await this.facebook.validateAuthorizationCode(code);
    return {
      accessToken: tokens.accessToken(),
    };
  }

  async fetchFacebookUser(accessToken: string): Promise<{
    id: string;
    email?: string;
    first_name?: string;
    last_name?: string;
  }> {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,email,first_name,last_name`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error('Failed to fetch Facebook user info');
    }

    return response.json();
  }

  // ─── Discord OAuth ────────────────────────────────────────────────

  createDiscordAuthorizationURL(state: string): URL {
    if (!this.discord) {
      throw new Error('Discord OAuth is not configured');
    }
    const codeVerifier = generateCodeVerifier();
    this.storeCodeVerifier(state, codeVerifier);
    return this.discord.createAuthorizationURL(state, codeVerifier, ['identify', 'email']);
  }

  async validateDiscordAuthorizationCode(code: string, state: string): Promise<{
    accessToken: string;
    refreshToken?: string;
  }> {
    if (!this.discord) {
      throw new Error('Discord OAuth is not configured');
    }
    const codeVerifier = this.retrieveCodeVerifier(state);
    const tokens = await this.discord.validateAuthorizationCode(code, codeVerifier);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
    };
  }

  async fetchDiscordUser(accessToken: string): Promise<{
    id: string;
    username: string;
    email?: string;
    global_name?: string;
    avatar?: string;
  }> {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Discord user info');
    }

    return response.json();
  }
}
