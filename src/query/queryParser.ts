/**
 * Query parser for natural language incident queries.
 * Extracts time range, service names, and incident type from user input.
 */

import { TimeRange } from '../types/common';

/** Parsed result from a natural language query */
export interface ParsedQuery {
  timeRange: TimeRange;
  serviceNames: string[];
  incidentType: string;
  rawQuery: string;
}

/** Clarification request when required parameters are missing */
export interface ClarificationRequest {
  message: string;
  missingParams: string[];
}

/** Known incident type keywords mapped to canonical types */
const INCIDENT_TYPE_MAP: Record<string, string> = {
  failure: 'failure',
  failures: 'failure',
  fail: 'failure',
  failed: 'failure',
  error: 'error',
  errors: 'error',
  exception: 'error',
  exceptions: 'error',
  slow: 'latency',
  latency: 'latency',
  timeout: 'latency',
  timeouts: 'latency',
  degradation: 'latency',
  degraded: 'latency',
  outage: 'outage',
  down: 'outage',
  crash: 'outage',
  crashed: 'outage',
  spike: 'spike',
  spikes: 'spike',
  high: 'spike',
};

/**
 * Extract a time range from natural language text.
 * Returns null if no time expression is found.
 */
export function extractTimeRange(query: string): TimeRange | null {
  const lower = query.toLowerCase();
  const now = new Date();

  // "last N hours/minutes"
  const lastMatch = lower.match(/last\s+(\d+)\s*(hour|hours|hr|hrs|minute|minutes|min|mins)/);
  if (lastMatch) {
    const amount = parseInt(lastMatch[1], 10);
    const unit = lastMatch[2];
    const ms = unit.startsWith('min') ? amount * 60 * 1000 : amount * 60 * 60 * 1000;
    return { start: new Date(now.getTime() - ms), end: now };
  }

  // "between Xam/pm and Yam/pm" with optional "today"/"yesterday"
  const betweenMatch = lower.match(
    /between\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*and\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|yesterday))?/
  );
  if (betweenMatch) {
    const [, startHr, startMin, startAmPm, endHr, endMin, endAmPm, dayRef] = betweenMatch;
    const baseDate = new Date(now);
    if (dayRef === 'yesterday') {
      baseDate.setDate(baseDate.getDate() - 1);
    }
    const start = buildTime(baseDate, parseInt(startHr, 10), parseInt(startMin || '0', 10), startAmPm);
    const end = buildTime(baseDate, parseInt(endHr, 10), parseInt(endMin || '0', 10), endAmPm);
    return { start, end };
  }

  // "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

/** Build a Date with specific hour/minute, handling am/pm */
function buildTime(baseDate: Date, hour: number, minute: number, amPm?: string): Date {
  const d = new Date(baseDate);
  let h = hour;
  if (amPm === 'pm' && h < 12) h += 12;
  if (amPm === 'am' && h === 12) h = 0;
  d.setHours(h, minute, 0, 0);
  return d;
}

/**
 * Extract service names from the query.
 * Looks for patterns like "service-name", "serviceName", or "X service".
 */
export function extractServiceNames(query: string): string[] {
  const services: string[] = [];

  // Match explicit service-like names (hyphenated identifiers)
  const hyphenated = query.match(/\b([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+)\b/gi);
  if (hyphenated) {
    for (const name of hyphenated) {
      services.push(name.toLowerCase());
    }
  }

  // Match "X service" pattern (e.g., "checkout service", "payment service")
  const servicePattern = query.match(/\b(\w+)\s+service\b/gi);
  if (servicePattern) {
    for (const match of servicePattern) {
      const name = match.replace(/\s+service$/i, '').toLowerCase();
      const asHyphenated = `${name}-service`;
      if (!services.includes(asHyphenated)) {
        services.push(asHyphenated);
      }
    }
  }

  return services;
}

/**
 * Identify the incident type from the query text.
 * Returns 'unknown' if no recognizable incident type is found.
 */
export function extractIncidentType(query: string): string {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, '');
    if (INCIDENT_TYPE_MAP[cleaned]) {
      return INCIDENT_TYPE_MAP[cleaned];
    }
  }

  return 'unknown';
}

/** Default time range: last 1 hour */
function defaultTimeRange(): TimeRange {
  const now = new Date();
  return { start: new Date(now.getTime() - 60 * 60 * 1000), end: now };
}

/**
 * Parse a natural language query into structured parameters.
 * Extracts time range, service names, and incident type.
 * Defaults to last 1 hour if no time range is specified.
 */
export function parseQuery(naturalLanguageQuery: string): ParsedQuery {
  const timeRange = extractTimeRange(naturalLanguageQuery) ?? defaultTimeRange();
  const serviceNames = extractServiceNames(naturalLanguageQuery);
  const incidentType = extractIncidentType(naturalLanguageQuery);

  return {
    timeRange,
    serviceNames,
    incidentType,
    rawQuery: naturalLanguageQuery,
  };
}

/**
 * Return a clarification request when required parameters are missing.
 * A clarification is needed when both time range AND service names are absent.
 */
export function requestClarification(
  ambiguousQuery: string,
  missingParams: string[],
): ClarificationRequest {
  const parts: string[] = [];

  if (missingParams.includes('timeRange')) {
    parts.push('a time range (e.g., "between 2pm and 3pm" or "last 2 hours")');
  }
  if (missingParams.includes('serviceNames')) {
    parts.push('the affected service names (e.g., "checkout-service" or "payment service")');
  }

  const message =
    parts.length > 0
      ? `Could you please provide ${parts.join(' and ')}? This will help focus the analysis.`
      : 'Could you provide more details about the incident you want to analyze?';

  return { message, missingParams };
}
