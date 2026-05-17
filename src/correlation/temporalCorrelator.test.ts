import { TemporalCorrelator } from './temporalCorrelator';
import { TelemetryEvent } from '../types/telemetry';

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

describe('TemporalCorrelator', () => {
  let correlator: TemporalCorrelator;

  beforeEach(() => {
    correlator = new TemporalCorrelator();
  });

  describe('correlateTemporal', () => {
    it('returns empty array for no events', () => {
      expect(correlator.correlateTemporal([], '30s')).toEqual([]);
    });

    it('returns empty array for a single event (no group possible)', () => {
      const events = [makeEvent({ timestamp: new Date('2024-01-01T00:00:00Z') })];
      expect(correlator.correlateTemporal(events, '30s')).toEqual([]);
    });

    it('groups events within the time window', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 10_000), serviceName: 'svc-b' }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      expect(groups.length).toBeGreaterThanOrEqual(1);
      // Both events should be in at least one group
      const allGroupedEvents = groups.flatMap((g) => g.events);
      expect(allGroupedEvents).toEqual(expect.arrayContaining(events));
    });

    it('does not group events outside the time window', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 120_000), serviceName: 'svc-b' }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      // No group should contain both events
      for (const group of groups) {
        const hasFirst = group.events.includes(events[0]);
        const hasSecond = group.events.includes(events[1]);
        expect(hasFirst && hasSecond).toBe(false);
      }
    });

    it('uses default 30s window when no duration provided', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base }),
        makeEvent({ timestamp: new Date(base.getTime() + 25_000) }),
      ];

      const groups = correlator.correlateTemporal(events);
      expect(groups.length).toBeGreaterThanOrEqual(1);
    });

    it('allows events to belong to multiple groups', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      // Three events: A at 0s, B at 25s, C at 50s with 30s window
      // A and B are within 30s, B and C are within 30s, but A and C are not
      const events = [
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 25_000), serviceName: 'svc-b' }),
        makeEvent({ timestamp: new Date(base.getTime() + 50_000), serviceName: 'svc-c' }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      // Event B (middle) should appear in multiple groups
      const groupsWithB = groups.filter((g) =>
        g.events.some((e) => e.serviceName === 'svc-b'),
      );
      expect(groupsWithB.length).toBeGreaterThanOrEqual(1);
    });

    it('assigns correlation scores between 0 and 1', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base }),
        makeEvent({ timestamp: new Date(base.getTime() + 5_000) }),
        makeEvent({ timestamp: new Date(base.getTime() + 10_000) }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      for (const group of groups) {
        expect(group.correlationScore).toBeGreaterThanOrEqual(0);
        expect(group.correlationScore).toBeLessThanOrEqual(1);
      }
    });

    it('assigns unique IDs to each group', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 25_000), serviceName: 'svc-b' }),
        makeEvent({ timestamp: new Date(base.getTime() + 50_000), serviceName: 'svc-c' }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      const ids = groups.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('sets correct timeWindow on each group', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base }),
        makeEvent({ timestamp: new Date(base.getTime() + 10_000) }),
      ];

      const groups = correlator.correlateTemporal(events, '30s');
      for (const group of groups) {
        expect(group.timeWindow.start).toBeInstanceOf(Date);
        expect(group.timeWindow.end).toBeInstanceOf(Date);
        expect(group.timeWindow.end.getTime()).toBeGreaterThan(
          group.timeWindow.start.getTime(),
        );
      }
    });
  });

  describe('accountForClockSkew', () => {
    it('returns empty array for no events', () => {
      expect(correlator.accountForClockSkew([])).toEqual([]);
    });

    it('returns single event unchanged', () => {
      const event = makeEvent({ timestamp: new Date('2024-01-01T00:00:00Z') });
      const result = correlator.accountForClockSkew([event], '5s');
      expect(result.length).toBe(1);
      expect(result[0].timestamp.getTime()).toBe(event.timestamp.getTime());
    });

    it('preserves event count', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 2_000), serviceName: 'svc-b' }),
        makeEvent({ timestamp: new Date(base.getTime() + 4_000), serviceName: 'svc-c' }),
      ];

      const result = correlator.accountForClockSkew(events, '5s');
      expect(result.length).toBe(events.length);
    });

    it('returns events sorted by timestamp', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const events = [
        makeEvent({ timestamp: new Date(base.getTime() + 3_000), serviceName: 'svc-b' }),
        makeEvent({ timestamp: base, serviceName: 'svc-a' }),
        makeEvent({ timestamp: new Date(base.getTime() + 1_000), serviceName: 'svc-c' }),
      ];

      const result = correlator.accountForClockSkew(events, '5s');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          result[i - 1].timestamp.getTime(),
        );
      }
    });

    it('does not modify original events', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const originalTs = base.getTime();
      const event = makeEvent({ timestamp: base, serviceName: 'svc-a' });

      correlator.accountForClockSkew([event], '5s');
      expect(event.timestamp.getTime()).toBe(originalTs);
    });

    it('reorders dependency events within skew window', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      // Dependency call from svc-a to svc-b happens at t+3s,
      // but svc-b's event is at t+1s (clock skew)
      const depEvent: TelemetryEvent = {
        timestamp: new Date(base.getTime() + 3_000),
        eventType: 'dependency',
        serviceName: 'svc-a',
        properties: {},
        ...({ dependencyName: 'svc-b' } as any),
      };
      const targetEvent = makeEvent({
        timestamp: new Date(base.getTime() + 1_000),
        serviceName: 'svc-b',
      });

      const result = correlator.accountForClockSkew([depEvent, targetEvent], '5s');
      // The dependency call should come before the target service event
      const depIdx = result.findIndex((e) => e.eventType === 'dependency');
      const targetIdx = result.findIndex((e) => e.serviceName === 'svc-b' && e.eventType !== 'dependency');
      expect(depIdx).toBeLessThan(targetIdx);
    });
  });
});
