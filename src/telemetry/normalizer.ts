/**
 * Telemetry normalizer — converts raw Azure telemetry into a standardized format.
 */

import {
  TelemetryEvent,
  Exception,
  RequestMetric,
  DependencyMetric,
  DeploymentEvent,
} from '../types/telemetry';
import { logger } from '../errors/logger';

/** Raw telemetry data as retrieved from Azure Application Insights */
export interface RawTelemetry {
  exceptions?: unknown[];
  requests?: unknown[];
  dependencies?: unknown[];
  deployments?: unknown[];
}

/** Normalized telemetry with a unified sorted event array and typed sub-arrays */
export interface NormalizedTelemetry {
  events: TelemetryEvent[];
  exceptions: Exception[];
  requests: RequestMetric[];
  dependencies: DependencyMetric[];
  deployments: DeploymentEvent[];
}

export class TelemetryNormalizer {
  /**
   * Convert raw Azure telemetry into a standardized NormalizedTelemetry structure.
   * Malformed records are skipped with a warning logged.
   */
  normalize(rawData: RawTelemetry): NormalizedTelemetry {
    const exceptions = this.normalizeExceptions(rawData.exceptions ?? []);
    const requests = this.normalizeRequests(rawData.requests ?? []);
    const dependencies = this.normalizeDependencies(rawData.dependencies ?? []);
    const deployments = this.normalizeDeployments(rawData.deployments ?? []);

    const events: TelemetryEvent[] = [
      ...exceptions,
      ...requests,
      ...dependencies,
      ...deployments,
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return { events, exceptions, requests, dependencies, deployments };
  }

  private normalizeExceptions(raw: unknown[]): Exception[] {
    const results: Exception[] = [];
    for (const item of raw) {
      try {
        const rec = item as Record<string, any>;
        if (!this.hasValidTimestamp(rec) || !this.hasString(rec, 'exceptionType')) {
          logger.warning('Skipping malformed exception record', { record: rec });
          continue;
        }
        results.push({
          timestamp: new Date(rec.timestamp),
          eventType: 'exception',
          serviceName: String(rec.serviceName ?? ''),
          traceId: rec.traceId ?? undefined,
          spanId: rec.spanId ?? undefined,
          properties: rec.properties ?? {},
          exceptionType: String(rec.exceptionType),
          message: String(rec.message ?? ''),
          stackTrace: String(rec.stackTrace ?? ''),
          severity: this.parseSeverity(rec.severity),
        });
      } catch (err) {
        logger.warning('Failed to normalize exception record', { error: String(err) });
      }
    }
    return results;
  }

  private normalizeRequests(raw: unknown[]): RequestMetric[] {
    const results: RequestMetric[] = [];
    for (const item of raw) {
      try {
        const rec = item as Record<string, any>;
        if (!this.hasValidTimestamp(rec)) {
          logger.warning('Skipping malformed request record', { record: rec });
          continue;
        }
        results.push({
          timestamp: new Date(rec.timestamp),
          eventType: 'request',
          serviceName: String(rec.serviceName ?? ''),
          traceId: rec.traceId ?? undefined,
          spanId: rec.spanId ?? undefined,
          properties: rec.properties ?? {},
          operationName: String(rec.operationName ?? ''),
          duration: Number(rec.duration ?? 0),
          responseCode: Number(rec.responseCode ?? 0),
          success: Boolean(rec.success),
        });
      } catch (err) {
        logger.warning('Failed to normalize request record', { error: String(err) });
      }
    }
    return results;
  }

  private normalizeDependencies(raw: unknown[]): DependencyMetric[] {
    const results: DependencyMetric[] = [];
    for (const item of raw) {
      try {
        const rec = item as Record<string, any>;
        if (!this.hasValidTimestamp(rec)) {
          logger.warning('Skipping malformed dependency record', { record: rec });
          continue;
        }
        results.push({
          timestamp: new Date(rec.timestamp),
          eventType: 'dependency',
          serviceName: String(rec.serviceName ?? ''),
          traceId: rec.traceId ?? undefined,
          spanId: rec.spanId ?? undefined,
          properties: rec.properties ?? {},
          dependencyName: String(rec.dependencyName ?? ''),
          dependencyType: String(rec.dependencyType ?? ''),
          duration: Number(rec.duration ?? 0),
          success: Boolean(rec.success),
          resultCode: rec.resultCode != null ? String(rec.resultCode) : undefined,
        });
      } catch (err) {
        logger.warning('Failed to normalize dependency record', { error: String(err) });
      }
    }
    return results;
  }

  private normalizeDeployments(raw: unknown[]): DeploymentEvent[] {
    const results: DeploymentEvent[] = [];
    for (const item of raw) {
      try {
        const rec = item as Record<string, any>;
        if (!this.hasValidTimestamp(rec)) {
          logger.warning('Skipping malformed deployment record', { record: rec });
          continue;
        }
        results.push({
          timestamp: new Date(rec.timestamp),
          eventType: 'deployment',
          serviceName: String(rec.serviceName ?? ''),
          traceId: rec.traceId ?? undefined,
          spanId: rec.spanId ?? undefined,
          properties: rec.properties ?? {},
          deploymentId: String(rec.deploymentId ?? ''),
          version: String(rec.version ?? ''),
          deployedBy: String(rec.deployedBy ?? ''),
        });
      } catch (err) {
        logger.warning('Failed to normalize deployment record', { error: String(err) });
      }
    }
    return results;
  }

  /** Check that a record has a parseable timestamp */
  private hasValidTimestamp(rec: Record<string, any>): boolean {
    if (rec.timestamp == null) return false;
    const d = new Date(rec.timestamp);
    return !isNaN(d.getTime());
  }

  /** Check that a record has a non-empty string field */
  private hasString(rec: Record<string, any>, field: string): boolean {
    return typeof rec[field] === 'string' && rec[field].length > 0;
  }

  /** Parse severity, defaulting to 'error' for unrecognised values */
  private parseSeverity(value: unknown): 'error' | 'warning' | 'critical' {
    if (value === 'warning' || value === 'critical' || value === 'error') {
      return value;
    }
    return 'error';
  }
}
