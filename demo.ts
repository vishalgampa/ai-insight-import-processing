/**
 * Demo script — runs the full RCA pipeline with mock data.
 * Usage: npx ts-node demo.ts
 */

import { TelemetryNormalizer } from './src/telemetry/normalizer';
import { DataFilter } from './src/telemetry/dataFilter';
import { TimeSeriesBuilder } from './src/telemetry/timeSeriesBuilder';
import { BaselineCalculator } from './src/telemetry/baselineCalculator';
import { AnomalyDetector } from './src/analysis/anomalyDetector';
import { SeverityRanker } from './src/analysis/severityRanker';
import { TemporalCorrelator } from './src/correlation/temporalCorrelator';
import { CausalGraphBuilder } from './src/correlation/causalGraphBuilder';
import { CausalAnalyzer } from './src/rootcause/causalAnalyzer';
import { CascadeAnalyzer } from './src/symptoms/cascadeAnalyzer';
import { RecommendationGenerator } from './src/ai/recommendationGenerator';
import { ReportFormatter } from './src/report/reportFormatter';
import { TimelineBuilder } from './src/report/timelineBuilder';
import { MarkdownRenderer } from './src/report/markdownRenderer';
import { parseQuery } from './src/query/queryParser';
import { formatResponse } from './src/query/responseFormatter';

// --- Simulate telemetry data for a database connection pool exhaustion incident ---

const rawTelemetry = {
  exceptions: [
    {
      timestamp: '2024-06-15T14:05:30Z',
      serviceName: 'db-service',
      eventType: 'exception',
      exceptionType: 'ConnectionPoolExhaustedException',
      message: 'All connections in the pool are in use',
      stackTrace: 'at DbPool.acquire() line 42\nat QueryRunner.execute() line 18',
      severity: 'critical',
      properties: {},
    },
    {
      timestamp: '2024-06-15T14:06:00Z',
      serviceName: 'api-service',
      eventType: 'exception',
      exceptionType: 'TimeoutException',
      message: 'Database query timed out after 30s',
      stackTrace: 'at ApiController.getUsers() line 55\nat DbClient.query() line 22',
      severity: 'error',
      properties: {},
    },
    {
      timestamp: '2024-06-15T14:06:15Z',
      serviceName: 'web-frontend',
      eventType: 'exception',
      exceptionType: 'HttpException',
      message: 'Upstream service returned 503',
      stackTrace: 'at FrontendProxy.fetch() line 30',
      severity: 'error',
      properties: {},
    },
  ],
  requests: [
    {
      timestamp: '2024-06-15T14:04:00Z',
      serviceName: 'api-service',
      eventType: 'request',
      operationName: 'GET /api/users',
      duration: 150,
      responseCode: 200,
      success: true,
      properties: {},
    },
    {
      timestamp: '2024-06-15T14:05:45Z',
      serviceName: 'api-service',
      eventType: 'request',
      operationName: 'GET /api/users',
      duration: 31000,
      responseCode: 504,
      success: false,
      properties: {},
    },
    {
      timestamp: '2024-06-15T14:06:10Z',
      serviceName: 'api-service',
      eventType: 'request',
      operationName: 'POST /api/orders',
      duration: 30500,
      responseCode: 504,
      success: false,
      properties: {},
    },
  ],
  dependencies: [
    {
      timestamp: '2024-06-15T14:05:25Z',
      serviceName: 'api-service',
      eventType: 'dependency',
      dependencyName: 'db-service',
      dependencyType: 'SQL',
      duration: 30000,
      success: false,
      properties: {},
    },
  ],
  deployments: [
    {
      timestamp: '2024-06-15T13:30:00Z',
      serviceName: 'db-service',
      eventType: 'deployment',
      deploymentId: 'deploy-789',
      version: 'v2.4.1',
      deployedBy: 'ci-pipeline',
      properties: {},
    },
  ],
};

// --- Run the pipeline ---

console.log('=== AI-Powered RCA Assistant — Demo ===\n');

// 1. Parse query
const query = parseQuery('What caused the API failures between 2pm and 3pm today?');
console.log('Query:', query.rawQuery);
console.log('Parsed time range:', query.timeRange.start.toISOString(), '→', query.timeRange.end.toISOString());
console.log('Incident type:', query.incidentType);
console.log();

// 2. Normalize telemetry
const normalizer = new TelemetryNormalizer();
const telemetry = normalizer.normalize(rawTelemetry);
console.log(`Normalized: ${telemetry.events.length} events (${telemetry.exceptions.length} exceptions, ${telemetry.requests.length} requests, ${telemetry.dependencies.length} dependencies, ${telemetry.deployments.length} deployments)`);
console.log();

// 3. Build time series & baseline
const tsBuilder = new TimeSeriesBuilder();
const timeSeries = tsBuilder.buildTimeSeries(telemetry.events, '5m');
const baselineCalc = new BaselineCalculator();
const baseline = baselineCalc.calculateBaseline('errorRate', timeSeries, 'mean');
console.log(`Baseline: mean=${baseline.mean.toFixed(2)}, stdDev=${baseline.standardDeviation.toFixed(2)}`);

// 4. Detect anomalies
const anomalyDetector = new AnomalyDetector();
const anomalies = anomalyDetector.detectAnomalies(timeSeries, baseline, 3);
const ranker = new SeverityRanker();
const ranked = ranker.rankAnomaliesBySeverity(anomalies);
console.log(`Anomalies detected: ${ranked.length}`);

// 5. Correlate events
const correlator = new TemporalCorrelator();
const groups = correlator.correlateTemporal(telemetry.events);
console.log(`Correlated groups: ${groups.length}`);

// 6. Build causal graph
const graphBuilder = new CausalGraphBuilder();
const causalGraph = graphBuilder.buildCausalGraph(groups);
console.log(`Causal graph: ${causalGraph.nodes.length} nodes, ${causalGraph.edges.length} edges`);

// 7. Identify root causes
const causalAnalyzer = new CausalAnalyzer();
const rootCauses = causalAnalyzer.identifyRootCauses(causalGraph, ranked, telemetry.deployments);
console.log(`Root causes identified: ${rootCauses.length}`);
for (const rc of rootCauses) {
  console.log(`  - [${rc.category}] ${rc.explanation} (confidence: ${(rc.confidence * 100).toFixed(0)}%)`);
}
console.log();

// 8. Classify symptoms
const cascadeAnalyzer = new CascadeAnalyzer();
const symptoms = cascadeAnalyzer.identifySymptoms(causalGraph, rootCauses);
console.log(`Symptoms identified: ${symptoms.length}`);
for (const s of symptoms) {
  console.log(`  - ${s.description}`);
}
console.log();

// 9. Generate recommendations (without LLM — rule-based)
const recGen = new RecommendationGenerator();
const recommendations = recGen.generateRecommendations(rootCauses, {
  affectedServices: ['db-service', 'api-service', 'web-frontend'],
});
const prioritized = recGen.prioritizeRecommendations(recommendations);
console.log(`Recommendations (${prioritized.length}):`);
for (const r of prioritized) {
  console.log(`  ${r.priority}. ${r.action}`);
}
console.log();

// 10. Generate report
const reportFormatter = new ReportFormatter(new TimelineBuilder());
const report = reportFormatter.generateReport({
  incidentId: 'INC-2024-0615-001',
  summary: 'API failures caused by database connection pool exhaustion following deployment v2.4.1 to db-service.',
  timeRange: query.timeRange,
  affectedServices: ['db-service', 'api-service', 'web-frontend'],
  events: telemetry.events,
  rootCauses,
  symptoms,
  recommendations: prioritized,
  evidence: [
    { type: 'metric', description: 'Connection pool usage at 100%', data: {} },
    { type: 'deployment', description: 'v2.4.1 deployed 35 minutes before incident', data: {} },
  ],
});

// 11. Render as Markdown
const mdRenderer = new MarkdownRenderer();
const markdown = mdRenderer.renderAsMarkdown(report);

console.log('=== Generated Markdown Report ===\n');
console.log(markdown);

// 12. Natural language response
console.log('=== Natural Language Response ===\n');
const nlResponse = formatResponse(report, query);
console.log(nlResponse);
