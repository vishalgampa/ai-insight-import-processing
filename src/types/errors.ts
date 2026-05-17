/**
 * Error response types for the RCA Assistant.
 */

/** Structured error response */
export interface ErrorResponse {
  errorCode: string;
  errorMessage: string;
  errorDetails: Record<string, any>;
  timestamp: Date;
  requestId: string;
  suggestedAction?: string;
}
