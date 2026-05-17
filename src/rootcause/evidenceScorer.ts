/**
 * Evidence scorer — scores potential root causes based on the strength
 * of supporting evidence using multiple weighted factors.
 */

import { TelemetryEvent } from '../types/telemetry';

/** Score breakdown for a potential root cause */
export interface EvidenceScore {
  score: number; // 0-1 overall score
  factors: {
    temporalPriority: number;   // How early the event occurred (earlier = higher)
    evidenceStrength: number;   // Number of supporting events (diminishing returns)
    exceptionUniqueness: number; // How unique the exception type is (rarer = higher)
    dependencyPosition: number;  // Whether event is in a critical dependency
  };
}

/**
 * Scores potential root causes by evaluating multiple evidence factors.
 */
export class EvidenceScorer {
  /**
   * Score a potential root cause based on the strength of supporting evidence.
   *
   * @param potentialCause - The telemetry event being evaluated as a root cause
   * @param supportingEvidence - Other telemetry events that support this cause
   * @returns An EvidenceScore with overall score (0-1) and individual factor scores
   */
  scoreRootCauseEvidence(
    potentialCause: TelemetryEvent,
    supportingEvidence: TelemetryEvent[],
  ): EvidenceScore {
    const temporalPriority = this.scoreTemporalPriority(potentialCause, supportingEvidence);
    const evidenceStrength = this.scoreEvidenceStrength(supportingEvidence);
    const exceptionUniqueness = this.scoreExceptionUniqueness(potentialCause, supportingEvidence);
    const dependencyPosition = this.scoreDependencyPosition(potentialCause);

    // Weighted combination of factors
    const score =
      temporalPriority * 0.3 +
      evidenceStrength * 0.3 +
      exceptionUniqueness * 0.2 +
      dependencyPosition * 0.2;

    return {
      score: Math.min(1, Math.max(0, score)),
      factors: {
        temporalPriority,
        evidenceStrength,
        exceptionUniqueness,
        dependencyPosition,
      },
    };
  }

  /**
   * Score how early the event occurred relative to supporting evidence.
   * Earlier events score higher since they are more likely to be causes.
   */
  private scoreTemporalPriority(
    cause: TelemetryEvent,
    evidence: TelemetryEvent[],
  ): number {
    if (evidence.length === 0) return 1.0;

    const causeTime = cause.timestamp.getTime();
    const allTimes = [causeTime, ...evidence.map((e) => e.timestamp.getTime())];
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const range = maxTime - minTime;

    if (range === 0) return 1.0;

    // Score is 1.0 when cause is earliest, 0.0 when latest
    return 1 - (causeTime - minTime) / range;
  }

  /**
   * Score based on the number of supporting events.
   * Uses logarithmic scaling for diminishing returns.
   */
  private scoreEvidenceStrength(evidence: TelemetryEvent[]): number {
    if (evidence.length === 0) return 0;

    // Logarithmic scaling: more evidence helps but with diminishing returns
    // ln(1+n)/ln(1+10) caps around 10 events for near-max score
    return Math.min(1, Math.log(1 + evidence.length) / Math.log(11));
  }

  /**
   * Score how unique the exception type is among all events.
   * Rarer exception types score higher.
   */
  private scoreExceptionUniqueness(
    cause: TelemetryEvent,
    evidence: TelemetryEvent[],
  ): number {
    if (cause.eventType !== 'exception') return 0.5; // neutral for non-exceptions

    const causeExType = (cause as any).exceptionType as string | undefined;
    if (!causeExType) return 0.5;

    const allExceptions = evidence.filter((e) => e.eventType === 'exception');
    if (allExceptions.length === 0) return 1.0; // only exception = very unique

    const matchCount = allExceptions.filter(
      (e) => (e as any).exceptionType === causeExType,
    ).length;

    // Fewer matches = more unique = higher score
    return 1 - matchCount / (allExceptions.length + 1);
  }

  /**
   * Score based on whether the event is in a dependency (critical position).
   * Dependency events score higher since they often represent root causes.
   */
  private scoreDependencyPosition(cause: TelemetryEvent): number {
    if (cause.eventType === 'dependency') return 1.0;
    if (cause.eventType === 'exception') return 0.7;
    if (cause.eventType === 'request') return 0.4;
    return 0.3;
  }
}
