/**
 * LLM client supporting Google Gemini and OpenAI-compatible APIs.
 * Set provider to 'gemini' (default) or 'openai' in LLMConfig.
 */

import { logger } from '../errors';

/** Configuration for the LLM client */
export interface LLMConfig {
  apiKey: string;
  /** 'gemini' (default) or 'openai' */
  provider?: 'gemini' | 'openai';
  /**
   * Model name.
   * Gemini default: 'gemini-2.0-flash'
   * OpenAI default: 'gpt-4'
   */
  model?: string;
  maxTokens?: number;
  /**
   * Only required for 'openai' provider — the full endpoint URL.
   * e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-01
   */
  apiEndpoint?: string;
}

/** Abstraction over the HTTP call so it can be mocked in tests */
export interface HttpClient {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  data: unknown;
}

/** Default HTTP client using fetch */
export class FetchHttpClient implements HttpClient {
  async post(url: string, body: unknown, headers: Record<string, string>): Promise<HttpResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
  }
}

export class LLMClient {
  private config: LLMConfig;
  private httpClient: HttpClient;

  constructor(config: LLMConfig, httpClient?: HttpClient) {
    this.config = config;
    this.httpClient = httpClient ?? new FetchHttpClient();
  }

  /**
   * Send a prompt to the LLM and return the text response.
   * Throws an error with a descriptive message on failure.
   */
  async complete(prompt: string): Promise<string> {
    const provider = this.config.provider ?? 'gemini';
    return provider === 'gemini'
      ? this.completeGemini(prompt)
      : this.completeOpenAI(prompt);
  }

  // ── Gemini ────────────────────────────────────────────────────────────────

  private async completeGemini(prompt: string): Promise<string> {
    const model = this.config.model ?? 'gemini-2.0-flash';
    const maxTokens = this.config.maxTokens ?? 2048;

    // Gemini REST endpoint: POST with API key as query param
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };

    try {
      const response = await this.httpClient.post(url, body, {});

      if (response.status !== 200) {
        const errorData = response.data as Record<string, unknown>;
        const message =
          ((errorData?.error as Record<string, unknown>)?.message as string) ?? 'Unknown error';
        throw new Error(`Gemini API returned status ${response.status}: ${message}`);
      }

      const data = response.data as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini API returned an empty or malformed response');
      }

      return text;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Gemini completion failed', { model, error: err.message });
      throw new Error(`LLM completion failed: ${err.message}`);
    }
  }

  // ── OpenAI / Azure OpenAI ─────────────────────────────────────────────────

  private async completeOpenAI(prompt: string): Promise<string> {
    const model = this.config.model ?? 'gpt-4';
    const maxTokens = this.config.maxTokens ?? 2048;

    if (!this.config.apiEndpoint) {
      throw new Error('apiEndpoint is required for the openai provider');
    }

    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    };

    const headers: Record<string, string> = {
      'api-key': this.config.apiKey,
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    try {
      const response = await this.httpClient.post(this.config.apiEndpoint, body, headers);

      if (response.status !== 200) {
        const errorData = response.data as Record<string, unknown>;
        const message =
          ((errorData?.error as Record<string, unknown>)?.message as string) ?? 'Unknown error';
        throw new Error(`OpenAI API returned status ${response.status}: ${message}`);
      }

      const data = response.data as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI API returned an empty or malformed response');
      }

      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('OpenAI completion failed', {
        endpoint: this.config.apiEndpoint,
        model,
        error: err.message,
      });
      throw new Error(`LLM completion failed: ${err.message}`);
    }
  }
}
