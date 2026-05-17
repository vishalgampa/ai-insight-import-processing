import {
  AuthenticationError,
  NetworkError,
  QueryValidationError,
  PermissionError,
  AnalysisTimeoutError,
} from './errors';

describe('AuthenticationError', () => {
  it('has correct name, code, and message', () => {
    const err = new AuthenticationError('Invalid client secret');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthenticationError');
    expect(err.code).toBe('AUTHENTICATION_ERROR');
    expect(err.message).toBe('Invalid client secret');
  });
});

describe('NetworkError', () => {
  it('includes default retry recommendation', () => {
    const err = new NetworkError('Connection refused');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NetworkError');
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.retryRecommendation).toBe('Retry the request with exponential backoff');
  });

  it('accepts a custom retry recommendation', () => {
    const err = new NetworkError('Timeout', 'Wait 30s then retry');
    expect(err.retryRecommendation).toBe('Wait 30s then retry');
  });
});

describe('QueryValidationError', () => {
  it('includes correction suggestions', () => {
    const err = new QueryValidationError('Bad query', ['Use ISO dates']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QueryValidationError');
    expect(err.code).toBe('QUERY_VALIDATION_ERROR');
    expect(err.correctionSuggestions).toEqual(['Use ISO dates']);
  });

  it('defaults to empty suggestions', () => {
    const err = new QueryValidationError('Bad query');
    expect(err.correctionSuggestions).toEqual([]);
  });
});

describe('PermissionError', () => {
  it('includes required permissions', () => {
    const err = new PermissionError('Forbidden', ['Reader', 'Contributor']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PermissionError');
    expect(err.code).toBe('PERMISSION_ERROR');
    expect(err.requiredPermissions).toEqual(['Reader', 'Contributor']);
  });
});

describe('AnalysisTimeoutError', () => {
  it('includes timeout duration', () => {
    const err = new AnalysisTimeoutError('Timed out', 60000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AnalysisTimeoutError');
    expect(err.code).toBe('ANALYSIS_TIMEOUT_ERROR');
    expect(err.timeoutMs).toBe(60000);
  });
});
