/**
 * Cascade analyzer — identifies downstream cascade effects as symptoms
 * and links them to root causes.
 */

import { TelemetryEvent, Exception } from '../types/telemetry';
import { CausalGraph, RootCause, Symptom } from '../types/analysis';

/** Classification of a timeout error */
export interface Classification {
  event: Exception;
  isSymptom: boolean;
  linkedUpstreamEvent?: TelemetryEvent;
}

/** Mapping from a symptom to its root cause */
export interface SymptomCauseMapping {
  symptom: Symptom;
  rootCause: RootCause;
}

/** Maximum time gap (ms) for an upstream failure to be considered related to a timeout */
const UPSTREAM_WINDOW_MS = 60_000;

/**
 * Analyzes failure cascades in causal graphs to identify symptoms
 * and link them back to root causes.
 */
export class CascadeAnalyzer {
  /**
   * Identify downstream cascade effects as symptoms.
   * Any node that is NOT a root cause and has incoming edges is a symptom.
   * Each symptom is linked to the root cause that leads to it.
   */
  identifySymptoms(causalGraph: CausalGraph, rootCauses: RootCause[]): Symptom[] {
    const rootCauseIndices = new Set<string>();
    for (const rc of rootCauses) {
      const idx = causalGraph.nodes.indexOf(rc.event);
      if (idx >= 0) {
        rootCauseIndices.add(String(idx));
      }
    }

    // Build incoming-edges map: nodeIndex -> list of source node indices
    const incomingMap = new Map<string, string[]>();
    for (const edge of causalGraph.edges) {
      if (!incomingMap.has(edge.to)) {
        incomingMap.set(edge.to, []);
      }
      incomingMap.get(edge.to)!.push(edge.from);
    }

    const symptoms: Symptom[] = [];

    for (let i = 0; i < causalGraph.nodes.length; i++) {
      const nodeKey = String(i);

      // Skip root cause nodes
      if (rootCauseIndices.has(nodeKey)) continue;

      // Only nodes with incoming edges are symptoms
      const incoming = incomingMap.get(nodeKey);
      if (!incoming || incoming.length === 0) continue;

      const event = causalGraph.nodes[i];
      const linkedRootCause = this.findLinkedRootCause(
        nodeKey,
        incomingMap,
        rootCauseIndices,
        rootCauses,
        causalGraph,
      );

      symptoms.push({
        id: `symptom-${i}`,
        event,
        linkedRootCause: linkedRootCause ? linkedRootCause.id : rootCauses[0]?.id ?? 'unknown',
        description: `Downstream effect in ${event.serviceName} caused by upstream failure`,
      });
    }

    return symptoms;
  }

  /**
   * Classify timeout errors: a timeout is a symptom if there's an upstream
   * failure within 60 seconds before it.
   */
  classifyTimeouts(
    timeoutErrors: Exception[],
    upstreamFailures: TelemetryEvent[],
  ): Classification[] {
    return timeoutErrors.map((timeout) => {
      const timeoutTime = timeout.timestamp.getTime();

      // Find the closest upstream failure within the window
      let linkedUpstream: TelemetryEvent | undefined;
      let closestGap = Infinity;

      for (const upstream of upstreamFailures) {
        const gap = timeoutTime - upstream.timestamp.getTime();
        if (gap >= 0 && gap <= UPSTREAM_WINDOW_MS && gap < closestGap) {
          closestGap = gap;
          linkedUpstream = upstream;
        }
      }

      return {
        event: timeout,
        isSymptom: linkedUpstream !== undefined,
        linkedUpstreamEvent: linkedUpstream,
      };
    });
  }

  /**
   * Ensure every symptom links to at least one root cause.
   */
  linkSymptomsToRootCauses(
    symptoms: Symptom[],
    rootCauses: RootCause[],
  ): SymptomCauseMapping[] {
    return symptoms.map((symptom) => {
      const matched = rootCauses.find((rc) => rc.id === symptom.linkedRootCause);
      return {
        symptom,
        rootCause: matched ?? rootCauses[0],
      };
    });
  }

  /**
   * Walk upstream through the causal graph to find the root cause
   * that leads to a given node.
   */
  private findLinkedRootCause(
    nodeKey: string,
    incomingMap: Map<string, string[]>,
    rootCauseIndices: Set<string>,
    rootCauses: RootCause[],
    causalGraph: CausalGraph,
  ): RootCause | undefined {
    const visited = new Set<string>();
    const queue = [nodeKey];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (rootCauseIndices.has(current)) {
        const idx = Number(current);
        const event = causalGraph.nodes[idx];
        return rootCauses.find((rc) => rc.event === event);
      }

      const parents = incomingMap.get(current);
      if (parents) {
        for (const parent of parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      }
    }

    return undefined;
  }
}
