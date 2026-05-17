/**
 * Causal graph builder — constructs directed causal graphs from correlated
 * event groups to represent cause-effect relationships between telemetry events.
 */

import { TelemetryEvent } from '../types/telemetry';
import { CorrelatedEventGroup, CausalGraph, CausalEdge } from '../types/analysis';

/**
 * Builds a directed CausalGraph from correlated event groups.
 *
 * Edges are created based on:
 * - Temporal ordering (earlier events → later events within a group)
 * - Service dependency (dependency calls → target service events)
 * - Trace ID correlation (events sharing the same traceId)
 * - Exception type correlation (similar exception patterns across services)
 */
export class CausalGraphBuilder {
  /**
   * Construct a directed CausalGraph from correlated event groups.
   * Nodes are deduplicated TelemetryEvents from all groups.
   * Each node is identified by its index in the nodes array.
   */
  buildCausalGraph(correlatedEvents: CorrelatedEventGroup[]): CausalGraph {
    if (correlatedEvents.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Deduplicate nodes across all groups
    const nodes = this.deduplicateNodes(correlatedEvents);
    const edges: CausalEdge[] = [];
    const edgeSet = new Set<string>();

    for (const group of correlatedEvents) {
      const groupNodeIndices = group.events.map((e) => this.findNodeIndex(nodes, e));

      // Temporal edges: earlier events → later events within the group
      this.addTemporalEdges(group.events, groupNodeIndices, edges, edgeSet);

      // Service dependency edges: dependency calls → target service events
      this.addDependencyEdges(group.events, groupNodeIndices, edges, edgeSet);

      // Trace ID correlation edges: events sharing the same traceId
      this.addTraceEdges(group.events, groupNodeIndices, edges, edgeSet);

      // Exception type correlation edges: similar exception patterns
      this.addExceptionPatternEdges(group.events, groupNodeIndices, edges, edgeSet);
    }

    return { nodes, edges };
  }

  /**
   * Deduplicate telemetry events across all groups by reference identity.
   */
  private deduplicateNodes(groups: CorrelatedEventGroup[]): TelemetryEvent[] {
    const seen = new Set<TelemetryEvent>();
    const nodes: TelemetryEvent[] = [];

    for (const group of groups) {
      for (const event of group.events) {
        if (!seen.has(event)) {
          seen.add(event);
          nodes.push(event);
        }
      }
    }

    return nodes;
  }

  /**
   * Find the index of an event in the nodes array by reference identity.
   */
  private findNodeIndex(nodes: TelemetryEvent[], event: TelemetryEvent): number {
    return nodes.indexOf(event);
  }

  /**
   * Add a unique edge to the edges array, avoiding duplicates.
   */
  private addEdge(
    edges: CausalEdge[],
    edgeSet: Set<string>,
    from: number,
    to: number,
    confidence: number,
    evidenceType: CausalEdge['evidenceType'],
  ): void {
    if (from === to || from < 0 || to < 0) return;

    const key = `${from}->${to}:${evidenceType}`;
    if (edgeSet.has(key)) return;

    edgeSet.add(key);
    edges.push({
      from: String(from),
      to: String(to),
      confidence,
      evidenceType,
    });
  }

  /**
   * Create temporal edges: earlier events point to later events within a group.
   * Confidence is based on temporal proximity.
   */
  private addTemporalEdges(
    events: TelemetryEvent[],
    nodeIndices: number[],
    edges: CausalEdge[],
    edgeSet: Set<string>,
  ): void {
    const sorted = events
      .map((e, i) => ({ event: e, nodeIdx: nodeIndices[i] }))
      .sort((a, b) => a.event.timestamp.getTime() - b.event.timestamp.getTime());

    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const timeDiffMs = to.event.timestamp.getTime() - from.event.timestamp.getTime();

      // Confidence decreases with time distance (max 30s window assumed)
      const confidence = Math.max(0.1, 1 - timeDiffMs / 30_000);

      this.addEdge(edges, edgeSet, from.nodeIdx, to.nodeIdx, confidence, 'temporal');
    }
  }

  /**
   * Create dependency edges: dependency call events point to events in the target service.
   */
  private addDependencyEdges(
    events: TelemetryEvent[],
    nodeIndices: number[],
    edges: CausalEdge[],
    edgeSet: Set<string>,
  ): void {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.eventType !== 'dependency') continue;

      const depName = (event as any).dependencyName as string | undefined;
      if (!depName) continue;

      // Find events in the target service
      for (let j = 0; j < events.length; j++) {
        if (i === j) continue;
        if (events[j].serviceName === depName) {
          this.addEdge(edges, edgeSet, nodeIndices[i], nodeIndices[j], 0.8, 'dependency');
        }
      }
    }
  }

  /**
   * Create trace edges: events sharing the same traceId are linked chronologically.
   */
  private addTraceEdges(
    events: TelemetryEvent[],
    nodeIndices: number[],
    edges: CausalEdge[],
    edgeSet: Set<string>,
  ): void {
    // Group events by traceId
    const traceGroups = new Map<string, { event: TelemetryEvent; nodeIdx: number }[]>();

    for (let i = 0; i < events.length; i++) {
      const traceId = events[i].traceId;
      if (!traceId) continue;

      if (!traceGroups.has(traceId)) {
        traceGroups.set(traceId, []);
      }
      traceGroups.get(traceId)!.push({ event: events[i], nodeIdx: nodeIndices[i] });
    }

    // For each trace group with 2+ events, link them chronologically
    for (const group of traceGroups.values()) {
      if (group.length < 2) continue;

      const sorted = group.sort(
        (a, b) => a.event.timestamp.getTime() - b.event.timestamp.getTime(),
      );

      for (let i = 0; i < sorted.length - 1; i++) {
        this.addEdge(edges, edgeSet, sorted[i].nodeIdx, sorted[i + 1].nodeIdx, 0.9, 'trace');
      }
    }
  }

  /**
   * Create exception pattern edges: events with similar exception types across
   * different services are linked.
   */
  private addExceptionPatternEdges(
    events: TelemetryEvent[],
    nodeIndices: number[],
    edges: CausalEdge[],
    edgeSet: Set<string>,
  ): void {
    // Collect exception events
    const exceptions: { event: TelemetryEvent; nodeIdx: number; exceptionType: string }[] = [];

    for (let i = 0; i < events.length; i++) {
      if (events[i].eventType === 'exception') {
        const exType = (events[i] as any).exceptionType as string | undefined;
        if (exType) {
          exceptions.push({ event: events[i], nodeIdx: nodeIndices[i], exceptionType: exType });
        }
      }
    }

    // Group by exception type
    const typeGroups = new Map<string, typeof exceptions>();
    for (const exc of exceptions) {
      if (!typeGroups.has(exc.exceptionType)) {
        typeGroups.set(exc.exceptionType, []);
      }
      typeGroups.get(exc.exceptionType)!.push(exc);
    }

    // Link exceptions of the same type across different services chronologically
    for (const group of typeGroups.values()) {
      if (group.length < 2) continue;

      // Only link across different services
      const crossService = group.filter(
        (e, i, arr) => arr.some((o) => o !== e && o.event.serviceName !== e.event.serviceName),
      );

      if (crossService.length < 2) continue;

      const sorted = crossService.sort(
        (a, b) => a.event.timestamp.getTime() - b.event.timestamp.getTime(),
      );

      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].event.serviceName !== sorted[i + 1].event.serviceName) {
          this.addEdge(edges, edgeSet, sorted[i].nodeIdx, sorted[i + 1].nodeIdx, 0.6, 'pattern');
        }
      }
    }
  }
}
