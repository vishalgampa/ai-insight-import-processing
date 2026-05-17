/**
 * Generates and prioritizes actionable recommendations based on root causes.
 */

import { RootCause, Recommendation } from '../types/analysis';

/** Impact ordering for prioritization (higher index = higher priority) */
const IMPACT_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Effort ordering for prioritization (lower index = less effort = preferred) */
const EFFORT_ORDER: Record<string, number> = { minutes: 0, hours: 1, days: 2 };

export class RecommendationGenerator {
  /**
   * Generate actionable recommendations based on identified root causes.
   * Guarantees at least one recommendation per root cause.
   * Each recommendation is concise (<200 characters) and specific.
   */
  generateRecommendations(
    rootCauses: RootCause[],
    incidentContext?: { affectedServices: string[] },
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    for (const rootCause of rootCauses) {
      const recs = this.generateForRootCause(rootCause, incidentContext);
      recommendations.push(...recs);
    }

    return recommendations;
  }

  /**
   * Sort recommendations by impact (high > medium > low)
   * then by effort (minutes < hours < days).
   */
  prioritizeRecommendations(recommendations: Recommendation[]): Recommendation[] {
    const sorted = [...recommendations].sort((a, b) => {
      const impactDiff = (IMPACT_ORDER[b.estimatedImpact] ?? 0) - (IMPACT_ORDER[a.estimatedImpact] ?? 0);
      if (impactDiff !== 0) return impactDiff;
      return (EFFORT_ORDER[a.estimatedEffort] ?? 0) - (EFFORT_ORDER[b.estimatedEffort] ?? 0);
    });

    // Re-assign priority numbers based on sorted order
    return sorted.map((rec, index) => ({ ...rec, priority: index + 1 }));
  }

  private generateForRootCause(
    rootCause: RootCause,
    incidentContext?: { affectedServices: string[] },
  ): Recommendation[] {
    const recs: Recommendation[] = [];

    // Rule (a): Deployment-related root causes get a rollback recommendation
    if (rootCause.category === 'deployment') {
      recs.push(this.truncateAction({
        priority: 0,
        action: `Rollback the recent deployment for ${rootCause.event.serviceName} to the previous stable version`,
        rationale: 'Deployment correlates with incident onset; rollback is the fastest mitigation.',
        estimatedImpact: 'high',
        estimatedEffort: 'minutes',
      }));
    }

    // Rule (b): Resource constraint root causes get a scaling recommendation
    if (rootCause.category === 'resource') {
      const resourceType = this.inferResourceType(rootCause);
      recs.push(this.truncateAction({
        priority: 0,
        action: `Scale ${resourceType} for ${rootCause.event.serviceName} to alleviate resource exhaustion`,
        rationale: `Resource constraint detected: ${rootCause.explanation}`,
        estimatedImpact: 'high',
        estimatedEffort: 'minutes',
      }));
    }

    // Rule (c): Low-confidence root causes get diagnostic steps
    if (rootCause.confidence < 0.5) {
      recs.push(this.truncateAction({
        priority: 0,
        action: `Collect additional diagnostics for ${rootCause.event.serviceName}: enable verbose logging and capture traces`,
        rationale: `Root cause confidence is low (${(rootCause.confidence * 100).toFixed(0)}%); more data is needed.`,
        estimatedImpact: 'medium',
        estimatedEffort: 'hours',
      }));
    }

    // Rule (e): Always generate at least one recommendation per root cause
    if (recs.length === 0) {
      recs.push(this.generateDefaultRecommendation(rootCause, incidentContext));
    }

    return recs;
  }

  private generateDefaultRecommendation(
    rootCause: RootCause,
    incidentContext?: { affectedServices: string[] },
  ): Recommendation {
    const service = rootCause.event.serviceName;

    switch (rootCause.category) {
      case 'dependency':
        return this.truncateAction({
          priority: 0,
          action: `Check health and connectivity of dependencies for ${service}`,
          rationale: `Dependency failure detected: ${rootCause.explanation}`,
          estimatedImpact: 'high',
          estimatedEffort: 'minutes',
        });
      case 'code':
        return this.truncateAction({
          priority: 0,
          action: `Review recent code changes in ${service} and inspect exception stack traces`,
          rationale: `Code-level issue identified: ${rootCause.explanation}`,
          estimatedImpact: 'medium',
          estimatedEffort: 'hours',
        });
      case 'infrastructure':
        return this.truncateAction({
          priority: 0,
          action: `Investigate infrastructure health for ${service}: check network, DNS, and host status`,
          rationale: `Infrastructure issue detected: ${rootCause.explanation}`,
          estimatedImpact: 'high',
          estimatedEffort: 'hours',
        });
      default:
        return this.truncateAction({
          priority: 0,
          action: `Investigate ${rootCause.category} issue in ${service} and review related telemetry`,
          rationale: rootCause.explanation,
          estimatedImpact: 'medium',
          estimatedEffort: 'hours',
        });
    }
  }

  /** Ensure the action string is under 200 characters (rule d) */
  private truncateAction(rec: Recommendation): Recommendation {
    if (rec.action.length > 200) {
      return { ...rec, action: rec.action.slice(0, 197) + '...' };
    }
    return rec;
  }

  /** Infer the specific resource type from the root cause explanation */
  private inferResourceType(rootCause: RootCause): string {
    const explanation = rootCause.explanation.toLowerCase();
    if (explanation.includes('cpu')) return 'CPU capacity';
    if (explanation.includes('memory') || explanation.includes('ram')) return 'memory';
    if (explanation.includes('disk') || explanation.includes('storage')) return 'disk storage';
    return 'resources';
  }
}
