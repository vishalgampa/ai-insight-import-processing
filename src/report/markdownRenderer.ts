/**
 * Renders an IncidentReport as valid Markdown following the design template.
 *
 * Report structure:
 * - Incident Analysis Report (H1)
 * - Executive Summary (H2)
 * - Timeline (H2)
 * - Root Cause Analysis (H2) with Primary Root Cause (H3) and Contributing Factors (H3)
 * - Symptoms Observed (H2)
 * - Recommendations (H2)
 * - Supporting Evidence (H2)
 */

import { IncidentReport, TimelineEvent, Evidence } from '../types/report';
import { RootCause, Symptom, Recommendation } from '../types/analysis';

export class MarkdownRenderer {
  /**
   * Render a complete IncidentReport as a Markdown string with all required
   * section headers matching the design document template.
   */
  renderAsMarkdown(report: IncidentReport): string {
    const sections: string[] = [
      '# Incident Analysis Report',
      this.renderExecutiveSummary(report.summary),
      this.renderTimeline(report.timeline.events),
      this.renderRootCauseAnalysis(report.rootCauses),
      this.renderSymptoms(report.symptoms),
      this.renderRecommendations(report.recommendations),
      this.renderSupportingEvidence(report.supportingEvidence),
    ];

    return sections.join('\n\n') + '\n';
  }

  private renderExecutiveSummary(summary: string): string {
    return `## Executive Summary\n\n${summary || 'No summary available.'}`;
  }

  private renderTimeline(events: TimelineEvent[]): string {
    if (events.length === 0) {
      return '## Timeline\n\nNo timeline events recorded.';
    }

    const lines = events.map((e) => {
      const ts = e.timestamp.toISOString();
      const svc = e.serviceName ? ` [${e.serviceName}]` : '';
      return `- **${ts}**${svc}: ${e.description}`;
    });

    return `## Timeline\n\n${lines.join('\n')}`;
  }

  private renderRootCauseAnalysis(rootCauses: RootCause[]): string {
    if (rootCauses.length === 0) {
      return '## Root Cause Analysis\n\n### Primary Root Cause\n\nNo root cause identified.\n\n### Contributing Factors\n\nNone identified.';
    }

    const primary = rootCauses.find((rc) =>
      rc.explanation.startsWith('[Primary]'),
    );
    const contributing = rootCauses.filter((rc) =>
      rc.explanation.startsWith('[Contributing]'),
    );

    const primarySection = this.renderPrimaryRootCause(primary ?? rootCauses[0]);
    const contributingSection = this.renderContributingFactors(contributing);

    return `## Root Cause Analysis\n\n${primarySection}\n\n${contributingSection}`;
  }

  private renderPrimaryRootCause(rc: RootCause): string {
    const explanation = this.stripPrefix(rc.explanation);
    const confidence = `Confidence: ${(rc.confidence * 100).toFixed(0)}%`;
    const category = `Category: ${rc.category}`;

    return `### Primary Root Cause\n\n${explanation}\n\n- ${confidence}\n- ${category}`;
  }

  private renderContributingFactors(contributing: RootCause[]): string {
    if (contributing.length === 0) {
      return '### Contributing Factors\n\nNone identified.';
    }

    const items = contributing.map((rc) => {
      const explanation = this.stripPrefix(rc.explanation);
      return `- ${explanation} (confidence: ${(rc.confidence * 100).toFixed(0)}%, category: ${rc.category})`;
    });

    return `### Contributing Factors\n\n${items.join('\n')}`;
  }

  private renderSymptoms(symptoms: Symptom[]): string {
    if (symptoms.length === 0) {
      return '## Symptoms Observed\n\nNo symptoms identified.';
    }

    const items = symptoms.map(
      (s) => `- ${s.description} (linked to root cause: ${s.linkedRootCause})`,
    );

    return `## Symptoms Observed\n\n${items.join('\n')}`;
  }

  private renderRecommendations(recommendations: Recommendation[]): string {
    if (recommendations.length === 0) {
      return '## Recommendations\n\nNo recommendations available.';
    }

    const sorted = [...recommendations].sort((a, b) => a.priority - b.priority);
    const items = sorted.map(
      (r, i) => `${i + 1}. ${r.action} — ${r.rationale} (impact: ${r.estimatedImpact}, effort: ${r.estimatedEffort})`,
    );

    return `## Recommendations\n\n${items.join('\n')}`;
  }

  private renderSupportingEvidence(evidence: Evidence[]): string {
    if (evidence.length === 0) {
      return '## Supporting Evidence\n\nNo supporting evidence available.';
    }

    const items = evidence.map(
      (e) => `- **[${e.type}]** ${e.description}`,
    );

    return `## Supporting Evidence\n\n${items.join('\n')}`;
  }

  /** Strip [Primary] or [Contributing] prefix from explanation text. */
  private stripPrefix(explanation: string): string {
    return explanation
      .replace(/^\[Primary\]\s*/, '')
      .replace(/^\[Contributing\]\s*/, '');
  }
}
