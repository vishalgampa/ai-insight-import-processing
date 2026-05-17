import { PromptBuilder, IncidentPromptContext } from './promptBuilder';
import { Anomaly, CorrelatedEventGroup, RootCause, Symptom } from '../types/analysis';
import { TimeRange } from '../types/common';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-06-01T12:00:00Z'),
    eventType: 'exception',
    serviceName: 'order-service',
    properties: {},
    ...overrides,
  };
}

function makeContext(overrides: Partial<IncidentPromptContext> = {}): IncidentPromptContext {
  return {
    timeRange: { start: new Date('2024-06-01T12:00:00Z'), end: new Date('2024-06-01T13:00:00Z') },
    affectedServices: ['order-service', 'payment-service'],
    severity: 'high',
    anomalies: [],
    correlations: [],
    rootCauseCandidates: [],
    symptoms: [],
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  test('builds prompt with correct structure', () => {
    const prompt = builder.buildIncidentAnalysisPrompt(makeContext());

    expect(prompt).toContain('You are an expert SRE analyzing a production incident.');
    expect(prompt).toContain('INCIDENT SUMMARY:');
    expect(prompt).toContain('TELEMETRY FINDINGS:');
    expect(prompt).toContain('ROOT CAUSE CANDIDATES:');
    expect(prompt).toContain('TASK:');
    expect(prompt).toContain('Be concise and specific.');
  });

  test('includes time range and affected services', () => {
    const prompt = builder.buildIncidentAnalysisPrompt(makeContext());

    expect(prompt).toContain('2024-06-01T12:00:00.000Z to 2024-06-01T13:00:00.000Z');
    expect(prompt).toContain('order-service, payment-service');
    expect(prompt).toContain('Severity: high');
  });

  test('formats anomalies in telemetry findings', () => {
    const anomaly: Anomaly = {
      id: 'a1',
      timestamp: new Date(),
      metricName: 'error_rate',
      observedValue: 45,
      expectedValue: 5,
      deviationScore: 8.0,
      severity: 'critical',
    };

    const prompt = builder.buildIncidentAnalysisPrompt(makeContext({ anomalies: [anomaly] }));

    expect(prompt).toContain('[CRITICAL] error_rate');
    expect(prompt).toContain('observed=45');
    expect(prompt).toContain('expected=5');
    expect(prompt).toContain('deviation=8.00');
  });

  test('formats correlations in telemetry findings', () => {
    const correlation: CorrelatedEventGroup = {
      id: 'cg1',
      events: [
        makeEvent({ serviceName: 'svc-a' }),
        makeEvent({ serviceName: 'svc-b' }),
      ],
      timeWindow: { start: new Date(), end: new Date() },
      correlationScore: 0.85,
    };

    const prompt = builder.buildIncidentAnalysisPrompt(makeContext({ correlations: [correlation] }));

    expect(prompt).toContain('Group cg1');
    expect(prompt).toContain('2 events');
    expect(prompt).toContain('svc-a');
    expect(prompt).toContain('svc-b');
    expect(prompt).toContain('score=0.85');
  });

  test('formats root cause candidates', () => {
    const rc: RootCause = {
      id: 'rc1',
      event: makeEvent(),
      confidence: 0.92,
      evidenceScore: 0.88,
      explanation: 'Bad deployment of order-service v2.3',
      category: 'deployment',
    };

    const prompt = builder.buildIncidentAnalysisPrompt(makeContext({ rootCauseCandidates: [rc] }));

    expect(prompt).toContain('[deployment]');
    expect(prompt).toContain('Bad deployment of order-service v2.3');
    expect(prompt).toContain('confidence=0.92');
    expect(prompt).toContain('evidence=0.88');
  });

  test('formats symptoms in telemetry findings', () => {
    const symptom: Symptom = {
      id: 's1',
      event: makeEvent(),
      linkedRootCause: 'rc1',
      description: 'Timeout errors in payment-service',
    };

    const prompt = builder.buildIncidentAnalysisPrompt(makeContext({ symptoms: [symptom] }));

    expect(prompt).toContain('Timeout errors in payment-service');
    expect(prompt).toContain('linked to root cause rc1');
  });

  test('handles empty context gracefully', () => {
    const prompt = builder.buildIncidentAnalysisPrompt(
      makeContext({ affectedServices: [], anomalies: [], correlations: [], rootCauseCandidates: [] }),
    );

    expect(prompt).toContain('Affected Services: Unknown');
    expect(prompt).toContain('Anomalies: None detected');
    expect(prompt).toContain('Correlations: None detected');
    expect(prompt).toContain('No root cause candidates identified.');
  });
});
