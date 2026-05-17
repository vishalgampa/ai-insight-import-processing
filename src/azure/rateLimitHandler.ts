/**
 * Rate limit handler with exponential backoff retry logic.
 * Delays: 1s, 2s, 4s — max 3 retries.
 */
import { NetworkError } from '../errors';
import { logger } from '../errors/logger';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class RateLimitHandler {
  /**
   * Execute an async function with exponential backoff retry.
   * Retries up to 3 times with delays of 1s, 2s, 4s.
   * Throws NetworkError after all retries are exhausted.
   */
  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt >= MAX_RETRIES) {
          break;
        }

        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        logger.warning(`Retry attempt ${attempt + 1}/${MAX_RETRIES} after ${delayMs}ms`, {
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.delay(delayMs);
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error';
    throw new NetworkError(
      `All ${MAX_RETRIES} retries exhausted: ${message}`,
      'Retry the request later or check network connectivity',
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
