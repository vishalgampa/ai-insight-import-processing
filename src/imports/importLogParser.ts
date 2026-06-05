/**
 * Parses raw log rows into structured timing data.
 * Organised by the 5-level hierarchy from the log structure doc:
 *   Process → Stage → Bundle → Batch → Row
 */

import { RawRow, StepMeta } from './importLogFetcher';

export interface PerRowStepStat {
  stepName: string;
  avgMs: number;
  maxMs: number;
  occurrences: number;
}

export interface StepTiming {
  stepName: string;
  durationMs: number;
  startTime?: Date;
  endTime?: Date;
  pod?: string;
  operationId?: string;
}

export interface DataCounts {
  totalRows: number | null;
  mappedContentCount: number | null;
  accountIds: number | null;
  linkedAccountIds: number | null;
  customFields: number | null;
  bankruptcyRecords: number | null;
  dictionaryEntries: number | null;
}

// ── Validation structured output ──────────────────────────────────────────

export interface ValidationBundleStat {
  chunkIndex: number;
  rowCount: number | null;
  existingUsersMs: number | null;
  redisBatchSizeMs: number | null;
}

export interface ValidationBatchStat {
  startRow: number;
  endRow: number;
  bulkInsertMs: number;
  timestamp: string;
}

// ── Submission structured output ──────────────────────────────────────────

export interface SubmissionStageStat {
  stepName: string;
  valueMs: number | null;
  extra?: string;  // e.g. entry count for dictionary, row count for mapped content
}

export interface SubmissionBundleStat {
  bundleIdx: number;
  startRow: number | null;
  endRow: number | null;
  attributeCount: number | null;
  bundleDbFetchMs: number | null;
  accountIds: number | null;
  linkedAccountIds: number | null;
  customFields: number | null;
  bankruptcyRecords: number | null;
}

export interface SubmissionBatchStat {
  batchIdx: number;       // global sequential batch counter (k)
  bundleIdx: number;      // which bundle this batch belongs to
  startRow: number | null;  // derived: batchIdx * batchSize
  endRow: number | null;    // derived: (batchIdx + 1) * batchSize - 1
  loopProcessingMs: number | null;
  bulkProcessingMs: number | null;
  startTime: string | null;
  endTime: string | null;
}

// ── Full parsed result ────────────────────────────────────────────────────

export interface ParsedImportLogs {
  mappingMeta: StepMeta;
  validationMeta: StepMeta;
  submissionMeta: StepMeta;
  k8sTriggerMeta: StepMeta;

  // Top-level durations
  mappingDurationSec: number | null;
  validationDurationSec: number | null;

  // Validation — Stage
  allDbFetchesMs: number | null;
  blobDownloadMs: number | null;
  chunksCompletedMs: number | null;
  bundleSize: number | null;

  // Validation — Bundle (1× per 5000-row chunk)
  validationBundleStats: ValidationBundleStat[];

  // Validation — Batch (1× per 500-row batch)
  validationBatchStats: ValidationBatchStat[];

  // Validation — Row (aggregated, conditional — only fires when >0ms)
  validationRowStats: PerRowStepStat[];

  // Submission — Stage (1× per job)
  submissionStageStats: SubmissionStageStat[];

  // Submission — Bundle (1× per 5000-row chunk)
  submissionBundleStats: SubmissionBundleStat[];

  // Submission — Batch (1× per 500-row batch)
  submissionBatchStats: SubmissionBatchStat[];

  // Submission — Row (aggregated, fires unconditionally)
  submissionRowStats: PerRowStepStat[];

  counts: DataCounts;
  errors: { timestamp: Date; message: string; pod: string; operationId: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractMs(msg: string): number | null {
  // Matches "123 ms", "123ms", "123.4ms" — but NOT "123 sec"
  const m = msg.match(/(\d+(?:\.\d+)?)\s*ms\b/i);
  return m ? parseFloat(m[1]) : null;
}

function extractSec(msg: string): number | null {
  const m = msg.match(/Duration:\s*([\d.]+)\s*sec/i) || msg.match(/([\d.]+)\s*seconds?\b/i);
  return m ? parseFloat(m[1]) : null;
}

function extractNumber(msg: string, pattern: RegExp): number | null {
  const m = msg.match(pattern);
  return m ? parseInt(m[1], 10) : null;
}

function addStat(map: Map<string, number[]>, name: string, ms: number) {
  if (!map.has(name)) map.set(name, []);
  map.get(name)!.push(ms);
}

function mapToStats(map: Map<string, number[]>): PerRowStepStat[] {
  return [...map.entries()].map(([stepName, vals]) => ({
    stepName,
    avgMs: vals.reduce((a, b) => a + b, 0) / vals.length,
    maxMs: Math.max(...vals),
    occurrences: vals.length,
  })).sort((a, b) => b.avgMs - a.avgMs);
}

// ── Main parser ───────────────────────────────────────────────────────────

export function parseImportLogs(
  mappingRows: RawRow[],
  validationRows: RawRow[],
  validationAggRows: RawRow[],
  validationPerRowRaw: RawRow[],
  validationGlobalFetches: RawRow[],
  submissionRows: RawRow[],
  submissionRawAll: RawRow[],
  submissionAggRows: RawRow[],
  submissionCountRows: RawRow[],
  errorRows: RawRow[],
  rowCount: number | null,
  mappingMeta: StepMeta,
  validationMeta: StepMeta,
  submissionMeta: StepMeta,
  k8sTriggerMeta: StepMeta,
): ParsedImportLogs {

  const result: ParsedImportLogs = {
    mappingMeta, validationMeta, submissionMeta, k8sTriggerMeta,
    mappingDurationSec: null,
    validationDurationSec: null,
    allDbFetchesMs: null,
    blobDownloadMs: null,
    chunksCompletedMs: null,
    bundleSize: null,
    validationBundleStats: [],
    validationBatchStats: [],
    validationRowStats: [],
    submissionStageStats: [],
    submissionBundleStats: [],
    submissionBatchStats: [],
    submissionRowStats: [],
    counts: {
      totalRows: rowCount, mappedContentCount: null,
      accountIds: null, linkedAccountIds: null,
      customFields: null, bankruptcyRecords: null, dictionaryEntries: null,
    },
    errors: [],
  };

  // ── MAPPING ───────────────────────────────────────────────────────────
  for (const row of mappingRows) {
    if (row.message.includes('ImportgenericUpdateFileMapping') && row.message.includes('ended'))
      result.mappingDurationSec = extractSec(row.message);
  }

  // ── VALIDATION — Stage logs ───────────────────────────────────────────
  // validationRows = ImportGenericUpdateFile: * (excludes chunk/identifier noise)
  for (const row of validationRows) {
    const msg = row.message;
    if (msg.includes('ImportGenericUpdateFile ended') || msg.includes('ImportGenericUpdateFile: ImportGenericUpdateFile ended'))
      result.validationDurationSec = extractSec(msg);
    if (msg.includes('All DB Fetchs'))
      result.allDbFetchesMs = extractMs(msg);
    if (msg.includes('BLOB file download operation completed'))
      result.blobDownloadMs = extractMs(msg);
    if (msg.includes('Processing all chunks completed'))
      result.chunksCompletedMs = extractMs(msg);
    if (msg.includes('Starting processing with bundle size')) {
      const m = msg.match(/bundle size:\s*(\d+)/i);
      if (m) result.bundleSize = parseInt(m[1], 10);
    }
  }

  // ── VALIDATION — Bundle logs ──────────────────────────────────────────
  // "Processing generic update chunk N with X rows" — 1× per chunk
  // "Fetched existing users in X ms" — 1× per chunk
  // "Fetched batch size from redis in X ms" — 1× per chunk
  //
  // Build a map: chunkIndex → ValidationBundleStat
  const bundleMap = new Map<number, ValidationBundleStat>();

  const ensureBundle = (idx: number) => {
    if (!bundleMap.has(idx))
      bundleMap.set(idx, { chunkIndex: idx, rowCount: null, existingUsersMs: null, redisBatchSizeMs: null });
    return bundleMap.get(idx)!;
  };

  // Chunk start logs come from validationPerRowRaw (they're in the same query)
  for (const row of validationPerRowRaw) {
    const msg = row.message;
    const chunkMatch = msg.match(/Processing generic update chunk\s+(\d+)\s+with\s+(\d+)\s+rows/i);
    if (chunkMatch) {
      const b = ensureBundle(parseInt(chunkMatch[1], 10));
      b.rowCount = parseInt(chunkMatch[2], 10);
    }
  }

  // Global fetches (once per chunk)
  let currentChunkForGlobal = 0;
  for (const row of validationGlobalFetches) {
    const msg = row.message;
    // Try to infer chunk from surrounding context — use the last seen chunk index
    // (global fetches fire right after chunk start)
    if (msg.includes('Fetched existing users')) {
      const ms = extractMs(msg);
      if (ms !== null) ensureBundle(currentChunkForGlobal).existingUsersMs = ms;
    }
    if (msg.includes('Fetched batch size from redis')) {
      const ms = extractMs(msg);
      if (ms !== null) ensureBundle(currentChunkForGlobal).redisBatchSizeMs = ms;
    }
  }

  // Also scan validationPerRowRaw for chunk boundaries to track currentChunk for global fetches
  // (global fetches are interleaved with per-row logs in the same operation)
  let currentChunk = 0;
  for (const row of validationPerRowRaw) {
    const msg = row.message;
    const chunkMatch = msg.match(/Processing generic update chunk\s+(\d+)/i);
    if (chunkMatch) { currentChunk = parseInt(chunkMatch[1], 10); continue; }
    if (msg.includes('Fetched existing users')) {
      const ms = extractMs(msg);
      if (ms !== null) ensureBundle(currentChunk).existingUsersMs = ms;
    }
    if (msg.includes('Fetched batch size from redis')) {
      const ms = extractMs(msg);
      if (ms !== null) ensureBundle(currentChunk).redisBatchSizeMs = ms;
    }
  }

  result.validationBundleStats = [...bundleMap.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);

  // ── VALIDATION — Batch logs ───────────────────────────────────────────
  // "BulkInsert for rows {start} to {end} took {ms} ms" — 1× per 500-row batch
  for (const row of validationRows) {
    const msg = row.message;
    if (msg.includes('BulkInsert for rows')) {
      const ms = extractMs(msg);
      const rangeMatch = msg.match(/rows\s+(\d+)\s+to\s+(\d+)/i);
      if (ms !== null && rangeMatch) {
        result.validationBatchStats.push({
          startRow: parseInt(rangeMatch[1], 10),
          endRow: parseInt(rangeMatch[2], 10),
          bulkInsertMs: ms,
          timestamp: row.timestamp,
        });
      }
    }
  }

  // ── VALIDATION — Row aggregates (from KQL summarize) ─────────────────
  // These are the 26 per-row steps from UploadGenericUpdateAccountDataWithValidations
  // KQL already excludes BulkInsert, Fetched batch size, Fetched existing users
  for (const row of validationAggRows) {
    const r = row as any;
    if (r.step != null && String(r.step).trim())
      result.validationRowStats.push({
        stepName: String(r.step).trim(),
        avgMs: parseFloat(r.avg_ms ?? 0) || 0,
        maxMs: parseFloat(r.max_ms ?? 0) || 0,
        occurrences: parseInt(r.count_ ?? 0, 10) || 0,
      });
  }

  // ── SUBMISSION — Stage logs ───────────────────────────────────────────
  // 1× per job: MappedContentCount fetch, Dictionary created, Global DB fetch
  for (const row of submissionRows) {
    const msg = row.message;

    if (msg.includes('MappedContentCount')) {
      const ms = extractMs(msg) ?? extractNumber(msg, /fetch:\s*(\d+)/i);
      const rc = msg.match(/total rows\((\d+)\)/i);
      if (rc) result.counts.mappedContentCount = parseInt(rc[1], 10);
      result.submissionStageStats.push({
        stepName: 'MappedContent & total rows fetch',
        valueMs: ms,
        extra: rc ? `${rc[1]} rows` : undefined,
      });
    }
    if (msg.includes('Dictionary created')) {
      const ms = extractMs(msg);
      const entries = extractNumber(msg, /with\s+(\d+)\s+entries/i);
      result.submissionStageStats.push({
        stepName: 'Dictionary build',
        valueMs: ms,
        extra: entries != null ? `${entries} entries` : undefined,
      });
      if (entries != null) result.counts.dictionaryEntries = entries;
    }
    if (msg.includes('Global DB fetch')) {
      const ms = extractMs(msg) ?? extractNumber(msg, /fetch:\s*(\d+)/i);
      result.submissionStageStats.push({ stepName: 'Global DB fetch', valueMs: ms });
    }
  }

  // ── SUBMISSION — Bundle logs ──────────────────────────────────────────
  // Log order per bundle (from the doc):
  //   1. Data Count (line 362) — NO bundle idx, fires BEFORE "For bundle"
  //   2. Attributes Status fetch started (line 402)
  //   3. For bundle {idx}: startRow=... endRow=... Status Attributes Count: N (line 413)
  //   4. Bundle DB fetch for {idx}: {ms} (line 486)
  //
  // Because Data Count fires BEFORE "For bundle", we can't use lastBundleIdx
  // from the current bundle. Instead: sort all rows by timestamp, track which
  // bundle index is "next" by watching "For bundle" logs, and assign Data Count
  // to the bundle whose "For bundle" log comes immediately after it.
  //
  // Simpler approach: collect all rows with timestamps, sort, then do two passes:
  //   Pass 1: build a timeline of (timestamp → bundleIdx) from "For bundle" logs
  //   Pass 2: for each "Data Count" log, find the next "For bundle" timestamp → that's its bundle

  const subBundleMap = new Map<number, SubmissionBundleStat>();
  const ensureSubBundle = (idx: number) => {
    if (!subBundleMap.has(idx))
      subBundleMap.set(idx, {
        bundleIdx: idx, startRow: null, endRow: null, attributeCount: null,
        bundleDbFetchMs: null, accountIds: null, linkedAccountIds: null,
        customFields: null, bankruptcyRecords: null,
      });
    return subBundleMap.get(idx)!;
  };

  // Pass 1: collect "For bundle" timestamps → bundleIdx mapping
  const forBundleTimeline: { ts: number; bundleIdx: number }[] = [];
  for (const row of submissionRows) {
    const msg = row.message;
    if (msg.includes('For bundle')) {
      const idxMatch = msg.match(/For bundle\s+(\d+)/i);
      if (idxMatch) {
        forBundleTimeline.push({ ts: new Date(row.timestamp).getTime(), bundleIdx: parseInt(idxMatch[1], 10) });
      }
    }
  }
  forBundleTimeline.sort((a, b) => a.ts - b.ts);

  // Pass 2: process all bundle-level logs
  for (const row of submissionRows) {
    const msg = row.message;
    const rowTs = new Date(row.timestamp).getTime();

    if (msg.includes('For bundle')) {
      const idxMatch = msg.match(/For bundle\s+(\d+)/i);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
      const b = ensureSubBundle(idx);
      b.startRow = extractNumber(msg, /startRow\s*=\s*(\d+)/i);
      b.endRow = extractNumber(msg, /endRow\s*=\s*(\d+)/i);
      b.attributeCount = extractNumber(msg, /Status Attributes Count\s*:\s*(\d+)/i);
    }
    if (msg.includes('Bundle DB fetch')) {
      const idxMatch = msg.match(/fetch for\s+(\d+)/i);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
      const ms = extractNumber(msg, /fetch for\s+\d+:\s*(\d+)/i);
      ensureSubBundle(idx).bundleDbFetchMs = ms;
    }
    if (msg.includes('Data Count')) {
      // Data Count fires BEFORE "For bundle" for the same bundle.
      // Find the next "For bundle" log after this timestamp — that's the bundle it belongs to.
      const nextBundle = forBundleTimeline.find(fb => fb.ts >= rowTs);
      const idx = nextBundle ? nextBundle.bundleIdx : (forBundleTimeline[forBundleTimeline.length - 1]?.bundleIdx ?? 0);
      const b = ensureSubBundle(idx);
      b.accountIds = extractNumber(msg, /Account IDs:\s*(\d+)/i);
      b.linkedAccountIds = extractNumber(msg, /Linked Account IDs:\s*(\d+)/i);
      b.customFields = extractNumber(msg, /Custom Fields:\s*(\d+)/i);
      b.bankruptcyRecords = extractNumber(msg, /Bankruptcy Records:\s*(\d+)/i);
      result.counts.accountIds = b.accountIds;
      result.counts.linkedAccountIds = b.linkedAccountIds;
      result.counts.customFields = b.customFields;
      result.counts.bankruptcyRecords = b.bankruptcyRecords;
    }
  }

  result.submissionBundleStats = [...subBundleMap.values()].sort((a, b) => a.bundleIdx - b.bundleIdx);

  // ── SUBMISSION — Batch logs ───────────────────────────────────────────
  // KEY INSIGHT: batchIdx resets to 0 for every bundle.
  // Bundle 0 has batches 0, 500, 1000, 1500, 2000
  // Bundle 1 has batches 0, 500, 1000, 1500, 2000  ← same numbers!
  // So we CANNOT key by batchIdx alone — we must track which bundle we're
  // currently inside (by watching "For bundle" and "Bulk Processing" logs in
  // timestamp order) and use a composite key: `${currentBundleIdx}:${batchIdx}`.

  // Build a sorted timeline of bundle start timestamps from the already-parsed
  // forBundleTimeline (built during bundle parsing above).
  // For each batch log, find the bundle whose "For bundle" log most recently
  // preceded it in time — that's the bundle this batch belongs to.

  const subBatchMap = new Map<string, SubmissionBatchStat>();

  // Helper: given a log timestamp, find the bundleIdx whose "For bundle" log
  // fired most recently before (or at) that timestamp.
  const bundleIdxAtTime = (ts: number): number => {
    let best = forBundleTimeline[0]?.bundleIdx ?? 0;
    for (const fb of forBundleTimeline) {
      if (fb.ts <= ts) best = fb.bundleIdx;
      else break;
    }
    return best;
  };

  const ensureSubBatch = (compositeKey: string, batchIdx: number, bundleIdx: number): SubmissionBatchStat => {
    if (!subBatchMap.has(compositeKey))
      subBatchMap.set(compositeKey, {
        batchIdx,
        bundleIdx,
        startRow: batchIdx,
        endRow: null,    // resolved after batch size is known
        loopProcessingMs: null,
        bulkProcessingMs: null,
        startTime: null,
        endTime: null,
      });
    return subBatchMap.get(compositeKey)!;
  };

  for (const row of submissionRows) {
    const msg = row.message;
    const rowTs = new Date(row.timestamp).getTime();
    const bm = msg.match(/batch\s+(\d+)/i);
    const batchIdx = bm ? parseInt(bm[1], 10) : 0;
    const bundleIdx = bundleIdxAtTime(rowTs);
    const key = `${bundleIdx}:${batchIdx}`;

    if (msg.includes('Loop Processing batch')) {
      const ms = extractNumber(msg, /batch\s+\d+:\s*(\d+)/i);
      ensureSubBatch(key, batchIdx, bundleIdx).loopProcessingMs = ms;
    }
    if (msg.includes('Bulk Processing started')) {
      ensureSubBatch(key, batchIdx, bundleIdx).startTime = row.timestamp;
    }
    if (msg.includes('Bulk Processing ended')) {
      const sec = extractSec(msg);
      const b = ensureSubBatch(key, batchIdx, bundleIdx);
      b.endTime = row.timestamp;
      b.bulkProcessingMs = sec !== null ? sec * 1000 : null;
    }
  }

  // Resolve batch size and endRow for each batch
  // Sort by (bundleIdx asc, batchIdx asc) for consistent ordering
  const sortedBatches = [...subBatchMap.values()].sort((a, b) =>
    a.bundleIdx !== b.bundleIdx ? a.bundleIdx - b.bundleIdx : a.batchIdx - b.batchIdx
  );

  // Infer batch size from the gap between consecutive batchIdx values within a bundle
  let batchSize = 500; // default
  const batchIdxsInFirstBundle = sortedBatches
    .filter(b => b.bundleIdx === (sortedBatches[0]?.bundleIdx ?? 0))
    .map(b => b.batchIdx)
    .sort((a, b) => a - b);
  if (batchIdxsInFirstBundle.length >= 2) {
    const gaps = batchIdxsInFirstBundle.slice(1)
      .map((v, i) => v - batchIdxsInFirstBundle[i])
      .filter(g => g > 0);
    if (gaps.length > 0) batchSize = Math.min(...gaps);
  }

  for (const batch of sortedBatches) {
    batch.endRow = batch.batchIdx + batchSize - 1;
  }

  result.submissionBatchStats = sortedBatches;

  // ── SUBMISSION — Row aggregates (from KQL summarize) ─────────────────
  // 26 per-row steps: Checkpoint logs + MpStatusFetch + BKY logs
  for (const row of submissionAggRows) {
    const r = row as any;
    if (r.step != null && String(r.step).trim())
      result.submissionRowStats.push({
        stepName: String(r.step).trim(),
        avgMs: parseFloat(r.avg_ms ?? 0) || 0,
        maxMs: parseFloat(r.max_ms ?? 0) || 0,
        occurrences: parseInt(r.count_ ?? 0, 10) || 0,
      });
  }

  // ── Errors ────────────────────────────────────────────────────────────
  for (const row of errorRows) {
    if ((row.severityLevel ?? 0) >= 3)
      result.errors.push({
        timestamp: new Date(row.timestamp),
        message: row.message.substring(0, 300),
        pod: row.cloud_RoleInstance,
        operationId: row.operation_Id,
      });
  }

  return result;
}
