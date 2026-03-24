import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { MetricsService, MetricsSummary } from '../../common/services/metrics.service';
import * as os from 'os';
import { createClient } from 'redis';

@Injectable()
export class AdminSystemService {
  private readonly logger = new Logger(AdminSystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly stripeService: StripeService,
    private readonly metricsService: MetricsService,
  ) {}

  async getHealthCheck() {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (error) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: error.message };
    }

    // Redis
    const redisStart = Date.now();
    try {
      const redisHost = this.configService.get('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get('REDIS_PORT', '6379');
      const redisPassword = this.configService.get('REDIS_PASSWORD');
      const url = redisPassword
        ? `redis://:${redisPassword}@${redisHost}:${redisPort}`
        : `redis://${redisHost}:${redisPort}`;
      const client = createClient({ url });
      await client.connect();
      await client.ping();
      await client.disconnect();
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (error) {
      checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, error: error.message };
    }

    // Stripe
    const stripeStart = Date.now();
    try {
      await this.stripeService.getPlatformBalance();
      checks.stripe = { status: 'ok', latencyMs: Date.now() - stripeStart };
    } catch (error) {
      checks.stripe = { status: 'error', latencyMs: Date.now() - stripeStart, error: error.message };
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    return {
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  getSystemInfo() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      node: {
        version: process.version,
        uptime: Math.floor(process.uptime()),
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        rss: this.formatBytes(memUsage.rss),
        heapTotal: this.formatBytes(memUsage.heapTotal),
        heapUsed: this.formatBytes(memUsage.heapUsed),
        external: this.formatBytes(memUsage.external),
        heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
      cpu: {
        userMicroseconds: cpuUsage.user,
        systemMicroseconds: cpuUsage.system,
        loadAvg: os.loadavg(),
        cpuCount: os.cpus().length,
      },
      os: {
        hostname: os.hostname(),
        type: os.type(),
        totalMemory: this.formatBytes(os.totalmem()),
        freeMemory: this.formatBytes(os.freemem()),
        memoryUsagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
      },
      kubernetes: {
        podName: process.env.POD_NAME || null,
        podNamespace: process.env.POD_NAMESPACE || null,
        podIp: process.env.POD_IP || null,
        nodeName: process.env.NODE_NAME || null,
        appVersion: process.env.APP_VERSION || null,
        cpuLimit: process.env.CONTAINER_CPU_LIMIT || null,
        memoryLimit: process.env.CONTAINER_MEMORY_LIMIT || null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  getApiMetrics(): MetricsSummary {
    return this.metricsService.getMetrics();
  }

  private formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb * 100) / 100} MB`;
  }
}
