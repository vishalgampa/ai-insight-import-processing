/**
 * Symptom detector — classifies telemetry findings as symptoms or root causes
 * based on their position in the causal graph.
 */

import { TelemetryEvent } from '../types/telemetry';
import { CausalGraph } from '../types/analysis';

/** A finding classified as either a symptom or root cause */
export interface ClassifiedFinding {
  event: TelemetryEvent;
  type: 'symptom' | 'rootCause';
  nodeIndex: number;
}

/**
 * Classifies telemetry findings based on causal graph position.
 *
 * - Root Cause: node with no incoming edges (nothing causes it)
 * - Symptom: node with at least one incoming edge (has upstream cause)
 */
export class SymptomDetector {
  /**
   * Label each finding as "symptom" or "rootCause" based on its position
   * in the causal graph.
   */
  classifyFindings(
    findings: TelemetryEvent[],
    causalGraph: CausalGraph,
  ): ClassifiedFinding[] {
    // Build set of node indices that have incoming edges
    const nodesWithIncoming = new Set<string>();
    for (const edge of causalGraph.edges) {
      nodesWithIncoming.add(edge.to);
    }

    return findings.map((event) => {
      const nodeIndex = causalGraph.nodes.indexOf(event);
      const hasIncoming = nodeIndex >= 0 && nodesWithIncoming.has(String(nodeIndex));

      return {
        event,
        type: hasIncoming ? 'symptom' : 'rootCause',
        nodeIndex,
      };
    });
  }
}
