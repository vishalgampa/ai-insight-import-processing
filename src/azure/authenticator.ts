/**
 * Azure authenticator — validates credentials and manages auth tokens.
 */
import { ClientSecretCredential } from '@azure/identity';
import { AzureCredentials, AuthToken } from '../types/common';
import { AuthenticationError } from '../errors';

export class AzureAuthenticator {
  private currentToken: AuthToken | null = null;
  private credential: ClientSecretCredential | null = null;
  private credentials: AzureCredentials | null = null;

  /**
   * Authenticate with Azure using client secret credentials.
   * Throws AuthenticationError if credentials are invalid or authentication fails.
   */
  async authenticate(credentials: AzureCredentials): Promise<AuthToken> {
    if (!credentials.tenantId || !credentials.clientId || !credentials.clientSecret) {
      throw new AuthenticationError(
        'Invalid credentials: tenantId, clientId, and clientSecret are required',
      );
    }

    try {
      this.credential = new ClientSecretCredential(
        credentials.tenantId,
        credentials.clientId,
        credentials.clientSecret,
      );
      this.credentials = credentials;

      const tokenResponse = await this.credential.getToken(
        'https://api.applicationinsights.io/.default',
      );

      if (!tokenResponse) {
        throw new AuthenticationError('Authentication failed: no token returned from Azure');
      }

      this.currentToken = {
        token: tokenResponse.token,
        expiresAt: new Date(tokenResponse.expiresOnTimestamp),
      };

      return this.currentToken;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown authentication error';
      throw new AuthenticationError(`Authentication failed: ${message}`);
    }
  }

  /**
   * Refresh the current token. Requires a prior successful authenticate() call.
   */
  async refreshToken(): Promise<AuthToken> {
    if (!this.credential || !this.credentials) {
      throw new AuthenticationError('Cannot refresh token: not authenticated');
    }

    try {
      const tokenResponse = await this.credential.getToken(
        'https://api.applicationinsights.io/.default',
      );

      if (!tokenResponse) {
        throw new AuthenticationError('Token refresh failed: no token returned from Azure');
      }

      this.currentToken = {
        token: tokenResponse.token,
        expiresAt: new Date(tokenResponse.expiresOnTimestamp),
      };

      return this.currentToken;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error during token refresh';
      throw new AuthenticationError(`Token refresh failed: ${message}`);
    }
  }

  /** Check whether the current token is still valid (exists and not expired). */
  isTokenValid(): boolean {
    if (!this.currentToken) {
      return false;
    }
    return this.currentToken.expiresAt.getTime() > Date.now();
  }
}
