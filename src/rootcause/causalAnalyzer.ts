/**
 * Enhanced causal analyzer — identifies and ranks root causes using:
 * - Graph topology (root nodes, fan-out, propagation depth)
 * - Temporal priority and evidence strength
 * - Error pattern analysis (frequency spikes, exception clustering)
 * - Multi-service failure correlation
 * - Deployment proximity
 * - Anomaly correlation
 */

import { TelemetryEvent, DeploymentEvent, Exception } from '../types/telemetry';
import { CausalGraph, CausalEdge, Anomaly, RootCause } from '../types/analysis';
import { EvidenceScorer } from './evidenceScorer';

/** Detailed analysis metadata attached to each root cause */
export interface RootCauseAnalysis {
  rootCause: RootCause;
  propagationDepth: number;
  affectedServiceCount: number;
  affectedServices: string[];
  errorFrequency: number;
  fanOut: number;
  relatedExceptionTypes: string[];
  timeToImpact: number | null; // ms from root cause to first downstream failure
  evidenceBreakdown: {
    temporalPriority: number;
    evidenceStrength: number;
    exceptionUniqueness: number;
    dependencyPosition: number;
    errorPatternBoost: number;
    propagationBoost: number;
    deploymentBoost: number;
    anomalyBoost: number;
  };
}

export class CausalAnalyzer {
  private evidenceScorer: EvidenceScorer;

  constructor(evidenceScorer?: EvidenceScorer) {
    this.evidenceScorer = evidenceScorer ?? new EvidenceScorer();
  }

  findEarliestFailure(causalGraph: CausalGraph): TelemetryEvent {
    if (causalGraph.nodes.length === 0) throw new Error('Causal graph has no nodes');
    const rootNodes = this.findRootNodes(causalGraph);
    const candidates = rootNodes.length > 0 ? rootNodes : causalGraph.nodes;
    return candidates.reduce((earliest, node) =>
      node.timestamp.getTime() < earliest.timestamp.getTime() ? node : earliest,
    );
  }

  /**
   * Enhanced root cause identification with deep analysis.
   * Returns RootCause[] for backward compatibility.
   * Use identifyRootCausesDetailed() for full analysis metadata.
   */
  identifyRootCauses(
    causalGraph: CausalGraph,
    anomalies: Anomaly[],
    deployments: DeploymentEvent[],
  ): RootCause[] {
    return this.identifyRootCausesDetailed(causalGraph, anomalies, deployments)
      .map((a) => a.rootCause);
  }

  /**
   * Full root cause analysis with detailed metadata per cause.
   */
  identifyRootCausesDetailed(
    causalGraph: CausalGraph,
    anomalies: Anomaly[],
    deployments: DeploymentEvent[],
  ): RootCauseAnalysis[] {
    if (causalGraph.nodes.length === 0) return [];

    const rootNodes = this.findRootNodes(causalGraph);
    const candidates = rootNodes.length > 0 ? rootNodes : causalGraph.nodes;

    // Pre-compute graph metrics
    const outEdges = this.buildOutgoingMap(causalGraph);
    const allEvents = causalGraph.nodes;
    const errorPatterns = this.analyzeErrorPatterns(allEvents);

    const analyses: RootCauseAnalysis[] = candidates.map((node, idx) => {
      const nodeKey = String(causalGraph.nodes.indexOf(node));
      const supportingEvidence = this.getSupportingEvidence(node, causalGraph);
      const evidenceScore = this.evidenceScorer.scoreRootCauseEvidence(node, supportingEvidence);

      // Compute graph-based metrics
      const fanOut = (outEdges.get(nodeKey) || []).length;
      const propagationDepth = this.computePropagationDepth(nodeKey, outEdges);
      const affectedServices = [...new Set(supportingEvidence.map((e) => e.serviceName))];
      const affectedServiceCount = affectedServices.length;

      // Error pattern analysis
      const errorPatternBoost = this.getErrorPatternBoost(node, errorPatterns);
      const propagationBoost = this.getPropagationBoost(propagationDepth, affectedServiceCount);
      const deploymentBoost = this.getDeploymentProximityBoost(node, deployments);
      const anomalyBoost = this.getAnomalyCorrelationBoost(node, anomalies);

      // Related exception types in downstream events
      const relatedExceptionTypes = this.getRelatedExceptionTypes(supportingEvidence);

      // Time to first downstream impact
      const timeToImpact = this.computeTimeToImpact(node, supportingEvidence);

      // Error frequency for this service around the event time
      const errorFrequency = this.computeErrorFrequency(node, allEvents);

      const confidence = Math.min(1,
        evidenceScore.score +
        errorPatternBoost +
        propagationBoost +
        deploymentBoost +
        anomalyBoost
      );

      const category = this.categorize(node, deployments, errorPatterns);
      const explanation = this.buildExplanation(
        node, category, supportingEvidence, deployments,
        { propagationDepth, affectedServices, errorFrequency, relatedExceptionTypes },
      );

      return {
        rootCause: {
          id: `rc-${idx}`,
          event: node,
          confidence,
          evidenceScore: evidenceScore.score,
          explanation,
          category,
        },
        propagationDepth,
        affectedServiceCount,
        affectedServices,
        errorFrequency,
        fanOut,
        relatedExceptionTypes,
        timeToImpact,
        evidenceBreakdown: {
          temporalPriority: evidenceScore.factors.temporalPriority,
          evidenceStrength: evidenceScore.factors.evidenceStrength,
          exceptionUniqueness: evidenceScore.factors.exceptionUniqueness,
          dependencyPosition: evidenceScore.factors.dependencyPosition,
          errorPatternBoost,
          propagationBoost,
          deploymentBoost,
          anomalyBoost,
        },
      };
    });

    return analyses.sort((a, b) => b.rootCause.confidence - a.rootCause.confidence);
  }

  // ── Graph helpers ──────────────────────────────────────────────────────

  private findRootNodes(causalGraph: CausalGraph): TelemetryEvent[] {
    const incomingTargets = new Set(causalGraph.edges.map((e) => e.to));
    return causalGraph.nodes.filter((_node, idx) => !incomingTargets.has(String(idx)));
  }

  private buildOutgoingMap(causalGraph: CausalGraph): Map<string, CausalEdge[]> {
    const map = new Map<string, CausalEdge[]>();
    for (const edge of causalGraph.edges) {
      if (!map.has(edge.from)) map.set(edge.from, []);
      map.get(edge.from)!.push(edge);
    }
    return map;
  }

  private getSupportingEvidence(node: TelemetryEvent, causalGraph: CausalGraph): TelemetryEvent[] {
    const nodeIdx = causalGraph.nodes.indexOf(node);
    if (nodeIdx < 0) return [];
    const visited = new Set<string>();
    const queue = [String(nodeIdx)];
    const evidence: TelemetryEvent[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of causalGraph.edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          const targetIdx = parseInt(edge.to, 10);
          if (targetIdx >= 0 && targetIdx < causalGraph.nodes.length) {
            evidence.push(causalGraph.nodes[targetIdx]);
            queue.push(edge.to);
          }
        }
      }
    }
    return evidence;
  }

  private computePropagationDepth(startKey: string, outEdges: Map<string, CausalEdge[]>): number {
    let maxDepth = 0;
    const visited = new Set<string>();
    const stack: Array<{ key: string; depth: number }> = [{ key: startKey, depth: 0 }];
    while (stack.length > 0) {
      const { key, depth } = stack.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      maxDepth = Math.max(maxDepth, depth);
      for (const edge of outEdges.get(key) || []) {
        if (!visited.has(edge.to)) stack.push({ key: edge.to, depth: depth + 1 });
      }
    }
    return maxDepth;
  }

  // ── Error pattern analysis ─────────────────────────────────────────────

  private analyzeErrorPatterns(events: TelemetryEvent[]): Map<string, { count: number; services: Set<string>; firstSeen: Date; lastSeen: Date }> {
    const patterns = new Map<string, { count: number; services: Set<string>; firstSeen: Date; lastSeen: Date }>();
    for (const event of events) {
      if (event.eventType !== 'exception') continue;
      const exType = (event as any).exceptionType as string || 'unknown';
      const existing = patterns.get(exType);
      if (existing) {
        existing.count++;
        existing.services.add(event.serviceName);
        if (event.timestamp < existing.firstSeen) existing.firstSeen = event.timestamp;
        if (event.timestamp > existing.lastSeen) existing.lastSeen = event.timestamp;
      } else {
        patterns.set(exType, { count: 1, services: new Set([event.serviceName]), firstSeen: event.timestamp, lastSeen: event.timestamp });
      }
    }
    return patterns;
  }

  private getErrorPatternBoost(node: TelemetryEvent, patterns: Map<string, { count: number; services: Set<string> }>): number {
    if (node.eventType !== 'exception') return 0;
    const exType = (node as any).exceptionType as string;
    if (!exType) return 0;
    const pattern = patterns.get(exType);
    if (!pattern) return 0;
    // High-frequency errors that span multiple services get a boost
    const freqBoost = Math.min(0.05, Math.log(1 + pattern.count) / 100);
    const crossServiceBoost = pattern.services.size > 1 ? 0.05 : 0;
    return freqBoost + crossServiceBoost;
  }

  private getPropagationBoost(depth: number, serviceCount: number): number {
    // Deeper propagation and more affected services = stronger root cause signal
    const depthBoost = Math.min(0.1, depth * 0.02);
    const serviceBoost = Math.min(0.1, serviceCount * 0.03);
    return depthBoost + serviceBoost;
  }

  private getDeploymentProximityBoost(event: TelemetryEvent, deployments: DeploymentEvent[]): number {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const eventTime = event.timestamp.getTime();
    for (const dep of deployments) {
      const diff = eventTime - dep.timestamp.getTime();
      if (diff >= 0 && diff <= ONE_HOUR_MS) return 0.15;
    }
    return 0;
  }

  private getAnomalyCorrelationBoost(event: TelemetryEvent, anomalies: Anomaly[]): number {
    const WINDOW_MS = 60_000;
    const eventTime = event.timestamp.getTime();
    const correlated = anomalies.filter((a) => Math.abs(a.timestamp.getTime() - eventTime) <= WINDOW_MS);
    if (correlated.length === 0) return 0;
    const maxSeverity = correlated.reduce((max, a) => {
      const m: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return Math.max(max, m[a.severity] ?? 0);
    }, 0);
    return Math.min(0.1, maxSeverity * 0.025);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private getRelatedExceptionTypes(evidence: TelemetryEvent[]): string[] {
    const types = new Set<string>();
    for (const e of evidence) {
      if (e.eventType === 'exception') {
        const t = (e as any).exceptionType as string;
        if (t) types.add(t);
      }
    }
    return [...types];
  }

  private computeTimeToImpact(node: TelemetryEvent, evidence: TelemetryEvent[]): number | null {
    if (evidence.length === 0) return null;
    const nodeTime = node.timestamp.getTime();
    let minDiff = Infinity;
    for (const e of evidence) {
      const diff = e.timestamp.getTime() - nodeTime;
      if (diff > 0 && diff < minDiff) minDiff = diff;
    }
    return minDiff === Infinity ? null : minDiff;
  }

  private computeErrorFrequency(node: TelemetryEvent, allEvents: TelemetryEvent[]): number {
    const WINDOW_MS = 5 * 60 * 1000; // 5 minute window
    const nodeTime = node.timestamp.getTime();
    return allEvents.filter((e) =>
      e.serviceName === node.serviceName &&
      (e.eventType === 'exception' || (e.eventType === 'request' && !(e as any).success)) &&
      Math.abs(e.timestamp.getTime() - nodeTime) <= WINDOW_MS
    ).length;
  }

  private categorize(
    event: TelemetryEvent,
    deployments: DeploymentEvent[],
    errorPatterns: Map<string, { count: number; services: Set<string> }>,
  ): RootCause['category'] {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const eventTime = event.timestamp.getTime();
    const isDeploymentRelated = deployments.some((d) => {
      const diff = eventTime - d.timestamp.getTime();
      return diff >= 0 && diff <= ONE_HOUR_MS;
    });
    if (event.eventType === 'deployment') return 'deployment';
    if (isDeploymentRelated) return 'deployment';
    if (event.eventType === 'dependency') return 'dependency';
    if (event.eventType === 'metric') return 'resource';
    // Check if exception message hints at resource issues
    if (event.eventType === 'exception') {
      const msg = ((event as any).message || '').toLowerCase();
      if (msg.includes('pool') || msg.includes('memory') || msg.includes('cpu') || msg.includes('disk') || msg.includes('timeout') || msg.includes('exhausted')) {
        return 'resource';
      }
      return 'code';
    }
    return 'infrastructure';
  }

  private buildExplanation(
    event: TelemetryEvent,
    category: RootCause['category'],
    supportingEvidence: TelemetryEvent[],
    deployments: DeploymentEvent[],
    meta: { propagationDepth: number; affectedServices: string[]; errorFrequency: number; relatedExceptionTypes: string[] },
  ): string {
    const service = event.serviceName;
    const time = event.timestamp.toISOString();
    const parts: string[] = [];

    // Opening
    parts.push(`${this.categoryLabel(category)} in ${service} at ${time}`);

    // Exception detail
    if (event.eventType === 'exception') {
      const exType = (event as any).exceptionType;
      const msg = (event as any).message;
      if (exType) parts.push(`Exception: ${exType}`);
      if (msg && msg.length < 120) parts.push(`Message: "${msg}"`);
    }

    // Deployment correlation
    if (category === 'deployment') {
      const ONE_HOUR_MS = 60 * 60 * 1000;
      const eventTime = event.timestamp.getTime();
      const dep = deployments.find((d) => {
        const diff = eventTime - d.timestamp.getTime();
        return diff >= 0 && diff <= ONE_HOUR_MS;
      });
      if (dep) parts.push(`Deployment ${dep.version} by ${dep.deployedBy} occurred ${Math.round((event.timestamp.getTime() - dep.timestamp.getTime()) / 60000)}min before the incident`);
    }

    // Impact summary
    if (meta.affectedServices.length > 0) {
      parts.push(`Propagated to ${meta.affectedServices.length} service(s): ${meta.affectedServices.join(', ')}`);
    }
    if (meta.propagationDepth > 0) {
      parts.push(`Cascade depth: ${meta.propagationDepth} hop(s)`);
    }
    if (supportingEvidence.length > 0) {
      parts.push(`${supportingEvidence.length} correlated downstream event(s)`);
    }
    if (meta.errorFrequency > 1) {
      parts.push(`Error frequency: ${meta.errorFrequency} errors in 5min window`);
    }
    if (meta.relatedExceptionTypes.length > 0) {
      parts.push(`Related exceptions: ${meta.relatedExceptionTypes.slice(0, 5).join(', ')}`);
    }

    return parts.join('. ');
  }

  private categoryLabel(category: RootCause['category']): string {
    const labels: Record<string, string> = {
      deployment: 'Deployment-related failure',
      resource: 'Resource exhaustion',
      dependency: 'Dependency failure',
      code: 'Application error',
      infrastructure: 'Infrastructure issue',
    };
    return labels[category] || 'Issue';
  }
}
