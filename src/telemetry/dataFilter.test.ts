import { DataFilter } from './dataFilter';
import { NormalizedTelemetry } from './normalizer';
import { TelemetryEvent } from '../types/telemetry';
import { TimeRange } from '../types/common';

function makeEvent(
  overrides: Partial<TelemetryEvent> = {},
): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T12:00:00Z'),
    eventType: 'request',
    serviceName: 'default-service',
    properties: {},
    ...overrides,
  };
}

function makeNormalized(
  events: TelemetryEvent[] = [],
): NormalizedTelemetry {
  return {
    events,
    exceptions: [],
    requests: [],
    dependencies: [],
    deployments: [],
  };
}

describe('DataFilter', () => {
  let filter: DataFilter;

  beforeEach(() => {
    filter = new DataFilter();
  });

  describe('filterByService', () => {
    it('should return only events matching the specified service names', () => {
      const telemetry = makeNormalized([
        makeEvent({ serviceName: 'api-service' }),
        makeEvent({ serviceName: 'web-app' }),
        makeEvent({ serviceName: 'worker' }),
      ]);
      telemetry.events = [
        makeEvent({ serviceName: 'api-service' }),
        makeEvent({ serviceName: 'web-app' }),
        makeEvent({ serviceName: 'worker' }),
      ];

      const result = filter.filterByService(telemetry, ['api-service']);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].serviceName).toBe('api-service');
    });

    it('should be case-insensitive', () => {
      const telemetry = makeNormalized([
        makeEvent({ serviceName: 'API-Service' }),
      ]);
      const result = filter.filterByService(telemetry, ['api-service']);
      expect(result.events).toHaveLength(1);
    });

    it('should return empty when no services match', () => {
      const telemetry = makeNormalized([
        makeEvent({ serviceName: 'api-service' }),
      ]);
      const result = filter.filterByService(telemetry, ['unknown']);
      expect(result.events).toHaveLength(0);
    });

    it('should not mutate the original telemetry', () => {
      const original = makeNormalized([
        makeEvent({ serviceName: 'api-service' }),
        makeEvent({ serviceName: 'web-app' }),
      ]);
      const originalLength = original.events.length;
      filter.filterByService(original, ['api-service']);
      expect(original.events).toHaveLength(originalLength);
    });
  });

  describe('filterByTimeRange', () => {
    const events: TelemetryEvent[] = [
      makeEvent({ timestamp: new Date('2024-01-01T10:00:00Z') }),
      makeEvent({ timestamp: new Date('2024-01-01T12:00:00Z') }),
      makeEvent({ timestamp: new Date('2024-01-01T14:00:00Z') }),
      makeEvent({ timestamp: new Date('2024-01-01T16:00:00Z') }),
    ];

    it('should return events within the time range (inclusive)', () => {
      const range: TimeRange = {
        start: new Date('2024-01-01T12:00:00Z'),
        end: new Date('2024-01-01T14:00:00Z'),
      };
      const result = filter.filterByTimeRange(events, range);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no events fall in range', () => {
      const range: TimeRange = {
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-01T01:00:00Z'),
      };
      const result = filter.filterByTimeRange(events, range);
      expect(result).toHaveLength(0);
    });

    it('should include boundary events', () => {
      const range: TimeRange = {
        start: new Date('2024-01-01T10:00:00Z'),
        end: new Date('2024-01-01T10:00:00Z'),
      };
      const result = filter.filterByTimeRange(events, range);
      expect(result).toHaveLength(1);
    });

    it('should not mutate the original array', () => {
      const range: TimeRange = {
        start: new Date('2024-01-01T12:00:00Z'),
        end: new Date('2024-01-01T14:00:00Z'),
      };
      const originalLength = events.length;
      filter.filterByTimeRange(events, range);
      expect(events).toHaveLength(originalLength);
    });
  });
});
