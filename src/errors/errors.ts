/**
 * Custom error classes for the RCA Assistant.
 * Runtime implementations of the error types defined in src/types/errors.ts.
 */

/** Base class for all RCA Assistant errors */
export abstract class RcaError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown when Azure authentication fails */
export class AuthenticationError extends RcaError {
  readonly code = 'AUTHENTICATION_ERROR';

  constructor(message: string) {
    super(message);
  }
}

/** Thrown on network or API call failures */
export class NetworkError extends RcaError {
  readonly code = 'NETWORK_ERROR';
  readonly retryRecommendation: string;

  constructor(message: string, retryRecommendation = 'Retry the request with exponential backoff') {
    super(message);
    this.retryRecommendation = retryRecommendation;
  }
}

/** Thrown when a query is invalid or malformed */
export class QueryValidationError extends RcaError {
  readonly code = 'QUERY_VALIDATION_ERROR';
  readonly correctionSuggestions: string[];

  constructor(message: string, correctionSuggestions: string[] = []) {
    super(message);
    this.correctionSuggestions = correctionSuggestions;
  }
}

/** Thrown when the caller lacks required permissions */
export class PermissionError extends RcaError {
  readonly code = 'PERMISSION_ERROR';
  readonly requiredPermissions: string[];

  constructor(message: string, requiredPermissions: string[] = []) {
    super(message);
    this.requiredPermissions = requiredPermissions;
  }
}

/** Thrown when analysis exceeds the allowed timeout */
export class AnalysisTimeoutError extends RcaError {
  readonly code = 'ANALYSIS_TIMEOUT_ERROR';
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.timeoutMs = timeoutMs;
  }
}
