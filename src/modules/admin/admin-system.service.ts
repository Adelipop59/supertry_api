import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { MetricsService, MetricsSummary } from '../../common/services/metrics.service';
import * as os from 'os';
import * as fs from 'fs';
import { createClient } from 'redis';

export interface SystemSnapshot {
  timestamp: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  diskPercent: number | null;
  diskUsedGb: number | null;
  networkRxMb: number | null;
  networkTxMb: number | null;
  processHeapPercent: number;
  processRssMb: number;
}

// 1 point toutes les 30s pendant 24h = 2880 points max
const MAX_HISTORY_POINTS = 2880;

@Injectable()
export class AdminSystemService implements OnModuleInit {
  private readonly logger = new Logger(AdminSystemService.name);
  private readonly history: SystemSnapshot[] = [];
  private previousNetworkRx = 0;
  private previousNetworkTx = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly stripeService: StripeService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit() {
    // Premier snapshot au demarrage
    await this.collectSnapshot();
  }

  // ============================================================================
  // Collecte automatique toutes les 30 secondes
  // ============================================================================

  @Cron(CronExpression.EVERY_30_SECONDS)
  async collectSnapshot() {
    try {
      const cpuPercent = await this.getCpuUsagePercent();
      const memUsage = process.memoryUsage();
      const disk = this.getDiskUsage();
      const network = this.getNetworkStats();

      // Calcul du delta reseau depuis le dernier snapshot (trafic par intervalle, pas cumulatif)
      let deltaRxMb: number | null = null;
      let deltaTxMb: number | null = null;
      if (network) {
        const currentRx = network.receivedMb;
        const currentTx = network.transmittedMb;
        if (this.previousNetworkRx > 0) {
          deltaRxMb = Math.round((currentRx - this.previousNetworkRx) * 100) / 100;
          deltaTxMb = Math.round((currentTx - this.previousNetworkTx) * 100) / 100;
          // Eviter les valeurs negatives (reboot ou overflow)
          if (deltaRxMb < 0) deltaRxMb = 0;
          if (deltaTxMb < 0) deltaTxMb = 0;
        }
        this.previousNetworkRx = currentRx;
        this.previousNetworkTx = currentTx;
      }

      const snapshot: SystemSnapshot = {
        timestamp: new Date().toISOString(),
        cpuPercent,
        memoryPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        memoryUsedMb: this.toMb(os.totalmem() - os.freemem()),
        diskPercent: disk?.usagePercent ?? null,
        diskUsedGb: disk?.usedGb ?? null,
        networkRxMb: deltaRxMb,
        networkTxMb: deltaTxMb,
        processHeapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        processRssMb: this.toMb(memUsage.rss),
      };

      this.history.push(snapshot);

      // Garder max 24h de donnees
      if (this.history.length > MAX_HISTORY_POINTS) {
        this.history.splice(0, this.history.length - MAX_HISTORY_POINTS);
      }
    } catch (error) {
      this.logger.error(`Failed to collect system snapshot: ${error.message}`);
    }
  }

  // ============================================================================
  // Historique systeme (pour graphiques frontend)
  // ============================================================================

  getSystemHistory(period: '1h' | '6h' | '24h' = '1h') {
    const now = Date.now();
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const cutoff = now - periodMs[period];

    // Filtrer par periode
    const filtered = this.history.filter(
      (s) => new Date(s.timestamp).getTime() >= cutoff,
    );

    // Pour les grandes periodes, reduire le nombre de points (downsample)
    // 1h = tous les points (~120), 6h = 1 point/2min (~180), 24h = 1 point/5min (~288)
    const targetPoints = { '1h': 120, '6h': 180, '24h': 288 };
    const target = targetPoints[period];

    let data: SystemSnapshot[];
    if (filtered.length <= target) {
      data = filtered;
    } else {
      // Downsample : prendre 1 point tous les N
      const step = Math.ceil(filtered.length / target);
      data = filtered.filter((_, i) => i % step === 0);
    }

    return {
      period,
      pointCount: data.length,
      collectionInterval: '30s',
      data,
    };
  }

  // ============================================================================
  // Health checks
  // ============================================================================

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
