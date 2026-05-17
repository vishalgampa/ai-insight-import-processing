import { ReportFormatter, ReportInput } from './reportFormatter';
import { TimelineBuilder } from './timelineBuilder';
import { RootCause, Symptom, Recommendation } from '../types/analysis';
import { TelemetryEvent } from '../types/telemetry';
import { Evidence } from '../types/report';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

function makeRootCause(overrides: Partial<RootCause> = {}): RootCause {
  return {
    id: 'rc-1',
    event: makeEvent(),
    confidence: 0.9,
    evidenceScore: 0.85,
    explanation: 'Database connection pool exhausted',
    category: 'resource',
    ...overrides,
  };
}

function makeReportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    incidentId: 'inc-001',
    summary: 'API latency spike due to database issues',
    timeRange: {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-01T01:00:00Z'),
    },
    affectedServices: ['api-service', 'db-service'],
    events: [
      makeEvent({ timestamp: new Date('2024-01-01T00:10:00Z'), serviceName: 'db-service' }),
      makeEvent({ timestamp: new Date('2024-01-01T00:05:00Z'), serviceName: 'api-service' }),
    ],
    rootCauses: [makeRootCause()],
    symptoms: [],
    recommendations: [],
    evidence: [],
    ...overrides,
  };
}

describe('ReportFormatter', () => {
  const formatter = new ReportFormatter();

  describe('generateReport', () => {
    it('assembles all sections into a complete report', () => {
      const symptom: Symptom = {
        id: 's-1',
        event: makeEvent({ serviceName: 'api-service' }),
        linkedRootCause: 'rc-1',
        description: 'Timeout errors in API',
      };
      const recommendation: Recommendation = {
        priority: 1,
        action: 'Scale database connection pool',
        rationale: 'Connection pool exhausted',
        estimatedImpact: 'high',
        estimatedEffort: 'minutes',
      };
      const evidence: Evidence = {
        type: 'metric',
        description: 'Connection pool usage at 100%',
        data: { usage: 100 },
      };

      const input = makeReportInput({
        symptoms: [symptom],
        recommendations: [recommendation],
        evidence: [evidence],
      });

      const report = formatter.generateReport(input);

      expect(report.incidentId).toBe('inc-001');
      expect(report.summary).toBe('API latency spike due to database issues');
      expect(report.timeRange).toEqual(input.timeRange);
      expect(report.affectedServices).toEqual(['api-service', 'db-service']);
      expect(report.timeline.events).toHaveLength(2);
      expect(report.rootCauses).toHaveLength(1);
      expect(report.symptoms).toHaveLength(1);
      expect(report.recommendations).toHaveLength(1);
      expect(report.supportingEvidence).toHaveLength(1);
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('orders timeline events chronologically', () => {
      const input = makeReportInput();
      const report = formatter.generateReport(input);

      // Events should be sorted: 00:05 before 00:10
      expect(report.timeline.events[0].serviceName).toBe('api-service');
      expect(report.timeline.events[1].serviceName).toBe('db-service');
    });

    it('marks single root cause as primary', () => {
      const input = makeReportInput({
        rootCauses: [makeRootCause({ explanation: 'DB pool exhausted' })],
      });

      const report = formatter.generateReport(input);

      expect(report.rootCauses).toHaveLength(1);
      expect(report.rootCauses[0].explanation).toBe('[Primary] DB pool exhausted');
    });

    it('marks highest confidence root cause as primary and others as contributing', () => {
      const input = makeReportInput({
        rootCauses: [
          makeRootCause({ id: 'rc-1', confidence: 0.7, explanation: 'Network issue' }),
          makeRootCause({ id: 'rc-2', confidence: 0.95, explanation: 'Bad deployment' }),
          makeRootCause({ id: 'rc-3', confidence: 0.5, explanation: 'Resource limit' }),
        ],
      });

      const report = formatter.generateReport(input);

      expect(report.rootCauses).toHaveLength(3);
      // Sorted by confidence descending: rc-2 (0.95), rc-1 (0.7), rc-3 (0.5)
      expect(report.rootCauses[0].explanation).toBe('[Primary] Bad deployment');
      expect(report.rootCauses[1].explanation).toBe('[Contributing] Network issue');
      expect(report.rootCauses[2].explanation).toBe('[Contributing] Resource limit');
    });

    it('handles empty root causes', () => {
      const input = makeReportInput({ rootCauses: [] });
      const report = formatter.generateReport(input);
      expect(report.rootCauses).toEqual([]);
    });

    it('handles empty events', () => {
      const input = makeReportInput({ events: [] });
      const report = formatter.generateReport(input);
      expect(report.timeline.events).toEqual([]);
    });

    it('does not double-tag already tagged root causes', () => {
      const input = makeReportInput({
        rootCauses: [
          makeRootCause({ explanation: '[Primary] Already tagged' }),
        ],
      });

      const report = formatter.generateReport(input);
      expect(report.rootCauses[0].explanation).toBe('[Primary] Already tagged');
    });

    it('exactly one root cause is primary when multiple exist', () => {
      const input = makeReportInput({
        rootCauses: [
          makeRootCause({ id: 'rc-1', confidence: 0.8 }),
          makeRootCause({ id: 'rc-2', confidence: 0.6 }),
          makeRootCause({ id: 'rc-3', confidence: 0.4 }),
        ],
      });

      const report = formatter.generateReport(input);
      const primaryCount = report.rootCauses.filter((rc) =>
        rc.explanation.startsWith('[Primary]'),
      ).length;
      const contributingCount = report.rootCauses.filter((rc) =>
        rc.explanation.startsWith('[Contributing]'),
      ).length;

      expect(primaryCount).toBe(1);
      expect(contributingCount).toBe(2);
    });

    it('uses injected TimelineBuilder', () => {
      const mockBuilder = new TimelineBuilder();
      const spy = jest.spyOn(mockBuilder, 'buildTimeline');
      const customFormatter = new ReportFormatter(mockBuilder);

      const input = makeReportInput();
      customFormatter.generateReport(input);

      expect(spy).toHaveBeenCalledWith(input.events);
    });
  });
});
