import { MarkdownRenderer } from './markdownRenderer';
import { IncidentReport, Evidence } from '../types/report';
import { RootCause, Symptom, Recommendation } from '../types/analysis';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

function makeReport(overrides: Partial<IncidentReport> = {}): IncidentReport {
  return {
    incidentId: 'inc-001',
    summary: 'API latency spike caused by database connection pool exhaustion.',
    timeRange: {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-01T01:00:00Z'),
    },
    affectedServices: ['api-service', 'db-service'],
    timeline: {
      events: [
        {
          timestamp: new Date('2024-01-01T00:05:00Z'),
          description: 'DB connection pool at 100%',
          serviceName: 'db-service',
          eventType: 'metric',
        },
        {
          timestamp: new Date('2024-01-01T00:06:00Z'),
          description: 'API latency spike detected',
          serviceName: 'api-service',
          eventType: 'metric',
        },
      ],
    },
    rootCauses: [
      {
        id: 'rc-1',
        event: makeEvent(),
        confidence: 0.9,
        evidenceScore: 0.85,
        explanation: '[Primary] Database connection pool exhausted',
        category: 'resource',
      },
    ],
    symptoms: [],
    recommendations: [],
    supportingEvidence: [],
    generatedAt: new Date('2024-01-01T02:00:00Z'),
    ...overrides,
  };
}

describe('MarkdownRenderer', () => {
  const renderer = new MarkdownRenderer();

  describe('renderAsMarkdown', () => {
    it('produces output containing all required section headers', () => {
      const md = renderer.renderAsMarkdown(makeReport());

      expect(md).toContain('# Incident Analysis Report');
      expect(md).toContain('## Executive Summary');
      expect(md).toContain('## Timeline');
      expect(md).toContain('## Root Cause Analysis');
      expect(md).toContain('### Primary Root Cause');
      expect(md).toContain('### Contributing Factors');
      expect(md).toContain('## Symptoms Observed');
      expect(md).toContain('## Recommendations');
      expect(md).toContain('## Supporting Evidence');
    });

    it('renders the executive summary from the report summary', () => {
      const md = renderer.renderAsMarkdown(makeReport());
      expect(md).toContain('API latency spike caused by database connection pool exhaustion.');
    });

    it('renders timeline events with timestamps and descriptions', () => {
      const md = renderer.renderAsMarkdown(makeReport());
      expect(md).toContain('2024-01-01T00:05:00.000Z');
      expect(md).toContain('[db-service]');
      expect(md).toContain('DB connection pool at 100%');
      expect(md).toContain('2024-01-01T00:06:00.000Z');
      expect(md).toContain('[api-service]');
    });

    it('renders primary root cause without the [Primary] prefix', () => {
      const md = renderer.renderAsMarkdown(makeReport());
      expect(md).toContain('### Primary Root Cause');
      expect(md).toContain('Database connection pool exhausted');
      expect(md).toContain('Confidence: 90%');
      expect(md).toContain('Category: resource');
      // Should strip the prefix
      expect(md).not.toContain('[Primary] Database connection pool exhausted');
    });

    it('renders contributing factors when multiple root causes exist', () => {
      const report = makeReport({
        rootCauses: [
          {
            id: 'rc-1',
            event: makeEvent(),
            confidence: 0.95,
            evidenceScore: 0.9,
            explanation: '[Primary] Bad deployment v2.1',
            category: 'deployment',
          },
          {
            id: 'rc-2',
            event: makeEvent(),
            confidence: 0.6,
            evidenceScore: 0.5,
            explanation: '[Contributing] Network congestion',
            category: 'infrastructure',
          },
        ],
      });

      const md = renderer.renderAsMarkdown(report);
      expect(md).toContain('### Primary Root Cause');
      expect(md).toContain('Bad deployment v2.1');
      expect(md).toContain('### Contributing Factors');
      expect(md).toContain('Network congestion');
      expect(md).toContain('confidence: 60%');
    });

    it('renders symptoms linked to root causes', () => {
      const report = makeReport({
        symptoms: [
          {
            id: 's-1',
            event: makeEvent(),
            linkedRootCause: 'rc-1',
            description: 'Timeout errors in API gateway',
          },
          {
            id: 's-2',
            event: makeEvent(),
            linkedRootCause: 'rc-1',
            description: 'Increased 5xx responses',
          },
        ],
      });

      const md = renderer.renderAsMarkdown(report);
      expect(md).toContain('Timeout errors in API gateway');
      expect(md).toContain('linked to root cause: rc-1');
      expect(md).toContain('Increased 5xx responses');
    });

    it('renders recommendations sorted by priority', () => {
      const report = makeReport({
        recommendations: [
          {
            priority: 3,
            action: 'Add connection pool monitoring',
            rationale: 'Long-term prevention',
            estimatedImpact: 'medium',
            estimatedEffort: 'days',
          },
          {
            priority: 1,
            action: 'Increase connection pool size',
            rationale: 'Immediate fix',
            estimatedImpact: 'high',
            estimatedEffort: 'minutes',
          },
          {
            priority: 2,
            action: 'Add circuit breaker',
            rationale: 'Short-term mitigation',
            estimatedImpact: 'high',
            estimatedEffort: 'hours',
          },
        ],
      });

      const md = renderer.renderAsMarkdown(report);
      const recSection = md.substring(md.indexOf('## Recommendations'));
      const pos1 = recSection.indexOf('Increase connection pool size');
      const pos2 = recSection.indexOf('Add circuit breaker');
      const pos3 = recSection.indexOf('Add connection pool monitoring');
      expect(pos1).toBeLessThan(pos2);
      expect(pos2).toBeLessThan(pos3);
    });

    it('renders supporting evidence with type labels', () => {
      const report = makeReport({
        supportingEvidence: [
          { type: 'metric', description: 'CPU usage at 95%', data: {} },
          { type: 'log', description: 'Connection refused errors', data: {} },
          { type: 'deployment', description: 'v2.1 deployed at 00:00', data: {} },
        ],
      });

      const md = renderer.renderAsMarkdown(report);
      expect(md).toContain('**[metric]** CPU usage at 95%');
      expect(md).toContain('**[log]** Connection refused errors');
      expect(md).toContain('**[deployment]** v2.1 deployed at 00:00');
    });

    it('handles empty report sections gracefully', () => {
      const report = makeReport({
        summary: '',
        timeline: { events: [] },
        rootCauses: [],
        symptoms: [],
        recommendations: [],
        supportingEvidence: [],
      });

      const md = renderer.renderAsMarkdown(report);
      expect(md).toContain('No summary available.');
      expect(md).toContain('No timeline events recorded.');
      expect(md).toContain('No root cause identified.');
      expect(md).toContain('No symptoms identified.');
      expect(md).toContain('No recommendations available.');
      expect(md).toContain('No supporting evidence available.');
    });

    it('ends with a newline', () => {
      const md = renderer.renderAsMarkdown(makeReport());
      expect(md.endsWith('\n')).toBe(true);
    });
  });
});
