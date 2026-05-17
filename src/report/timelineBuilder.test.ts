import { TimelineBuilder } from './timelineBuilder';
import { TelemetryEvent, Exception, DeploymentEvent, DependencyMetric, RequestMetric } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'exception',
    serviceName: 'svc-a',
    properties: {},
    ...overrides,
  };
}

describe('TimelineBuilder', () => {
  const builder = new TimelineBuilder();

  describe('buildTimeline', () => {
    it('returns empty timeline for empty events', () => {
      const timeline = builder.buildTimeline([]);
      expect(timeline.events).toEqual([]);
    });

    it('orders events chronologically in ascending order', () => {
      const events: TelemetryEvent[] = [
        makeEvent({ timestamp: new Date('2024-01-01T00:03:00Z'), serviceName: 'svc-c' }),
        makeEvent({ timestamp: new Date('2024-01-01T00:01:00Z'), serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date('2024-01-01T00:02:00Z'), serviceName: 'svc-b' }),
      ];

      const timeline = builder.buildTimeline(events);

      expect(timeline.events).toHaveLength(3);
      expect(timeline.events[0].serviceName).toBe('svc-a');
      expect(timeline.events[1].serviceName).toBe('svc-b');
      expect(timeline.events[2].serviceName).toBe('svc-c');
    });

    it('preserves order for events with the same timestamp', () => {
      const ts = new Date('2024-01-01T00:00:00Z');
      const events: TelemetryEvent[] = [
        makeEvent({ timestamp: ts, serviceName: 'svc-a' }),
        makeEvent({ timestamp: ts, serviceName: 'svc-b' }),
      ];

      const timeline = builder.buildTimeline(events);
      expect(timeline.events).toHaveLength(2);
    });

    it('builds description for exception events', () => {
      const event: Exception = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        eventType: 'exception',
        serviceName: 'api-service',
        properties: {},
        exceptionType: 'NullReferenceException',
        message: 'Object reference not set',
        stackTrace: '',
        severity: 'error',
      };

      const timeline = builder.buildTimeline([event]);
      expect(timeline.events[0].description).toContain('Exception in api-service');
      expect(timeline.events[0].description).toContain('NullReferenceException');
    });

    it('builds description for deployment events', () => {
      const event: DeploymentEvent = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        eventType: 'deployment',
        serviceName: 'api-service',
        properties: {},
        deploymentId: 'dep-1',
        version: 'v2.1.0',
        deployedBy: 'ci-pipeline',
      };

      const timeline = builder.buildTimeline([event]);
      expect(timeline.events[0].description).toContain('Deployment v2.1.0');
      expect(timeline.events[0].description).toContain('api-service');
    });

    it('builds description for dependency events', () => {
      const event: DependencyMetric = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        eventType: 'dependency',
        serviceName: 'api-service',
        properties: {},
        dependencyName: 'sql-db',
        dependencyType: 'SQL',
        duration: 500,
        success: false,
      };

      const timeline = builder.buildTimeline([event]);
      expect(timeline.events[0].description).toContain('Dependency call to sql-db');
      expect(timeline.events[0].description).toContain('failure');
    });

    it('builds description for request events', () => {
      const event: RequestMetric = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        eventType: 'request',
        serviceName: 'api-service',
        properties: {},
        operationName: 'GET /users',
        duration: 200,
        responseCode: 200,
        success: true,
      };

      const timeline = builder.buildTimeline([event]);
      expect(timeline.events[0].description).toContain('Request GET /users');
      expect(timeline.events[0].description).toContain('success');
    });

    it('sets serviceName and eventType on timeline events', () => {
      const event = makeEvent({ serviceName: 'my-svc', eventType: 'metric' });
      const timeline = builder.buildTimeline([event]);

      expect(timeline.events[0].serviceName).toBe('my-svc');
      expect(timeline.events[0].eventType).toBe('metric');
    });

    it('handles a single event', () => {
      const event = makeEvent();
      const timeline = builder.buildTimeline([event]);
      expect(timeline.events).toHaveLength(1);
    });
  });
});
