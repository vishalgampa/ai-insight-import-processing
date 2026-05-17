/**
 * Live demo — queries real Azure Application Insights data via REST API
 * using Application ID + API Key authentication, then runs the full RCA pipeline.
 *
 * Usage: npx ts-node demo-live.ts
 *
 * Environment variables (or edit the constants below):
 *   APP_INSIGHTS_APP_ID   — Application Insights Application ID
 *   APP_INSIGHTS_API_KEY  — Application Insights API Key (read access)
 */

import https from 'https';
import { TelemetryNormalizer } from './src/telemetry/normalizer';
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
import { formatResponse } from './src/query/responseFormatter';
import { parseQuery } from './src/query/queryParser';

// ── Configuration ──────────────────────────────────────────────────────────
const APP_ID  = process.env.APP_INSIGHTS_APP_ID  || '[app_id]';
const API_KEY = process.env.APP_INSIGHTS_API_KEY || '[api_key]';
// NOTE: Set environment variables instead of hardcoding credentials:
//   APP_INSIGHTS_APP_ID=your-app-id APP_INSIGHTS_API_KEY=your-key npx ts-node demo-live.ts

const BASE_URL = 'api.applicationinsights.io';
const TIME_SPAN = 'P7D'; // last 7 days

// ── REST API helper ────────────────────────────────────────────────────────

function queryAppInsights(kustoQuery: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: kustoQuery, timespan: TIME_SPAN });
    const options: https.RequestOptions = {
      hostname: BASE_URL,
      path: `/v1/apps/${APP_ID}/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          const table = json.tables?.[0];
          if (!table) return resolve([]);
          const cols = table.columns.map((c: any) => c.name);
          const rows = table.rows.map((row: any[]) => {
            const record: Record<string, unknown> = {};
            cols.forEach((col: string, i: number) => (record[col] = row[i]));
            return record;
          });
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Row mappers (REST API → our domain types) ─────────────────────────────

function mapException(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''),
    serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'exception' as const,
    exceptionType: String(row['type'] ?? row['problemId'] ?? ''),
    message: String(row['outerMessage'] ?? row['message'] ?? ''),
    stackTrace: String(row['details'] ?? ''),
    severity: Number(row['severityLevel'] ?? 2) >= 4 ? 'critical' as const
      : Number(row['severityLevel'] ?? 2) >= 3 ? 'error' as const : 'warning' as const,
    properties: {},
  };
}

function mapRequest(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''),
    serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'request' as const,
    operationName: String(row['name'] ?? ''),
    duration: Number(row['duration'] ?? 0),
    responseCode: Number(row['resultCode'] ?? 0),
    success: row['success'] === true || row['success'] === 'True',
    properties: {},
  };
}

function mapDependency(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''),
    serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'dependency' as const,
    dependencyName: String(row['name'] ?? row['target'] ?? ''),
    dependencyType: String(row['type'] ?? ''),
    duration: Number(row['duration'] ?? 0),
    success: row['success'] === true || row['success'] === 'True',
    properties: {},
  };
}

// ── Trace mapper ───────────────────────────────────────────────────────────

function mapTrace(row: Record<string, unknown>) {
  const severityLevel = Number(row['severityLevel'] ?? 1);
  // Treat warning+ traces as pseudo-exceptions for analysis
  const isError = severityLevel >= 3;
  return {
    timestamp: String(row['timestamp'] ?? ''),
    serviceName: String(row['cloud_RoleName'] ?? row['appName'] ?? 'unknown'),
    eventType: isError ? 'exception' as const : 'request' as const,
    // Exception-like fields
    exceptionType: isError ? String(row['message'] ?? '').substring(0, 80) : undefined,
    message: String(row['message'] ?? ''),
    stackTrace: '',
    severity: severityLevel >= 4 ? 'critical' as const
      : severityLevel >= 3 ? 'error' as const : 'warning' as const,
    // Request-like fields
    operationName: String(row['operation_Name'] ?? row['message'] ?? '').substring(0, 100),
    duration: 0,
    responseCode: isError ? 500 : 200,
    success: !isError,
    properties: {},
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== AI-Powered RCA Assistant — Live Demo ===\n');
  console.log(`Application ID: ${APP_ID}`);
  console.log(`Time span: ${TIME_SPAN}\n`);

  // 1. Discover what data exists
  console.log('Discovering available telemetry tables...\n');

  const countQuery = `
    let e = exceptions | count | extend table='exceptions';
    let r = requests | count | extend table='requests';
    let d = dependencies | count | extend table='dependencies';
    let t = traces | count | extend table='traces';
    let ce = customEvents | count | extend table='customEvents';
    union e, r, d, t, ce
  `;

  try {
    const counts = await queryAppInsights(countQuery);
    for (const row of counts) {
      console.log(`  ${row['table']}: ${row['Count']} records`);
    }
    console.log();
  } catch (e: any) {
    console.log(`  ⚠ Discovery query failed: ${e.message}\n`);
  }

  // 2. Fetch telemetry from all available tables
  console.log('Fetching telemetry from Azure Application Insights...\n');

  const [exceptionRows, requestRows, dependencyRows, traceRows] = await Promise.all([
    queryAppInsights('exceptions | order by timestamp desc | take 500').catch((e) => {
      console.log(`  ⚠ Exceptions: ${e.message}`);
      return [] as any[];
    }),
    queryAppInsights('requests | order by timestamp desc | take 500').catch((e) => {
      console.log(`  ⚠ Requests: ${e.message}`);
      return [] as any[];
    }),
    queryAppInsights('dependencies | order by timestamp desc | take 500').catch((e) => {
      console.log(`  ⚠ Dependencies: ${e.message}`);
      return [] as any[];
    }),
    queryAppInsights('traces | where severityLevel >= 2 | order by timestamp desc | take 500').catch((e) => {
      console.log(`  ⚠ Traces: ${e.message}`);
      return [] as any[];
    }),
  ]);

  const exceptions = exceptionRows.map(mapException);
  const requests = requestRows.map(mapRequest);
  const dependencies = dependencyRows.map(mapDependency);
  const traceMapped = traceRows.map(mapTrace);

  // Split traces into pseudo-exceptions and pseudo-requests
  const traceExceptions = traceMapped.filter((t) => t.eventType === 'exception');
  const traceRequests = traceMapped.filter((t) => t.eventType === 'request');

  const allExceptions = [...exceptions, ...traceExceptions];
  const allRequests = [...requests, ...traceRequests];

  console.log(`Fetched: ${exceptions.length} exceptions, ${requests.length} requests, ${dependencies.length} dependencies, ${traceRows.length} traces (${traceExceptions.length} error-level, ${traceRequests.length} info-level)\n`);

  if (allExceptions.length === 0 && allRequests.length === 0 && dependencies.length === 0) {
    console.log('No telemetry data found. Check your Application ID and API key, or try a wider time range.');
    return;
  }

  // 3. Normalize
  const normalizer = new TelemetryNormalizer();
  const telemetry = normalizer.normalize({
    exceptions: allExceptions,
    requests: allRequests,
    dependencies,
    deployments: [],
  });
  console.log(`Normalized: ${telemetry.events.length} total events\n`);

  // 4. Build time series & baseline
  const tsBuilder = new TimeSeriesBuilder();
  const timeSeries = tsBuilder.buildTimeSeries(telemetry.events, '5m');
  const baselineCalc = new BaselineCalculator();
  const baseline = baselineCalc.calculateBaseline('errorRate', timeSeries, 'mean');
  console.log(`Baseline: mean=${baseline.mean.toFixed(2)}, stdDev=${baseline.standardDeviation.toFixed(2)}`);

  // 5. Detect anomalies
  const anomalyDetector = new AnomalyDetector();
  const anomalies = anomalyDetector.detectAnomalies(timeSeries, baseline, 2);
  const ranker = new SeverityRanker();
  const ranked = ranker.rankAnomaliesBySeverity(anomalies);
  console.log(`Anomalies detected: ${ranked.length}`);

  // 6. Correlate events
  const correlator = new TemporalCorrelator();
  const groups = correlator.correlateTemporal(telemetry.events);
  console.log(`Correlated groups: ${groups.length}`);

  // 7. Build causal graph
  const graphBuilder = new CausalGraphBuilder();
  const causalGraph = graphBuilder.buildCausalGraph(groups);
  console.log(`Causal graph: ${causalGraph.nodes.length} nodes, ${causalGraph.edges.length} edges`);

  // 8. Identify root causes
  const causalAnalyzer = new CausalAnalyzer();
  const rootCauses = causalAnalyzer.identifyRootCauses(causalGraph, ranked, []);
  console.log(`\nRoot causes identified: ${rootCauses.length}`);
  for (const rc of rootCauses) {
    console.log(`  - [${rc.category}] ${rc.explanation} (confidence: ${(rc.confidence * 100).toFixed(0)}%)`);
  }

  // 9. Classify symptoms
  const cascadeAnalyzer = new CascadeAnalyzer();
  const symptoms = cascadeAnalyzer.identifySymptoms(causalGraph, rootCauses);
  console.log(`\nSymptoms: ${symptoms.length}`);
  for (const s of symptoms) {
    console.log(`  - ${s.description}`);
  }

  // 10. Generate recommendations
  const recGen = new RecommendationGenerator();
  const affectedServices = [...new Set(telemetry.events.map((e) => e.serviceName))];
  const recommendations = recGen.generateRecommendations(rootCauses, { affectedServices });
  const prioritized = recGen.prioritizeRecommendations(recommendations);
  console.log(`\nRecommendations (${prioritized.length}):`);
  for (const r of prioritized) {
    console.log(`  ${r.priority}. ${r.action}`);
  }

  // 11. Generate report
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const reportFormatter = new ReportFormatter(new TimelineBuilder());
  const report = reportFormatter.generateReport({
    incidentId: `INC-${now.toISOString().slice(0, 10).replace(/-/g, '')}`,
    summary: rootCauses.length > 0
      ? rootCauses[0].explanation
      : 'No clear root cause identified from available telemetry.',
    timeRange: { start: dayAgo, end: now },
    affectedServices,
    events: telemetry.events,
    rootCauses,
    symptoms,
    recommendations: prioritized,
    evidence: [],
  });

  // 12. Render Markdown
  const mdRenderer = new MarkdownRenderer();
  const markdown = mdRenderer.renderAsMarkdown(report);
  console.log('\n=== Generated Markdown Report ===\n');
  console.log(markdown);

  // 13. Natural language response
  const query = parseQuery('What caused the recent issues?');
  const nlResponse = formatResponse(report, query);
  console.log('=== Natural Language Response ===\n');
  console.log(nlResponse);
}

main().catch((err) => {
  console.error('Fatal error:', err.message ?? err);
  process.exit(1);
});
