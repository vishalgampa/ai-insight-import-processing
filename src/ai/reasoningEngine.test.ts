import { ReasoningEngine, AIAnalysis } from './reasoningEngine';
import { LLMClient } from './llmClient';
import { PromptBuilder, IncidentPromptContext } from './promptBuilder';
import { RootCause } from '../types/analysis';
import { Evidence } from '../types/report';
import { TelemetryEvent } from '../types/telemetry';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    eventType: 'exception',
    serviceName: 'order-service',
    properties: {},
    ...overrides,
  };
}

function makeRootCause(overrides: Partial<RootCause> = {}): RootCause {
  return {
    id: 'rc-1',
    event: makeEvent(),
    confidence: 0.85,
    evidenceScore: 0.9,
    explanation: 'Database connection pool exhausted',
    category: 'dependency',
    ...overrides,
  };
}

function makeContext(overrides: Partial<IncidentPromptContext> = {}): IncidentPromptContext {
  return {
    timeRange: { start: new Date('2024-01-15T09:00:00Z'), end: new Date('2024-01-15T10:00:00Z') },
    affectedServices: ['order-service'],
    severity: 'high',
    anomalies: [],
    correlations: [],
    rootCauseCandidates: [makeRootCause()],
    symptoms: [],
    ...overrides,
  };
}

function makeMockLLMClient(response: string): LLMClient {
  const client = new LLMClient({ apiEndpoint: 'http://test', apiKey: 'key' });
  client.complete = jest.fn().mockResolvedValue(response);
  return client;
}

function makeFailingLLMClient(): LLMClient {
  const client = new LLMClient({ apiEndpoint: 'http://test', apiKey: 'key' });
  client.complete = jest.fn().mockRejectedValue(new Error('LLM unavailable'));
  return client;
}

describe('ReasoningEngine', () => {
  describe('analyzeIncident', () => {
    it('returns AI explanation and recommendations on LLM success', async () => {
      const llm = makeMockLLMClient('The database connection pool was exhausted.');
      const engine = new ReasoningEngine(llm, new PromptBuilder());

      const result = await engine.analyzeIncident(makeContext());

      expect(result.explanation).toBe('The database connection pool was exhausted.');
      expect(result.rawResponse).toBe('The database connection pool was exhausted.');
      expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to rule-based explanation when LLM fails', async () => {
      const llm = makeFailingLLMClient();
      const engine = new ReasoningEngine(llm, new PromptBuilder());

      const result = await engine.analyzeIncident(makeContext());

      expect(result.explanation).toContain('dependency');
      expect(result.rawResponse).toBe('');
      expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    });

    it('handles context with no root cause candidates', async () => {
      const llm = makeFailingLLMClient();
      const engine = new ReasoningEngine(llm, new PromptBuilder());
      const ctx = makeContext({ rootCauseCandidates: [] });

      const result = await engine.analyzeIncident(ctx);

      expect(result.explanation).toContain('No definitive root cause');
    });
  });

  describe('generateExplanation', () => {
    it('returns LLM-generated explanation on success', async () => {
      const llm = makeMockLLMClient('The pool ran out of connections due to a leak.');
      const engine = new ReasoningEngine(llm, new PromptBuilder());
      const evidence: Evidence[] = [{ type: 'metric', description: 'Connection count spike', data: {} }];

      const explanation = await engine.generateExplanation(makeRootCause(), evidence);

      expect(explanation).toBe('The pool ran out of connections due to a leak.');
    });

    it('falls back to rule-based explanation when LLM fails', async () => {
      const llm = makeFailingLLMClient();
      const engine = new ReasoningEngine(llm, new PromptBuilder());
      const evidence: Evidence[] = [
        { type: 'metric', description: 'Connection count spike', data: {} },
      ];

      const explanation = await engine.generateExplanation(makeRootCause(), evidence);

      expect(explanation).toContain('Root cause identified');
      expect(explanation).toContain('dependency');
      expect(explanation).toContain('85%');
      expect(explanation).toContain('1 piece');
    });
  });
});
