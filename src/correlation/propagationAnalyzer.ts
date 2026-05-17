/**
 * Propagation analyzer — traces how failures propagate through dependent
 * services and identifies upstream causes of downstream failures.
 */

import { TelemetryEvent } from '../types/telemetry';

/** A single step in a failure propagation path */
export interface PropagationStep {
  event: TelemetryEvent;
  fromService: string;
  toService: string;
  delay: number; // milliseconds between this step and the previous
}

/** Complete failure propagation path from origin through dependent services */
export interface PropagationPath {
  origin: TelemetryEvent;
  steps: PropagationStep[];
}

/** Graph of service dependencies */
export interface ServiceDependencyGraph {
  services: string[];
  dependencies: { from: string; to: string }[];
}

/**
 * Analyzes failure propagation across services and identifies upstream causes.
 */
export class PropagationAnalyzer {
  /**
   * Trace how a failure propagates from the initial event through dependent services.
   *
   * Starting from the initial failure, finds subsequent failure events in services
   * that depend on the initial failure's service, ordered chronologically.
   */
  traceFailurePropagation(
    initialFailure: TelemetryEvent,
    allEvents: TelemetryEvent[],
  ): PropagationPath {
    const path: PropagationPath = {
      origin: initialFailure,
      steps: [],
    };

    if (allEvents.length === 0) {
      return path;
    }

    const originTime = initialFailure.timestamp.getTime();
    const originService = initialFailure.serviceName;

    // Find failure events that occurred after the initial failure in other services
    const subsequentFailures = allEvents
      .filter(
        (e) =>
          e !== initialFailure &&
          e.timestamp.getTime() >= originTime &&
          this.isFailureEvent(e),
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Build propagation chain: track which services have been visited
    const visited = new Set<string>([originService]);
    let lastService = originService;
    let lastTime = originTime;

    for (const event of subsequentFailures) {
      const service = event.serviceName;
      if (visited.has(service)) continue;

      // Check if this service could be affected by the chain so far
      // (either directly depends on origin or on a previously affected service)
      const delay = event.timestamp.getTime() - lastTime;

      path.steps.push({
        event,
        fromService: lastService,
        toService: service,
        delay,
      });

      visited.add(service);
      lastService = service;
      lastTime = event.timestamp.getTime();
    }

    return path;
  }

  /**
   * Given a downstream failure, find the upstream service event that caused it.
   *
   * Looks for failure events in services that the downstream service depends on,
   * occurring before the downstream failure.
   */
  identifyUpstreamCause(
    downstreamFailure: TelemetryEvent,
    dependencyGraph: ServiceDependencyGraph,
    allEvents: TelemetryEvent[] = [],
  ): TelemetryEvent | null {
    const downstreamService = downstreamFailure.serviceName;
    const downstreamTime = downstreamFailure.timestamp.getTime();

    // Find services that the downstream service depends on
    const upstreamServices = dependencyGraph.dependencies
      .filter((dep) => dep.from === downstreamService)
      .map((dep) => dep.to);

    if (upstreamServices.length === 0) {
      return null;
    }

    // Find the most recent failure event in an upstream service before the downstream failure
    const upstreamFailures = allEvents
      .filter(
        (e) =>
          upstreamServices.includes(e.serviceName) &&
          e.timestamp.getTime() <= downstreamTime &&
          this.isFailureEvent(e),
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return upstreamFailures.length > 0 ? upstreamFailures[0] : null;
  }

  /**
   * Determine if an event represents a failure (exception, failed request, or failed dependency).
   */
  private isFailureEvent(event: TelemetryEvent): boolean {
    if (event.eventType === 'exception') return true;

    if (event.eventType === 'request') {
      return (event as any).success === false;
    }

    if (event.eventType === 'dependency') {
      return (event as any).success === false;
    }

    return false;
  }
}
