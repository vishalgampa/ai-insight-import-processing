import { CascadeAnalyzer } from './cascadeAnalyzer';
import { TelemetryEvent, Exception } from '../types/telemetry';
import { CausalGraph, RootCause, Symptom } from '../types/analysis';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

function makeException(overrides: Partial<Exception> = {}): Exception {
  return {
    timestamp: new Date('2024-01-01T00:01:00Z'),
    eventType: 'exception',
    serviceName: 'svc-b',
    properties: {},
    exceptionType: 'TimeoutException',
    message: 'Request timed out',
    stackTrace: '',
    severity: 'error',
    ...overrides,
  };
}

function makeRootCause(event: TelemetryEvent, id = 'rc-1'): RootCause {
  return {
    id,
    event,
    confidence: 0.9,
    evidenceScore: 0.85,
    explanation: 'Root cause',
    category: 'code',
  };
}

describe('CascadeAnalyzer', () => {
  const analyzer = new CascadeAnalyzer();

  describe('identifySymptoms', () => {
    it('identifies downstream nodes as symptoms', () => {
      const eventA = makeEvent({ serviceName: 'svc-a' });
      const eventB = makeEvent({ serviceName: 'svc-b' });
      const eventC = makeEvent({ serviceName: 'svc-c' });

      const graph: CausalGraph = {
        nodes: [eventA, eventB, eventC],
        edges: [
          { from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' },
          { from: '1', to: '2', confidence: 0.8, evidenceType: 'dependency' },
        ],
      };

      const rootCauses = [makeRootCause(eventA)];
      const symptoms = analyzer.identifySymptoms(graph, rootCauses);

      expect(symptoms).toHaveLength(2);
      expect(symptoms[0].event).toBe(eventB);
      expect(symptoms[1].event).toBe(eventC);
      expect(symptoms.every((s) => s.linkedRootCause === 'rc-1')).toBe(true);
    });

    it('returns empty when all nodes are root causes', () => {
      const eventA = makeEvent({ serviceName: 'svc-a' });

      const graph: CausalGraph = {
        nodes: [eventA],
        edges: [],
      };

      const rootCauses = [makeRootCause(eventA)];
      expect(analyzer.identifySymptoms(graph, rootCauses)).toHaveLength(0);
    });

    it('skips nodes with no incoming edges that are not root causes', () => {
      const eventA = makeEvent({ serviceName: 'svc-a' });
      const eventB = makeEvent({ serviceName: 'svc-b' });

      const graph: CausalGraph = {
        nodes: [eventA, eventB],
        edges: [],
      };

      // eventA is root cause, eventB has no incoming edges and is not a root cause
      const rootCauses = [makeRootCause(eventA)];
      const symptoms = analyzer.identifySymptoms(graph, rootCauses);

      expect(symptoms).toHaveLength(0);
    });
  });

  describe('classifyTimeouts', () => {
    it('classifies timeout as symptom when upstream failure exists within 60s', () => {
      const upstream = makeEvent({
        timestamp: new Date('2024-01-01T00:00:30Z'),
        serviceName: 'svc-a',
      });
      const timeout = makeException({
        timestamp: new Date('2024-01-01T00:01:00Z'),
      });

      const results = analyzer.classifyTimeouts([timeout], [upstream]);

      expect(results).toHaveLength(1);
      expect(results[0].isSymptom).toBe(true);
      expect(results[0].linkedUpstreamEvent).toBe(upstream);
    });

    it('classifies timeout as not a symptom when no upstream failure within window', () => {
      const upstream = makeEvent({
        timestamp: new Date('2024-01-01T00:00:00Z'),
        serviceName: 'svc-a',
      });
      const timeout = makeException({
        timestamp: new Date('2024-01-01T00:02:01Z'),
      });

      const results = analyzer.classifyTimeouts([timeout], [upstream]);

      expect(results[0].isSymptom).toBe(false);
      expect(results[0].linkedUpstreamEvent).toBeUndefined();
    });

    it('does not link to upstream failures that occur after the timeout', () => {
      const upstream = makeEvent({
        timestamp: new Date('2024-01-01T00:02:00Z'),
      });
      const timeout = makeException({
        timestamp: new Date('2024-01-01T00:01:00Z'),
      });

      const results = analyzer.classifyTimeouts([timeout], [upstream]);
      expect(results[0].isSymptom).toBe(false);
    });

    it('handles empty inputs', () => {
      expect(analyzer.classifyTimeouts([], [])).toEqual([]);
    });
  });

  describe('linkSymptomsToRootCauses', () => {
    it('maps each symptom to its linked root cause', () => {
      const eventA = makeEvent({ serviceName: 'svc-a' });
      const eventB = makeEvent({ serviceName: 'svc-b' });
      const rc = makeRootCause(eventA, 'rc-1');

      const symptom: Symptom = {
        id: 'symptom-1',
        event: eventB,
        linkedRootCause: 'rc-1',
        description: 'downstream effect',
      };

      const mappings = analyzer.linkSymptomsToRootCauses([symptom], [rc]);

      expect(mappings).toHaveLength(1);
      expect(mappings[0].symptom).toBe(symptom);
      expect(mappings[0].rootCause).toBe(rc);
    });

    it('falls back to first root cause when linked ID not found', () => {
      const eventA = makeEvent({ serviceName: 'svc-a' });
      const eventB = makeEvent({ serviceName: 'svc-b' });
      const rc = makeRootCause(eventA, 'rc-1');

      const symptom: Symptom = {
        id: 'symptom-1',
        event: eventB,
        linkedRootCause: 'nonexistent',
        description: 'downstream effect',
      };

      const mappings = analyzer.linkSymptomsToRootCauses([symptom], [rc]);

      expect(mappings[0].rootCause).toBe(rc);
    });
  });
});
