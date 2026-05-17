/**
 * Report generation types for incident analysis output.
 */

import { RootCause, Symptom, Recommendation } from './analysis';
import { TimeRange } from './common';

/** Complete incident analysis report */
export interface IncidentReport {
  incidentId: string;
  summary: string;
  timeRange: TimeRange;
  affectedServices: string[];
  timeline: Timeline;
  rootCauses: RootCause[];
  symptoms: Symptom[];
  recommendations: Recommendation[];
  supportingEvidence: Evidence[];
  generatedAt: Date;
}

/** Chronological timeline of incident events */
export interface Timeline {
  events: TimelineEvent[];
}

/** Single event in the incident timeline */
export interface TimelineEvent {
  timestamp: Date;
  description: string;
  serviceName?: string;
  eventType?: string;
}

/** Supporting evidence for analysis findings */
export interface Evidence {
  type: 'metric' | 'log' | 'trace' | 'deployment';
  description: string;
  data: any;
}
