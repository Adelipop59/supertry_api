import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { MetricsService, MetricsSummary } from '../../common/services/metrics.service';
import * as os from 'os';
import * as fs from 'fs';
import { createClient } from 'redis';

export interface SystemSnapshotData {
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

@Injectable()
export class AdminSystemService implements OnModuleInit {
  private readonly logger = new Logger(AdminSystemService.name);
  private previousNetworkRx = 0;
  private previousNetworkTx = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly stripeService: StripeService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit() {
    await this.collectSnapshot();
  }

  // ============================================================================
  // Collecte automatique toutes les 30 secondes -> stocke en DB
  // ============================================================================

  @Cron(CronExpression.EVERY_30_SECONDS)
  async collectSnapshot() {
    try {
      const cpuPercent = await this.getCpuUsagePercent();
      const memUsage = process.memoryUsage();
      const disk = this.getDiskUsage();
      const network = this.getNetworkStats();

      let deltaRxMb: number | null = null;
      let deltaTxMb: number | null = null;
      if (network) {
        const currentRx = network.receivedMb;
        const currentTx = network.transmittedMb;
        if (this.previousNetworkRx > 0) {
          deltaRxMb = Math.max(0, Math.round((currentRx - this.previousNetworkRx) * 100) / 100);
          deltaTxMb = Math.max(0, Math.round((currentTx - this.previousNetworkTx) * 100) / 100);
        }
        this.previousNetworkRx = currentRx;
        this.previousNetworkTx = currentTx;
      }

      await this.prisma.systemSnapshot.create({
        data: {
          cpuPercent,
          memoryPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
          memoryUsedMb: this.toMb(os.totalmem() - os.freemem()),
          diskPercent: disk?.usagePercent ?? null,
          diskUsedGb: disk?.usedGb ?? null,
          networkRxMb: deltaRxMb,
          networkTxMb: deltaTxMb,
          processHeapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
          processRssMb: this.toMb(memUsage.rss),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect system snapshot: ${error.message}`);
    }
  }

  // Flush les metriques API en DB toutes les minutes
  @Cron(CronExpression.EVERY_MINUTE)
  async flushApiMetrics() {
    try {
      await this.metricsService.flushBuffer();
    } catch (error) {
      this.logger.error(`Failed to flush API metrics: ${error.message}`);
    }
  }

  // Cleanup des donnees > 2 mois, tourne une fois par jour a 3h du matin
  @Cron('0 3 * * *')
  async cleanupOldData() {
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    try {
      const [snapshots, metrics] = await Promise.all([
        this.prisma.systemSnapshot.deleteMany({
          where: { timestamp: { lt: twoMonthsAgo } },
        }),
        this.prisma.apiMetric.deleteMany({
          where: { timestamp: { lt: twoMonthsAgo } },
        }),
      ]);
      this.logger.log(
        `Cleanup: deleted ${snapshots.count} snapshots and ${metrics.count} api metrics older than 2 months`,
      );
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error.message}`);
    }
  }

  // ============================================================================
  // Historique systeme depuis la DB (pour graphiques)
  // ============================================================================

  async getSystemHistory(period: '1h' | '6h' | '24h' | '7d' | '30d' = '1h') {
    const periodMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const since = new Date(Date.now() - periodMs[period]);

    // Pour les longues periodes, agreger par intervalles plus grands
    if (period === '7d' || period === '30d') {
      // Agreger par heure
      const interval = period === '7d' ? '1 hour' : '3 hours';
      const data: Array<{
        bucket: Date;
        avg_cpu: number;
        avg_memory: number;
        avg_memory_mb: number;
        avg_disk: number;
        sum_rx: number;
        sum_tx: number;
        avg_heap: number;
        avg_rss: number;
      }> = await this.prisma.$queryRaw`
        SELECT
          date_trunc(${interval}, timestamp) AS bucket,
          ROUND(AVG(cpu_percent))::int AS avg_cpu,
          ROUND(AVG(memory_percent))::int AS avg_memory,
          ROUND(AVG(memory_used_mb)::numeric, 2)::float AS avg_memory_mb,
          ROUND(AVG(disk_percent))::int AS avg_disk,
          ROUND(COALESCE(SUM(network_rx_mb), 0)::numeric, 2)::float AS sum_rx,
          ROUND(COALESCE(SUM(network_tx_mb), 0)::numeric, 2)::float AS sum_tx,
          ROUND(AVG(process_heap_percent))::int AS avg_heap,
          ROUND(AVG(process_rss_mb)::numeric, 2)::float AS avg_rss
        FROM system_snapshots
        WHERE timestamp >= ${since}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;

      return {
        period,
        pointCount: data.length,
        aggregation: interval,
        data: data.map((d) => ({
          timestamp: d.bucket.toISOString(),
          cpuPercent: d.avg_cpu,
          memoryPercent: d.avg_memory,
          memoryUsedMb: d.avg_memory_mb,
          diskPercent: d.avg_disk,
          networkRxMb: d.sum_rx,
          networkTxMb: d.sum_tx,
          processHeapPercent: d.avg_heap,
          processRssMb: d.avg_rss,
        })),
      };
    }

    // Pour 1h/6h/24h : donnees brutes
    const data = await this.prisma.systemSnapshot.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        cpuPercent: true,
        memoryPercent: true,
        memoryUsedMb: true,
        diskPercent: true,
        diskUsedGb: true,
        networkRxMb: true,
        networkTxMb: true,
        processHeapPercent: true,
        processRssMb: true,
      },
    });

    return {
      period,
      pointCount: data.length,
      aggregation: 'raw (30s)',
      data,
    };
  }

  // ============================================================================
  // Health checks
  // ============================================================================

  async getHealthCheck() {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (error) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: error.message };
    }

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

  // ============================================================================
  // Info serveur temps reel (snapshot instantane)
  // ============================================================================

  async getSystemInfo() {
    const memUsage = process.memoryUsage();

    const uptimeSeconds = Math.floor(process.uptime());
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

    const osUptimeSeconds = Math.floor(os.uptime());
    const osUptimeDays = Math.floor(osUptimeSeconds / 86400);
    const osUptimeHours = Math.floor((osUptimeSeconds % 86400) / 3600);
    const osUptimeMinutes = Math.floor((osUptimeSeconds % 3600) / 60);

    const cpuPercent = await this.getCpuUsagePercent();
    const disk = this.getDiskUsage();
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
        usagePercent: cpuPercent,
        loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
        loadAvg5m: Math.round(os.loadavg()[1] * 100) / 100,
        loadAvg15m: Math.round(os.loadavg()[2] * 100) / 100,
        coreCount: os.cpus().length,
        model: os.cpus()[0]?.model || null,
      },
      memory: {
        totalMb: this.toMb(os.totalmem()),
        usedMb: this.toMb(os.totalmem() - os.freemem()),
        freeMb: this.toMb(os.freemem()),
        usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        processRssMb: this.toMb(memUsage.rss),
        processHeapUsedMb: this.toMb(memUsage.heapUsed),
        processHeapTotalMb: this.toMb(memUsage.heapTotal),
        processHeapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
      disk,
      network,
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

  // ============================================================================
  // Helpers privees
  // ============================================================================

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
        resolve(totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0);
      }, 100);
    });
  }

  private getDiskUsage(): { totalGb: number; usedGb: number; freeGb: number; usagePercent: number } | null {
    try {
      if (process.platform !== 'linux') return null;
      const { execSync } = require('child_process');
      const output = execSync('df -B1 / | tail -1', { encoding: 'utf8', timeout: 2000 });
      const parts = output.trim().split(/\s+/);
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

  private getNetworkStats(): { receivedMb: number; transmittedMb: number; interfaces: Record<string, { receivedMb: number; transmittedMb: number }> } | null {
    try {
      if (process.platform !== 'linux') return null;
      const content = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = content.trim().split('\n').slice(2);
      let totalRx = 0;
      let totalTx = 0;
      const interfaces: Record<string, { receivedMb: number; transmittedMb: number }> = {};

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const iface = parts[0].replace(':', '');
        if (iface === 'lo') continue;
        const rx = parseInt(parts[1], 10);
        const tx = parseInt(parts[9], 10);
        totalRx += rx;
        totalTx += tx;
        interfaces[iface] = {
          receivedMb: this.toMb(rx),
          transmittedMb: this.toMb(tx),
        };
      }

      return { receivedMb: this.toMb(totalRx), transmittedMb: this.toMb(totalTx), interfaces };
    } catch {
      return null;
    }
  }

  private toMb(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }

  private toGb(bytes: number): number {
    return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
  }
}
