/**
 * Express API server for the RCA Assistant frontend.
 * Usage: npx ts-node server.ts
 * Then open http://localhost:3000
 */
import express from 'express';
import https from 'https';
import path from 'path';
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
import { LLMClient } from './src/ai/llmClient';
import { PromptBuilder } from './src/ai/promptBuilder';
import { ReasoningEngine } from './src/ai/reasoningEngine';
import { ReportFormatter } from './src/report/reportFormatter';
import { TimelineBuilder } from './src/report/timelineBuilder';
import { MarkdownRenderer } from './src/report/markdownRenderer';
import { formatResponse } from './src/query/responseFormatter';
import { parseQuery } from './src/query/queryParser';
import { ImportOrchestrator } from './src/imports/importOrchestrator';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── App Insights REST helper ───────────────────────────────────────────────

function queryAppInsights(appId: string, apiKey: string, kustoQuery: string, timespan: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: kustoQuery, timespan });
    const options: https.RequestOptions = {
      hostname: 'api.applicationinsights.io',
      path: `/v1/apps/${appId}/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const table = json.tables?.[0];
          if (!table) return resolve([]);
          const cols = table.columns.map((c: any) => c.name);
          resolve(table.rows.map((row: any[]) => {
            const rec: Record<string, unknown> = {};
            cols.forEach((col: string, i: number) => (rec[col] = row[i]));
            return rec;
          }));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Row mappers ────────────────────────────────────────────────────────────

function mapException(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''), serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'exception' as const, exceptionType: String(row['type'] ?? row['problemId'] ?? ''),
    message: String(row['outerMessage'] ?? row['message'] ?? ''), stackTrace: String(row['details'] ?? ''),
    severity: Number(row['severityLevel'] ?? 2) >= 4 ? 'critical' as const : Number(row['severityLevel'] ?? 2) >= 3 ? 'error' as const : 'warning' as const,
    properties: {},
  };
}
function mapRequest(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''), serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'request' as const, operationName: String(row['name'] ?? ''),
    duration: Number(row['duration'] ?? 0), responseCode: Number(row['resultCode'] ?? 0),
    success: row['success'] === true || row['success'] === 'True', properties: {},
  };
}
function mapDependency(row: Record<string, unknown>) {
  return {
    timestamp: String(row['timestamp'] ?? ''), serviceName: String(row['cloud_RoleName'] ?? 'unknown'),
    eventType: 'dependency' as const, dependencyName: String(row['name'] ?? row['target'] ?? ''),
    dependencyType: String(row['type'] ?? ''), duration: Number(row['duration'] ?? 0),
    success: row['success'] === true || row['success'] === 'True', properties: {},
  };
}
function mapTrace(row: Record<string, unknown>) {
  const sev = Number(row['severityLevel'] ?? 1);
  const isError = sev >= 3;
  return {
    timestamp: String(row['timestamp'] ?? ''), serviceName: String(row['cloud_RoleName'] ?? row['appName'] ?? 'unknown'),
    eventType: isError ? 'exception' as const : 'request' as const,
    exceptionType: isError ? String(row['message'] ?? '').substring(0, 80) : undefined,
    message: String(row['message'] ?? ''), stackTrace: '',
    severity: sev >= 4 ? 'critical' as const : sev >= 3 ? 'error' as const : 'warning' as const,
    operationName: String(row['operation_Name'] ?? row['message'] ?? '').substring(0, 100),
    duration: 0, responseCode: isError ? 500 : 200, success: !isError, properties: {},
  };
}

// ── API endpoint ───────────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  try {
    const { appId, apiKey, geminiApiKey, timespan = 'P7D', query: userQuery = 'What caused the recent issues?' } = req.body;
    if (!appId || !apiKey) return res.status(400).json({ error: 'appId and apiKey are required' });

    const steps: any[] = [];
    const addStep = (name: string, detail: any) => steps.push({ name, ...detail });

    // 1. Discover tables
    let tableCounts: Record<string, number> = {};
    try {
      const countQuery = `
        let e = exceptions | count | extend table='exceptions';
        let r = requests | count | extend table='requests';
        let d = dependencies | count | extend table='dependencies';
        let t = traces | count | extend table='traces';
        union e, r, d, t`;
      const counts = await queryAppInsights(appId, apiKey, countQuery, timespan);
      for (const row of counts) tableCounts[String(row['table'])] = Number(row['Count'] ?? 0);
    } catch {}
    addStep('Discovery', { tableCounts });

    // 2. Fetch data
    const [exRows, reqRows, depRows, trRows] = await Promise.all([
      queryAppInsights(appId, apiKey, 'exceptions | order by timestamp desc | take 500', timespan).catch(() => []),
      queryAppInsights(appId, apiKey, 'requests | order by timestamp desc | take 500', timespan).catch(() => []),
      queryAppInsights(appId, apiKey, 'dependencies | order by timestamp desc | take 500', timespan).catch(() => []),
      queryAppInsights(appId, apiKey, 'traces | where severityLevel >= 2 | order by timestamp desc | take 500', timespan).catch(() => []),
    ]);

    const exceptions = exRows.map(mapException);
    const requests = reqRows.map(mapRequest);
    const dependencies = depRows.map(mapDependency);
    const traces = trRows.map(mapTrace);
    const traceExceptions = traces.filter(t => t.eventType === 'exception');
    const traceRequests = traces.filter(t => t.eventType === 'request');

    addStep('Fetch', {
      exceptions: exceptions.length, requests: requests.length,
      dependencies: dependencies.length, traces: trRows.length,
      traceErrors: traceExceptions.length, traceInfo: traceRequests.length,
    });

    const allExceptions = [...exceptions, ...traceExceptions];
    const allRequests = [...requests, ...traceRequests];

    if (allExceptions.length === 0 && allRequests.length === 0 && dependencies.length === 0) {
      return res.json({ steps, error: 'No telemetry data found for the given time range.' });
    }

    // 3. Normalize
    const normalizer = new TelemetryNormalizer();
    const telemetry = normalizer.normalize({ exceptions: allExceptions, requests: allRequests, dependencies, deployments: [] });
    addStep('Normalize', { totalEvents: telemetry.events.length });

    // 4. Baseline & anomalies
    const tsBuilder = new TimeSeriesBuilder();
    const timeSeries = tsBuilder.buildTimeSeries(telemetry.events, '5m');
    const baseline = new BaselineCalculator().calculateBaseline('errorRate', timeSeries, 'mean');
    const anomalies = new AnomalyDetector().detectAnomalies(timeSeries, baseline, 2);
    const ranked = new SeverityRanker().rankAnomaliesBySeverity(anomalies);
    addStep('Anomalies', { baseline: { mean: baseline.mean, stdDev: baseline.standardDeviation }, count: ranked.length, anomalies: ranked.slice(0, 10) });

    // 5. Correlation
    const groups = new TemporalCorrelator().correlateTemporal(telemetry.events);
    const causalGraph = new CausalGraphBuilder().buildCausalGraph(groups);
    addStep('Correlation', { groups: groups.length, nodes: causalGraph.nodes.length, edges: causalGraph.edges.length });

    // 6. Root causes (enhanced detailed analysis)
    const analyzer = new CausalAnalyzer();
    const detailedAnalyses = analyzer.identifyRootCausesDetailed(causalGraph, ranked, []);
    const rootCauses = detailedAnalyses.map((a) => a.rootCause);

    // Group root causes by category + service
    const rcGroupMap = new Map<string, typeof detailedAnalyses>();
    for (const a of detailedAnalyses) {
      const svc = a.affectedServices?.[0] || a.rootCause.explanation?.match(/service[:\s]+(\S+)/i)?.[1] || 'unknown';
      const key = `${a.rootCause.category}||${svc}`;
      if (!rcGroupMap.has(key)) rcGroupMap.set(key, []);
      rcGroupMap.get(key)!.push(a);
    }
    const groupedRootCauses = [...rcGroupMap.entries()].map(([key, items]) => {
      const best = items.reduce((a, b) => a.rootCause.confidence > b.rootCause.confidence ? a : b);
      const allServices = [...new Set(items.flatMap(i => i.affectedServices || []))];
      const allExTypes = [...new Set(items.flatMap(i => i.relatedExceptionTypes || []))];
      const category = best.rootCause.category;
      const { problem, fix } = generateProblemAndFix(category, allExTypes, allServices, best);
      return {
        count: items.length,
        category,
        confidence: best.rootCause.confidence,
        explanation: best.rootCause.explanation,
        problem,
        fix,
        propagationDepth: Math.max(...items.map(i => i.propagationDepth)),
        fanOut: Math.max(...items.map(i => i.fanOut)),
        affectedServiceCount: allServices.length,
        affectedServices: allServices,
        errorFrequency: items.reduce((s, i) => s + i.errorFrequency, 0),
        relatedExceptionTypes: allExTypes.slice(0, 8),
        timeToImpact: best.timeToImpact,
        evidenceBreakdown: best.evidenceBreakdown,
      };
    }).sort((a, b) => b.confidence - a.confidence);

    addStep('RootCauses', {
      count: rootCauses.length,
      rootCauses,
      groupedRootCauses,
      detailed: detailedAnalyses.map((a) => ({
        id: a.rootCause.id,
        confidence: a.rootCause.confidence,
        category: a.rootCause.category,
        explanation: a.rootCause.explanation,
        propagationDepth: a.propagationDepth,
        affectedServiceCount: a.affectedServiceCount,
        affectedServices: a.affectedServices,
        errorFrequency: a.errorFrequency,
        fanOut: a.fanOut,
        relatedExceptionTypes: a.relatedExceptionTypes,
        timeToImpact: a.timeToImpact,
        evidenceBreakdown: a.evidenceBreakdown,
      })),
    });

    // 7. Merged Issues — combine error groups with symptom context, deduplicated
    const rawSymptoms = new CascadeAnalyzer().identifySymptoms(causalGraph, rootCauses);
    const errorGroups = groupErrors(telemetry.events);

    // Build a lookup: serviceName -> linked root cause IDs from symptoms
    const symptomRcMap = new Map<string, Set<string>>();
    for (const sym of rawSymptoms) {
      const svc = (sym as any).event?.serviceName || '';
      if (!symptomRcMap.has(svc)) symptomRcMap.set(svc, new Set());
      symptomRcMap.get(svc)!.add(sym.linkedRootCause);
    }

    // Enrich error groups with symptom linkage and classify as root-cause vs downstream
    const issues = errorGroups.map((eg) => {
      const linkedRcIds = symptomRcMap.get(eg.service) || new Set<string>();
      const isDownstream = linkedRcIds.size > 0;
      // Find the matching root cause explanation for linked issues
      const linkedRc = isDownstream
        ? rootCauses.find(rc => linkedRcIds.has(rc.id))
        : null;
      return {
        ...eg,
        isDownstream,
        linkedRootCause: linkedRc ? linkedRc.explanation?.substring(0, 120) : null,
        linkedRootCauseCategory: linkedRc?.category || null,
      };
    });

    addStep('Issues', {
      totalErrors: issues.reduce((s, g) => s + g.count, 0),
      uniqueGroups: issues.length,
      rootCauseErrors: issues.filter(i => !i.isDownstream).length,
      downstreamErrors: issues.filter(i => i.isDownstream).length,
      issues,
    });

    // 7b. Session & Login Exceptions — highlight errors from SessionController / Login methods
    const sessionLoginKeywords = ['session', 'login', 'signin', 'sign_in', 'authenticate', 'sessioncontroller', 'logon'];
    const sessionLoginExceptions: any[] = [];
    for (const e of telemetry.events) {
      if (e.eventType !== 'exception') continue;
      const searchText = [
        (e as any).exceptionType || '',
        (e as any).message || '',
        (e as any).operationName || '',
        e.serviceName || '',
        (e as any).stackTrace || '',
      ].join(' ').toLowerCase();
      if (sessionLoginKeywords.some(kw => searchText.includes(kw))) {
        sessionLoginExceptions.push(e);
      }
    }
    // Group them the same way as regular errors
    const sessionLoginGroups = groupErrors(sessionLoginExceptions);
    if (sessionLoginGroups.length > 0) {
      addStep('SessionLoginExceptions', {
        totalErrors: sessionLoginGroups.reduce((s, g) => s + g.count, 0),
        uniqueGroups: sessionLoginGroups.length,
        groups: sessionLoginGroups,
      });
    }

    // 8. Recommendations (deduplicated)
    const affectedServices = [...new Set(telemetry.events.map(e => e.serviceName))];
    const recs = new RecommendationGenerator().generateRecommendations(rootCauses, { affectedServices });
    const prioritized = new RecommendationGenerator().prioritizeRecommendations(recs);
    // Deduplicate recommendations by normalized action text
    const seenActions = new Set<string>();
    const dedupedRecs = prioritized.filter((r) => {
      const key = (r.action || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenActions.has(key)) return false;
      seenActions.add(key);
      return true;
    }).map((r, i) => ({ ...r, priority: i + 1 }));
    addStep('Recommendations', { count: dedupedRecs.length, recommendations: dedupedRecs });

    // 10. AI narrative (Gemini Flash) — optional, only runs if geminiApiKey is provided
    let aiNarrative: string | null = null;
    if (geminiApiKey) {
      try {
        const llmClient = new LLMClient({ apiKey: geminiApiKey, provider: 'gemini', model: 'gemini-2.0-flash' });
        const reasoningEngine = new ReasoningEngine(llmClient, new PromptBuilder());
        const now2 = new Date();
        const start2 = new Date(now2.getTime() - parseDuration(timespan));
        const aiAnalysis = await reasoningEngine.analyzeIncident({
          timeRange: { start: start2, end: now2 },
          affectedServices,
          severity: ranked.length > 0 ? ranked[0].severity : 'medium',
          anomalies: ranked,
          correlations: groups,
          rootCauseCandidates: rootCauses,
          symptoms: rawSymptoms,
        });
        aiNarrative = aiAnalysis.explanation;
        addStep('AIInsights', { model: 'gemini-2.0-flash', narrative: aiNarrative });
      } catch (aiErr: any) {
        addStep('AIInsights', { model: 'gemini-2.0-flash', error: aiErr.message });
      }
    }

    // 11. Report
    const now = new Date();
    const start = new Date(now.getTime() - parseDuration(timespan));
    const report = new ReportFormatter(new TimelineBuilder()).generateReport({
      incidentId: `INC-${now.toISOString().slice(0, 10).replace(/-/g, '')}`,
      summary: aiNarrative ?? (rootCauses.length > 0 ? rootCauses[0].explanation : 'No clear root cause identified.'),
      timeRange: { start, end: now }, affectedServices, events: telemetry.events,
      rootCauses, symptoms: rawSymptoms, recommendations: dedupedRecs, evidence: [],
    });

    const markdown = new MarkdownRenderer().renderAsMarkdown(report);
    const parsed = parseQuery(userQuery);
    const nlResponse = formatResponse(report, parsed);

    addStep('Report', { incidentId: report.incidentId });

    res.json({ steps, report, markdown, nlResponse, affectedServices, aiNarrative });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

// ── Import Pipeline Analyzer endpoint ─────────────────────────────────────

app.post('/api/import-analyze', async (req, res) => {
  try {
    const { appId, apiKey, question, clientFileUploadId } = req.body;
    if (!appId || !apiKey) return res.status(400).json({ error: 'appId and apiKey are required' });

    // Accept either clientFileUploadId directly or extract from question
    const idToUse = clientFileUploadId || question;
    if (!idToUse) return res.status(400).json({ error: 'clientFileUploadId is required' });

    const queryFn = (kql: string) => queryAppInsights(appId, apiKey, kql.trim(), 'P90D');
    const orchestrator = new ImportOrchestrator(queryFn);
    const result = await orchestrator.answer(idToUse);

    // Generate plain-English answer to the question
    const plainAnswer = question && question.trim()
      ? generatePlainAnswer(question.trim(), result.primary)
      : null;

    res.json({ ...result, plainAnswer });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

function generatePlainAnswer(question: string, analysis: any): string {
  if (!analysis) return 'No data available to answer this question.';
  const q = question.toLowerCase();
  const lines: string[] = [];
  const id = analysis.clientFileUploadId;
  const rows = analysis.rowCount;
  const totalMs = analysis.totalEstimatedMs;
  const steps = analysis.stepContributions ?? [];
  const counts = analysis.countsSummary;

  // Time per step
  if (q.includes('time') || q.includes('how long') || q.includes('duration') || q.includes('took') || q.includes('each step')) {
    lines.push(`For import ${id}:`);
    if (steps.length > 0) {
      for (const s of steps) {
        const flag = s.flag !== 'ok' ? ` ⚠ (${s.flag})` : '';
        lines.push(`  • ${s.stepName}: ${fmtMsServer(s.durationMs)}${flag}`);
      }
      if (totalMs > 0) lines.push(`  Total estimated: ${fmtMsServer(totalMs)}`);
    } else {
      lines.push('  No step timing data found.');
    }
  }

  // Slow steps
  if (q.includes('slow') || q.includes('too much') || q.includes('bottleneck') || q.includes('issue') || q.includes('problem')) {
    const slow = steps.filter((s: any) => s.flag !== 'ok');
    if (slow.length > 0) {
      lines.push(`Slow steps detected:`);
      for (const s of slow) {
        lines.push(`  • ${s.stepName} took ${fmtMsServer(s.durationMs)} — ${s.note ?? s.flag}`);
      }
    } else {
      lines.push('No unusually slow steps detected.');
    }
    const insights = analysis.insights ?? [];
    for (const ins of insights) {
      if (ins.startsWith('⚠️') || ins.startsWith('❌')) lines.push(ins);
    }
  }

  // Data count
  if (q.includes('count') || q.includes('how many') || q.includes('data') || q.includes('rows') || q.includes('records')) {
    lines.push(`Data counts: ${counts}`);
    if (rows) lines.push(`File had ${rows.toLocaleString()} rows.`);
  }

  // Errors
  if (q.includes('error') || q.includes('fail') || q.includes('exception')) {
    const errInsights = (analysis.insights ?? []).filter((i: string) => i.startsWith('❌'));
    if (errInsights.length > 0) {
      for (const e of errInsights) lines.push(e);
    } else {
      lines.push('No errors found for this import.');
    }
  }

  // Comparison — handled separately in comparison mode, but catch the question
  if (q.includes('compar') || q.includes('vs') || q.includes('difference')) {
    lines.push('To compare two imports, include both UUIDs in the Client File Upload ID field (comma-separated or space-separated).');
  }

  if (lines.length === 0) {
    // Generic fallback — summarise what we know
    lines.push(`Import ${id}:`);
    if (rows) lines.push(`  • ${rows.toLocaleString()} rows in file`);
    if (totalMs > 0) lines.push(`  • Total processing time: ${fmtMsServer(totalMs)}`);
    lines.push(`  • ${counts}`);
    const insights = analysis.insights ?? [];
    for (const ins of insights.slice(0, 3)) lines.push(`  • ${ins}`);
  }

  return lines.join('\n');
}

function fmtMsServer(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

function generateProblemAndFix(
  category: string,
  exceptionTypes: string[],
  affectedServices: string[],
  analysis: { rootCause: any; propagationDepth: number; errorFrequency: number; fanOut: number },
): { problem: string; fix: string } {
  const svcList = affectedServices.length > 0 ? affectedServices.slice(0, 3).join(', ') : 'unknown service';
  const exList = exceptionTypes.length > 0 ? exceptionTypes.slice(0, 2).join(', ') : '';
  const event = analysis.rootCause.event;
  const msg = (event?.message || event?.exceptionType || '').substring(0, 120);

  // Detect specific patterns from exception messages
  const msgLower = (msg + ' ' + exList).toLowerCase();
  const hasTimeout = msgLower.includes('timeout') || msgLower.includes('timed out');
  const hasConnection = msgLower.includes('connection') || msgLower.includes('refused') || msgLower.includes('econnrefused');
  const hasMemory = msgLower.includes('memory') || msgLower.includes('heap') || msgLower.includes('oom');
  const hasCpu = msgLower.includes('cpu') || msgLower.includes('throttl');
  const hasPool = msgLower.includes('pool') || msgLower.includes('exhausted');
  const hasNull = msgLower.includes('null') || msgLower.includes('undefined') || msgLower.includes('cannot read');
  const hasAuth = msgLower.includes('auth') || msgLower.includes('401') || msgLower.includes('403') || msgLower.includes('forbidden');
  const has404 = msgLower.includes('404') || msgLower.includes('not found');
  const has500 = msgLower.includes('500') || msgLower.includes('internal server');
  const hasDb = msgLower.includes('sql') || msgLower.includes('database') || msgLower.includes('deadlock') || msgLower.includes('query');
  const hasDisk = msgLower.includes('disk') || msgLower.includes('storage') || msgLower.includes('no space');

  // Build problem + fix based on category and detected patterns
  switch (category) {
    case 'deployment': {
      const problem = `A recent deployment introduced failures in ${svcList}.${msg ? ` Error: "${msg}".` : ''} The issue appeared shortly after the deployment and cascaded to ${analysis.propagationDepth} downstream service(s).`;
      const fix = `1. Roll back the most recent deployment to the last known good version.\n2. Review the deployment diff for breaking changes, configuration mismatches, or missing environment variables.\n3. Add pre-deployment smoke tests and canary deployment strategy to catch regressions early.\n4. Verify all dependent service contracts are still compatible.`;
      return { problem, fix };
    }
    case 'dependency': {
      let problem = `An external dependency failure is impacting ${svcList}.`;
      let fix = '';
      if (hasTimeout) {
        problem += ` Requests to the dependency are timing out, causing cascading delays.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Increase timeout thresholds or add adaptive timeouts based on P99 latency.\n2. Implement circuit breaker pattern to fail fast when the dependency is unhealthy.\n3. Add retry with exponential backoff for transient failures.\n4. Consider adding a fallback/cache layer for degraded mode operation.`;
      } else if (hasConnection) {
        problem += ` The service cannot establish connections to the dependency.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Verify the dependency endpoint is reachable (DNS, firewall, network policies).\n2. Check if the dependency service is running and healthy.\n3. Review connection pool settings — pool may be exhausted.\n4. Add health checks and automatic failover to a secondary endpoint if available.`;
      } else if (hasDb) {
        problem += ` Database operations are failing or degraded.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Check database server health, connection limits, and active locks/deadlocks.\n2. Review slow query logs and optimize problematic queries.\n3. Increase connection pool size if connections are being exhausted.\n4. Consider read replicas or caching to reduce database load.`;
      } else {
        problem += `${msg ? ` Error: "${msg}".` : ''} ${exList ? `Related exceptions: ${exList}.` : ''}`;
        fix = `1. Check the health and availability of the external dependency.\n2. Implement circuit breaker and retry patterns with exponential backoff.\n3. Add fallback behavior for when the dependency is unavailable.\n4. Set up monitoring and alerts on dependency response times and error rates.`;
      }
      return { problem, fix };
    }
    case 'resource': {
      let problem = `Resource exhaustion detected in ${svcList}.`;
      let fix = '';
      if (hasMemory) {
        problem += ` The service is running out of memory, likely due to a memory leak or excessive allocation.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Capture a heap dump and analyze for memory leaks (large retained objects, growing collections).\n2. Increase memory limits as a short-term mitigation.\n3. Review recent code changes for unbounded caches, event listener leaks, or large payload processing.\n4. Add memory usage monitoring with alerts at 80% threshold.`;
      } else if (hasCpu) {
        problem += ` CPU utilization is critically high, causing request processing delays.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Profile the application to identify CPU-intensive operations (hot loops, inefficient algorithms).\n2. Scale horizontally by adding more instances.\n3. Offload heavy computation to background workers or async queues.\n4. Review and optimize any regex patterns, serialization, or cryptographic operations.`;
      } else if (hasPool) {
        problem += ` Connection or thread pool is exhausted — no resources available to handle new requests.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Increase pool size limits and review pool configuration.\n2. Investigate why connections/threads are not being released (long-running queries, missing close/dispose calls).\n3. Add connection pool monitoring and set up alerts.\n4. Implement request queuing with backpressure to prevent pool starvation.`;
      } else if (hasDisk) {
        problem += ` Disk space or storage is running low.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Free up disk space by cleaning logs, temp files, and old artifacts.\n2. Increase storage allocation or enable auto-scaling for storage.\n3. Implement log rotation and retention policies.\n4. Move large data to object storage (S3, Blob Storage).`;
      } else if (hasTimeout) {
        problem += ` Operations are timing out due to resource contention.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Identify the bottleneck resource (CPU, memory, I/O, network).\n2. Scale the service vertically or horizontally.\n3. Optimize slow operations and add caching where appropriate.\n4. Implement request prioritization and load shedding.`;
      } else {
        problem += `${msg ? ` Error: "${msg}".` : ''} The service is under resource pressure affecting reliability.`;
        fix = `1. Review resource utilization metrics (CPU, memory, disk, network).\n2. Scale the affected service(s) to handle current load.\n3. Identify and optimize resource-intensive operations.\n4. Set up auto-scaling policies based on resource utilization thresholds.`;
      }
      return { problem, fix };
    }
    case 'code': {
      let problem = `A code-level error is occurring in ${svcList}.`;
      let fix = '';
      if (hasNull) {
        problem += ` Null reference or undefined value errors indicate missing data validation.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Add null checks and input validation at service boundaries.\n2. Review the call stack to identify which data path returns null/undefined unexpectedly.\n3. Add defensive coding patterns (optional chaining, default values).\n4. Write unit tests covering edge cases with missing or malformed data.`;
      } else if (hasAuth) {
        problem += ` Authentication or authorization failures are blocking requests.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Verify API keys, tokens, and credentials are valid and not expired.\n2. Check if permissions/roles have been changed recently.\n3. Review auth middleware configuration and token refresh logic.\n4. Ensure secrets are properly configured in all environments.`;
      } else if (has404) {
        problem += ` Requests are hitting endpoints or resources that don't exist.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Verify API routes and endpoint URLs are correct.\n2. Check if a recent deployment removed or renamed endpoints.\n3. Review client-side code for hardcoded URLs that may be outdated.\n4. Add proper 404 handling with helpful error messages.`;
      } else if (has500) {
        problem += ` Internal server errors indicate unhandled exceptions in the application.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Review application logs for the full stack trace of the unhandled exception.\n2. Add proper error handling and try-catch blocks around the failing code path.\n3. Implement global error handling middleware.\n4. Add structured logging to capture context around failures.`;
      } else {
        problem += `${msg ? ` Error: "${msg}".` : ''}${exList ? ` Exception types: ${exList}.` : ''} Error frequency: ${analysis.errorFrequency}/5min.`;
        fix = `1. Review the stack trace and application logs to pinpoint the failing code path.\n2. Add error handling and input validation around the affected code.\n3. Write regression tests to cover the failure scenario.\n4. Consider adding structured logging for better debugging context.`;
      }
      return { problem, fix };
    }
    case 'infrastructure': {
      let problem = `Infrastructure-level issues detected affecting ${svcList}.`;
      let fix = '';
      if (hasConnection) {
        problem += ` Network connectivity problems are preventing service communication.${msg ? ` Error: "${msg}".` : ''}`;
        fix = `1. Check network connectivity, DNS resolution, and firewall rules.\n2. Verify load balancer health checks and routing configuration.\n3. Review recent infrastructure changes (network policies, security groups).\n4. Implement service mesh or DNS-based failover for resilience.`;
      } else {
        problem += `${msg ? ` Error: "${msg}".` : ''} The issue may be related to networking, DNS, load balancing, or platform-level failures.`;
        fix = `1. Check infrastructure health dashboards for the affected region/cluster.\n2. Review recent infrastructure changes or maintenance windows.\n3. Verify DNS resolution, load balancer configuration, and network policies.\n4. Consider multi-region deployment for higher availability.`;
      }
      return { problem, fix };
    }
    default: {
      const problem = `An issue was detected in ${svcList}.${msg ? ` Error: "${msg}".` : ''}`;
      const fix = `1. Review application and infrastructure logs for the affected service(s).\n2. Check recent changes (deployments, config updates, infrastructure modifications).\n3. Monitor the error rate to determine if the issue is ongoing or transient.\n4. Escalate to the owning team with the collected evidence.`;
      return { problem, fix };
    }
  }
}

function groupByKey<T>(items: T[], keyFn: (item: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}

interface ErrorGroup {
  errorType: string;
  service: string;
  count: number;
  sampleMessage: string;
  severity: string;
  firstSeen: string;
  lastSeen: string;
}

function groupErrors(events: any[]): ErrorGroup[] {
  const map = new Map<string, { count: number; messages: string[]; severity: string; timestamps: Date[]; originalType: string; service: string }>();
  for (const e of events) {
    if (e.eventType !== 'exception') continue;
    const exType = (e as any).exceptionType || (e as any).message?.substring(0, 60) || 'Unknown';
    const svc = e.serviceName || 'unknown';
    // Normalize key: strip timestamps, UUIDs, hex IDs, and long numbers so errors
    // that differ only by dynamic values get clubbed together
    const normalizedType = exType
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, '<ts>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/0x[0-9a-f]+/gi, '<hex>')
      .replace(/\b\d{10,}\b/g, '<id>')
      .trim();
    const key = `${normalizedType}||${svc}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (existing.messages.length < 3) existing.messages.push((e as any).message || '');
      existing.timestamps.push(e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp));
    } else {
      map.set(key, {
        count: 1,
        messages: [(e as any).message || ''],
        severity: (e as any).severity || 'error',
        timestamps: [e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp)],
        originalType: exType,
        service: svc,
      });
    }
  }
  const groups: ErrorGroup[] = [];
  for (const [, val] of map) {
    const sorted = val.timestamps.sort((a, b) => a.getTime() - b.getTime());
    groups.push({
      errorType: val.originalType,
      service: val.service,
      count: val.count,
      sampleMessage: val.messages[0],
      severity: val.severity,
      firstSeen: sorted[0].toISOString(),
      lastSeen: sorted[sorted.length - 1].toISOString(),
    });
  }
  return groups.sort((a, b) => b.count - a.count);
}

function parseDuration(iso: string): number {
  const match = iso.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!match) return 24 * 60 * 60 * 1000;
  const days = Number(match[1] || 0), hours = Number(match[2] || 0), mins = Number(match[3] || 0);
  return (days * 86400 + hours * 3600 + mins * 60) * 1000;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RCA Assistant running at http://localhost:${PORT}`));
