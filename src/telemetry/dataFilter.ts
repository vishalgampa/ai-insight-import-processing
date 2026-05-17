/**
 * Data filter — applies service name and time range filters to normalized telemetry.
 * All methods return new objects (immutable).
 */

import { TelemetryEvent } from '../types/telemetry';
import { TimeRange } from '../types/common';
import { NormalizedTelemetry } from './normalizer';

export class DataFilter {
  /**
   * Filter normalized telemetry to only include events from the specified services.
   * Returns a new NormalizedTelemetry object — the original is not mutated.
   */
  filterByService(
    telemetry: NormalizedTelemetry,
    serviceNames: string[],
  ): NormalizedTelemetry {
    const nameSet = new Set(serviceNames.map((n) => n.toLowerCase()));
    const match = (e: TelemetryEvent) =>
      nameSet.has(e.serviceName.toLowerCase());

    return {
      events: telemetry.events.filter(match),
      exceptions: telemetry.exceptions.filter(match),
      requests: telemetry.requests.filter(match),
      dependencies: telemetry.dependencies.filter(match),
      deployments: telemetry.deployments.filter(match),
    };
  }

  /**
   * Filter events to only include those within the specified time range (inclusive).
   * Returns a new array — the original is not mutated.
   */
  filterByTimeRange(
    events: TelemetryEvent[],
    timeRange: TimeRange,
  ): TelemetryEvent[] {
    const start = timeRange.start.getTime();
    const end = timeRange.end.getTime();
    return events.filter((e) => {
      const t = e.timestamp.getTime();
      return t >= start && t <= end;
    });
  }
}
