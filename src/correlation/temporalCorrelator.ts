/**
 * Temporal correlator — groups telemetry events that occur within configurable
 * time windows and adjusts for clock skew between services.
 */

import { TelemetryEvent } from '../types/telemetry';
import { CorrelatedEventGroup } from '../types/analysis';
import { TimeRange, Duration } from '../types/common';
import { parseDuration } from '../telemetry/timeSeriesBuilder';
import { randomUUID } from 'crypto';

/**
 * Groups temporally related telemetry events and handles clock skew
 * between distributed services.
 */
export class TemporalCorrelator {
  /**
   * Group events that occur within ±timeWindow of each other as potentially related.
   * Default time window is ±30 seconds per the design spec.
   *
   * Events can belong to multiple groups if they fall within multiple windows.
   * Correlation score is based on group size and temporal proximity.
   */
  correlateTemporal(
    events: TelemetryEvent[],
    timeWindow: Duration = '30s',
  ): CorrelatedEventGroup[] {
    if (events.length === 0) {
      return [];
    }

    const windowMs = parseDuration(timeWindow);
    const sorted = [...events].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const groups: CorrelatedEventGroup[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const anchor = sorted[i];
      const anchorTime = anchor.timestamp.getTime();
      const windowStart = anchorTime - windowMs;
      const windowEnd = anchorTime + windowMs;

      // Collect all events within ±timeWindow of the anchor
      const groupEvents: TelemetryEvent[] = [];
      for (let j = 0; j < sorted.length; j++) {
        const t = sorted[j].timestamp.getTime();
        if (t >= windowStart && t <= windowEnd) {
          groupEvents.push(sorted[j]);
        }
      }

      // Only create a group if there are at least 2 events
      if (groupEvents.length < 2) {
        continue;
      }

      // Avoid creating duplicate groups — check if an identical set already exists
      const isDuplicate = groups.some(
        (g) =>
          g.events.length === groupEvents.length &&
          g.events.every((e, idx) => e === groupEvents[idx]),
      );
      if (isDuplicate) {
        continue;
      }

      const timeRange: TimeRange = {
        start: new Date(windowStart),
        end: new Date(windowEnd),
      };

      const correlationScore = this.computeCorrelationScore(
        groupEvents,
        windowMs,
      );

      groups.push({
        id: randomUUID(),
        events: groupEvents,
        timeWindow: timeRange,
        correlationScore,
      });
    }

    return groups;
  }

  /**
   * Adjust timestamps to account for clock skew between services.
   *
   * Sorts events and adjusts timestamps that are within maxSkew of each other
   * to be ordered by service dependency if possible, otherwise leaves as-is.
   */
  accountForClockSkew(
    events: TelemetryEvent[],
    maxSkew: Duration = '5s',
  ): TelemetryEvent[] {
    if (events.length <= 1) {
      return [...events];
    }

    const maxSkewMs = parseDuration(maxSkew);
    const adjusted = events.map((e) => ({ ...e, timestamp: new Date(e.timestamp.getTime()) }));

    // Sort by timestamp first
    adjusted.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // For events within maxSkew of each other, reorder by service dependency:
    // dependency events should come after the services they depend on.
    for (let i = 0; i < adjusted.length - 1; i++) {
      for (let j = i + 1; j < adjusted.length; j++) {
        const timeDiff = Math.abs(
          adjusted[j].timestamp.getTime() - adjusted[i].timestamp.getTime(),
        );
        if (timeDiff > maxSkewMs) {
          break; // sorted, so no further events are within skew range
        }

        // If event j should logically precede event i based on dependency,
        // nudge j's timestamp to be just before i
        if (this.shouldPrecede(adjusted[j], adjusted[i])) {
          adjusted[j].timestamp = new Date(
            adjusted[i].timestamp.getTime() - 1,
          );
          // Re-sort the affected range
          adjusted.sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
          );
          // Restart comparison from current position
          i = Math.max(0, i - 1);
          break;
        }
      }
    }

    return adjusted;
  }

  /**
   * Compute a correlation score for a group of events.
   * Score is based on:
   * - Number of events in the group (more events = higher score)
   * - Temporal proximity (closer events = higher score)
   *
   * Returns a value between 0 and 1.
   */
  private computeCorrelationScore(
    events: TelemetryEvent[],
    windowMs: number,
  ): number {
    if (events.length <= 1) return 0;

    // Size factor: more events increase the score (diminishing returns)
    const sizeFactor = Math.min(events.length / 10, 1);

    // Proximity factor: average pairwise distance relative to window size
    const timestamps = events.map((e) => e.timestamp.getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const spread = maxTs - minTs;
    const proximityFactor = spread > 0 ? 1 - spread / (2 * windowMs) : 1;

    // Weighted combination
    const score = 0.4 * sizeFactor + 0.6 * Math.max(0, proximityFactor);
    return Math.round(score * 1000) / 1000; // 3 decimal places
  }

  /**
   * Determine if eventA should logically precede eventB based on
   * service dependency relationships.
   *
   * A dependency event from service X calling service Y suggests
   * that Y's events should come after X's dependency call.
   */
  private shouldPrecede(
    eventA: TelemetryEvent,
    eventB: TelemetryEvent,
  ): boolean {
    // If A is a dependency call targeting B's service, A should precede B
    if (eventA.eventType === 'dependency') {
      const depName = (eventA as any).dependencyName as string | undefined;
      if (depName && depName === eventB.serviceName) {
        return true;
      }
    }

    // If B is a dependency call targeting A's service, A should precede B
    // (the service being called should have its events after the caller)
    if (eventB.eventType === 'dependency') {
      const depName = (eventB as any).dependencyName as string | undefined;
      if (depName && depName === eventA.serviceName) {
        return false; // B (the caller) should precede A (the callee)
      }
    }

    return false;
  }
}
