import { SeverityRanker } from './severityRanker';
import { Anomaly } from '../types/analysis';

function makeAnomaly(
  severity: Anomaly['severity'],
  deviationScore: number,
  id?: string,
): Anomaly {
  return {
    id: id ?? crypto.randomUUID(),
    timestamp: new Date(),
    metricName: 'test-metric',
    observedValue: 100,
    expectedValue: 50,
    deviationScore,
    severity,
  };
}

describe('SeverityRanker', () => {
  const ranker = new SeverityRanker();

  it('returns an empty array when given an empty array', () => {
    expect(ranker.rankAnomaliesBySeverity([])).toEqual([]);
  });

  it('returns a single anomaly unchanged', () => {
    const anomaly = makeAnomaly('medium', 3.5);
    const result = ranker.rankAnomaliesBySeverity([anomaly]);
    expect(result).toEqual([anomaly]);
  });

  it('sorts anomalies by severity descending (critical > high > medium > low)', () => {
    const low = makeAnomaly('low', 5);
    const medium = makeAnomaly('medium', 5);
    const high = makeAnomaly('high', 5);
    const critical = makeAnomaly('critical', 5);

    const result = ranker.rankAnomaliesBySeverity([low, high, medium, critical]);

    expect(result.map((a) => a.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });

  it('sorts by deviation score descending within the same severity', () => {
    const a = makeAnomaly('high', 3.1, 'a');
    const b = makeAnomaly('high', 5.0, 'b');
    const c = makeAnomaly('high', 4.2, 'c');

    const result = ranker.rankAnomaliesBySeverity([a, b, c]);

    expect(result.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [
      makeAnomaly('low', 1),
      makeAnomaly('critical', 10),
    ];
    const copy = [...input];

    ranker.rankAnomaliesBySeverity(input);

    expect(input).toEqual(copy);
  });

  it('handles mixed severities and deviation scores correctly', () => {
    const anomalies = [
      makeAnomaly('medium', 4.0, 'm4'),
      makeAnomaly('critical', 6.0, 'c6'),
      makeAnomaly('low', 2.0, 'l2'),
      makeAnomaly('critical', 8.0, 'c8'),
      makeAnomaly('high', 3.5, 'h3.5'),
      makeAnomaly('medium', 5.0, 'm5'),
    ];

    const result = ranker.rankAnomaliesBySeverity(anomalies);

    expect(result.map((a) => a.id)).toEqual([
      'c8', 'c6', 'h3.5', 'm5', 'm4', 'l2',
    ]);
  });
});
