import { createRCAAssistant, RCAAssistantConfig, RCAAssistant } from './index';

const validConfig: RCAAssistantConfig = {
  azure: {
    tenantId: 'test-tenant',
    clientId: 'test-client',
    clientSecret: 'test-secret',
  },
  resourceId: '/subscriptions/sub-1/resourceGroups/rg/providers/microsoft.insights/components/app',
  llm: {
    apiEndpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4',
  },
};

describe('createRCAAssistant', () => {
  it('returns an object with analyze, analyzeWithMarkdown, and formatResponse', () => {
    const assistant = createRCAAssistant(validConfig);

    expect(assistant).toBeDefined();
    expect(typeof assistant.analyze).toBe('function');
    expect(typeof assistant.analyzeWithMarkdown).toBe('function');
    expect(typeof assistant.formatResponse).toBe('function');
  });

  it('accepts optional timeoutMs in config', () => {
    const assistant = createRCAAssistant({ ...validConfig, timeoutMs: 30_000 });

    expect(assistant).toBeDefined();
    expect(typeof assistant.analyze).toBe('function');
  });

  it('returns distinct instances for separate calls', () => {
    const a = createRCAAssistant(validConfig);
    const b = createRCAAssistant(validConfig);

    // Different object references — supports concurrent independent usage
    expect(a).not.toBe(b);
  });
});
