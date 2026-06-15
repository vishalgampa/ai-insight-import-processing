/**
 * Analyzes parsed import timing data.
 * Passes structured data through to the UI with projections and insights.
 */

import {
  ParsedImportLogs, PerRowStepStat,
  ValidationBundleStat, ValidationBatchStat,
  SubmissionStageStat, SubmissionBundleStat, SubmissionBatchStat,
  SlowCheckpoint,
} from './importLogParser';
import { FetchDiagnostics } from './importLogFetcher';
import { THRESHOLDS } from './knownPatterns';

export interface PerRowInsight extends PerRowStepStat {
  projectedTotalMs: number;
  projectedTotalMin: number;
  flag: 'ok' | 'slow' | 'critical';
  note?: string;
}

export interface StepContribution {
  stepName: string;
  durationMs: number;
  percentOfTotal: number;
  flag: 'ok' | 'slow' | 'critical';
  note?: string;
}

export interface ImportAnalysis {
  clientFileUploadId: string;
  rowCount: number | null;
  totalEstimatedMs: number;
  bundleSize: number | null;
  diagnostics: FetchDiagnostics;

  stepMeta: {
    mapping:    { operationId: string | null; pod: string | null; startTime: string | null; endTime: string | null };
    validation: { operationId: string | null; pod: string | null; startTime: string | null; endTime: string | null };
    submission: { operationId: string | null; pod: string | null; startTime: string | null; endTime: string | null };
  };

  // High-level step timing breakdown
  stepContributions: StepContribution[];

  // ── VALIDATION ──
  validationBundleStats: ValidationBundleStat[];
  validationBatchStats: ValidationBatchStat[];
  validationRowInsights: PerRowInsight[];   // per-row with projections
  slowCheckpoints: SlowCheckpoint[];

  // ── SUBMISSION ──
  submissionStageStats: SubmissionStageStat[];
  submissionBundleStats: SubmissionBundleStat[];
  submissionBatchStats: SubmissionBatchStat[];
  submissionRowInsights: PerRowInsight[];   // per-row with projections

  insights: string[];
  countsSummary: string;
}

import { BucketAverages } from '../persistence/IReportRepository';

export interface ComparisonResult {
  idA: string;
  idB: string;
  rowCountA: number | null;
  rowCountB: number | null;
  stepDiff: {
    stepName: string;
    msA: number;
    msB: number;
    deltaMs: number;
    deltaPercent: number;
    flag: 'faster' | 'slower' | 'same';
  }[];
  insights: string[];
  // Structured Nested Diffs for "Deep-Dive"
  validationBundleDiff?: { index: number, msA: number, msB: number, deltaMs: number }[];
  submissionBatchDiff?: { 
    index?: number, 
    bundleIdx: number, 
    batchIdx: number, 
    startRow: number, 
    endRow: number, 
    msA: number, 
    msB: number, 
    deltaMs: number, 
    bulkMsA: number, 
    bulkMsB: number 
  }[];
  rowInsightDiff?: { stepName: string, avgMsA: number, avgMsB: number, deltaMs: number }[];
  
  sourceReports?: { id: string, rowCount: number | null, timestamp: string }[];
}

export function compareAgainstBaseline(current: ImportAnalysis, baseline: BucketAverages): ComparisonResult {
  const currentMap = new Map<string, number>();
  for (const s of current.stepContributions) {
    currentMap.set(s.stepName, s.durationMs);
  }

  const baselineMap = new Map<string, number>();
  for (const stepName in baseline.stepAverages) {
    baselineMap.set(stepName, baseline.stepAverages[stepName]);
  }

  const keys = [...new Set([...currentMap.keys(), ...baselineMap.keys()])];
  const stepDiff = keys.map(k => {
    const msBaseline = baselineMap.get(k) ?? 0, msCurrent = currentMap.get(k) ?? 0;
    const delta = msCurrent - msBaseline, pct = msBaseline > 0 ? (delta / msBaseline) * 100 : 0;
    return { 
      stepName: k, 
      msA: msBaseline, 
      msB: msCurrent, 
      deltaMs: delta, 
      deltaPercent: Math.round(pct),
      flag: (Math.abs(pct) < 15 ? 'same' : delta > 0 ? 'slower' : 'faster') as 'faster'|'slower'|'same' 
    };
  }).sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs));

  const insights: string[] = [];
  for (const s of stepDiff.filter(s => s.flag === 'slower' && s.deltaMs > 1000).slice(0, 3))
    insights.push(`"${s.stepName}" is ${(s.deltaMs/1000).toFixed(1)}s slower than baseline (+${s.deltaPercent}%)`);
  
  if (insights.length === 0) insights.push('Performance is consistent with size-bucket averages.');

  // ── Deep-Dive Structured Diffs (Mirroring Single Run) ──
  
  // 1. Validation Bundles
  const validationBundleDiff = current.validationBundleStats.map(b => ({
    index: b.bundleIdx,
    msA: baseline.validationBundleAverages[b.bundleIdx] ?? 0,
    msB: b.totalMs ?? 0,
    deltaMs: (b.totalMs ?? 0) - (baseline.validationBundleAverages[b.bundleIdx] ?? 0)
  }));

  // 2. Submission Batches (Total & Bulk)
  const submissionBatchDiff = current.submissionBatchStats.map(b => ({
    index: b.batchIdx,
    bundleIdx: b.bundleIdx,
    batchIdx: b.batchIdx,
    startRow: b.startRow ?? 0,
    endRow: b.endRow ?? 0,
    msA: baseline.submissionBatchAverages[b.batchIdx]?.total ?? 0,
    msB: b.totalProcessingMs ?? 0,
    deltaMs: (b.totalProcessingMs ?? 0) - (baseline.submissionBatchAverages[b.batchIdx]?.total ?? 0),
    bulkMsA: baseline.submissionBatchAverages[b.batchIdx]?.bulk ?? 0,
    bulkMsB: b.bulkProcessingMs ?? 0
  }));

  // 3. Row-Level Rules
  const rowInsightDiff = current.validationRowInsights.map(r => ({
    stepName: r.stepName,
    avgMsA: baseline.rowInsightAverages[r.stepName] ?? 0,
    avgMsB: r.avgMs,
    deltaMs: r.avgMs - (baseline.rowInsightAverages[r.stepName] ?? 0)
  }));

  return { 
    idA: `Bucket ${baseline.sizeBucket/1000}k Average (${baseline.count} files)`, 
    idB: current.clientFileUploadId, 
    rowCountA: null, 
    rowCountB: current.rowCount, 
    stepDiff, 
    insights,
    validationBundleDiff,
    submissionBatchDiff,
    rowInsightDiff,
    sourceReports: baseline.sourceReports
  };
}

function toInsight(stat: PerRowStepStat, rowCount: number | null, useOccurrences = false): PerRowInsight {
  // Both validation and submission filter ms_val > 0 before summarizing.
  // So occurrences = rows where this step was measurably non-zero.
  //
  // useOccurrences=true  → project against occurrences (step is conditional / sparse)
  // useOccurrences=false → project against rowCount    (step runs on every row, just
  //                        fast enough to be filtered out most of the time)
  const effectiveCount = useOccurrences ? stat.occurrences : (rowCount ?? 0);
  const projected = effectiveCount ? stat.avgMs * effectiveCount : 0;
  const projectedMin = projected / 60_000;
  const f: 'ok' | 'slow' | 'critical' =
    projectedMin > THRESHOLDS.projectedMinutes * 2 ? 'critical' :
    projectedMin > THRESHOLDS.projectedMinutes ? 'slow' :
    stat.avgMs > THRESHOLDS.perRowStepMs ? 'slow' : 'ok';
  let note: string | undefined;
  if (effectiveCount && projectedMin > THRESHOLDS.projectedMinutes)
    note = `${stat.avgMs.toFixed(1)}ms × ${effectiveCount.toLocaleString()} occurrences = ${projectedMin.toFixed(1)} min projected` +
      (f === 'critical' ? ' — CRITICAL' : '');
  else if (stat.maxMs > stat.avgMs * 5 && stat.maxMs > 50)
    note = `High variance: avg ${stat.avgMs.toFixed(1)}ms, max ${stat.maxMs.toFixed(1)}ms`;
  return { ...stat, projectedTotalMs: projected, projectedTotalMin: projectedMin, flag: f, note };
}

export function analyzeImport(id: string, logs: ParsedImportLogs): ImportAnalysis {
  const rowCount = logs.counts.totalRows ?? logs.counts.mappedContentCount;

  // ── Step contributions (high-level timing breakdown) ─────────────────
  const steps: { name: string; ms: number }[] = [];
  if (logs.mappingDurationSec !== null)
    steps.push({ name: 'Mapping', ms: logs.mappingDurationSec * 1000 });
  if (logs.allDbFetchesMs !== null)
    steps.push({ name: 'Validation: Initial DB Fetches', ms: logs.allDbFetchesMs });
  if (logs.blobDownloadMs !== null)
    steps.push({ name: 'Validation: BLOB Download', ms: logs.blobDownloadMs });
  if (logs.chunksCompletedMs !== null)
    steps.push({ name: 'Validation: All Chunks', ms: logs.chunksCompletedMs });
  
  // Aggregate nested stats for baseline comparison
  if (logs.validationBatchStats.length > 0) {
    const avgBulk = logs.validationBatchStats.reduce((s, b) => s + (b.bulkInsertMs ?? 0), 0) / logs.validationBatchStats.length;
    steps.push({ name: 'Validation: BulkInsert (avg/batch)', ms: avgBulk });
  }
  if (logs.submissionBatchStats.length > 0) {
    const avgSubBulk = logs.submissionBatchStats.reduce((s, b) => s + (b.bulkProcessingMs ?? 0), 0) / logs.submissionBatchStats.length;
    const avgSubLoop = logs.submissionBatchStats.reduce((s, b) => s + (b.loopProcessingMs ?? 0), 0) / logs.submissionBatchStats.length;
    steps.push({ name: 'Submission: Bulk Processing (avg/batch)', ms: avgSubBulk });
    steps.push({ name: 'Submission: Loop Processing (avg/batch)', ms: avgSubLoop });
  }

  for (const b of logs.validationBatchStats)
    steps.push({ name: `Validation BulkInsert rows ${b.startRow}-${b.endRow}`, ms: b.bulkInsertMs });
  for (const s of logs.submissionStageStats)
    if (s.valueMs !== null) steps.push({ name: `Submission: ${s.stepName}`, ms: s.valueMs });
  for (const b of logs.submissionBundleStats)
    if (b.bundleDbFetchMs !== null) steps.push({ name: `Submission Bundle ${b.bundleIdx} DB fetch`, ms: b.bundleDbFetchMs });
  for (const b of logs.submissionBatchStats)
    if (b.totalProcessingMs !== null) steps.push({ name: `Submission Batch ${b.batchIdx} Total Processing`, ms: b.totalProcessingMs });

  const totalMs = steps.reduce((s, x) => s + x.ms, 0);
  const stepContributions: StepContribution[] = steps.map(s => {
    const pct = totalMs > 0 ? (s.ms / totalMs) * 100 : 0;
    const f = s.ms >= THRESHOLDS.dbFetchMs * 3 ? 'critical' : s.ms >= THRESHOLDS.dbFetchMs ? 'slow' : 'ok';
    let note: string | undefined;
    if (s.name.includes('DB Fetch') && s.ms > THRESHOLDS.dbFetchMs)
      note = `${(s.ms / 1000).toFixed(1)}s — check query plans`;
    if (s.name.includes('BLOB') && s.ms > THRESHOLDS.blobDownloadMs)
      note = `Blob download slow`;
    if (s.name.includes('BulkInsert') && s.ms > THRESHOLDS.bulkInsertMs)
      note = `Bulk insert slow — check index fragmentation`;
    return { stepName: s.name, durationMs: s.ms, percentOfTotal: Math.round(pct * 10) / 10, flag: f, note };
  });

  // ── Per-row insights ─────────────────────────────────────────────────
  // Both validation and submission filter ms_val > 0, so occurrences = rows where
  // the step was measurably non-zero. For steps that run on every row but are usually
  // instant, occurrences understates — but projecting by rowCount overstates for
  // conditional steps. Using occurrences is the safer, more honest choice for both.
  const validationRowInsights = logs.validationRowStats.map(s => toInsight(s, rowCount, true))
    .sort((a, b) => b.projectedTotalMs - a.projectedTotalMs);
  const submissionRowInsights = logs.submissionRowStats.map(s => toInsight(s, rowCount, true))
    .sort((a, b) => b.projectedTotalMs - a.projectedTotalMs);

  // ── AI insights ──────────────────────────────────────────────────────
  const insights: string[] = [];
  if (logs.allDbFetchesMs && logs.allDbFetchesMs > 10_000)
    insights.push(`⚠️ Initial DB fetches: ${(logs.allDbFetchesMs / 1000).toFixed(1)}s — fixed cost per import regardless of file size.`);
  for (const p of validationRowInsights.filter(p => p.flag !== 'ok').slice(0, 3))
    if (p.note) insights.push(`⚠️ Validation "${p.stepName}": ${p.note}`);
  for (const p of submissionRowInsights.filter(p => p.flag !== 'ok').slice(0, 3))
    if (p.note) insights.push(`⚠️ Submission "${p.stepName}": ${p.note}`);
  const totalBulkInsertMs = logs.validationBatchStats.reduce((s, b) => s + b.bulkInsertMs, 0);
  if (totalBulkInsertMs > 5_000)
    insights.push(`⚠️ Total BulkInsert (validation): ${(totalBulkInsertMs / 1000).toFixed(1)}s across ${logs.validationBatchStats.length} batch(es).`);
  const heavyBundleDb = logs.submissionBundleStats.filter(b => (b.bundleDbFetchMs ?? 0) > 5_000);
  if (heavyBundleDb.length > 0)
    insights.push(`⚠️ ${heavyBundleDb.length} submission bundle(s) had DB fetch >5s.`);
  if (logs.errors.length > 0) {
    const types = [...new Set(logs.errors.map(e => {
      if (e.message.includes('truncated')) return 'Data truncation';
      if (e.message.includes('Sequence contains no elements')) return 'Missing config data';
      if (e.message.includes('already in progress')) return 'Duplicate trigger';
      if (e.message.includes('AlreadyExists')) return 'K8s job already exists';
      return 'Error';
    }))];
    insights.push(`❌ Errors: ${types.join(', ')}`);
  }
  if (insights.length === 0) insights.push('✅ No significant performance issues detected.');

  // ── Counts summary ───────────────────────────────────────────────────
  const c = logs.counts;
  const parts: string[] = [];
  if (c.totalRows) parts.push(`${c.totalRows.toLocaleString()} rows in file`);
  if (c.mappedContentCount) parts.push(`${c.mappedContentCount.toLocaleString()} mapped records`);
  if (c.accountIds != null) parts.push(`${c.accountIds.toLocaleString()} accounts`);
  if (c.linkedAccountIds != null) parts.push(`${c.linkedAccountIds.toLocaleString()} linked accounts`);
  if (c.customFields != null) parts.push(`${c.customFields.toLocaleString()} custom fields`);
  if (c.bankruptcyRecords != null) parts.push(`${c.bankruptcyRecords.toLocaleString()} bankruptcy records`);

  return {
    clientFileUploadId: id,
    rowCount,
    totalEstimatedMs: totalMs,
    bundleSize: logs.bundleSize,
    diagnostics: {
      anchorFound: !!(logs.validationMeta.pod || logs.submissionMeta.pod || logs.k8sTriggerMeta.pod),
      anchorRowCount: 0,
      validationFound: !!logs.validationMeta.operationId,
      submissionFound: !!logs.submissionMeta.operationId,
      noDataReason: null,
    },
    stepMeta: {
      mapping:    { operationId: logs.mappingMeta.operationId,    pod: logs.mappingMeta.pod,    startTime: logs.mappingMeta.startTime?.toISOString() ?? null,    endTime: logs.mappingMeta.endTime?.toISOString() ?? null },
      validation: { operationId: logs.validationMeta.operationId, pod: logs.validationMeta.pod, startTime: logs.validationMeta.startTime?.toISOString() ?? null, endTime: logs.validationMeta.endTime?.toISOString() ?? null },
      submission: { operationId: logs.submissionMeta.operationId, pod: logs.submissionMeta.pod, startTime: logs.submissionMeta.startTime?.toISOString() ?? null, endTime: logs.submissionMeta.endTime?.toISOString() ?? null },
    },
    stepContributions,
    validationBundleStats: logs.validationBundleStats,
    validationBatchStats: logs.validationBatchStats,
    validationRowInsights,
    slowCheckpoints: logs.slowCheckpoints,
    submissionStageStats: logs.submissionStageStats,
    submissionBundleStats: logs.submissionBundleStats,
    submissionBatchStats: logs.submissionBatchStats,
    submissionRowInsights,
    insights,
    countsSummary:  parts.join(' | '),
  };
}

export function compareImports(idA: string, logsA: ParsedImportLogs, idB: string, logsB: ParsedImportLogs): ComparisonResult {
  const analysisA = analyzeImport(idA, logsA);
  const analysisB = analyzeImport(idB, logsB);

  const mapA = new Map<string, number>();
  for (const s of analysisA.stepContributions) {
    mapA.set(s.stepName, s.durationMs);
  }

  const mapB = new Map<string, number>();
  for (const s of analysisB.stepContributions) {
    mapB.set(s.stepName, s.durationMs);
  }

  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const stepDiff = keys.map(k => {
    const msA = mapA.get(k) ?? 0, msB = mapB.get(k) ?? 0;
    const delta = msB - msA, pct = msA > 0 ? (delta / msA) * 100 : 0;
    return { stepName: k, msA, msB, deltaMs: delta, deltaPercent: Math.round(pct),
      flag: (Math.abs(pct) < 10 ? 'same' : delta > 0 ? 'slower' : 'faster') as 'faster'|'slower'|'same' };
  }).sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs));

  const insights: string[] = [];
  for (const s of stepDiff.filter(s => s.flag === 'slower' && s.deltaMs > 1000).slice(0, 3))
    insights.push(`"${s.stepName}" is ${(s.deltaMs/1000).toFixed(1)}s slower in ${idB} (+${s.deltaPercent}%)`);
  for (const f of stepDiff.filter(s => s.flag === 'faster' && Math.abs(s.deltaMs) > 1000).slice(0, 2))
    insights.push(`"${f.stepName}" is ${(Math.abs(f.deltaMs)/1000).toFixed(1)}s faster in ${idB} (${f.deltaPercent}%)`);
  const rcA = analysisA.rowCount, rcB = analysisB.rowCount;
  if (rcA && rcB && rcA !== rcB)
    insights.push(`File sizes differ: ${idA} had ${rcA.toLocaleString()} rows, ${idB} had ${rcB.toLocaleString()} rows.`);

  // ── Deep-Dive Structured Diffs (A vs B) ──
  
  // 1. Validation Bundles
  const valBundlesA = new Map<number, number>();
  analysisA.validationBundleStats.forEach(b => valBundlesA.set(b.bundleIdx, b.totalMs ?? 0));
  const valBundlesB = new Map<number, number>();
  analysisB.validationBundleStats.forEach(b => valBundlesB.set(b.bundleIdx, b.totalMs ?? 0));
  const valBundleIndices = [...new Set([...valBundlesA.keys(), ...valBundlesB.keys()])].sort((a, b) => a - b);
  
  const validationBundleDiff = valBundleIndices.map(idx => {
    const msA = valBundlesA.get(idx) ?? 0;
    const msB = valBundlesB.get(idx) ?? 0;
    return {
      index: idx,
      msA,
      msB,
      deltaMs: msB - msA
    };
  });

  // 2. Submission Batches
  const subBatchesA = new Map<string, { total: number, bulk: number, bundleIdx: number, batchIdx: number, startRow: number, endRow: number }>();
  analysisA.submissionBatchStats.forEach(b => {
    const key = `${b.bundleIdx}:${b.batchIdx}`;
    subBatchesA.set(key, {
      total: b.totalProcessingMs ?? 0,
      bulk: b.bulkProcessingMs ?? 0,
      bundleIdx: b.bundleIdx,
      batchIdx: b.batchIdx,
      startRow: b.startRow ?? 0,
      endRow: b.endRow ?? 0
    });
  });

  const subBatchesB = new Map<string, { total: number, bulk: number, bundleIdx: number, batchIdx: number, startRow: number, endRow: number }>();
  analysisB.submissionBatchStats.forEach(b => {
    const key = `${b.bundleIdx}:${b.batchIdx}`;
    subBatchesB.set(key, {
      total: b.totalProcessingMs ?? 0,
      bulk: b.bulkProcessingMs ?? 0,
      bundleIdx: b.bundleIdx,
      batchIdx: b.batchIdx,
      startRow: b.startRow ?? 0,
      endRow: b.endRow ?? 0
    });
  });

  const subBatchKeys = [...new Set([...subBatchesA.keys(), ...subBatchesB.keys()])].sort((key1, key2) => {
    const [bundle1, batch1] = key1.split(':').map(Number);
    const [bundle2, batch2] = key2.split(':').map(Number);
    return bundle1 !== bundle2 ? bundle1 - bundle2 : batch1 - batch2;
  });

  const submissionBatchDiff = subBatchKeys.map(key => {
    const bA = subBatchesA.get(key);
    const bB = subBatchesB.get(key);
    const info = bB || bA!;
    
    const msA = bA?.total ?? 0;
    const msB = bB?.total ?? 0;
    const bulkMsA = bA?.bulk ?? 0;
    const bulkMsB = bB?.bulk ?? 0;

    return {
      index: info.batchIdx,
      bundleIdx: info.bundleIdx,
      batchIdx: info.batchIdx,
      startRow: info.startRow,
      endRow: info.endRow,
      msA,
      msB,
      deltaMs: msB - msA,
      bulkMsA,
      bulkMsB
    };
  });

  // 3. Row-Level Rules
  const rowInsightsA = new Map<string, number>();
  analysisA.validationRowInsights.forEach(r => rowInsightsA.set(`Validation: ${r.stepName}`, r.avgMs));
  analysisA.submissionRowInsights.forEach(r => rowInsightsA.set(`Submission: ${r.stepName}`, r.avgMs));

  const rowInsightsB = new Map<string, number>();
  analysisB.validationRowInsights.forEach(r => rowInsightsB.set(`Validation: ${r.stepName}`, r.avgMs));
  analysisB.submissionRowInsights.forEach(r => rowInsightsB.set(`Submission: ${r.stepName}`, r.avgMs));

  const rowStepNames = [...new Set([...rowInsightsA.keys(), ...rowInsightsB.keys()])];

  const rowInsightDiff = rowStepNames.map(name => {
    const avgMsA = rowInsightsA.get(name) ?? 0;
    const avgMsB = rowInsightsB.get(name) ?? 0;
    return {
      stepName: name,
      avgMsA,
      avgMsB,
      deltaMs: avgMsB - avgMsA
    };
  });

  return { 
    idA, 
    idB, 
    rowCountA: rcA, 
    rowCountB: rcB, 
    stepDiff, 
    insights,
    validationBundleDiff,
    submissionBatchDiff,
    rowInsightDiff
  };
}
