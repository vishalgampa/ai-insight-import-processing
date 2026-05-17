/**
 * Analysis types for pattern detection, correlation, and root cause identification.
 */

import { TelemetryEvent } from './telemetry';
import { TimeRange } from './common';

/** Detected anomaly in telemetry metrics */
export interface Anomaly {
  id: string;
  timestamp: Date;
  metricName: string;
  observedValue: number;
  expectedValue: number;
  deviationScore: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** Group of temporally correlated events */
export interface CorrelatedEventGroup {
  id: string;
  events: TelemetryEvent[];
  timeWindow: TimeRange;
  correlationScore: number;
}

/** Directed graph of causal relationships between events */
export interface CausalGraph {
  nodes: TelemetryEvent[];
  edges: CausalEdge[];
}

/** Edge in the causal graph linking two events */
export interface CausalEdge {
  from: string;
  to: string;
  confidence: number;
  evidenceType: 'temporal' | 'dependency' | 'trace' | 'pattern';
}

/** Identified root cause of an incident */
export interface RootCause {
  id: string;
  event: TelemetryEvent;
  confidence: number;
  evidenceScore: number;
  explanation: string;
  category: 'deployment' | 'resource' | 'dependency' | 'code' | 'infrastructure';
}

/** Symptom linked to a root cause */
export interface Symptom {
  id: string;
  event: TelemetryEvent;
  linkedRootCause: string;
  description: string;
}

/** Actionable recommendation for incident resolution */
export interface Recommendation {
  priority: number;
  action: string;
  rationale: string;
  estimatedImpact: 'high' | 'medium' | 'low';
  estimatedEffort: 'minutes' | 'hours' | 'days';
}
