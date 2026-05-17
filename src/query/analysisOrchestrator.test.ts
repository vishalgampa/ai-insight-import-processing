/**
 * Unit tests for AnalysisOrchestrator using mocked dependencies.
 */

import { AnalysisOrchestrator, OrchestratorConfig, OrchestratorDependencies } from './analysisOrchestrator';
import { ParsedQuery } from './queryParser';
import { TelemetryEvent, Exception, DeploymentEvent } from '../types/telemetry';
import { NormalizedTelemetry } from '../telemetry/normalizer';
import { AnalysisTimeoutError } from '../errors';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    timestamp: new Date('2024-01-01T00:10:00Z'),
    eventType: 'exception',
    serviceName: 'api-service',
    properties: {},
    ...overrides,
  };
}

function makeQuery(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    timeRange: { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') },
    serviceNames: ['api-service'],
    incidentType: 'failure',
    rawQuery: 'What caused the API failures?',
    ...overrides,
  };
}

function makeNormalizedTelemetry(events: TelemetryEvent[] = []): NormalizedTelemetry {
  return {
    events,
    exceptions: events.filter((e) => e.eventType === 'exception') as Exception[],
    requests: [],
    dependencies: [],
    deployments: events.filter((e) => e.eventType === 'deployment') as DeploymentEvent[],
  };
}

function makeMockDeps(overrides: Partial<OrchestratorDependencies> = {}): OrchestratorDependencies {
  const events = [makeEvent()];
  const normalizedTelemetry = makeNormalizedTelemetry(events);

  return {
    azureClient: {
      getExceptions: jest.fn().mockResolvedValue([{ timestamp: '2024-01-01T00:10:00Z', exceptionType: 'NullRef', serviceName: 'api-service' }]),
      getRequestMetrics: jest.fn().mockResolvedValue([]),
      getDependencyMetrics: jest.fn().mockResolvedValue([]),
      getDeploymentEvents: jest.fn().mockResolvedValue([]),
    } as any,
    normalizer: {
      normalize: jest.fn().mockReturnValue(normalizedTelemetry),
    } as any,
    dataFilter: {
      filterByService: jest.fn().mockReturnValue(normalizedTelemetry),
    } as any,
    timeSeriesBuilder: {
      buildTimeSeries: jest.fn().mockReturnValue({ metricName: 'event_count', dataPoints: [{ timestamp: new Date(), value: 1 }] }),
    } as any,
    baselineCalculator: {
      calculateBaseline: jest.fn().mockReturnValue({ metricName: 'event_count', mean: 1, standardDeviation: 0.5, percentiles: {} }),
    } as any,
    anomalyDetector: {
      detectAnomalies: jest.fn().mockReturnValue([]),
    } as any,
    spikeDetector: {
      detectSpikes: jest.fn().mockReturnValue([]),
    } as any,
    severityRanker: {
      rankAnomaliesBySeverity: jest.fn().mockReturnValue([]),
    } as any,
    temporalCorrelator: {
      correlateTemporal: jest.fn().mockReturnValue([]),
    } as any,
    causalGraphBuilder: {
      buildCausalGraph: jest.fn().mockReturnValue({ nodes: events, edges: [] }),
    } as any,
    propagationAnalyzer: {} as any,
    causalAnalyzer: {
      identifyRootCauses: jest.fn().mockReturnValue([]),
    } as any,
    evidenceScorer: {} as any,
    deploymentCorrelator: {} as any,
    resourceAnalyzer: {} as any,
    exceptionGrouper: {} as any,
    symptomDetector: {} as any,
    cascadeAnalyzer: {
      identifySymptoms: jest.fn().mockReturnValue([]),
    } as any,
    reasoningEngine: {
      analyzeIncident: jest.fn().mockResolvedValue({
        explanation: 'AI analysis: NullRef in api-service',
        recommendations: [],
        rawResponse: '',
      }),
    } as any,
    recommendationGenerator: {
      generateRecommendations: jest.fn().mockReturnValue([]),
      prioritizeRecommendations: jest.fn().mockReturnValue([]),
    } as any,
    reportFormatter: {
      generateReport: jest.fn().mockImplementation((input: any) => ({
        incidentId: input.incidentId,
        summary: input.summary,
        timeRange: input.timeRange,
        affectedServices: input.affectedServices,
        timeline: { events: [] },
        rootCauses: input.rootCauses,
        symptoms: input.symptoms,
        recommendations: input.recommendations,
        supportingEvidence: input.evidence,
        generatedAt: new Date(),
      })),
    } as any,
    markdownRenderer: {
      renderAsMarkdown: jest.fn().mockReturnValue('# Report'),
    } as any,
    ...overrides,
  };
}


describe('AnalysisOrchestrator', () => {
  const config: OrchestratorConfig = {
    resourceId: 'test-resource-id',
    timeoutMs: 5000,
    prioritizationThreshold: 100,
    samplingThreshold: 500,
  };

  describe('executeAnalysis', () => {
    it('should coordinate the full pipeline and return a report', async () => {
      const deps = makeMockDeps();
      const orchestrator = new AnalysisOrchestrator(deps, config);
      const query = makeQuery();

      const report = await orchestrator.executeAnalysis(query);

      expect(report).toBeDefined();
      expect(report.incidentId).toBeDefined();
      expect(report.timeRange).toEqual(query.timeRange);
      expect(deps.azureClient.getExceptions).toHaveBeenCalled();
      expect(deps.normalizer.normalize).toHaveBeenCalled();
      expect(deps.timeSeriesBuilder.buildTimeSeries).toHaveBeenCalled();
      expect(deps.anomalyDetector.detectAnomalies).toHaveBeenCalled();
      expect(deps.temporalCorrelator.correlateTemporal).toHaveBeenCalled();
      expect(deps.causalGraphBuilder.buildCausalGraph).toHaveBeenCalled();
      expect(deps.causalAnalyzer.identifyRootCauses).toHaveBeenCalled();
      expect(deps.cascadeAnalyzer.identifySymptoms).toHaveBeenCalled();
      expect(deps.reasoningEngine.analyzeIncident).toHaveBeenCalled();
      expect(deps.reportFormatter.generateReport).toHaveBeenCalled();
    });

    it('should handle graceful degradation when some data retrieval fails', async () => {
      const deps = makeMockDeps({
        azureClient: {
          getExceptions: jest.fn().mockRejectedValue(new Error('Network error')),
          getRequestMetrics: jest.fn().mockResolvedValue([]),
          getDependencyMetrics: jest.fn().mockRejectedValue(new Error('Timeout')),
          getDeploymentEvents: jest.fn().mockResolvedValue([]),
        } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      const report = await orchestrator.executeAnalysis(makeQuery());

      expect(report).toBeDefined();
      // Should still produce a report despite partial data failures
      expect(deps.reportFormatter.generateReport).toHaveBeenCalled();
    });

    it('should fall back when AI reasoning fails', async () => {
      const deps = makeMockDeps({
        reasoningEngine: {
          analyzeIncident: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
        } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      const report = await orchestrator.executeAnalysis(makeQuery());

      expect(report).toBeDefined();
      expect(report.summary).toContain('AI analysis unavailable');
      expect(deps.recommendationGenerator.generateRecommendations).toHaveBeenCalled();
    });

    it('should throw AnalysisTimeoutError when timeout is exceeded', async () => {
      const deps = makeMockDeps({
        azureClient: {
          getExceptions: jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000))),
          getRequestMetrics: jest.fn().mockResolvedValue([]),
          getDependencyMetrics: jest.fn().mockResolvedValue([]),
          getDeploymentEvents: jest.fn().mockResolvedValue([]),
        } as any,
      });
      const shortTimeoutConfig = { ...config, timeoutMs: 50 };
      const orchestrator = new AnalysisOrchestrator(deps, shortTimeoutConfig);

      await expect(orchestrator.executeAnalysis(makeQuery())).rejects.toThrow(AnalysisTimeoutError);
    });

    it('should apply data prioritization for large datasets', async () => {
      // Create >100 events (our test prioritizationThreshold)
      const manyEvents = Array.from({ length: 150 }, (_, i) =>
        makeEvent({ timestamp: new Date(`2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`) }),
      );
      const telemetry = makeNormalizedTelemetry(manyEvents);

      const deps = makeMockDeps({
        normalizer: { normalize: jest.fn().mockReturnValue(telemetry) } as any,
        dataFilter: { filterByService: jest.fn().mockReturnValue(telemetry) } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      const report = await orchestrator.executeAnalysis(makeQuery());
      expect(report).toBeDefined();
      // The time series builder should receive a reduced set of events
      const tsCall = (deps.timeSeriesBuilder.buildTimeSeries as jest.Mock).mock.calls[0];
      expect(tsCall[0].length).toBeLessThanOrEqual(config.prioritizationThreshold!);
    });

    it('should apply stratified sampling for very large datasets', async () => {
      // Create >500 events (our test samplingThreshold)
      const manyEvents = Array.from({ length: 600 }, (_, i) =>
        makeEvent({
          timestamp: new Date(`2024-01-01T00:${String(i % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`),
          eventType: i % 3 === 0 ? 'exception' : i % 3 === 1 ? 'request' : 'dependency',
        }),
      );
      const telemetry = makeNormalizedTelemetry(manyEvents);

      const deps = makeMockDeps({
        normalizer: { normalize: jest.fn().mockReturnValue(telemetry) } as any,
        dataFilter: { filterByService: jest.fn().mockReturnValue(telemetry) } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      const report = await orchestrator.executeAnalysis(makeQuery());
      expect(report).toBeDefined();
    });

    it('should include affected services from events and query', async () => {
      const events = [
        makeEvent({ serviceName: 'api-service' }),
        makeEvent({ serviceName: 'db-service' }),
      ];
      const telemetry = makeNormalizedTelemetry(events);

      const deps = makeMockDeps({
        normalizer: { normalize: jest.fn().mockReturnValue(telemetry) } as any,
        dataFilter: { filterByService: jest.fn().mockReturnValue(telemetry) } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      await orchestrator.executeAnalysis(makeQuery({ serviceNames: ['api-service'] }));

      const reportCall = (deps.reportFormatter.generateReport as jest.Mock).mock.calls[0][0];
      expect(reportCall.affectedServices).toContain('api-service');
      expect(reportCall.affectedServices).toContain('db-service');
    });

    it('should handle empty telemetry gracefully', async () => {
      const emptyTelemetry = makeNormalizedTelemetry([]);
      const deps = makeMockDeps({
        normalizer: { normalize: jest.fn().mockReturnValue(emptyTelemetry) } as any,
        dataFilter: { filterByService: jest.fn().mockReturnValue(emptyTelemetry) } as any,
        causalGraphBuilder: { buildCausalGraph: jest.fn().mockReturnValue({ nodes: [], edges: [] }) } as any,
      });
      const orchestrator = new AnalysisOrchestrator(deps, config);

      const report = await orchestrator.executeAnalysis(makeQuery());
      expect(report).toBeDefined();
    });
  });
});
