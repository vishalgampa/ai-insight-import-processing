/**
 * Prompt builder for constructing structured LLM prompts
 * from incident analysis context.
 */

import { Anomaly, CorrelatedEventGroup, RootCause, Symptom } from '../types/analysis';
import { TimeRange } from '../types/common';

/** Context required to build an incident analysis prompt */
export interface IncidentPromptContext {
  timeRange: TimeRange;
  affectedServices: string[];
  severity: string;
  anomalies: Anomaly[];
  correlations: CorrelatedEventGroup[];
  rootCauseCandidates: RootCause[];
  symptoms: Symptom[];
}

export class PromptBuilder {
  /**
   * Build a structured prompt for LLM-based incident analysis,
   * following the design document's prompt template.
   */
  buildIncidentAnalysisPrompt(context: IncidentPromptContext): string {
    const sections = [
      'You are an expert SRE analyzing a production incident.',
      '',
      'INCIDENT SUMMARY:',
      `- Time Range: ${this.formatTimeRange(context.timeRange)}`,
      `- Affected Services: ${context.affectedServices.join(', ') || 'Unknown'}`,
      `- Severity: ${context.severity}`,
      '',
      'TELEMETRY FINDINGS:',
      this.formatTelemetryFindings(context.anomalies, context.correlations, context.symptoms),
      '',
      'ROOT CAUSE CANDIDATES:',
      this.formatRootCauseCandidates(context.rootCauseCandidates),
      '',
      'TASK:',
      '1. Explain the most likely root cause in 2-3 sentences',
      '2. Distinguish symptoms from root causes',
      '3. Provide 3 actionable recommendations prioritized by impact',
      '',
      'Be concise and specific. Focus on what engineers should do next.',
    ];

    return sections.join('\n');
  }

  private formatTimeRange(timeRange: TimeRange): string {
    return `${timeRange.start.toISOString()} to ${timeRange.end.toISOString()}`;
  }

  private formatTelemetryFindings(
    anomalies: Anomaly[],
    correlations: CorrelatedEventGroup[],
    symptoms: Symptom[],
  ): string {
    const parts: string[] = [];

    if (anomalies.length > 0) {
      parts.push('Anomalies:');
      for (const a of anomalies) {
        parts.push(
          `  - [${a.severity.toUpperCase()}] ${a.metricName}: observed=${a.observedValue}, expected=${a.expectedValue}, deviation=${a.deviationScore.toFixed(2)}`,
        );
      }
    } else {
      parts.push('Anomalies: None detected');
    }

    if (correlations.length > 0) {
      parts.push('Correlations:');
      for (const c of correlations) {
        const serviceNames = [...new Set(c.events.map((e) => e.serviceName))];
        parts.push(
          `  - Group ${c.id}: ${c.events.length} events across [${serviceNames.join(', ')}], score=${c.correlationScore.toFixed(2)}`,
        );
      }
    } else {
      parts.push('Correlations: None detected');
    }

    if (symptoms.length > 0) {
      parts.push('Symptoms:');
      for (const s of symptoms) {
        parts.push(`  - ${s.description} (linked to root cause ${s.linkedRootCause})`);
      }
    }

    return parts.join('\n');
  }

  private formatRootCauseCandidates(candidates: RootCause[]): string {
    if (candidates.length === 0) {
      return 'No root cause candidates identified.';
    }

    return candidates
      .map(
        (rc, i) =>
          `${i + 1}. [${rc.category}] ${rc.explanation} (confidence=${rc.confidence.toFixed(2)}, evidence=${rc.evidenceScore.toFixed(2)})`,
      )
      .join('\n');
  }
}
