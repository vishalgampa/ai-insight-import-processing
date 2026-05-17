/**
 * Severity ranker — ranks anomalies by severity (descending) and then by
 * deviation score (descending) within the same severity level.
 */

import { Anomaly } from '../types/analysis';

/** Numeric weight for each severity level (higher = more severe) */
const SEVERITY_ORDER: Record<Anomaly['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export class SeverityRanker {
  /**
   * Return a new array of anomalies sorted by severity (descending),
   * then by deviation score (descending) within the same severity level.
   *
   * Does **not** mutate the input array.
   */
  rankAnomaliesBySeverity(anomalies: Anomaly[]): Anomaly[] {
    return [...anomalies].sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.deviationScore - a.deviationScore;
    });
  }
}
