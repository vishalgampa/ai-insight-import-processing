import { SymptomDetector } from './symptomDetector';
import { TelemetryEvent } from '../types/telemetry';
import { CausalGraph } from '../types/analysis';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

describe('SymptomDetector', () => {
  const detector = new SymptomDetector();

  it('classifies a node with no incoming edges as rootCause', () => {
    const eventA = makeEvent({ serviceName: 'svc-a' });
    const eventB = makeEvent({ serviceName: 'svc-b' });

    const graph: CausalGraph = {
      nodes: [eventA, eventB],
      edges: [{ from: '0', to: '1', confidence: 0.9, evidenceType: 'temporal' }],
    };

    const results = detector.classifyFindings([eventA, eventB], graph);

    expect(results[0].type).toBe('rootCause');
    expect(results[0].nodeIndex).toBe(0);
    expect(results[1].type).toBe('symptom');
    expect(results[1].nodeIndex).toBe(1);
  });

  it('classifies all nodes as rootCause when there are no edges', () => {
    const eventA = makeEvent({ serviceName: 'svc-a' });
    const eventB = makeEvent({ serviceName: 'svc-b' });

    const graph: CausalGraph = { nodes: [eventA, eventB], edges: [] };

    const results = detector.classifyFindings([eventA, eventB], graph);

    expect(results.every((r) => r.type === 'rootCause')).toBe(true);
  });

  it('classifies a finding not in the graph as rootCause', () => {
    const eventA = makeEvent({ serviceName: 'svc-a' });
    const orphan = makeEvent({ serviceName: 'orphan' });

    const graph: CausalGraph = { nodes: [eventA], edges: [] };

    const results = detector.classifyFindings([orphan], graph);

    expect(results[0].type).toBe('rootCause');
    expect(results[0].nodeIndex).toBe(-1);
  });

  it('handles empty findings', () => {
    const graph: CausalGraph = { nodes: [], edges: [] };
    expect(detector.classifyFindings([], graph)).toEqual([]);
  });
});
