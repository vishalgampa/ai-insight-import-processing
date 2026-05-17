/**
 * Telemetry data types for Azure Application Insights integration.
 */

/** Base telemetry event from Application Insights */
export interface TelemetryEvent {
  timestamp: Date;
  eventType: 'exception' | 'request' | 'dependency' | 'deployment' | 'metric';
  serviceName: string;
  traceId?: string;
  spanId?: string;
  properties: Record<string, any>;
}

/** Exception telemetry event */
export interface Exception extends TelemetryEvent {
  exceptionType: string;
  message: string;
  stackTrace: string;
  severity: 'error' | 'warning' | 'critical';
}

/** Request metric telemetry event */
export interface RequestMetric extends TelemetryEvent {
  operationName: string;
  duration: number;
  responseCode: number;
  success: boolean;
}

/** Dependency call metric telemetry event */
export interface DependencyMetric extends TelemetryEvent {
  dependencyName: string;
  dependencyType: string;
  duration: number;
  success: boolean;
  resultCode?: string;
}

/** Deployment event telemetry */
export interface DeploymentEvent extends TelemetryEvent {
  deploymentId: string;
  version: string;
  deployedBy: string;
}
