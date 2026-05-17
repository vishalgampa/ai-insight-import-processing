/**
 * Assembles all analysis sections into a complete IncidentReport.
 * Distinguishes primary root cause from contributing causes when multiple exist.
 */

import { RootCause, Symptom, Recommendation, Anomaly } from '../types/analysis';
import { TelemetryEvent } from '../types/telemetry';
import { TimeRange } from '../types/common';
import { IncidentReport, Evidence } from '../types/report';
import { TimelineBuilder } from './timelineBuilder';

/** Input context for report generation */
export interface ReportInput {
  incidentId: string;
  summary: string;
  timeRange: TimeRange;
  affectedServices: string[];
  events: TelemetryEvent[];
  rootCauses: RootCause[];
  symptoms: Symptom[];
  recommendations: Recommendation[];
  evidence: Evidence[];
}

export class ReportFormatter {
  private timelineBuilder: TimelineBuilder;

  constructor(timelineBuilder?: TimelineBuilder) {
    this.timelineBuilder = timelineBuilder ?? new TimelineBuilder();
  }

  /**
   * Generate a complete incident report assembling all sections:
   * summary, timeline, root causes, symptoms, recommendations, evidence.
   *
   * When multiple root causes exist, exactly one is marked as "primary"
   * (highest confidence) and the rest as "contributing".
   */
  generateReport(input: ReportInput): IncidentReport {
    const timeline = this.timelineBuilder.buildTimeline(input.events);
    const rootCauses = this.distinguishRootCauses(input.rootCauses);

    return {
      incidentId: input.incidentId,
      summary: input.summary,
      timeRange: input.timeRange,
      affectedServices: input.affectedServices,
      timeline,
      rootCauses,
      symptoms: input.symptoms,
      recommendations: input.recommendations,
      supportingEvidence: input.evidence,
      generatedAt: new Date(),
    };
  }

  /**
   * When multiple root causes exist, mark exactly one as "primary"
   * (the one with the highest confidence) and the rest as "contributing".
   * A single root cause is always "primary".
   *
   * The distinction is stored in the explanation field by prepending
   * "[Primary]" or "[Contributing]" to the explanation.
   */
  private distinguishRootCauses(rootCauses: RootCause[]): RootCause[] {
    if (rootCauses.length <= 1) {
      return rootCauses.map((rc) => this.markAsPrimary(rc));
    }

    // Sort by confidence descending to find the primary cause
    const sorted = [...rootCauses].sort(
      (a, b) => b.confidence - a.confidence,
    );

    return sorted.map((rc, index) =>
      index === 0 ? this.markAsPrimary(rc) : this.markAsContributing(rc),
    );
  }

  private markAsPrimary(rc: RootCause): RootCause {
    if (rc.explanation.startsWith('[Primary]') || rc.explanation.startsWith('[Contributing]')) {
      return rc;
    }
    return { ...rc, explanation: `[Primary] ${rc.explanation}` };
  }

  private markAsContributing(rc: RootCause): RootCause {
    if (rc.explanation.startsWith('[Primary]') || rc.explanation.startsWith('[Contributing]')) {
      return rc;
    }
    return { ...rc, explanation: `[Contributing] ${rc.explanation}` };
  }
}
