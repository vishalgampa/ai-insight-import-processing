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
}

function toInsight(stat: PerRowStepStat, rowCount: number | null): PerRowInsight {
  const projected = rowCount ? stat.avgMs * rowCount : 0;
  const projectedMin = projected / 60_000;
  const f: 'ok' | 'slow' | 'critical' =
    projectedMin > THRESHOLDS.projectedMinutes * 2 ? 'critical' :
    projectedMin > THRESHOLDS.projectedMinutes ? 'slow' :
    stat.avgMs > THRESHOLDS.perRowStepMs ? 'slow' : 'ok';
  let note: string | undefined;
  if (rowCount && projectedMin > THRESHOLDS.projectedMinutes)
    note = `${stat.avgMs.toFixed(1)}ms/row × ${rowCount.toLocaleString()} rows = ${projectedMin.toFixed(1)} min projected` +
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
  for (const b of logs.validationBatchStats)
    steps.push({ name: `Validation BulkInsert rows ${b.startRow}-${b.endRow}`, ms: b.bulkInsertMs });
  for (const s of logs.submissionStageStats)
    if (s.valueMs !== null) steps.push({ name: `Submission: ${s.stepName}`, ms: s.valueMs });
  for (const b of logs.submissionBundleStats)
    if (b.bundleDbFetchMs !== null) steps.push({ name: `Submission Bundle ${b.bundleIdx} DB fetch`, ms: b.bundleDbFetchMs });
  for (const b of logs.submissionBatchStats)
    if (b.bulkProcessingMs !== null) steps.push({ name: `Submission Batch ${b.batchIdx} Bulk Processing`, ms: b.bulkProcessingMs });

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
  const validationRowInsights = logs.validationRowStats.map(s => toInsight(s, rowCount))
    .sort((a, b) => b.projectedTotalMs - a.projectedTotalMs);
  const submissionRowInsights = logs.submissionRowStats.map(s => toInsight(s, rowCount))
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
  if (c.accountIds != null) parts.push(`${c.accountIds} accounts`);
  if (c.linkedAccountIds != null) parts.push(`${c.linkedAccountIds} linked accounts`);
  if (c.customFields != null) parts.push(`${c.customFields} custom fields`);
  if (c.bankruptcyRecords != null) parts.push(`${c.bankruptcyRecords} bankruptcy records`);

  return {
    clientFileUploadId: id,
    rowCount,
    totalEstimatedMs: totalMs,
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
    countsSummary: parts.join(' | ') || 'No count data found',
  };
}

export function compareImports(idA: string, logsA: ParsedImportLogs, idB: string, logsB: ParsedImportLogs): ComparisonResult {
  const mapA = buildStepMap(logsA), mapB = buildStepMap(logsB);
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
  const rcA = logsA.counts.totalRows, rcB = logsB.counts.totalRows;
  if (rcA && rcB && rcA !== rcB)
    insights.push(`File sizes differ: ${idA} had ${rcA.toLocaleString()} rows, ${idB} had ${rcB.toLocaleString()} rows.`);

  return { idA, idB, rowCountA: rcA, rowCountB: rcB, stepDiff, insights };
}

function buildStepMap(logs: ParsedImportLogs): Map<string, number> {
  const m = new Map<string, number>();
  if (logs.mappingDurationSec !== null) m.set('Mapping', logs.mappingDurationSec * 1000);
  if (logs.allDbFetchesMs !== null) m.set('Validation: DB Fetches', logs.allDbFetchesMs);
  if (logs.chunksCompletedMs !== null) m.set('Validation: Chunks', logs.chunksCompletedMs);
  for (const s of logs.submissionStageStats)
    if (s.valueMs !== null) m.set(`Submission: ${s.stepName}`, s.valueMs);
  const bulkMs = logs.submissionBatchStats.reduce((s, b) => s + (b.bulkProcessingMs ?? 0), 0);
  if (bulkMs > 0) m.set('Submission: Bulk Processing', bulkMs);
  return m;
}
