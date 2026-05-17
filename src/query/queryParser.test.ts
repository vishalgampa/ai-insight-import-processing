import {
  parseQuery,
  requestClarification,
  extractTimeRange,
  extractServiceNames,
  extractIncidentType,
  ParsedQuery,
  ClarificationRequest,
} from './queryParser';

describe('QueryParser', () => {
  describe('extractTimeRange', () => {
    it('should extract "last N hours" expressions', () => {
      const range = extractTimeRange('Show me errors in the last 2 hours');
      expect(range).not.toBeNull();
      const diffMs = range!.end.getTime() - range!.start.getTime();
      expect(diffMs).toBe(2 * 60 * 60 * 1000);
    });

    it('should extract "last N minutes" expressions', () => {
      const range = extractTimeRange('What happened in the last 30 minutes');
      expect(range).not.toBeNull();
      const diffMs = range!.end.getTime() - range!.start.getTime();
      expect(diffMs).toBe(30 * 60 * 1000);
    });

    it('should extract "between Xpm and Ypm" expressions', () => {
      const range = extractTimeRange('What caused failures between 2pm and 3pm today?');
      expect(range).not.toBeNull();
      expect(range!.start.getHours()).toBe(14);
      expect(range!.end.getHours()).toBe(15);
    });

    it('should extract "between Xam and Yam" expressions', () => {
      const range = extractTimeRange('Check logs between 9am and 11am');
      expect(range).not.toBeNull();
      expect(range!.start.getHours()).toBe(9);
      expect(range!.end.getHours()).toBe(11);
    });

    it('should handle "yesterday" keyword', () => {
      const range = extractTimeRange('What happened yesterday');
      expect(range).not.toBeNull();
      const today = new Date();
      const expectedDay = today.getDate() - 1;
      expect(range!.start.getDate()).toBe(expectedDay);
      expect(range!.start.getHours()).toBe(0);
      expect(range!.end.getHours()).toBe(23);
    });

    it('should return null when no time expression is found', () => {
      const range = extractTimeRange('Why is the checkout service slow?');
      expect(range).toBeNull();
    });

    it('should handle "last 1 hour" singular', () => {
      const range = extractTimeRange('Show errors from the last 1 hour');
      expect(range).not.toBeNull();
      const diffMs = range!.end.getTime() - range!.start.getTime();
      expect(diffMs).toBe(60 * 60 * 1000);
    });
  });

  describe('extractServiceNames', () => {
    it('should extract hyphenated service names', () => {
      const services = extractServiceNames(
        'Analyze the incident affecting user-service and payment-service',
      );
      expect(services).toContain('user-service');
      expect(services).toContain('payment-service');
    });

    it('should extract "X service" pattern', () => {
      const services = extractServiceNames('Why is the checkout service slow?');
      expect(services).toContain('checkout-service');
    });

    it('should return empty array when no services found', () => {
      const services = extractServiceNames('What caused the API failures?');
      expect(services).toHaveLength(0);
    });

    it('should be case-insensitive for hyphenated names', () => {
      const services = extractServiceNames('Check User-Service health');
      expect(services).toContain('user-service');
    });

    it('should not duplicate services found by both patterns', () => {
      const services = extractServiceNames('Look at api-service and api service');
      const apiCount = services.filter((s) => s === 'api-service').length;
      expect(apiCount).toBe(1);
    });
  });

  describe('extractIncidentType', () => {
    it('should detect failure-related keywords', () => {
      expect(extractIncidentType('What caused the API failures?')).toBe('failure');
    });

    it('should detect error-related keywords', () => {
      expect(extractIncidentType('Show me recent errors')).toBe('error');
    });

    it('should detect latency-related keywords', () => {
      expect(extractIncidentType('Why is the service slow?')).toBe('latency');
    });

    it('should detect outage-related keywords', () => {
      expect(extractIncidentType('The service is down')).toBe('outage');
    });

    it('should detect spike-related keywords', () => {
      expect(extractIncidentType('There is a spike in error rates')).toBe('spike');
    });

    it('should return unknown for unrecognized queries', () => {
      expect(extractIncidentType('Analyze the incident')).toBe('unknown');
    });
  });

  describe('parseQuery', () => {
    it('should parse query with time range, services, and incident type', () => {
      const result = parseQuery(
        'What caused the API failures between 2pm and 3pm today?',
      );
      expect(result.timeRange.start.getHours()).toBe(14);
      expect(result.timeRange.end.getHours()).toBe(15);
      expect(result.incidentType).toBe('failure');
      expect(result.rawQuery).toBe(
        'What caused the API failures between 2pm and 3pm today?',
      );
    });

    it('should default to last 1 hour when no time range specified', () => {
      const before = Date.now();
      const result = parseQuery('Why is the checkout service slow?');
      const after = Date.now();

      const diffMs =
        result.timeRange.end.getTime() - result.timeRange.start.getTime();
      expect(diffMs).toBe(60 * 60 * 1000);
      // end should be approximately now
      expect(result.timeRange.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.timeRange.end.getTime()).toBeLessThanOrEqual(after);
    });

    it('should extract service names from query', () => {
      const result = parseQuery(
        'Analyze the incident affecting user-service and payment-service',
      );
      expect(result.serviceNames).toContain('user-service');
      expect(result.serviceNames).toContain('payment-service');
    });

    it('should handle query with only time range', () => {
      const result = parseQuery('What happened in the last 3 hours?');
      expect(result.serviceNames).toHaveLength(0);
      expect(result.incidentType).toBe('unknown');
      const diffMs =
        result.timeRange.end.getTime() - result.timeRange.start.getTime();
      expect(diffMs).toBe(3 * 60 * 60 * 1000);
    });

    it('should handle query with only service names', () => {
      const result = parseQuery(
        'Analyze the incident affecting user-service and payment-service',
      );
      expect(result.serviceNames.length).toBeGreaterThan(0);
    });

    it('should preserve the raw query', () => {
      const query = 'Some random query text';
      const result = parseQuery(query);
      expect(result.rawQuery).toBe(query);
    });
  });

  describe('requestClarification', () => {
    it('should request time range when missing', () => {
      const result = requestClarification('analyze stuff', ['timeRange']);
      expect(result.missingParams).toContain('timeRange');
      expect(result.message).toContain('time range');
    });

    it('should request service names when missing', () => {
      const result = requestClarification('analyze stuff', ['serviceNames']);
      expect(result.missingParams).toContain('serviceNames');
      expect(result.message).toContain('service names');
    });

    it('should request both when both are missing', () => {
      const result = requestClarification('help', [
        'timeRange',
        'serviceNames',
      ]);
      expect(result.missingParams).toHaveLength(2);
      expect(result.message).toContain('time range');
      expect(result.message).toContain('service names');
    });

    it('should return generic message when no specific params listed', () => {
      const result = requestClarification('help', []);
      expect(result.message).toContain('more details');
    });
  });
});
