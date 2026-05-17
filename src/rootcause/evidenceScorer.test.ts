import { EvidenceScorer } from './evidenceScorer';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T12:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

describe('EvidenceScorer', () => {
  let scorer: EvidenceScorer;

  beforeEach(() => {
    scorer = new EvidenceScorer();
  });

  it('returns score between 0 and 1', () => {
    const cause = makeEvent();
    const evidence = [makeEvent({ timestamp: new Date('2024-01-01T12:01:00Z') })];
    const result = scorer.scoreRootCauseEvidence(cause, evidence);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('returns all four factor scores', () => {
    const cause = makeEvent();
    const result = scorer.scoreRootCauseEvidence(cause, []);

    expect(result.factors).toHaveProperty('temporalPriority');
    expect(result.factors).toHaveProperty('evidenceStrength');
    expect(result.factors).toHaveProperty('exceptionUniqueness');
    expect(result.factors).toHaveProperty('dependencyPosition');
  });

  describe('temporalPriority', () => {
    it('scores 1.0 when cause is earliest event', () => {
      const cause = makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z') });
      const evidence = [
        makeEvent({ timestamp: new Date('2024-01-01T11:05:00Z') }),
        makeEvent({ timestamp: new Date('2024-01-01T11:10:00Z') }),
      ];
      const result = scorer.scoreRootCauseEvidence(cause, evidence);
      expect(result.factors.temporalPriority).toBe(1.0);
    });

    it('scores lower when cause is later than evidence', () => {
      const cause = makeEvent({ timestamp: new Date('2024-01-01T12:00:00Z') });
      const evidence = [makeEvent({ timestamp: new Date('2024-01-01T11:00:00Z') })];
      const result = scorer.scoreRootCauseEvidence(cause, evidence);
      expect(result.factors.temporalPriority).toBeLessThan(0.5);
    });

    it('scores 1.0 with no evidence', () => {
      const cause = makeEvent();
      const result = scorer.scoreRootCauseEvidence(cause, []);
      expect(result.factors.temporalPriority).toBe(1.0);
    });
  });

  describe('evidenceStrength', () => {
    it('scores 0 with no evidence', () => {
      const cause = makeEvent();
      const result = scorer.scoreRootCauseEvidence(cause, []);
      expect(result.factors.evidenceStrength).toBe(0);
    });

    it('increases with more evidence', () => {
      const cause = makeEvent();
      const oneEvidence = [makeEvent()];
      const manyEvidence = Array.from({ length: 5 }, () => makeEvent());

      const scoreOne = scorer.scoreRootCauseEvidence(cause, oneEvidence);
      const scoreMany = scorer.scoreRootCauseEvidence(cause, manyEvidence);

      expect(scoreMany.factors.evidenceStrength).toBeGreaterThan(
        scoreOne.factors.evidenceStrength,
      );
    });

    it('shows diminishing returns (logarithmic)', () => {
      const cause = makeEvent();
      const five = Array.from({ length: 5 }, () => makeEvent());
      const ten = Array.from({ length: 10 }, () => makeEvent());
      const twenty = Array.from({ length: 20 }, () => makeEvent());

      const s5 = scorer.scoreRootCauseEvidence(cause, five).factors.evidenceStrength;
      const s10 = scorer.scoreRootCauseEvidence(cause, ten).factors.evidenceStrength;
      const s20 = scorer.scoreRootCauseEvidence(cause, twenty).factors.evidenceStrength;

      // Gain from 5→10 should be greater than 10→20
      expect(s10 - s5).toBeGreaterThan(s20 - s10);
    });
  });

  describe('dependencyPosition', () => {
    it('scores highest for dependency events', () => {
      const dep = makeEvent({ eventType: 'dependency' });
      const exc = makeEvent({ eventType: 'exception' });
      const req = makeEvent({ eventType: 'request' });

      const depScore = scorer.scoreRootCauseEvidence(dep, []).factors.dependencyPosition;
      const excScore = scorer.scoreRootCauseEvidence(exc, []).factors.dependencyPosition;
      const reqScore = scorer.scoreRootCauseEvidence(req, []).factors.dependencyPosition;

      expect(depScore).toBeGreaterThan(excScore);
      expect(excScore).toBeGreaterThan(reqScore);
    });
  });

  describe('exceptionUniqueness', () => {
    it('scores higher for unique exception types', () => {
      const cause = { ...makeEvent(), exceptionType: 'RareException' } as any;
      const evidence = [
        { ...makeEvent(), exceptionType: 'CommonException' } as any,
        { ...makeEvent(), exceptionType: 'CommonException' } as any,
      ];

      const result = scorer.scoreRootCauseEvidence(cause, evidence);
      expect(result.factors.exceptionUniqueness).toBeGreaterThan(0.5);
    });

    it('scores neutral (0.5) for non-exception events', () => {
      const cause = makeEvent({ eventType: 'request' });
      const result = scorer.scoreRootCauseEvidence(cause, []);
      expect(result.factors.exceptionUniqueness).toBe(0.5);
    });
  });
});
