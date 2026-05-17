/**
 * Application Insights client — queries telemetry data from Azure Application Insights.
 * Implements the IAzureIntegrationLayer interface from the design document.
 */
import { LogsQueryClient, LogsQueryResultStatus } from '@azure/monitor-query';
import type { LogsTable, QueryTimeInterval } from '@azure/monitor-query';
import { AzureAuthenticator } from './authenticator';
import { RateLimitHandler } from './rateLimitHandler';
import { TimeRange, QueryFilters } from '../types/common';
import {
  TelemetryEvent,
  Exception,
  RequestMetric,
  DependencyMetric,
  DeploymentEvent,
} from '../types/telemetry';
import { AuthenticationError, NetworkError, QueryValidationError } from '../errors';
import { logger } from '../errors/logger';

/** Page size for paginated queries */
const PAGE_SIZE = 1000;

/**
 * Converts our TimeRange to the Azure SDK QueryTimeInterval format.
 */
function toQueryTimeInterval(timeRange: TimeRange): QueryTimeInterval {
  return { startTime: timeRange.start, endTime: timeRange.end };
}

/**
 * Extracts typed rows from a LogsTable by mapping column names to row values.
 */
function tableToRecords(table: LogsTable): Record<string, unknown>[] {
  const columns = table.columnDescriptors.map((c) => c.name ?? '');
  return table.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      record[columns[i]] = row[i];
    }
    return record;
  });
}

/**
 * Builds a Kusto `where` clause fragment from optional QueryFilters.
 */
function buildFilterClause(filters?: QueryFilters): string {
  const clauses: string[] = [];

  if (filters?.serviceNames?.length) {
    const names = filters.serviceNames.map((n) => `'${n}'`).join(', ');
    clauses.push(`cloud_RoleName in (${names})`);
  }
  if (filters?.operationNames?.length) {
    const ops = filters.operationNames.map((n) => `'${n}'`).join(', ');
    clauses.push(`operation_Name in (${ops})`);
  }
  if (filters?.severityLevels?.length) {
    const levels = filters.severityLevels.map((l) => `'${l}'`).join(', ');
    clauses.push(`severityLevel in (${levels})`);
  }

  return clauses.length > 0 ? `| where ${clauses.join(' and ')}` : '';
}

export class ApplicationInsightsClient {
  private logsClient: LogsQueryClient | null = null;

  constructor(
    private readonly authenticator: AzureAuthenticator,
    private readonly rateLimitHandler: RateLimitHandler,
  ) {}

  /**
   * Ensures the LogsQueryClient is initialised with a valid credential.
   * Re-creates the client when the token has expired.
   */
  private async ensureClient(): Promise<LogsQueryClient> {
    if (!this.logsClient || !this.authenticator.isTokenValid()) {
      throw new AuthenticationError(
        'Not authenticated. Call authenticator.authenticate() before querying.',
      );
    }
    return this.logsClient;
  }

  /**
   * Initialise the underlying LogsQueryClient.
   * Must be called after a successful `authenticator.authenticate()`.
   */
  initializeClient(logsClient: LogsQueryClient): void {
    this.logsClient = logsClient;
  }

  // ---------------------------------------------------------------------------
  // queryTelemetry
  // ---------------------------------------------------------------------------

  /**
   * Execute an arbitrary Kusto query against Application Insights.
   * Supports pagination for large result sets (>PAGE_SIZE rows).
   */
  async queryTelemetry(
    resourceId: string,
    query: string,
    timeRange: TimeRange,
  ): Promise<TelemetryEvent[]> {
    if (!query || query.trim().length === 0) {
      throw new QueryValidationError('Query must not be empty', [
        'Provide a valid Kusto query string',
      ]);
    }

    const allRecords: TelemetryEvent[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const paginatedQuery = `${query} | serialize | skip ${offset} | take ${PAGE_SIZE}`;
      const records = await this.executeQuery(resourceId, paginatedQuery, timeRange);
      const events = records.map(mapToTelemetryEvent);
      allRecords.push(...events);
      hasMore = records.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    return allRecords;
  }

  // ---------------------------------------------------------------------------
  // getExceptions
  // ---------------------------------------------------------------------------

  async getExceptions(
    resourceId: string,
    timeRange: TimeRange,
    filters?: QueryFilters,
  ): Promise<Exception[]> {
    const filterClause = buildFilterClause(filters);
    const allResults: Exception[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `exceptions ${filterClause} | serialize | skip ${offset} | take ${PAGE_SIZE}`;
      const records = await this.executeQuery(resourceId, query, timeRange);
      allResults.push(...records.map(mapToException));
      hasMore = records.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    return allResults;
  }

  // ---------------------------------------------------------------------------
  // getRequestMetrics
  // ---------------------------------------------------------------------------

  async getRequestMetrics(
    resourceId: string,
    timeRange: TimeRange,
    filters?: QueryFilters,
  ): Promise<RequestMetric[]> {
    const filterClause = buildFilterClause(filters);
    const allResults: RequestMetric[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `requests ${filterClause} | serialize | skip ${offset} | take ${PAGE_SIZE}`;
      const records = await this.executeQuery(resourceId, query, timeRange);
      allResults.push(...records.map(mapToRequestMetric));
      hasMore = records.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    return allResults;
  }

  // ---------------------------------------------------------------------------
  // getDependencyMetrics
  // ---------------------------------------------------------------------------

  async getDependencyMetrics(
    resourceId: string,
    timeRange: TimeRange,
    filters?: QueryFilters,
  ): Promise<DependencyMetric[]> {
    const filterClause = buildFilterClause(filters);
    const allResults: DependencyMetric[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `dependencies ${filterClause} | serialize | skip ${offset} | take ${PAGE_SIZE}`;
      const records = await this.executeQuery(resourceId, query, timeRange);
      allResults.push(...records.map(mapToDependencyMetric));
      hasMore = records.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    return allResults;
  }

  // ---------------------------------------------------------------------------
  // getDeploymentEvents
  // ---------------------------------------------------------------------------

  async getDeploymentEvents(
    resourceId: string,
    timeRange: TimeRange,
  ): Promise<DeploymentEvent[]> {
    const allResults: DeploymentEvent[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `customEvents | where name == "DeploymentEvent" | serialize | skip ${offset} | take ${PAGE_SIZE}`;
      const records = await this.executeQuery(resourceId, query, timeRange);
      allResults.push(...records.map(mapToDeploymentEvent));
      hasMore = records.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    return allResults;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute a single paginated query via the LogsQueryClient, wrapped in
   * rate-limit retry logic.
   */
  private async executeQuery(
    resourceId: string,
    query: string,
    timeRange: TimeRange,
  ): Promise<Record<string, unknown>[]> {
    const client = await this.ensureClient();
    const interval = toQueryTimeInterval(timeRange);

    return this.rateLimitHandler.executeWithRetry(async () => {
      try {
        const result = await client.queryResource(resourceId, query, interval);

        if (result.status === LogsQueryResultStatus.PartialFailure) {
          logger.warning('Partial query failure', {
            error: result.partialError.message,
          });
          return result.partialTables.flatMap(tableToRecords);
        }

        if (result.status === LogsQueryResultStatus.Success) {
          return result.tables.flatMap(tableToRecords);
        }

        return [];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('authentication') || message.includes('401')) {
          throw new AuthenticationError(`Authentication failed during query: ${message}`);
        }
        if (message.includes('syntax') || message.includes('Semantic error')) {
          throw new QueryValidationError(`Invalid query: ${message}`, [
            'Check Kusto query syntax',
          ]);
        }

        throw new NetworkError(
          `Query execution failed: ${message}`,
          'Retry the request or check network connectivity',
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Row → domain-type mappers
// ---------------------------------------------------------------------------

function mapToTelemetryEvent(row: Record<string, unknown>): TelemetryEvent {
  return {
    timestamp: toDate(row['timestamp']),
    eventType: (row['itemType'] as TelemetryEvent['eventType']) ?? 'metric',
    serviceName: String(row['cloud_RoleName'] ?? ''),
    traceId: row['operation_Id'] != null ? String(row['operation_Id']) : undefined,
    spanId: row['operation_ParentId'] != null ? String(row['operation_ParentId']) : undefined,
    properties: typeof row['customDimensions'] === 'object'
      ? (row['customDimensions'] as Record<string, any>) ?? {}
      : {},
  };
}

function mapToException(row: Record<string, unknown>): Exception {
  return {
    ...mapToTelemetryEvent(row),
    eventType: 'exception',
    exceptionType: String(row['type'] ?? row['problemId'] ?? ''),
    message: String(row['outerMessage'] ?? row['message'] ?? ''),
    stackTrace: String(row['details'] ?? row['innermostMessage'] ?? ''),
    severity: mapSeverity(row['severityLevel']),
  };
}

function mapToRequestMetric(row: Record<string, unknown>): RequestMetric {
  return {
    ...mapToTelemetryEvent(row),
    eventType: 'request',
    operationName: String(row['name'] ?? row['operation_Name'] ?? ''),
    duration: Number(row['duration'] ?? 0),
    responseCode: Number(row['resultCode'] ?? 0),
    success: row['success'] === true || row['success'] === 'True',
  };
}

function mapToDependencyMetric(row: Record<string, unknown>): DependencyMetric {
  return {
    ...mapToTelemetryEvent(row),
    eventType: 'dependency',
    dependencyName: String(row['name'] ?? row['target'] ?? ''),
    dependencyType: String(row['type'] ?? ''),
    duration: Number(row['duration'] ?? 0),
    success: row['success'] === true || row['success'] === 'True',
    resultCode: row['resultCode'] != null ? String(row['resultCode']) : undefined,
  };
}

function mapToDeploymentEvent(row: Record<string, unknown>): DeploymentEvent {
  const props = typeof row['customDimensions'] === 'object'
    ? (row['customDimensions'] as Record<string, any>) ?? {}
    : {};
  return {
    ...mapToTelemetryEvent(row),
    eventType: 'deployment',
    deploymentId: String(props['deploymentId'] ?? row['name'] ?? ''),
    version: String(props['version'] ?? ''),
    deployedBy: String(props['deployedBy'] ?? ''),
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
}

function mapSeverity(value: unknown): Exception['severity'] {
  const num = Number(value);
  if (num >= 4) return 'critical';
  if (num >= 3) return 'error';
  return 'warning';
}
