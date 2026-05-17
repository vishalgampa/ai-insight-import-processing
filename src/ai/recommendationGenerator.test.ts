import { RecommendationGenerator } from './recommendationGenerator';
import { RootCause, Recommendation } from '../types/analysis';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    eventType: 'exception',
    serviceName: 'order-service',
    properties: {},
    ...overrides,
  };
}

function makeRootCause(overrides: Partial<RootCause> = {}): RootCause {
  return {
    id: 'rc-1',
    event: makeEvent(),
    confidence: 0.85,
    evidenceScore: 0.9,
    explanation: 'Database connection pool exhausted',
    category: 'dependency',
    ...overrides,
  };
}

describe('RecommendationGenerator', () => {
  const generator = new RecommendationGenerator();

  describe('generateRecommendations', () => {
    it('generates at least one recommendation per root cause', () => {
      const rootCauses = [
        makeRootCause({ id: 'rc-1', category: 'dependency' }),
        makeRootCause({ id: 'rc-2', category: 'code' }),
      ];

      const recs = generator.generateRecommendations(rootCauses);

      expect(recs.length).toBeGreaterThanOrEqual(2);
    });

    it('includes rollback recommendation for deployment root causes', () => {
      const recs = generator.generateRecommendations([
        makeRootCause({ category: 'deployment' }),
      ]);

      expect(recs.some((r) => r.action.toLowerCase().includes('rollback'))).toBe(true);
    });

    it('includes scaling recommendation for resource root causes', () => {
      const recs = generator.generateRecommendations([
        makeRootCause({ category: 'resource', explanation: 'CPU usage exceeded 90%' }),
      ]);

      expect(recs.some((r) => r.action.toLowerCase().includes('scale'))).toBe(true);
      expect(recs.some((r) => r.action.toLowerCase().includes('cpu'))).toBe(true);
    });

    it('includes diagnostic steps for low-confidence root causes', () => {
      const recs = generator.generateRecommendations([
        makeRootCause({ confidence: 0.3 }),
      ]);

      expect(recs.some((r) => r.action.toLowerCase().includes('diagnostic'))).toBe(true);
    });

    it('keeps all recommendation actions under 200 characters', () => {
      const rootCauses = [
        makeRootCause({ category: 'deployment' }),
        makeRootCause({ category: 'resource', confidence: 0.2, explanation: 'Memory usage exceeded 95% threshold' }),
        makeRootCause({ category: 'code' }),
        makeRootCause({ category: 'infrastructure' }),
      ];

      const recs = generator.generateRecommendations(rootCauses);

      for (const rec of recs) {
        expect(rec.action.length).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('prioritizeRecommendations', () => {
    it('sorts by impact descending then effort ascending', () => {
      const recs: Recommendation[] = [
        { priority: 0, action: 'Low impact', rationale: '', estimatedImpact: 'low', estimatedEffort: 'minutes' },
        { priority: 0, action: 'High impact, days', rationale: '', estimatedImpact: 'high', estimatedEffort: 'days' },
        { priority: 0, action: 'High impact, minutes', rationale: '', estimatedImpact: 'high', estimatedEffort: 'minutes' },
        { priority: 0, action: 'Medium impact', rationale: '', estimatedImpact: 'medium', estimatedEffort: 'hours' },
      ];

      const sorted = generator.prioritizeRecommendations(recs);

      expect(sorted[0].action).toBe('High impact, minutes');
      expect(sorted[1].action).toBe('High impact, days');
      expect(sorted[2].action).toBe('Medium impact');
      expect(sorted[3].action).toBe('Low impact');
    });

    it('assigns sequential priority numbers after sorting', () => {
      const recs: Recommendation[] = [
        { priority: 0, action: 'B', rationale: '', estimatedImpact: 'low', estimatedEffort: 'hours' },
        { priority: 0, action: 'A', rationale: '', estimatedImpact: 'high', estimatedEffort: 'minutes' },
      ];

      const sorted = generator.prioritizeRecommendations(recs);

      expect(sorted[0].priority).toBe(1);
      expect(sorted[1].priority).toBe(2);
    });
  });
});
