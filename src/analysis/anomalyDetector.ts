/**
 * Anomaly detector — detects statistical anomalies in time series data
 * using z-score and IQR methods.
 */

import { Anomaly } from '../types/analysis';
import { Baseline } from '../types/common';
import { TimeSeries } from '../telemetry/timeSeriesBuilder';

export class AnomalyDetector {
  /**
   * Detect anomalies using the z-score method.
   * Values more than `sensitivity` standard deviations from the baseline mean
   * are flagged as anomalies.
   */
  detectAnomalies(
    timeSeries: TimeSeries,
    baseline: Baseline,
    sensitivity: number,
  ): Anomaly[] {
    if (baseline.standardDeviation === 0) {
      return [];
    }

    const anomalies: Anomaly[] = [];

    for (const dp of timeSeries.dataPoints) {
      const zScore = Math.abs(dp.value - baseline.mean) / baseline.standardDeviation;

      if (zScore > sensitivity) {
        anomalies.push({
          id: crypto.randomUUID(),
          timestamp: dp.timestamp,
          metricName: timeSeries.metricName,
          observedValue: dp.value,
          expectedValue: baseline.mean,
          deviationScore: zScore,
          severity: this.severityFromDeviation(zScore),
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect outliers using the Interquartile Range (IQR) method.
   * Returns indices of values beyond 1.5 × IQR from Q1/Q3.
   */
  detectAnomaliesIQR(values: number[]): number[] {
    if (values.length < 4) {
      return [];
    }

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;

    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const outlierIndices: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] < lowerBound || values[i] > upperBound) {
        outlierIndices.push(i);
      }
    }

    return outlierIndices;
  }

  /** Map deviation score to severity level */
  private severityFromDeviation(deviation: number): Anomaly['severity'] {
    if (deviation > 5) return 'critical';
    if (deviation > 4) return 'high';
    if (deviation > 3) return 'medium';
    return 'low';
  }

  /** Compute a percentile from a pre-sorted array using linear interpolation */
  private percentile(sorted: number[], p: number): number {
    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    if (lower === upper) return sorted[lower];
    const fraction = rank - lower;
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }
}
