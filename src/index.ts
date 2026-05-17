/**
 * AI-Powered Root Cause Analysis Assistant
 *
 * Entry point that wires all components together via dependency injection
 * and exports a public API for programmatic usage.
 *
 * The assistant is stateless — each call to analyze() or analyzeWithMarkdown()
 * runs an independent pipeline, so concurrent requests are safe without
 * additional synchronization.
 *
 * Requirements: 10.3
 */

// --- Azure Integration ---
import { AzureAuthenticator } from './azure/authenticator';
import { ApplicationInsightsClient } from './azure/applicationInsightsClient';
import { RateLimitHandler } from './azure/rateLimitHandler';

// --- Telemetry Processing ---
import { TelemetryNormalizer } from './telemetry/normalizer';
import { DataFilter } from './telemetry/dataFilter';
import { TimeSeriesBuilder } from './telemetry/timeSeriesBuilder';
import { BaselineCalculator } from './telemetry/baselineCalculator';

// --- Pattern Detection ---
import { AnomalyDetector } from './analysis/anomalyDetector';
import { SpikeDetector } from './analysis/spikeDetector';
import { SeverityRanker } from './analysis/severityRanker';

// --- Correlation ---
import { TemporalCorrelator } from './correlation/temporalCorrelator';
import { CausalGraphBuilder } from './correlation/causalGraphBuilder';
import { PropagationAnalyzer } from './correlation/propagationAnalyzer';

// --- Root Cause ---
import { CausalAnalyzer } from './rootcause/causalAnalyzer';
import { EvidenceScorer } from './rootcause/evidenceScorer';
import { DeploymentCorrelator } from './rootcause/deploymentCorrelator';
import { ResourceAnalyzer } from './rootcause/resourceAnalyzer';
import { ExceptionGrouper } from './rootcause/exceptionGrouper';

// --- Symptoms ---
import { SymptomDetector } from './symptoms/symptomDetector';
import { CascadeAnalyzer } from './symptoms/cascadeAnalyzer';

// --- AI Reasoning ---
import { LLMClient } from './ai/llmClient';
import { PromptBuilder } from './ai/promptBuilder';
import { ReasoningEngine } from './ai/reasoningEngine';
import { RecommendationGenerator } from './ai/recommendationGenerator';

// --- Report Generation ---
import { ReportFormatter } from './report/reportFormatter';
import { TimelineBuilder } from './report/timelineBuilder';
import { MarkdownRenderer } from './report/markdownRenderer';

// --- Query Interface ---
import { parseQuery, requestClarification } from './query/queryParser';
import { AnalysisOrchestrator } from './query/analysisOrchestrator';
import { formatResponse } from './query/responseFormatter';

// --- Types (re-exported for consumers) ---
import type { IncidentReport } from './types/report';
import type { LLMConfig } from './ai/llmClient';
import type { AzureCredentials } from './types/common';

/** Configuration for creating an RCA Assistant instance */
export interface RCAAssistantConfig {
  /** Azure AD credentials for Application Insights access */
  azure: AzureCredentials;
  /** Application Insights resource ID */
  resourceId: string;
  /** LLM configuration for AI reasoning */
  llm: LLMConfig;
  /** Analysis timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/** Public API surface returned by createRCAAssistant */
export interface RCAAssistant {
  /** Parse a natural language query and run the full analysis pipeline */
  analyze(query: string): Promise<IncidentReport>;
  /** Parse a natural language query, run analysis, and render as Markdown */
  analyzeWithMarkdown(query: string): Promise<string>;
  /** Format an existing report as a natural language response */
  formatResponse(report: IncidentReport, query: string): string;
}

/**
 * Factory function that wires all dependencies and returns an RCAAssistant.
 *
 * The returned object is stateless per-request — the orchestrator creates
 * fresh analysis state on every call, so concurrent invocations are safe.
 */
export function createRCAAssistant(config: RCAAssistantConfig): RCAAssistant {
  // --- Instantiate components ---
  const authenticator = new AzureAuthenticator();
  const rateLimitHandler = new RateLimitHandler();
  const azureClient = new ApplicationInsightsClient(authenticator, rateLimitHandler);

  const normalizer = new TelemetryNormalizer();
  const dataFilter = new DataFilter();
  const timeSeriesBuilder = new TimeSeriesBuilder();
  const baselineCalculator = new BaselineCalculator();

  const anomalyDetector = new AnomalyDetector();
  const spikeDetector = new SpikeDetector();
  const severityRanker = new SeverityRanker();

  const temporalCorrelator = new TemporalCorrelator();
  const causalGraphBuilder = new CausalGraphBuilder();
  const propagationAnalyzer = new PropagationAnalyzer();

  const evidenceScorer = new EvidenceScorer();
  const causalAnalyzer = new CausalAnalyzer(evidenceScorer);
  const deploymentCorrelator = new DeploymentCorrelator();
  const resourceAnalyzer = new ResourceAnalyzer();
  const exceptionGrouper = new ExceptionGrouper();

  const symptomDetector = new SymptomDetector();
  const cascadeAnalyzer = new CascadeAnalyzer();

  const llmClient = new LLMClient(config.llm);
  const promptBuilder = new PromptBuilder();
  const reasoningEngine = new ReasoningEngine(llmClient, promptBuilder);
  const recommendationGenerator = new RecommendationGenerator();

  const timelineBuilder = new TimelineBuilder();
  const reportFormatter = new ReportFormatter(timelineBuilder);
  const markdownRenderer = new MarkdownRenderer();

  // --- Wire orchestrator ---
  const orchestrator = new AnalysisOrchestrator(
    {
      azureClient,
      normalizer,
      dataFilter,
      timeSeriesBuilder,
      baselineCalculator,
      anomalyDetector,
      spikeDetector,
      severityRanker,
      temporalCorrelator,
      causalGraphBuilder,
      propagationAnalyzer,
      causalAnalyzer,
      evidenceScorer,
      deploymentCorrelator,
      resourceAnalyzer,
      exceptionGrouper,
      symptomDetector,
      cascadeAnalyzer,
      reasoningEngine,
      recommendationGenerator,
      reportFormatter,
      markdownRenderer,
    },
    {
      resourceId: config.resourceId,
      timeoutMs: config.timeoutMs,
    },
  );

  // --- Return public API ---
  return {
    async analyze(query: string): Promise<IncidentReport> {
      const parsed = parseQuery(query);
      return orchestrator.executeAnalysis(parsed);
    },

    async analyzeWithMarkdown(query: string): Promise<string> {
      const parsed = parseQuery(query);
      const report = await orchestrator.executeAnalysis(parsed);
      return markdownRenderer.renderAsMarkdown(report);
    },

    formatResponse(report: IncidentReport, query: string): string {
      const parsed = parseQuery(query);
      return formatResponse(report, parsed);
    },
  };
}

// ---- Re-export public types and key classes for programmatic usage ----

// Types
export type { IncidentReport, Timeline, TimelineEvent, Evidence } from './types/report';
export type {
  Anomaly,
  CorrelatedEventGroup,
  CausalGraph,
  CausalEdge,
  RootCause,
  Symptom,
  Recommendation,
} from './types/analysis';
export type {
  TelemetryEvent,
  Exception,
  RequestMetric,
  DependencyMetric,
  DeploymentEvent,
} from './types/telemetry';
export type {
  TimeRange,
  Baseline,
  AzureCredentials,
  AuthToken,
  QueryFilters,
  TimeGranularity,
  BaselineMethod,
  MetricType,
  Duration,
} from './types/common';
export type { LLMConfig } from './ai/llmClient';
export type { ParsedQuery, ClarificationRequest } from './query/queryParser';
export type { OrchestratorConfig, OrchestratorDependencies } from './query/analysisOrchestrator';

// Key classes (for advanced / custom wiring)
export { AzureAuthenticator } from './azure/authenticator';
export { ApplicationInsightsClient } from './azure/applicationInsightsClient';
export { RateLimitHandler } from './azure/rateLimitHandler';
export { AnalysisOrchestrator } from './query/analysisOrchestrator';
export { MarkdownRenderer } from './report/markdownRenderer';
export { ReportFormatter } from './report/reportFormatter';
export { LLMClient } from './ai/llmClient';
export { ReasoningEngine } from './ai/reasoningEngine';
export { RecommendationGenerator } from './ai/recommendationGenerator';

// Query utilities
export { parseQuery, requestClarification } from './query/queryParser';
export { formatResponse } from './query/responseFormatter';

// Error classes
export {
  RcaError,
  AuthenticationError,
  NetworkError,
  QueryValidationError,
  PermissionError,
  AnalysisTimeoutError,
} from './errors';
