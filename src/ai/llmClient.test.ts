import { LLMClient, LLMConfig, HttpClient, HttpResponse } from './llmClient';

/** Stub HTTP client for testing */
class MockHttpClient implements HttpClient {
  public lastUrl = '';
  public lastBody: unknown = null;
  public lastHeaders: Record<string, string> = {};
  public response: HttpResponse = { status: 200, data: {} };
  public shouldThrow = false;

  async post(url: string, body: unknown, headers: Record<string, string>): Promise<HttpResponse> {
    this.lastUrl = url;
    this.lastBody = body;
    this.lastHeaders = headers;
    if (this.shouldThrow) {
      throw new Error('Network failure');
    }
    return this.response;
  }
}

const baseConfig: LLMConfig = {
  apiEndpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'test-key-123',
};

describe('LLMClient', () => {
  let httpClient: MockHttpClient;

  beforeEach(() => {
    httpClient = new MockHttpClient();
  });

  test('complete() returns content from a successful response', async () => {
    httpClient.response = {
      status: 200,
      data: { choices: [{ message: { content: 'Root cause is a bad deploy.' } }] },
    };

    const client = new LLMClient(baseConfig, httpClient);
    const result = await client.complete('Analyze this incident');

    expect(result).toBe('Root cause is a bad deploy.');
    expect(httpClient.lastUrl).toBe(baseConfig.apiEndpoint);
  });

  test('complete() sends correct headers and body', async () => {
    httpClient.response = {
      status: 200,
      data: { choices: [{ message: { content: 'ok' } }] },
    };

    const config: LLMConfig = { ...baseConfig, model: 'gpt-3.5-turbo', maxTokens: 512 };
    const client = new LLMClient(config, httpClient);
    await client.complete('test prompt');

    expect(httpClient.lastHeaders['api-key']).toBe('test-key-123');
    expect(httpClient.lastHeaders['Authorization']).toBe('Bearer test-key-123');

    const body = httpClient.lastBody as Record<string, unknown>;
    expect(body.model).toBe('gpt-3.5-turbo');
    expect(body.max_tokens).toBe(512);
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
  });

  test('complete() uses default model and maxTokens when not specified', async () => {
    httpClient.response = {
      status: 200,
      data: { choices: [{ message: { content: 'ok' } }] },
    };

    const client = new LLMClient(baseConfig, httpClient);
    await client.complete('prompt');

    const body = httpClient.lastBody as Record<string, unknown>;
    expect(body.model).toBe('gpt-4');
    expect(body.max_tokens).toBe(2048);
  });

  test('complete() throws on non-200 status', async () => {
    httpClient.response = {
      status: 429,
      data: { error: { message: 'Rate limit exceeded' } },
    };

    const client = new LLMClient(baseConfig, httpClient);
    await expect(client.complete('prompt')).rejects.toThrow('LLM completion failed');
  });

  test('complete() throws on empty response content', async () => {
    httpClient.response = {
      status: 200,
      data: { choices: [{ message: {} }] },
    };

    const client = new LLMClient(baseConfig, httpClient);
    await expect(client.complete('prompt')).rejects.toThrow('LLM completion failed');
  });

  test('complete() throws on network failure', async () => {
    httpClient.shouldThrow = true;

    const client = new LLMClient(baseConfig, httpClient);
    await expect(client.complete('prompt')).rejects.toThrow('LLM completion failed: Network failure');
  });
});
