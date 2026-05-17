import { formatResponse } from './responseFormatter';
import { IncidentReport } from '../types/report';
import { ParsedQuery } from './queryParser';
import { RootCause, Symptom, Recommendation } from '../types/analysis';

function makeQuery(raw = 'What caused the API failures?'): ParsedQuery {
  return {
    timeRange: { start: new Date('2024-01-01T14:00:00Z'), end: new Date('2024-01-01T15:00:00Z') },
    serviceNames: ['api-service'],
    incidentType: 'failure',
    rawQuery: raw,
  };
}

function makeRootCause(overrides: Partial<RootCause> = {}): RootCause {
  return {
    id: 'rc-1',
    event: { timestamp: new Date(), eventType: 'exception', serviceName: 'api-service', properties: {} },
    confidence: 0.9,
    evidenceScore: 8,
    explanation: '[Primary] Database connection pool exhausted',
    category: 'resource',
    ...overrides,
  };
}

function makeSymptom(overrides: Partial<Symptom> = {}): Symptom {
  return {
    id: 's-1',
    event: { timestamp: new Date(), eventType: 'request', serviceName: 'web-service', properties: {} },
    linkedRootCause: 'rc-1',
    description: 'Timeout errors in web-service',
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    priority: 1,
    action: 'Increase database connection pool size',
    rationale: 'Pool exhaustion is the root cause',
    estimatedImpact: 'high',
    estimatedEffort: 'minutes',
    ...overrides,
  };
}

function makeReport(overrides: Partial<IncidentReport> = {}): IncidentReport {
  return {
    incidentId: 'inc-1',
    summary: 'API failures caused by database connection pool exhaustion',
    timeRange: { start: new Date('2024-01-01T14:00:00Z'), end: new Date('2024-01-01T15:00:00Z') },
    affectedServices: ['api-service', 'web-service'],
    timeline: { events: [] },
    rootCauses: [makeRootCause()],
    symptoms: [makeSymptom()],
    recommendations: [makeRecommendation()],
    supportingEvidence: [],
    generatedAt: new Date(),
    ...overrides,
  };
}

describe('formatResponse', () => {
  it('should directly address the user query in the response', () => {
    const query = makeQuery('What caused the API failures?');
    const report = makeReport();
    const result = formatResponse(report, query);

    expect(result).toContain('What caused the API failures?');
  });

  it('should include root cause explanation', () => {
    const report = makeReport();
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('Database connection pool exhausted');
    expect(result).toContain('resource');
  });

  it('should include confidence percentage for root cause', () => {
    const report = makeReport();
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('90%');
  });

  it('should list top recommendations', () => {
    const report = makeReport({
      recommendations: [
        makeRecommendation({ priority: 2, action: 'Add connection pool monitoring' }),
        makeRecommendation({ priority: 1, action: 'Increase database connection pool size' }),
        makeRecommendation({ priority: 3, action: 'Review connection leak patterns' }),
      ],
    });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('1. Increase database connection pool size');
    expect(result).toContain('2. Add connection pool monitoring');
    expect(result).toContain('3. Review connection leak patterns');
  });

  it('should limit recommendations to top 3', () => {
    const report = makeReport({
      recommendations: [
        makeRecommendation({ priority: 1, action: 'Action one' }),
        makeRecommendation({ priority: 2, action: 'Action two' }),
        makeRecommendation({ priority: 3, action: 'Action three' }),
        makeRecommendation({ priority: 4, action: 'Action four' }),
      ],
    });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('Action one');
    expect(result).toContain('Action two');
    expect(result).toContain('Action three');
    expect(result).not.toContain('Action four');
  });

  it('should include symptom descriptions', () => {
    const report = makeReport({
      symptoms: [makeSymptom({ description: 'Timeout errors in web-service' })],
    });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('Timeout errors in web-service');
  });

  it('should reference the full report', () => {
    const result = formatResponse(makeReport(), makeQuery());

    expect(result).toContain('full');
    expect(result).toContain('report');
  });

  it('should handle report with no root causes', () => {
    const report = makeReport({ rootCauses: [] });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('no definitive root cause');
  });

  it('should handle report with no symptoms', () => {
    const report = makeReport({ symptoms: [] });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('No downstream symptoms');
  });

  it('should handle report with no recommendations', () => {
    const report = makeReport({ recommendations: [] });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('No specific recommendations');
  });

  it('should include contributing factors when multiple root causes exist', () => {
    const report = makeReport({
      rootCauses: [
        makeRootCause({ id: 'rc-1', explanation: '[Primary] Database pool exhausted', category: 'resource' }),
        makeRootCause({ id: 'rc-2', explanation: '[Contributing] High traffic spike', category: 'infrastructure', confidence: 0.6 }),
      ],
    });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('Database pool exhausted');
    expect(result).toContain('Contributing factors');
    expect(result).toContain('High traffic spike');
  });

  it('should truncate symptoms list when more than 5', () => {
    const symptoms = Array.from({ length: 7 }, (_, i) =>
      makeSymptom({ id: `s-${i}`, description: `Symptom ${i}` }),
    );
    const report = makeReport({ symptoms });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('2 more symptoms in the full report');
  });

  it('should use highest confidence root cause as primary when no [Primary] prefix', () => {
    const report = makeReport({
      rootCauses: [
        makeRootCause({ id: 'rc-1', explanation: 'Low confidence cause', confidence: 0.3 }),
        makeRootCause({ id: 'rc-2', explanation: 'High confidence cause', confidence: 0.95 }),
      ],
    });
    const result = formatResponse(report, makeQuery());

    // The opening line should reference the high-confidence cause
    expect(result).toContain('High confidence cause');
  });

  it('should handle empty affected services gracefully', () => {
    const report = makeReport({ affectedServices: [], rootCauses: [] });
    const result = formatResponse(report, makeQuery());

    expect(result).toContain('the affected services');
  });
});
