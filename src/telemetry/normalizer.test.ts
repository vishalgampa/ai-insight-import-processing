import { TelemetryNormalizer, RawTelemetry } from './normalizer';

describe('TelemetryNormalizer', () => {
  let normalizer: TelemetryNormalizer;

  beforeEach(() => {
    normalizer = new TelemetryNormalizer();
  });

  it('should return empty arrays for empty raw data', () => {
    const result = normalizer.normalize({});
    expect(result.events).toEqual([]);
    expect(result.exceptions).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(result.dependencies).toEqual([]);
    expect(result.deployments).toEqual([]);
  });

  it('should normalize valid exception records', () => {
    const raw: RawTelemetry = {
      exceptions: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          serviceName: 'api-service',
          exceptionType: 'NullReferenceException',
          message: 'Object reference not set',
          stackTrace: 'at Foo.Bar()',
          severity: 'critical',
          traceId: 'trace-1',
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0].eventType).toBe('exception');
    expect(result.exceptions[0].exceptionType).toBe('NullReferenceException');
    expect(result.exceptions[0].severity).toBe('critical');
    expect(result.events).toHaveLength(1);
  });

  it('should normalize valid request records', () => {
    const raw: RawTelemetry = {
      requests: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          serviceName: 'web-app',
          operationName: 'GET /api/users',
          duration: 250,
          responseCode: 200,
          success: true,
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].operationName).toBe('GET /api/users');
    expect(result.requests[0].duration).toBe(250);
  });

  it('should normalize valid dependency records', () => {
    const raw: RawTelemetry = {
      dependencies: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          serviceName: 'api-service',
          dependencyName: 'sql-db',
          dependencyType: 'SQL',
          duration: 50,
          success: true,
          resultCode: '200',
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0].dependencyName).toBe('sql-db');
  });

  it('should normalize valid deployment records', () => {
    const raw: RawTelemetry = {
      deployments: [
        {
          timestamp: '2024-01-01T09:00:00Z',
          serviceName: 'api-service',
          deploymentId: 'deploy-1',
          version: '2.0.0',
          deployedBy: 'ci-pipeline',
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0].version).toBe('2.0.0');
  });

  it('should sort unified events by timestamp', () => {
    const raw: RawTelemetry = {
      exceptions: [
        {
          timestamp: '2024-01-01T12:00:00Z',
          serviceName: 'svc',
          exceptionType: 'Error',
        },
      ],
      requests: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          serviceName: 'svc',
        },
      ],
      deployments: [
        {
          timestamp: '2024-01-01T08:00:00Z',
          serviceName: 'svc',
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.events).toHaveLength(3);
    expect(result.events[0].eventType).toBe('deployment');
    expect(result.events[1].eventType).toBe('request');
    expect(result.events[2].eventType).toBe('exception');
  });

  it('should skip records with missing timestamp', () => {
    const raw: RawTelemetry = {
      requests: [
        { serviceName: 'svc', operationName: 'GET /' },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.requests).toHaveLength(0);
  });

  it('should skip records with invalid timestamp', () => {
    const raw: RawTelemetry = {
      requests: [
        { timestamp: 'not-a-date', serviceName: 'svc' },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.requests).toHaveLength(0);
  });

  it('should skip exception records missing exceptionType', () => {
    const raw: RawTelemetry = {
      exceptions: [
        { timestamp: '2024-01-01T10:00:00Z', serviceName: 'svc' },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.exceptions).toHaveLength(0);
  });

  it('should default severity to error for unknown values', () => {
    const raw: RawTelemetry = {
      exceptions: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          serviceName: 'svc',
          exceptionType: 'Err',
          severity: 'unknown',
        },
      ],
    };
    const result = normalizer.normalize(raw);
    expect(result.exceptions[0].severity).toBe('error');
  });
});
