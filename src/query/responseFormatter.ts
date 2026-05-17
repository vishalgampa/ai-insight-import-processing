/**
 * Response formatter that converts an IncidentReport into a concise
 * natural language answer addressing the user's query.
 *
 * Validates: Requirements 8.5
 */

import { IncidentReport } from '../types/report';
import { ParsedQuery } from './queryParser';
import { RootCause, Recommendation } from '../types/analysis';

/**
 * Format an IncidentReport into a natural language response that
 * directly addresses the user's query, summarises key findings,
 * lists top recommendations, and references the full report.
 */
export function formatResponse(report: IncidentReport, query: ParsedQuery): string {
  const sections: string[] = [];

  sections.push(buildAnswerLine(report, query));
  sections.push(buildRootCauseSummary(report.rootCauses));
  sections.push(buildSymptomSummary(report));
  sections.push(buildRecommendationSummary(report.recommendations));
  sections.push('For full details, please refer to the complete incident analysis report.');

  return sections.filter(Boolean).join('\n\n');
}

/** Opening sentence that directly addresses the user's question. */
function buildAnswerLine(report: IncidentReport, query: ParsedQuery): string {
  const services = report.affectedServices.length > 0
    ? report.affectedServices.join(', ')
    : 'the affected services';

  if (report.rootCauses.length === 0) {
    return `Based on the analysis of ${services}, no definitive root cause was identified for the incident described in your query: "${query.rawQuery}".`;
  }

  const primary = getPrimaryRootCause(report.rootCauses);
  const explanation = stripPrefix(primary.explanation);

  return `In response to your query "${query.rawQuery}": ${explanation}`;
}

/** Summarise root causes. */
function buildRootCauseSummary(rootCauses: RootCause[]): string {
  if (rootCauses.length === 0) {
    return 'No root causes were identified. Consider gathering additional telemetry data.';
  }

  const primary = getPrimaryRootCause(rootCauses);
  const contributing = rootCauses.filter((rc) => rc !== primary);

  let text = `Root Cause: ${stripPrefix(primary.explanation)} (confidence: ${formatConfidence(primary.confidence)}, category: ${primary.category}).`;

  if (contributing.length > 0) {
    const factors = contributing
      .map((rc) => `${stripPrefix(rc.explanation)} (${rc.category})`)
      .join('; ');
    text += ` Contributing factors: ${factors}.`;
  }

  return text;
}

/** Summarise observed symptoms. */
function buildSymptomSummary(report: IncidentReport): string {
  if (report.symptoms.length === 0) {
    return 'No downstream symptoms were observed.';
  }

  const descriptions = report.symptoms
    .slice(0, 5)
    .map((s) => s.description);

  let text = `Observed symptoms: ${descriptions.join('; ')}.`;

  if (report.symptoms.length > 5) {
    text += ` (${report.symptoms.length - 5} more symptoms in the full report)`;
  }

  return text;
}

/** List top recommendations (up to 3). */
function buildRecommendationSummary(recommendations: Recommendation[]): string {
  if (recommendations.length === 0) {
    return 'No specific recommendations are available at this time.';
  }

  const sorted = [...recommendations].sort((a, b) => a.priority - b.priority);
  const top = sorted.slice(0, 3);

  const lines = top.map((r, i) => `${i + 1}. ${r.action}`);

  return `Top recommendations:\n${lines.join('\n')}`;
}

/** Get the primary root cause (marked with [Primary] prefix, or first by confidence). */
function getPrimaryRootCause(rootCauses: RootCause[]): RootCause {
  const primary = rootCauses.find((rc) => rc.explanation.startsWith('[Primary]'));
  if (primary) return primary;

  return [...rootCauses].sort((a, b) => b.confidence - a.confidence)[0];
}

/** Strip [Primary] or [Contributing] prefix from explanation text. */
function stripPrefix(explanation: string): string {
  return explanation
    .replace(/^\[Primary\]\s*/, '')
    .replace(/^\[Contributing\]\s*/, '');
}

/** Format confidence as a percentage string. */
function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`;
}
