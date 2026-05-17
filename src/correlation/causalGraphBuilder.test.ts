import { CausalGraphBuilder } from './causalGraphBuilder';
import { TelemetryEvent } from '../types/telemetry';
import { CorrelatedEventGroup } from '../types/analysis';
import { TimeRange } from '../types/common';

function makeEvent(
  overrides: Partial<TelemetryEvent> & { timestamp: Date },
): TelemetryEvent {
  return {
    eventType: 'request',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

function makeGroup(events: TelemetryEvent[], id = 'group-1'): CorrelatedEventGroup {
  const timestamps = events.map((e) => e.timestamp.getTime());
  const timeWindow: TimeRange = {
    start: new Date(Math.min(...timestamps) - 30_000),
    end: new Date(Math.max(...timestamps) + 30_000),
  };
  return { id, events, timeWindow, correlationScore: 0.8 };
}

describe('CausalGraphBuilder', () => {
  let builder: CausalGraphBuilder;

  beforeEach(() => {
    builder = new CausalGraphBuilder();
  });

  it('returns empty graph for no correlated events', () => {
    const graph = builder.buildCausalGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('deduplicates nodes across groups', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const sharedEvent = makeEvent({ timestamp: base, serviceName: 'svc-a' });
    const eventB = makeEvent({ timestamp: new Date(base.getTime() + 5_000), serviceName: 'svc-b' });
    const eventC = makeEvent({ timestamp: new Date(base.getTime() + 10_000), serviceName: 'svc-c' });

    const group1 = makeGroup([sharedEvent, eventB], 'g1');
    const group2 = makeGroup([sharedEvent, eventC], 'g2');

    const graph = builder.buildCausalGraph([group1, group2]);
    expect(graph.nodes).toHaveLength(3); // sharedEvent, eventB, eventC
  });

  it('creates temporal edges from earlier to later events', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const eventA = makeEvent({ timestamp: base, serviceName: 'svc-a' });
    const eventB = makeEvent({ timestamp: new Date(base.getTime() + 5_000), serviceName: 'svc-b' });

    const graph = builder.buildCausalGraph([makeGroup([eventA, eventB])]);

    const temporalEdges = graph.edges.filter((e) => e.evidenceType === 'temporal');
    expect(temporalEdges.length).toBeGreaterThanOrEqual(1);

    // Edge should go from earlier (index 0) to later (index 1)
    const edge = temporalEdges[0];
    expect(Number(edge.from)).toBeLessThan(Number(edge.to));
    expect(edge.confidence).toBeGreaterThan(0);
    expect(edge.confidence).toBeLessThanOrEqual(1);
  });

  it('creates dependency edges from dependency calls to target service events', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const depEvent: TelemetryEvent = {
      timestamp: base,
      eventType: 'dependency',
      serviceName: 'svc-a',
      properties: {},
      ...(({ dependencyName: 'svc-b' }) as any),
    };
    const targetEvent = makeEvent({
      timestamp: new Date(base.getTime() + 1_000),
      serviceName: 'svc-b',
    });

    const graph = builder.buildCausalGraph([makeGroup([depEvent, targetEvent])]);

    const depEdges = graph.edges.filter((e) => e.evidenceType === 'dependency');
    expect(depEdges.length).toBeGreaterThanOrEqual(1);
    expect(depEdges[0].confidence).toBe(0.8);
  });

  it('creates trace edges for events sharing the same traceId', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const eventA = makeEvent({
      timestamp: base,
      serviceName: 'svc-a',
      traceId: 'trace-123',
    });
    const eventB = makeEvent({
      timestamp: new Date(base.getTime() + 2_000),
      serviceName: 'svc-b',
      traceId: 'trace-123',
    });

    const graph = builder.buildCausalGraph([makeGroup([eventA, eventB])]);

    const traceEdges = graph.edges.filter((e) => e.evidenceType === 'trace');
    expect(traceEdges.length).toBeGreaterThanOrEqual(1);
    expect(traceEdges[0].confidence).toBe(0.9);
  });

  it('creates pattern edges for similar exceptions across services', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const excA: TelemetryEvent = {
      timestamp: base,
      eventType: 'exception',
      serviceName: 'svc-a',
      properties: {},
      ...(({ exceptionType: 'TimeoutException' }) as any),
    };
    const excB: TelemetryEvent = {
      timestamp: new Date(base.getTime() + 3_000),
      eventType: 'exception',
      serviceName: 'svc-b',
      properties: {},
      ...(({ exceptionType: 'TimeoutException' }) as any),
    };

    const graph = builder.buildCausalGraph([makeGroup([excA, excB])]);

    const patternEdges = graph.edges.filter((e) => e.evidenceType === 'pattern');
    expect(patternEdges.length).toBeGreaterThanOrEqual(1);
    expect(patternEdges[0].confidence).toBe(0.6);
  });

  it('does not create pattern edges for exceptions in the same service', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const excA: TelemetryEvent = {
      timestamp: base,
      eventType: 'exception',
      serviceName: 'svc-a',
      properties: {},
      ...(({ exceptionType: 'NullPointerException' }) as any),
    };
    const excB: TelemetryEvent = {
      timestamp: new Date(base.getTime() + 1_000),
      eventType: 'exception',
      serviceName: 'svc-a',
      properties: {},
      ...(({ exceptionType: 'NullPointerException' }) as any),
    };

    const graph = builder.buildCausalGraph([makeGroup([excA, excB])]);

    const patternEdges = graph.edges.filter((e) => e.evidenceType === 'pattern');
    expect(patternEdges).toHaveLength(0);
  });

  it('does not create self-referencing edges', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const event = makeEvent({ timestamp: base });

    const graph = builder.buildCausalGraph([makeGroup([event, event])]);

    for (const edge of graph.edges) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it('handles a single event group with no edges possible', () => {
    const event = makeEvent({ timestamp: new Date('2024-01-01T00:00:00Z') });
    const graph = builder.buildCausalGraph([makeGroup([event])]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });
});
