import { ResourceAnalyzer, ResourceMetric } from './resourceAnalyzer';

function makeMetric(overrides: Partial<ResourceMetric> = {}): ResourceMetric {
  return {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    serviceName: 'api-service',
    metricType: 'cpu',
    value: 50,
    ...overrides,
  };
}

describe('ResourceAnalyzer', () => {
  const analyzer = new ResourceAnalyzer();

  it('returns empty array for empty input', () => {
    expect(analyzer.identifyResourceConstraints([])).toEqual([]);
  });

  it('detects CPU above 90%', () => {
    const metrics = [makeMetric({ metricType: 'cpu', value: 91 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(1);
    expect(result[0].threshold).toBe(90);
  });

  it('does not flag CPU at exactly 90%', () => {
    const metrics = [makeMetric({ metricType: 'cpu', value: 90 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(0);
  });

  it('detects memory above 95%', () => {
    const metrics = [makeMetric({ metricType: 'memory', value: 96 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(1);
    expect(result[0].threshold).toBe(95);
  });

  it('does not flag memory at exactly 95%', () => {
    const metrics = [makeMetric({ metricType: 'memory', value: 95 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(0);
  });

  it('detects disk above 95%', () => {
    const metrics = [makeMetric({ metricType: 'disk', value: 99 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(1);
    expect(result[0].threshold).toBe(95);
  });

  it('does not flag values below thresholds', () => {
    const metrics = [
      makeMetric({ metricType: 'cpu', value: 80 }),
      makeMetric({ metricType: 'memory', value: 70 }),
      makeMetric({ metricType: 'disk', value: 50 }),
    ];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result).toHaveLength(0);
  });

  it('preserves metric details in constraint output', () => {
    const ts = new Date('2024-01-15T12:00:00Z');
    const metrics = [makeMetric({ timestamp: ts, serviceName: 'db-service', metricType: 'memory', value: 98 })];
    const result = analyzer.identifyResourceConstraints(metrics);
    expect(result[0]).toEqual({
      timestamp: ts,
      serviceName: 'db-service',
      metricType: 'memory',
      value: 98,
      threshold: 95,
    });
  });
});
