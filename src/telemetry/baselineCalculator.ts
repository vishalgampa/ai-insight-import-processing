/**
 * Baseline calculator — computes statistical baselines from historical time series data.
 */

import { Baseline, BaselineMethod, MetricType } from '../types/common';
import { TimeSeries } from './timeSeriesBuilder';

export class BaselineCalculator {
  /**
   * Calculate a statistical baseline from historical time series data.
   *
   * @param metric - The type of metric being baselined
   * @param historicalData - Historical time series data
   * @param method - The baseline calculation method ('mean', 'median', 'percentile')
   * @returns A Baseline object with mean, standard deviation, and percentiles
   */
  calculateBaseline(
    metric: MetricType,
    historicalData: TimeSeries,
    method: BaselineMethod,
  ): Baseline {
    const values = historicalData.dataPoints.map((dp) => dp.value);

    if (values.length === 0) {
      return {
        metricName: historicalData.metricName,
        mean: 0,
        standardDeviation: 0,
        percentiles: { 50: 0, 90: 0, 95: 0, 99: 0 },
      };
    }

    const mean = this.computeMean(values);
    const standardDeviation = this.computeStdDev(values, mean);
    const percentiles: Record<number, number> = {
      50: this.computePercentile(values, 50),
      90: this.computePercentile(values, 90),
      95: this.computePercentile(values, 95),
      99: this.computePercentile(values, 99),
    };

    return {
      metricName: historicalData.metricName,
      mean,
      standardDeviation,
      percentiles,
    };
  }

  /** Compute the arithmetic mean of a set of values */
  private computeMean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /** Compute the population standard deviation */
  private computeStdDev(values: number[], mean: number): number {
    if (values.length <= 1) return 0;
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Compute a percentile using linear interpolation.
   * Uses the "exclusive" method (rank = p/100 * (n+1)).
   */
  private computePercentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];

    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const fraction = rank - lower;

    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }
}
