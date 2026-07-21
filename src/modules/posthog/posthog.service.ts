import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

type EventProps = Record<string, unknown>;

@Injectable()
export class PostHogService implements OnModuleDestroy {
  private readonly logger = new Logger(PostHogService.name);
  private readonly client?: PostHog;
  private readonly environment: string;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('POSTHOG_ENABLED') === 'true';
    const apiKey = config.get<string>('POSTHOG_API_KEY');
    const host = config.get<string>('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
    // Super property attached to every event — filter dev vs prod in PostHog.
    // K8s overlays pass APP_ENV=dev|prod → normalized to preprod|production.
    const raw =
      config.get<string>('APP_ENV') ?? process.env.NODE_ENV ?? 'development';
    const envMap: Record<string, string> = { dev: 'preprod', prod: 'production' };
    this.environment = envMap[raw] ?? raw;

    if (!enabled || !apiKey) {
      this.logger.log('PostHog disabled (set POSTHOG_ENABLED=true + POSTHOG_API_KEY to activate)');
      return;
    }

    this.client = new PostHog(apiKey, {
      host,
      flushAt: 20,
      flushInterval: 10_000,
    });
    this.logger.log(`PostHog initialized (host=${host})`);
  }

  capture(distinctId: string, event: string, properties?: EventProps): void {
    if (!this.client || !distinctId) return;
    try {
      this.client.capture({
        distinctId,
        event,
        properties: { environment: this.environment, ...properties },
      });
    } catch (err) {
      this.logger.warn(`PostHog capture failed for ${event}: ${(err as Error).message}`);
    }
  }

  identify(distinctId: string, properties?: EventProps): void {
    if (!this.client || !distinctId) return;
    try {
      this.client.identify({
        distinctId,
        properties: { environment: this.environment, ...properties },
      });
    } catch (err) {
      this.logger.warn(`PostHog identify failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.shutdown();
    } catch (err) {
      this.logger.warn(`PostHog shutdown failed: ${(err as Error).message}`);
    }
  }
}
