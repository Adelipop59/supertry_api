import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// Buffer en memoire pour agreger avant flush en DB
interface RouteBuffer {
  requests: number;
  errors: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

// Pour les stats all-time en memoire (p95 etc)
interface RouteMetric {
  method: string;
  route: string;
  totalRequests: number;
  totalErrors: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  durations: number[]; // circular buffer for p95
}

export interface RouteMetricsSummary {
  method: string;
  route: string;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p95DurationMs: number;
}

export interface MetricsSummary {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  routes: RouteMetricsSummary[];
  topSlowest: RouteMetricsSummary[];
  topMostRequested: RouteMetricsSummary[];
}

const BUFFER_SIZE = 1000;

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // Stats all-time en memoire (pour p95, requete instantanee)
  private readonly metrics = new Map<string, RouteMetric>();
  private totalRequests = 0;
  private totalErrors = 0;
  private readonly startedAt = Date.now();

  // Buffer horaire en memoire, flush en DB toutes les minutes
  private readonly hourlyBuffer = new Map<string, RouteBuffer>(); // "METHOD:route" -> buffer
  private currentHourKey = ''; // "YYYY-MM-DDTHH"

  constructor(private readonly prisma: PrismaService) {
    this.currentHourKey = this.getHourKey();
  }

  recordRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const key = `${method}:${route}`;
    const isError = statusCode >= 400;

    // --- Stats all-time en memoire ---
    let metric = this.metrics.get(key);
    if (!metric) {
      metric = {
        method,
        route,
        totalRequests: 0,
        totalErrors: 0,
        totalDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0,
        durations: [],
      };
      this.metrics.set(key, metric);
    }

    metric.totalRequests++;
    metric.totalDurationMs += durationMs;
    metric.minDurationMs = Math.min(metric.minDurationMs, durationMs);
    metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
    if (metric.durations.length >= BUFFER_SIZE) metric.durations.shift();
    metric.durations.push(durationMs);
    this.totalRequests++;
    if (isError) {
      metric.totalErrors++;
      this.totalErrors++;
    }

    // --- Buffer horaire (sera flush en DB) ---
    const hourKey = this.getHourKey();
    if (hourKey !== this.currentHourKey) {
      // Nouvelle heure : flush le buffer precedent puis reset
      this.flushBuffer();
      this.currentHourKey = hourKey;
    }

    let buf = this.hourlyBuffer.get(key);
    if (!buf) {
      buf = { requests: 0, errors: 0, totalDurationMs: 0, minDurationMs: Infinity, maxDurationMs: 0 };
      this.hourlyBuffer.set(key, buf);
    }
    buf.requests++;
    buf.totalDurationMs += durationMs;
    buf.minDurationMs = Math.min(buf.minDurationMs, durationMs);
    buf.maxDurationMs = Math.max(buf.maxDurationMs, durationMs);
    if (isError) buf.errors++;
  }

  // Flush le buffer memoire vers la DB (appele au changement d'heure + par cron)
  async flushBuffer(): Promise<void> {
    if (this.hourlyBuffer.size === 0) return;

    const hourTimestamp = new Date(this.currentHourKey + ':00:00.000Z');
    const entries = Array.from(this.hourlyBuffer.entries());
    this.hourlyBuffer.clear();

    for (const [key, buf] of entries) {
      const [method, ...routeParts] = key.split(':');
      const route = routeParts.join(':');

      try {
        // Upsert : si l'heure+method+route existe deja, on additionne
        await this.prisma.apiMetric.upsert({
          where: {
            timestamp_method_route: { timestamp: hourTimestamp, method, route },
          },
          update: {
            requests: { increment: buf.requests },
            errors: { increment: buf.errors },
            totalDurationMs: { increment: buf.totalDurationMs },
            minDurationMs: buf.minDurationMs === Infinity ? 0 : buf.minDurationMs,
            maxDurationMs: buf.maxDurationMs,
          },
          create: {
            timestamp: hourTimestamp,
            method,
            route,
            requests: buf.requests,
            errors: buf.errors,
            totalDurationMs: buf.totalDurationMs,
            minDurationMs: buf.minDurationMs === Infinity ? 0 : buf.minDurationMs,
            maxDurationMs: buf.maxDurationMs,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to flush metric ${key}: ${error.message}`);
      }
    }
  }

  // --- Stats all-time en memoire (depuis dernier restart) ---
  getMetrics(): MetricsSummary {
    const routes = Array.from(this.metrics.values()).map((m) => this.toSummary(m));
    const topSlowest = [...routes].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 10);
    const topMostRequested = [...routes].sort((a, b) => b.totalRequests - a.totalRequests).slice(0, 10);

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      routes,
      topSlowest,
      topMostRequested,
    };
  }

  // --- Stats par jour depuis la DB (persistant) ---
  async getDailyMetrics(days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // Flush le buffer courant avant de requeter
    await this.flushBuffer();

    const result: Array<{
      date: string;
      method: string;
      route: string;
      requests: bigint;
      errors: bigint;
      total_duration_ms: bigint;
      min_duration: number;
      max_duration: number;
    }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('day', timestamp)::date::text AS date,
        method,
        route,
        SUM(requests)::bigint AS requests,
        SUM(errors)::bigint AS errors,
        SUM(total_duration_ms)::bigint AS total_duration_ms,
        MIN(min_duration_ms) AS min_duration,
        MAX(max_duration_ms) AS max_duration
      FROM api_metrics
      WHERE timestamp >= ${since}
      GROUP BY date, method, route
      ORDER BY date DESC, requests DESC
    `;

    // Grouper par jour
    const dayMap = new Map<string, Array<{
      method: string;
      route: string;
      requests: number;
      errors: number;
      avgDurationMs: number;
      minDurationMs: number;
      maxDurationMs: number;
    }>>();

    for (const row of result) {
      const reqs = Number(row.requests);
      const entry = {
        method: row.method,
        route: row.route,
        requests: reqs,
        errors: Number(row.errors),
        avgDurationMs: reqs > 0 ? Math.round(Number(row.total_duration_ms) / reqs) : 0,
        minDurationMs: row.min_duration,
        maxDurationMs: row.max_duration,
      };
      if (!dayMap.has(row.date)) dayMap.set(row.date, []);
      dayMap.get(row.date)!.push(entry);
    }

    return Array.from(dayMap.entries()).map(([date, routes]) => ({
      date,
      totalRequests: routes.reduce((s, r) => s + r.requests, 0),
      totalErrors: routes.reduce((s, r) => s + r.errors, 0),
      routes,
    }));
  }

  // --- Requetes par heure depuis la DB (dernieres 24/48h) ---
  async getHourlyRequestCounts(hours: number = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    await this.flushBuffer();

    const result: Array<{ hour: Date; requests: bigint }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('hour', timestamp) AS hour,
        SUM(requests)::bigint AS requests
      FROM api_metrics
      WHERE timestamp >= ${since}
      GROUP BY hour
      ORDER BY hour ASC
    `;

    return result.map((r) => ({
      hour: r.hour.toISOString().substring(0, 13),
      requests: Number(r.requests),
    }));
  }

  // --- Detail d'un endpoint specifique ---
  async getRouteDetail(method: string, route: string) {
    const key = `${method}:${route}`;
    const memMetric = this.metrics.get(key);

    await this.flushBuffer();

    const daily: Array<{
      date: string;
      requests: bigint;
      errors: bigint;
      total_duration_ms: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        date_trunc('day', timestamp)::date::text AS date,
        SUM(requests)::bigint AS requests,
        SUM(errors)::bigint AS errors,
        SUM(total_duration_ms)::bigint AS total_duration_ms
      FROM api_metrics
      WHERE method = ${method} AND route = ${route}
      GROUP BY date
      ORDER BY date DESC
      LIMIT 60
    `;

    return {
      allTime: memMetric ? this.toSummary(memMetric) : null,
      daily: daily.map((r) => {
        const reqs = Number(r.requests);
        return {
          date: r.date,
          requests: reqs,
          errors: Number(r.errors),
          avgDurationMs: reqs > 0 ? Math.round(Number(r.total_duration_ms) / reqs) : 0,
        };
      }),
    };
  }

  private toSummary(m: RouteMetric): RouteMetricsSummary {
    const sorted = [...m.durations].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    return {
      method: m.method,
      route: m.route,
      totalRequests: m.totalRequests,
      totalErrors: m.totalErrors,
      errorRate: m.totalRequests > 0 ? Math.round((m.totalErrors / m.totalRequests) * 10000) / 100 : 0,
      avgDurationMs: m.totalRequests > 0 ? Math.round(m.totalDurationMs / m.totalRequests) : 0,
      minDurationMs: m.minDurationMs === Infinity ? 0 : m.minDurationMs,
      maxDurationMs: m.maxDurationMs,
      p95DurationMs: sorted[p95Index] ?? 0,
    };
  }

  private getHourKey(): string {
    return new Date().toISOString().substring(0, 13); // "YYYY-MM-DDTHH"
  }
}
