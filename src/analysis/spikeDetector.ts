/**
 * Spike detector — detects sudden rate-of-change spikes, latency increases,
 * and dependency failures in telemetry data.
 */

import { Baseline } from '../types/common';
import { RequestMetric, DependencyMetric } from '../types/telemetry';
import { TimeSeries } from '../telemetry/timeSeriesBuilder';

/** A detected spike between consecutive data points */
export interface Spike {
  timestamp: Date;
  previousValue: number;
  currentValue: number;
  changePercent: number;
}

/** A detected latency anomaly compared to baseline */
export interface LatencyAnomaly {
  timestamp: Date;
  operationName: string;
  observedLatency: number;
  baselineLatency: number;
  deviationFactor: number;
}

/** A detected dependency failure */
export interface DependencyFailure {
  timestamp: Date;
  dependencyName: string;
  dependencyType: string;
  resultCode?: string;
  duration: number;
}

export class SpikeDetector {
  /**
   * Detect sudden rate-of-change spikes in a time series.
   * A spike is flagged when the percentage change between consecutive
   * data points exceeds the given threshold.
   */
  detectSpikes(timeSeries: TimeSeries, threshold: number): Spike[] {
    const points = timeSeries.dataPoints;
    if (points.length < 2) {
      return [];
    }

    const spikes: Spike[] = [];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].value;
      const curr = points[i].value;

      if (prev === 0 && curr === 0) continue;

      const changePercent =
        prev === 0 ? (curr > 0 ? Infinity : 0) : Math.abs((curr - prev) / prev) * 100;

      if (changePercent > threshold) {
        spikes.push({
          timestamp: points[i].timestamp,
          previousValue: prev,
          currentValue: curr,
          changePercent,
        });
      }
    }

    return spikes;
  }

  /**
   * Detect latency increases in request metrics compared to a baseline.
   * Flags requests whose duration exceeds the baseline mean by more than
   * 2 standard deviations.
   */
  detectLatencyIncrease(
    requestMetrics: RequestMetric[],
    baseline: Baseline,
  ): LatencyAnomaly[] {
    if (baseline.standardDeviation === 0 && baseline.mean === 0) {
      return [];
    }

    const threshold = baseline.mean + 2 * baseline.standardDeviation;
    const anomalies: LatencyAnomaly[] = [];

    for (const metric of requestMetrics) {
      if (metric.duration > threshold) {
        const deviationFactor =
          baseline.mean > 0 ? metric.duration / baseline.mean : Infinity;

        anomalies.push({
          timestamp: metric.timestamp,
          operationName: metric.operationName,
          observedLatency: metric.duration,
          baselineLatency: baseline.mean,
          deviationFactor,
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect failed dependency calls from dependency metrics.
   */
  detectDependencyFailures(
    dependencyMetrics: DependencyMetric[],
  ): DependencyFailure[] {
    return dependencyMetrics
      .filter((m) => !m.success)
      .map((m) => ({
        timestamp: m.timestamp,
        dependencyName: m.dependencyName,
        dependencyType: m.dependencyType,
        resultCode: m.resultCode,
        duration: m.duration,
      }));
  }
}
