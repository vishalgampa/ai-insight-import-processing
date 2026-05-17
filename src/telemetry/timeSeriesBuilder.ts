/**
 * Time series builder — constructs time series from discrete telemetry events
 * and aggregates events into time windows.
 */

import { TelemetryEvent } from '../types/telemetry';
import { TimeGranularity, Duration } from '../types/common';

/** A single data point in a time series */
export interface DataPoint {
  timestamp: Date;
  value: number;
}

/** A named time series composed of ordered data points */
export interface TimeSeries {
  metricName: string;
  dataPoints: DataPoint[];
}

/** Aggregated metrics for a single time window */
export interface AggregatedMetrics {
  windowStart: Date;
  windowEnd: Date;
  count: number;
  errorCount: number;
  errorRate: number;
  avgDuration: number;
}

/** Map from TimeGranularity string to milliseconds */
const GRANULARITY_MS: Record<TimeGranularity, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/**
 * Parse a Duration string (e.g. '30s', '5m', '1h') into milliseconds.
 * Supported suffixes: s (seconds), m (minutes), h (hours), d (days).
 */
export function parseDuration(duration: Duration): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}". Expected format like '30s', '5m', '1h', '1d'.`);
  }
  const amount = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return amount * 1_000;
    case 'm': return amount * 60_000;
    case 'h': return amount * 60 * 60_000;
    case 'd': return amount * 24 * 60 * 60_000;
    default: throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

export class TimeSeriesBuilder {
  /**
   * Construct a time series from discrete telemetry events by bucketing them
   * into time windows based on the given granularity.
   * Each bucket's value is the count of events that fall within that window.
   */
  buildTimeSeries(events: TelemetryEvent[], granularity: TimeGranularity): TimeSeries {
    if (events.length === 0) {
      return { metricName: 'event_count', dataPoints: [] };
    }

    const windowMs = GRANULARITY_MS[granularity];
    const sorted = [...events].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const firstTs = sorted[0].timestamp.getTime();
    const lastTs = sorted[sorted.length - 1].timestamp.getTime();

    // Build buckets from the first event's window start to the last event's window
    const bucketStart = Math.floor(firstTs / windowMs) * windowMs;
    const bucketEnd = Math.floor(lastTs / windowMs) * windowMs;

    const buckets = new Map<number, number>();
    for (let t = bucketStart; t <= bucketEnd; t += windowMs) {
      buckets.set(t, 0);
    }

    for (const event of sorted) {
      const bucket = Math.floor(event.timestamp.getTime() / windowMs) * windowMs;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }

    const dataPoints: DataPoint[] = [];
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
    for (const key of sortedKeys) {
      dataPoints.push({ timestamp: new Date(key), value: buckets.get(key)! });
    }

    return { metricName: 'event_count', dataPoints };
  }

  /**
   * Aggregate events into time windows of the given size, computing
   * count, error count, error rate, and average duration per window.
   */
  aggregateByTimeWindow(events: TelemetryEvent[], windowSize: Duration): AggregatedMetrics[] {
    if (events.length === 0) {
      return [];
    }

    const windowMs = parseDuration(windowSize);
    const sorted = [...events].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const firstTs = sorted[0].timestamp.getTime();
    const lastTs = sorted[sorted.length - 1].timestamp.getTime();

    const windowStart = Math.floor(firstTs / windowMs) * windowMs;
    const windowEnd = Math.floor(lastTs / windowMs) * windowMs;

    // Collect events per window
    const windowMap = new Map<number, TelemetryEvent[]>();
    for (let t = windowStart; t <= windowEnd; t += windowMs) {
      windowMap.set(t, []);
    }

    for (const event of sorted) {
      const bucket = Math.floor(event.timestamp.getTime() / windowMs) * windowMs;
      windowMap.get(bucket)!.push(event);
    }

    const results: AggregatedMetrics[] = [];
    const sortedKeys = [...windowMap.keys()].sort((a, b) => a - b);

    for (const key of sortedKeys) {
      const windowEvents = windowMap.get(key)!;
      const count = windowEvents.length;
      const errorCount = windowEvents.filter((e) => this.isError(e)).length;
      const errorRate = count > 0 ? errorCount / count : 0;
      const avgDuration = this.computeAvgDuration(windowEvents);

      results.push({
        windowStart: new Date(key),
        windowEnd: new Date(key + windowMs),
        count,
        errorCount,
        errorRate,
        avgDuration,
      });
    }

    return results;
  }

  /** Determine if an event represents an error */
  private isError(event: TelemetryEvent): boolean {
    if (event.eventType === 'exception') return true;
    if (event.eventType === 'request') {
      const req = event as TelemetryEvent & { success?: boolean };
      return req.success === false;
    }
    if (event.eventType === 'dependency') {
      const dep = event as TelemetryEvent & { success?: boolean };
      return dep.success === false;
    }
    return false;
  }

  /** Compute average duration from events that have a duration property */
  private computeAvgDuration(events: TelemetryEvent[]): number {
    const durations: number[] = [];
    for (const event of events) {
      const dur = (event as any).duration;
      if (typeof dur === 'number' && !isNaN(dur)) {
        durations.push(dur);
      }
    }
    if (durations.length === 0) return 0;
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }
}
