import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { MetricsService, MetricsSummary } from '../../common/services/metrics.service';
import * as os from 'os';
import * as fs from 'fs';
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

  async getSystemInfo() {
    const memUsage = process.memoryUsage();

    const uptimeSeconds = Math.floor(process.uptime());
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

    // OS uptime (serveur entier, pas juste le process Node)
    const osUptimeSeconds = Math.floor(os.uptime());
    const osUptimeDays = Math.floor(osUptimeSeconds / 86400);
    const osUptimeHours = Math.floor((osUptimeSeconds % 86400) / 3600);
    const osUptimeMinutes = Math.floor((osUptimeSeconds % 3600) / 60);

    // CPU usage reel en pourcentage (moyenne sur les cores)
    const cpuPercent = await this.getCpuUsagePercent();

    // Disk usage (Linux /proc/diskstats ou df)
    const disk = this.getDiskUsage();

    // Network I/O (Linux /proc/net/dev)
    const network = this.getNetworkStats();

    return {
      node: {
        version: process.version,
        uptimeSeconds,
        uptimeFormatted: `${uptimeDays}j ${uptimeHours}h ${uptimeMinutes}m`,
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
      },
      server: {
        hostname: os.hostname(),
        osType: os.type(),
        osRelease: os.release(),
        uptimeSeconds: osUptimeSeconds,
        uptimeFormatted: `${osUptimeDays}j ${osUptimeHours}h ${osUptimeMinutes}m`,
      },
      cpu: {
        usagePercent: cpuPercent,         // % CPU reel (comme Hostinger)
        loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
        loadAvg5m: Math.round(os.loadavg()[1] * 100) / 100,
        loadAvg15m: Math.round(os.loadavg()[2] * 100) / 100,
        coreCount: os.cpus().length,
        model: os.cpus()[0]?.model || null,
      },
      memory: {
        // RAM serveur (comme Hostinger "Memory usage")
        totalMb: this.toMb(os.totalmem()),
        usedMb: this.toMb(os.totalmem() - os.freemem()),
        freeMb: this.toMb(os.freemem()),
        usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        // RAM process Node.js
        processRssMb: this.toMb(memUsage.rss),
        processHeapUsedMb: this.toMb(memUsage.heapUsed),
        processHeapTotalMb: this.toMb(memUsage.heapTotal),
        processHeapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
      disk,     // { totalGb, usedGb, freeGb, usagePercent } ou null si pas dispo
      network,  // { receivedMb, transmittedMb } ou null si pas dispo
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

  /**
   * Mesure le % CPU reel sur 100ms (comme htop/Hostinger)
   */
  private getCpuUsagePercent(): Promise<number> {
    return new Promise((resolve) => {
      const cpus1 = os.cpus();
      setTimeout(() => {
        const cpus2 = os.cpus();
        let idleDiff = 0;
        let totalDiff = 0;
        for (let i = 0; i < cpus1.length; i++) {
          const c1 = cpus1[i].times;
          const c2 = cpus2[i].times;
          const idle = c2.idle - c1.idle;
          const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
          idleDiff += idle;
          totalDiff += total;
        }
        const percent = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;
        resolve(percent);
      }, 100);
    });
  }

  /**
   * Lit l'usage disque via /proc/mounts + statfs (Linux)
   * Fallback null si pas Linux
   */
  private getDiskUsage(): { totalGb: number; usedGb: number; freeGb: number; usagePercent: number } | null {
    try {
      if (process.platform !== 'linux') return null;
      // Utilise statvfs via execSync comme fallback simple
      const { execSync } = require('child_process');
      const output = execSync('df -B1 / | tail -1', { encoding: 'utf8', timeout: 2000 });
      const parts = output.trim().split(/\s+/);
      // parts: [filesystem, total, used, available, use%, mountpoint]
      const totalBytes = parseInt(parts[1], 10);
      const usedBytes = parseInt(parts[2], 10);
      const availBytes = parseInt(parts[3], 10);
      return {
        totalGb: this.toGb(totalBytes),
        usedGb: this.toGb(usedBytes),
        freeGb: this.toGb(availBytes),
        usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Lit les stats reseau depuis /proc/net/dev (Linux)
   * Retourne les bytes recus/transmis depuis le boot
   */
  private getNetworkStats(): { receivedMb: number; transmittedMb: number; interfaces: Record<string, { receivedMb: number; transmittedMb: number }> } | null {
    try {
      if (process.platform !== 'linux') return null;
      const content = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = content.trim().split('\n').slice(2); // skip headers
      let totalRx = 0;
      let totalTx = 0;
      const interfaces: Record<string, { receivedMb: number; transmittedMb: number }> = {};

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const iface = parts[0].replace(':', '');
        if (iface === 'lo') continue; // skip loopback
        const rx = parseInt(parts[1], 10);
        const tx = parseInt(parts[9], 10);
        totalRx += rx;
        totalTx += tx;
        interfaces[iface] = {
          receivedMb: this.toMb(rx),
          transmittedMb: this.toMb(tx),
        };
      }

      return {
        receivedMb: this.toMb(totalRx),
        transmittedMb: this.toMb(totalTx),
        interfaces,
      };
    } catch {
      return null;
    }
  }

  getApiMetrics(): MetricsSummary {
    return this.metricsService.getMetrics();
  }

  private toMb(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }

  private toGb(bytes: number): number {
    return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
  }
}
