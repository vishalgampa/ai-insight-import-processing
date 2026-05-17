/**
 * Resource analyzer — identifies resource exhaustion conditions
 * (CPU, memory, disk) that may be root causes of incidents.
 */

/** A resource utilization metric sample */
export interface ResourceMetric {
  timestamp: Date;
  serviceName: string;
  metricType: 'cpu' | 'memory' | 'disk';
  value: number; // 0-100 percentage
}

/** A detected resource constraint */
export interface ResourceConstraint {
  timestamp: Date;
  serviceName: string;
  metricType: string;
  value: number;
  threshold: number;
}

/** Thresholds for resource exhaustion detection */
const THRESHOLDS: Record<string, number> = {
  cpu: 90,
  memory: 95,
  disk: 95,
};

/**
 * Analyzes resource metrics to identify exhaustion conditions
 * that could be root causes of incidents.
 */
export class ResourceAnalyzer {
  /**
   * Identify resource constraints from a set of metrics.
   * A constraint is flagged when a metric exceeds its threshold:
   * - CPU > 90%
   * - Memory > 95%
   * - Disk > 95%
   *
   * @param metrics - Resource utilization metrics to analyze
   * @returns Detected resource constraints
   */
  identifyResourceConstraints(metrics: ResourceMetric[]): ResourceConstraint[] {
    const constraints: ResourceConstraint[] = [];

    for (const metric of metrics) {
      const threshold = THRESHOLDS[metric.metricType];
      if (threshold !== undefined && metric.value > threshold) {
        constraints.push({
          timestamp: metric.timestamp,
          serviceName: metric.serviceName,
          metricType: metric.metricType,
          value: metric.value,
          threshold,
        });
      }
    }

    return constraints;
  }
}
