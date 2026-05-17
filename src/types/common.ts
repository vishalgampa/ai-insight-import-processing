/**
 * Common types and interfaces shared across the RCA Assistant.
 */

/** Time range for filtering telemetry data */
export interface TimeRange {
  start: Date;
  end: Date;
}

/** Statistical baseline for a metric */
export interface Baseline {
  metricName: string;
  mean: number;
  standardDeviation: number;
  percentiles: Record<number, number>;
}

/** Azure authentication credentials */
export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Authentication token with expiry */
export interface AuthToken {
  token: string;
  expiresAt: Date;
}

/** Filters for telemetry queries */
export interface QueryFilters {
  serviceNames?: string[];
  operationNames?: string[];
  severityLevels?: string[];
}

/** Time granularity for time series construction */
export type TimeGranularity = '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '1d';

/** Method used for baseline calculation */
export type BaselineMethod = 'mean' | 'median' | 'percentile';

/** Types of metrics tracked */
export type MetricType = 'errorRate' | 'latency' | 'throughput' | 'availability' | 'saturation';

/** Duration expressed as a string (e.g., '30s', '5m', '1h') */
export type Duration = string;
