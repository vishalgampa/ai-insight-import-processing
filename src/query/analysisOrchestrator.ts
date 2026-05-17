/**
 * Analysis orchestrator — coordinates the full RCA pipeline:
 * Azure data retrieval → telemetry processing → pattern detection →
 * correlation → root cause identification → symptom classification →
 * AI reasoning → report generation.
 *
 * Implements timeout handling, graceful degradation, AI failure fallback,
 * and intelligent data sampling for large datasets.
 *
 * Requirements: 8.1, 8.5, 9.1, 9.3, 9.4, 10.1, 10.4, 10.5
 */

import { ApplicationInsightsClient } from '../azure/applicationInsightsClient';
import { TelemetryNormalizer, NormalizedTelemetry } from '../telemetry/normalizer';
import { DataFilter } from '../telemetry/dataFilter';
import { TimeSeriesBuilder } from '../telemetry/timeSeriesBuilder';
import { BaselineCalculator } from '../telemetry/baselineCalculator';
import { AnomalyDetector } from '../analysis/anomalyDetector';
import { SpikeDetector } from '../analysis/spikeDetector';
import { SeverityRanker } from '../analysis/severityRanker';
import { TemporalCorrelator } from '../correlation/temporalCorrelator';
import { CausalGraphBuilder } from '../correlation/causalGraphBuilder';
import { PropagationAnalyzer } from '../correlation/propagationAnalyzer';
import { CausalAnalyzer } from '../rootcause/causalAnalyzer';
import { EvidenceScorer } from '../rootcause/evidenceScorer';
import { DeploymentCorrelator } from '../rootcause/deploymentCorrelator';
import { ResourceAnalyzer } from '../rootcause/resourceAnalyzer';
import { ExceptionGrouper } from '../rootcause/exceptionGrouper';
import { SymptomDetector } from '../symptoms/symptomDetector';
import { CascadeAnalyzer } from '../symptoms/cascadeAnalyzer';
import { ReasoningEngine } from '../ai/reasoningEngine';
import { RecommendationGenerator } from '../ai/recommendationGenerator';
import { ReportFormatter, ReportInput } from '../report/reportFormatter';
import { MarkdownRenderer } from '../report/markdownRenderer';
import { ParsedQuery } from './queryParser';
import { TelemetryEvent, DeploymentEvent } from '../types/telemetry';
import { Anomaly, CausalGraph, RootCause, Symptom, Recommendation } from '../types/analysis';
import { IncidentReport, Evidence } from '../types/report';
import { AnalysisTimeoutError } from '../errors';
import { logger } from '../errors/logger';

/** Configuration for the analysis orchestrator */
export interface OrchestratorConfig {
  /** Azure Application Insights resource ID */
  resourceId: string;
  /** Analysis timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Threshold for data prioritization (default: 10000) */
  prioritizationThreshold?: number;
  /** Threshold for intelligent sampling (default: 50000) */
  samplingThreshold?: number;
}

/** Dependencies injected into the orchestrator */
export interface OrchestratorDependencies {
  azureClient: ApplicationInsightsClient;
  normalizer: TelemetryNormalizer;
  dataFilter: DataFilter;
  timeSeriesBuilder: TimeSeriesBuilder;
  baselineCalculator: BaselineCalculator;
  anomalyDetector: AnomalyDetector;
  spikeDetector: SpikeDetector;
  severityRanker: SeverityRanker;
  temporalCorrelator: TemporalCorrelator;
  causalGraphBuilder: CausalGraphBuilder;
  propagationAnalyzer: PropagationAnalyzer;
  causalAnalyzer: CausalAnalyzer;
  evidenceScorer: EvidenceScorer;
  deploymentCorrelator: DeploymentCorrelator;
  resourceAnalyzer: ResourceAnalyzer;
  exceptionGrouper: ExceptionGrouper;
  symptomDetector: SymptomDetector;
  cascadeAnalyzer: CascadeAnalyzer;
  reasoningEngine: ReasoningEngine;
  recommendationGenerator: RecommendationGenerator;
  reportFormatter: ReportFormatter;
  markdownRenderer: MarkdownRenderer;
}

/** Severity weight for prioritization */
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  error: 3,
  warning: 2,
};

export class AnalysisOrchestrator {
  private deps: OrchestratorDependencies;
  private config: Required<OrchestratorConfig>;

  constructor(deps: OrchestratorDependencies, config: OrchestratorConfig) {
    this.deps = deps;
    this.config = {
      resourceId: config.resourceId,
      timeoutMs: config.timeoutMs ?? 60_000,
      prioritizationThreshold: config.prioritizationThreshold ?? 10_000,
      samplingThreshold: config.samplingThreshold ?? 50_000,
    };
  }

  /**
   * Execute the full analysis pipeline for a parsed query.
   * Coordinates all modules with timeout handling, graceful degradation,
   * and AI failure fallback.
   */
  async executeAnalysis(query: ParsedQuery): Promise<IncidentReport> {
    const startTime = Date.now();
    logger.info('Starting analysis', { query: query.rawQuery, timeRange: query.timeRange });

    return this.withTimeout(async () => {
      // Step 1: Retrieve telemetry data from Azure
      const { telemetry, limitations } = await this.retrieveTelemetry(query);
      this.checkTimeout(startTime);

      // Step 2: Process and normalize telemetry
      let events = telemetry.events;

      // Step 3: Apply data prioritization / sampling for large datasets
      events = this.applyDataManagement(events, query);
      this.checkTimeout(startTime);

      // Step 4: Build time series and baseline
      const timeSeries = this.deps.timeSeriesBuilder.buildTimeSeries(events, '5m');
      const baseline = this.deps.baselineCalculator.calculateBaseline(
        'errorRate',
        timeSeries,
        'mean',
      );

      // Step 5: Pattern detection
      const anomalies = this.deps.anomalyDetector.detectAnomalies(timeSeries, baseline, 3);
      const rankedAnomalies = this.deps.severityRanker.rankAnomaliesBySeverity(anomalies);
      this.checkTimeout(startTime);

      // Step 6: Correlation analysis
      const correlatedGroups = this.deps.temporalCorrelator.correlateTemporal(events);
      const causalGraph = this.deps.causalGraphBuilder.buildCausalGraph(correlatedGroups);
      this.checkTimeout(startTime);

      // Step 7: Root cause identification
      const rootCauses = this.deps.causalAnalyzer.identifyRootCauses(
        causalGraph,
        rankedAnomalies,
        telemetry.deployments,
      );
      this.checkTimeout(startTime);

      // Step 8: Symptom classification
      const symptoms = this.deps.cascadeAnalyzer.identifySymptoms(causalGraph, rootCauses);
      this.checkTimeout(startTime);

      // Step 9: AI reasoning (with fallback)
      const { explanation, recommendations } = await this.performAIAnalysis(
        query,
        rankedAnomalies,
        correlatedGroups,
        rootCauses,
        symptoms,
        telemetry,
        limitations,
      );
      this.checkTimeout(startTime);

      // Step 10: Build evidence
      const evidence = this.buildEvidence(rankedAnomalies, telemetry, limitations);

      // Step 11: Generate report
      const affectedServices = this.extractAffectedServices(events, query);
      const summary = explanation || this.buildDefaultSummary(rootCauses, affectedServices);

      const reportInput: ReportInput = {
        incidentId: `incident-${Date.now()}`,
        summary,
        timeRange: query.timeRange,
        affectedServices,
        events,
        rootCauses,
        symptoms,
        recommendations,
        evidence,
      };

      return this.deps.reportFormatter.generateReport(reportInput);
    });
  }

  /**
   * Retrieve telemetry data from Azure with graceful degradation.
   * If some data types fail to retrieve, proceeds with available data
   * and notes limitations.
   */
  private async retrieveTelemetry(
    query: ParsedQuery,
  ): Promise<{ telemetry: NormalizedTelemetry; limitations: string[] }> {
    const { resourceId } = this.config;
    const { timeRange, serviceNames } = query;
    const filters = serviceNames.length > 0 ? { serviceNames } : undefined;
    const limitations: string[] = [];

    let exceptions: unknown[] = [];
    let requests: unknown[] = [];
    let dependencies: unknown[] = [];
    let deployments: unknown[] = [];

    // Retrieve each data type independently for graceful degradation
    try {
      exceptions = await this.deps.azureClient.getExceptions(resourceId, timeRange, filters);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('Failed to retrieve exceptions', { error: msg });
      limitations.push('Exception data unavailable');
    }

    try {
      requests = await this.deps.azureClient.getRequestMetrics(resourceId, timeRange, filters);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('Failed to retrieve request metrics', { error: msg });
      limitations.push('Request metrics unavailable');
    }

    try {
      dependencies = await this.deps.azureClient.getDependencyMetrics(resourceId, timeRange, filters);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('Failed to retrieve dependency metrics', { error: msg });
      limitations.push('Dependency metrics unavailable');
    }

    try {
      deployments = await this.deps.azureClient.getDeploymentEvents(resourceId, timeRange);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('Failed to retrieve deployment events', { error: msg });
      limitations.push('Deployment event data unavailable');
    }

    const telemetry = this.deps.normalizer.normalize({
      exceptions,
      requests,
      dependencies,
      deployments,
    });

    // Filter by service if specified
    const filtered = serviceNames.length > 0
      ? this.deps.dataFilter.filterByService(telemetry, serviceNames)
      : telemetry;

    return { telemetry: filtered, limitations };
  }

  /**
   * Apply data prioritization for >10,000 events and intelligent
   * stratified sampling for >50,000 events.
   */
  private applyDataManagement(events: TelemetryEvent[], query: ParsedQuery): TelemetryEvent[] {
    if (events.length <= this.config.prioritizationThreshold) {
      return events;
    }

    if (events.length > this.config.samplingThreshold) {
      logger.info('Applying stratified sampling', { eventCount: events.length });
      return this.stratifiedSample(events);
    }

    logger.info('Applying data prioritization', { eventCount: events.length });
    return this.prioritizeEvents(events, query);
  }

  /**
   * Prioritize events by severity and temporal proximity to the incident window center.
   * Keeps the top prioritizationThreshold events.
   */
  private prioritizeEvents(events: TelemetryEvent[], query: ParsedQuery): TelemetryEvent[] {
    const midpoint = (query.timeRange.start.getTime() + query.timeRange.end.getTime()) / 2;
    const halfWindow = (query.timeRange.end.getTime() - query.timeRange.start.getTime()) / 2 || 1;

    const scored = events.map((event) => {
      const severityScore = this.getEventSeverityWeight(event);
      const temporalDistance = Math.abs(event.timestamp.getTime() - midpoint);
      const temporalScore = 1 - Math.min(temporalDistance / halfWindow, 1);
      return { event, score: severityScore * 0.6 + temporalScore * 0.4 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.prioritizationThreshold).map((s) => s.event);
  }

  /**
   * Stratified sampling for very large datasets (>50,000 events).
   * Maintains representation of all event types by sampling proportionally
   * from each type, capped at prioritizationThreshold total events.
   */
  private stratifiedSample(events: TelemetryEvent[]): TelemetryEvent[] {
    const targetSize = this.config.prioritizationThreshold;
    const byType = new Map<string, TelemetryEvent[]>();

    for (const event of events) {
      const key = event.eventType;
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(event);
    }

    const sampled: TelemetryEvent[] = [];
    const typeCount = byType.size || 1;

    for (const [, typeEvents] of byType) {
      // Proportional allocation based on type frequency
      const proportion = typeEvents.length / events.length;
      const sampleSize = Math.max(1, Math.round(proportion * targetSize));

      if (typeEvents.length <= sampleSize) {
        sampled.push(...typeEvents);
      } else {
        // Uniform sampling within each type
        const step = typeEvents.length / sampleSize;
        for (let i = 0; i < sampleSize; i++) {
          sampled.push(typeEvents[Math.floor(i * step)]);
        }
      }
    }

    // Sort by timestamp to maintain chronological order
    return sampled.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Perform AI analysis with fallback to raw telemetry on failure.
   */
  private async performAIAnalysis(
    query: ParsedQuery,
    anomalies: Anomaly[],
    correlatedGroups: ReturnType<TemporalCorrelator['correlateTemporal']>,
    rootCauses: RootCause[],
    symptoms: Symptom[],
    telemetry: NormalizedTelemetry,
    limitations: string[],
  ): Promise<{ explanation: string; recommendations: Recommendation[] }> {
    const affectedServices = this.extractAffectedServices(telemetry.events, query);
    const severity = anomalies.length > 0
      ? anomalies[0].severity
      : 'unknown';

    try {
      const aiResult = await this.deps.reasoningEngine.analyzeIncident({
        timeRange: query.timeRange,
        affectedServices,
        severity,
        anomalies,
        correlations: correlatedGroups,
        rootCauseCandidates: rootCauses,
        symptoms,
      });

      let explanation = aiResult.explanation;
      if (limitations.length > 0) {
        explanation += `\n\nNote: Analysis performed with limited data. ${limitations.join('. ')}.`;
      }

      return { explanation, recommendations: aiResult.recommendations };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('AI reasoning failed, returning raw telemetry fallback', { error: msg });

      // Fallback: generate recommendations without AI
      const recommendations = this.deps.recommendationGenerator.generateRecommendations(
        rootCauses,
        { affectedServices },
      );
      const prioritized = this.deps.recommendationGenerator.prioritizeRecommendations(
        recommendations,
      );

      const explanation =
        `AI analysis unavailable (${msg}). ` +
        `Raw telemetry: ${telemetry.events.length} events, ` +
        `${telemetry.exceptions.length} exceptions, ` +
        `${telemetry.requests.length} requests, ` +
        `${telemetry.dependencies.length} dependencies.` +
        (limitations.length > 0 ? ` Limitations: ${limitations.join('. ')}.` : '');

      return { explanation, recommendations: prioritized };
    }
  }

  /** Build supporting evidence from analysis results */
  private buildEvidence(
    anomalies: Anomaly[],
    telemetry: NormalizedTelemetry,
    limitations: string[],
  ): Evidence[] {
    const evidence: Evidence[] = [];

    for (const anomaly of anomalies.slice(0, 10)) {
      evidence.push({
        type: 'metric',
        description: `${anomaly.severity} anomaly in ${anomaly.metricName}: observed=${anomaly.observedValue}, expected=${anomaly.expectedValue}`,
        data: anomaly,
      });
    }

    for (const deployment of telemetry.deployments) {
      evidence.push({
        type: 'deployment',
        description: `Deployment ${deployment.version} by ${deployment.deployedBy} at ${deployment.timestamp.toISOString()}`,
        data: deployment,
      });
    }

    if (limitations.length > 0) {
      evidence.push({
        type: 'log',
        description: `Data limitations: ${limitations.join('; ')}`,
        data: { limitations },
      });
    }

    return evidence;
  }

  /** Extract unique affected service names from events and query */
  private extractAffectedServices(events: TelemetryEvent[], query: ParsedQuery): string[] {
    const services = new Set<string>(query.serviceNames);
    for (const event of events) {
      if (event.serviceName) services.add(event.serviceName);
    }
    return [...services];
  }

  /** Build a default summary when AI explanation is unavailable */
  private buildDefaultSummary(rootCauses: RootCause[], affectedServices: string[]): string {
    if (rootCauses.length === 0) {
      return `Analysis of ${affectedServices.length} service(s) found no definitive root cause.`;
    }
    const primary = rootCauses[0];
    return `${primary.category} issue identified in ${primary.event.serviceName} with ${(primary.confidence * 100).toFixed(0)}% confidence. ${affectedServices.length} service(s) affected.`;
  }

  /** Get severity weight for an event for prioritization scoring */
  private getEventSeverityWeight(event: TelemetryEvent): number {
    if (event.eventType === 'exception') {
      const severity = (event as any).severity as string | undefined;
      return (severity && SEVERITY_WEIGHT[severity]) || 2;
    }
    if (event.eventType === 'request') {
      return (event as any).success === false ? 3 : 1;
    }
    if (event.eventType === 'dependency') {
      return (event as any).success === false ? 3 : 1;
    }
    if (event.eventType === 'deployment') return 2;
    return 1;
  }

  /**
   * Wrap an async operation with a configurable timeout.
   * Throws AnalysisTimeoutError if the operation exceeds the limit.
   */
  private async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new AnalysisTimeoutError(
            `Analysis exceeded timeout of ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
          ),
        );
      }, this.config.timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Check if the elapsed time exceeds the timeout and throw if so.
   * Used for intermediate checkpoints within the pipeline.
   */
  private checkTimeout(startTime: number): void {
    const elapsed = Date.now() - startTime;
    if (elapsed >= this.config.timeoutMs) {
      throw new AnalysisTimeoutError(
        `Analysis exceeded timeout of ${this.config.timeoutMs}ms at checkpoint (elapsed: ${elapsed}ms)`,
        this.config.timeoutMs,
      );
    }
  }
}
