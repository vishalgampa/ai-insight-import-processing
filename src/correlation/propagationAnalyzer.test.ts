import { PropagationAnalyzer, ServiceDependencyGraph } from './propagationAnalyzer';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(
  overrides: Partial<TelemetryEvent> & { timestamp: Date },
): TelemetryEvent {
  return {
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

describe('PropagationAnalyzer', () => {
  let analyzer: PropagationAnalyzer;

  beforeEach(() => {
    analyzer = new PropagationAnalyzer();
  });

  describe('traceFailurePropagation', () => {
    it('returns empty steps when no other events exist', () => {
      const origin = makeEvent({ timestamp: new Date('2024-01-01T00:00:00Z') });
      const path = analyzer.traceFailurePropagation(origin, []);
      expect(path.origin).toBe(origin);
      expect(path.steps).toEqual([]);
    });

    it('returns empty steps when no subsequent failures exist', () => {
      const origin = makeEvent({ timestamp: new Date('2024-01-01T00:00:10Z') });
      const earlier = makeEvent({
        timestamp: new Date('2024-01-01T00:00:00Z'),
        serviceName: 'svc-b',
      });
      const path = analyzer.traceFailurePropagation(origin, [earlier]);
      expect(path.steps).toEqual([]);
    });

    it('traces propagation through multiple services', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const origin = makeEvent({ timestamp: base, serviceName: 'svc-a' });
      const failB = makeEvent({
        timestamp: new Date(base.getTime() + 5_000),
        serviceName: 'svc-b',
      });
      const failC = makeEvent({
        timestamp: new Date(base.getTime() + 10_000),
        serviceName: 'svc-c',
      });

      const path = analyzer.traceFailurePropagation(origin, [origin, failB, failC]);

      expect(path.origin).toBe(origin);
      expect(path.steps).toHaveLength(2);
      expect(path.steps[0].toService).toBe('svc-b');
      expect(path.steps[0].delay).toBe(5_000);
      expect(path.steps[1].toService).toBe('svc-c');
      expect(path.steps[1].delay).toBe(5_000);
    });

    it('skips non-failure events', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const origin = makeEvent({ timestamp: base, serviceName: 'svc-a' });
      const successEvent: TelemetryEvent = {
        timestamp: new Date(base.getTime() + 5_000),
        eventType: 'request',
        serviceName: 'svc-b',
        properties: {},
        ...(({ success: true }) as any),
      };

      const path = analyzer.traceFailurePropagation(origin, [origin, successEvent]);
      expect(path.steps).toHaveLength(0);
    });

    it('includes failed request events in propagation', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const origin = makeEvent({ timestamp: base, serviceName: 'svc-a' });
      const failedReq: TelemetryEvent = {
        timestamp: new Date(base.getTime() + 3_000),
        eventType: 'request',
        serviceName: 'svc-b',
        properties: {},
        ...(({ success: false }) as any),
      };

      const path = analyzer.traceFailurePropagation(origin, [origin, failedReq]);
      expect(path.steps).toHaveLength(1);
      expect(path.steps[0].toService).toBe('svc-b');
    });

    it('does not revisit the same service', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const origin = makeEvent({ timestamp: base, serviceName: 'svc-a' });
      const failB1 = makeEvent({
        timestamp: new Date(base.getTime() + 5_000),
        serviceName: 'svc-b',
      });
      const failB2 = makeEvent({
        timestamp: new Date(base.getTime() + 10_000),
        serviceName: 'svc-b',
      });

      const path = analyzer.traceFailurePropagation(origin, [origin, failB1, failB2]);
      expect(path.steps).toHaveLength(1);
    });
  });

  describe('identifyUpstreamCause', () => {
    const depGraph: ServiceDependencyGraph = {
      services: ['api', 'auth', 'db'],
      dependencies: [
        { from: 'api', to: 'auth' },
        { from: 'auth', to: 'db' },
      ],
    };

    it('returns null when no upstream services exist', () => {
      const failure = makeEvent({
        timestamp: new Date('2024-01-01T00:00:10Z'),
        serviceName: 'db',
      });
      const result = analyzer.identifyUpstreamCause(failure, depGraph, []);
      expect(result).toBeNull();
    });

    it('returns null when no upstream failures exist', () => {
      const failure = makeEvent({
        timestamp: new Date('2024-01-01T00:00:10Z'),
        serviceName: 'api',
      });
      const healthyAuth: TelemetryEvent = {
        timestamp: new Date('2024-01-01T00:00:05Z'),
        eventType: 'request',
        serviceName: 'auth',
        properties: {},
        ...(({ success: true }) as any),
      };

      const result = analyzer.identifyUpstreamCause(failure, depGraph, [healthyAuth]);
      expect(result).toBeNull();
    });

    it('finds the upstream cause in a dependency chain', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const authFailure = makeEvent({
        timestamp: new Date(base.getTime() + 2_000),
        serviceName: 'auth',
      });
      const apiFailure = makeEvent({
        timestamp: new Date(base.getTime() + 5_000),
        serviceName: 'api',
      });

      const result = analyzer.identifyUpstreamCause(apiFailure, depGraph, [authFailure]);
      expect(result).toBe(authFailure);
    });

    it('returns the most recent upstream failure', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const earlyAuth = makeEvent({
        timestamp: new Date(base.getTime() + 1_000),
        serviceName: 'auth',
      });
      const lateAuth = makeEvent({
        timestamp: new Date(base.getTime() + 4_000),
        serviceName: 'auth',
      });
      const apiFailure = makeEvent({
        timestamp: new Date(base.getTime() + 5_000),
        serviceName: 'api',
      });

      const result = analyzer.identifyUpstreamCause(apiFailure, depGraph, [earlyAuth, lateAuth]);
      expect(result).toBe(lateAuth);
    });

    it('ignores upstream failures that occurred after the downstream failure', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const apiFailure = makeEvent({
        timestamp: base,
        serviceName: 'api',
      });
      const laterAuth = makeEvent({
        timestamp: new Date(base.getTime() + 5_000),
        serviceName: 'auth',
      });

      const result = analyzer.identifyUpstreamCause(apiFailure, depGraph, [laterAuth]);
      expect(result).toBeNull();
    });
  });
});
