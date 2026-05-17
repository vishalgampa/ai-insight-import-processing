/**
 * Builds chronologically ordered timelines from telemetry events.
 */

import { TelemetryEvent } from '../types/telemetry';
import { Timeline, TimelineEvent } from '../types/report';

export class TimelineBuilder {
  /**
   * Build a timeline from telemetry events, ordered chronologically
   * by timestamp in ascending order.
   */
  buildTimeline(events: TelemetryEvent[]): Timeline {
    if (events.length === 0) {
      return { events: [] };
    }

    const timelineEvents = events.map((event) => this.toTimelineEvent(event));

    timelineEvents.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    return { events: timelineEvents };
  }

  private toTimelineEvent(event: TelemetryEvent): TimelineEvent {
    return {
      timestamp: event.timestamp,
      description: this.buildDescription(event),
      serviceName: event.serviceName,
      eventType: event.eventType,
    };
  }

  private buildDescription(event: TelemetryEvent): string {
    switch (event.eventType) {
      case 'exception':
        return `Exception in ${event.serviceName}: ${(event as any).exceptionType ?? 'Unknown'} - ${(event as any).message ?? 'No message'}`;
      case 'request':
        return `Request ${(event as any).operationName ?? 'unknown'} in ${event.serviceName} (${(event as any).success ? 'success' : 'failure'}, ${(event as any).responseCode ?? '?'})`;
      case 'dependency':
        return `Dependency call to ${(event as any).dependencyName ?? 'unknown'} from ${event.serviceName} (${(event as any).success ? 'success' : 'failure'})`;
      case 'deployment':
        return `Deployment ${(event as any).version ?? 'unknown'} to ${event.serviceName}`;
      case 'metric':
        return `Metric event in ${event.serviceName}`;
      default:
        return `Event in ${event.serviceName}`;
    }
  }
}
