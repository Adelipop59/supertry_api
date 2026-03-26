import { Injectable } from '@nestjs/common';

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
  private readonly metrics = new Map<string, RouteMetric>();
  private totalRequests = 0;
  private totalErrors = 0;
  private readonly startedAt = Date.now();

  recordRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const key = `${method}:${route}`;
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

    if (metric.durations.length >= BUFFER_SIZE) {
      metric.durations.shift();
    }
    metric.durations.push(durationMs);

    this.totalRequests++;
    if (statusCode >= 400) {
      metric.totalErrors++;
      this.totalErrors++;
    }
  }

  getMetrics(): MetricsSummary {
    const routes = Array.from(this.metrics.values()).map((m) =>
      this.toSummary(m),
    );

    const topSlowest = [...routes]
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 10);

    const topMostRequested = [...routes]
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10);

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      routes,
      topSlowest,
      topMostRequested,
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
      errorRate:
        m.totalRequests > 0
          ? Math.round((m.totalErrors / m.totalRequests) * 10000) / 100
          : 0,
      avgDurationMs:
        m.totalRequests > 0
          ? Math.round(m.totalDurationMs / m.totalRequests)
          : 0,
      minDurationMs: m.minDurationMs === Infinity ? 0 : m.minDurationMs,
      maxDurationMs: m.maxDurationMs,
      p95DurationMs: sorted[p95Index] ?? 0,
    };
  }
}
