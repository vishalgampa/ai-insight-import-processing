/**
 * Fetches import pipeline logs from Azure Application Insights.
 *
 * Hop chain:
 *   clientFileUploadId → anchor logs → pod + time window per step
 *   Each step: try operationId first, fallback to pod + time window
 *   Submission: SaveApprovedRecords is just a k8s trigger;
 *     actual job starts in a new pod — found by time proximity
 *   Errors: scoped by operationId per step, fallback to pod + timestamps
 */

import { PATTERNS, SUBMISSION_SEARCH_WINDOW_MINUTES } from './knownPatterns';

export type QueryFn = (kql: string) => Promise<RawRow[]>;

export interface RawRow {
  timestamp: string;
  message: string;
  operation_Id: string;
  cloud_RoleInstance: string;
  severityLevel?: number;
}

export interface AnchorInfo {
  clientFileUploadId: string;
  rowCount: number | null;
  validateStartTime: Date | null;
  validateEndTime: Date | null;
  validatePod: string | null;
  validateOperationId: string | null;
  saveStartTime: Date | null;
  saveEndTime: Date | null;
  savePod: string | null;
}

/** Resolved IDs and timestamps for each step — exposed to UI */
export interface StepMeta {
  operationId: string | null;
  pod: string | null;
  startTime: Date | null;
  endTime: Date | null;
}

export interface FetchDiagnostics {
  anchorFound: boolean;
  anchorRowCount: number;
  validationFound: boolean;
  submissionFound: boolean;
  noDataReason: string | null;  // null = data found, string = human-readable reason
}

export interface StepLogs {
  anchor: AnchorInfo;
  diagnostics: FetchDiagnostics;
  mappingMeta: StepMeta;
  validationMeta: StepMeta;
  submissionMeta: StepMeta;
  k8sTriggerMeta: StepMeta;
  mappingRows: RawRow[];
  validationRows: RawRow[];
  validationAggRows: RawRow[];
  validationPerRowRaw: RawRow[];
  validationGlobalFetches: RawRow[];  // one-time fetches per chunk (redis, existing users)
  submissionRows: RawRow[];
  submissionRawAll: RawRow[];
  submissionAggRows: RawRow[];     // aggregated per-checkpoint stats
  submissionCountRows: RawRow[];
  errorRows: RawRow[];
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}
function fmtDt(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

const DEBUG = process.env.IMPORT_LOG_DEBUG === '1';
function dbg(section: string, ...args: any[]) {
  if (!DEBUG) return;
  console.log(`[ImportLogFetcher:${section}]`, ...args);
}

export class ImportLogFetcher {
  constructor(private query: QueryFn) {}

  async fetchAll(clientFileUploadId: string): Promise<StepLogs> {
    dbg('START', `fetchAll for ID: ${clientFileUploadId}`);

    // ── Step 1: anchor ────────────────────────────────────────────────
    // WHY: The anchor query is the only one that uses the clientFileUploadId.
    // All subsequent queries derive their time windows and operationIds from
    // what this returns. If this is wrong, everything downstream is wrong.
    const anchorKql = `
      traces
      | where timestamp > ago(90d)
      | where message contains '${clientFileUploadId}'
      | project timestamp, message, operation_Id, cloud_RoleInstance
      | order by timestamp asc
    `;
    dbg('ANCHOR', 'KQL:', anchorKql.trim());
    const anchorRows = await this.query(anchorKql);
    dbg('ANCHOR', `returned ${anchorRows.length} rows`);
    if (DEBUG) {
      anchorRows.forEach((r, i) =>
        console.log(`  [anchor row ${i}] ${r.timestamp} | opId=${r.operation_Id} | pod=${r.cloud_RoleInstance} | msg=${r.message.substring(0, 120)}`)
      );
    }

    const anchor = this.parseAnchor(clientFileUploadId, anchorRows);
    // WHY: Log the parsed anchor so you can see exactly what timestamps and
    // operationIds were extracted. This is the most common source of bugs —
    // a wrong saveStartTime means the submission search window is wrong.
    dbg('ANCHOR:parsed', JSON.stringify({
      validateStartTime: anchor.validateStartTime?.toISOString() ?? null,
      validateEndTime:   anchor.validateEndTime?.toISOString()   ?? null,
      validatePod:       anchor.validatePod,
      validateOperationId: anchor.validateOperationId,
      saveStartTime:     anchor.saveStartTime?.toISOString()     ?? null,
      saveEndTime:       anchor.saveEndTime?.toISOString()       ?? null,
      savePod:           anchor.savePod,
      rowCount:          anchor.rowCount,
    }, null, 2));

    // ── Diagnostics ───────────────────────────────────────────────────
    const diagnostics: FetchDiagnostics = {
      anchorFound: anchorRows.length > 0,
      anchorRowCount: anchorRows.length,
      validationFound: false,
      submissionFound: false,
      noDataReason: null,
    };

    if (anchorRows.length === 0) {
      diagnostics.noDataReason = `No logs found containing ID "${clientFileUploadId}" in the last 90 days. The ID may be incorrect, or logs may have expired.`;
    } else if (!anchor.validateStartTime && !anchor.saveStartTime) {
      diagnostics.noDataReason = `Found ${anchorRows.length} log(s) with this ID but none matched the expected "ValidateGenericUpdateContent started" or "SaveApprovedRecords started" patterns. The import may not have been triggered, or log format may differ.`;
    }

    // k8s trigger meta (SaveApprovedRecords controller call)
    const k8sTriggerMeta: StepMeta = {
      operationId: null,
      pod: anchor.savePod,
      startTime: anchor.saveStartTime,
      endTime: anchor.saveEndTime,
    };

    // ── Step 2: mapping ───────────────────────────────────────────────
    let mappingRows: RawRow[] = [];
    const mappingMeta: StepMeta = { operationId: null, pod: null, startTime: null, endTime: null };

    if (anchor.validateStartTime) {
      const t1 = fmtDt(addMinutes(anchor.validateStartTime, -30));
      const t2 = fmtDt(addMinutes(anchor.validateStartTime, 5));
      mappingRows = await this.query(`
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where message contains 'ImportgenericUpdateFileMapping'
               or message contains 'GetGenericClientFileMappedContent'
        | project timestamp, message, operation_Id, cloud_RoleInstance
        | order by timestamp asc
      `).catch(() => []);

      if (mappingRows.length > 0) {
        mappingMeta.operationId = mappingRows[0].operation_Id || null;
        mappingMeta.pod = mappingRows[0].cloud_RoleInstance || null;
        mappingMeta.startTime = new Date(mappingRows[0].timestamp);
        mappingMeta.endTime = new Date(mappingRows[mappingRows.length - 1].timestamp);
      }
    }

    // ── Step 3: validation ────────────────────────────────────────────
    let validationRows: RawRow[] = [];
    let validationAggRows: RawRow[] = [];
    const validationMeta: StepMeta = {
      operationId: anchor.validateOperationId,
      pod: anchor.validatePod,
      startTime: anchor.validateStartTime,
      endTime: anchor.validateEndTime,
    };

    const valOpId = anchor.validateOperationId;
    if (valOpId) {
      validationRows = await this.fetchValidationByOpId(valOpId);
      validationAggRows = await this.fetchValidationAggByOpId(valOpId);
    } else if (anchor.validateStartTime && anchor.validatePod) {
      const t1 = fmtDt(addMinutes(anchor.validateStartTime, -1));
      const t2 = fmtDt(addMinutes(anchor.validateStartTime, 60));
      // Find operationId from the actual validation start log
      const startLogs = await this.query(`
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where cloud_RoleInstance contains '${anchor.validatePod.split('.')[0]}'
        | where message contains 'ImportGenericUpdateFile: ImportGenericUpdateFile started'
        | project timestamp, message, operation_Id, cloud_RoleInstance
        | order by timestamp asc
        | take 5
      `).catch(() => []);

      const opId = startLogs[0]?.operation_Id || null;
      if (opId) {
        validationMeta.operationId = opId;
        validationMeta.pod = startLogs[0].cloud_RoleInstance;
        validationRows = await this.fetchValidationByOpId(opId);
        validationAggRows = await this.fetchValidationAggByOpId(opId);
      } else {
        // Last resort: pod + time window
        validationRows = await this.query(`
          traces
          | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
          | where cloud_RoleInstance contains '${anchor.validatePod.split('.')[0]}'
          | where message contains 'ImportGenericUpdateFile:'
          | where message !contains '${PATTERNS.validation.excludeChunk}'
                 and message !contains '${PATTERNS.validation.excludeIdentifiers}'
          | project timestamp, message, operation_Id, cloud_RoleInstance
          | order by timestamp asc
        `).catch(() => []);
      }
    }

    // Refine validation start/end from actual logs
    if (validationRows.length > 0) {
      for (const r of validationRows) {
        if (r.message.includes('ImportGenericUpdateFile started')) {
          validationMeta.startTime = new Date(r.timestamp);
          if (!validationMeta.operationId) validationMeta.operationId = r.operation_Id || null;
          if (!validationMeta.pod) validationMeta.pod = r.cloud_RoleInstance || null;
        }
        if (r.message.includes('ImportGenericUpdateFile ended')) {
          validationMeta.endTime = new Date(r.timestamp);
        }
      }
    }

    // ── Step 4: submission ────────────────────────────────────────────
    let submissionRows: RawRow[] = [];
    let submissionCountRows: RawRow[] = [];
    const submissionMeta: StepMeta = { operationId: null, pod: null, startTime: null, endTime: null };

    if (anchor.saveStartTime) {
      const t1 = fmtDt(anchor.saveStartTime);
      const t2 = fmtDt(addMinutes(anchor.saveStartTime, SUBMISSION_SEARCH_WINDOW_MINUTES));

      // WHY: SaveApprovedRecords is just a k8s trigger — it does NOT contain the
      // clientFileUploadId in the submission job logs. We find the real submission
      // operationId by searching for MappedContentCount in the time window after
      // SaveApprovedRecords fired. If this search returns nothing, submission logs
      // will be empty even if they exist — check the window and the log message.
      const subStartKql = `
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where message contains 'ImportGenericUpdateApprovedContent: MappedContentCount'
        | project timestamp, message, operation_Id, cloud_RoleInstance
        | order by timestamp desc
        | take 1
      `;
      dbg('SUBMISSION:search', `window: ${t1} → ${t2} (${SUBMISSION_SEARCH_WINDOW_MINUTES} min)`);
      dbg('SUBMISSION:search', 'KQL:', subStartKql.trim());

      const subStartLogs = await this.query(subStartKql).catch((err) => {
        dbg('SUBMISSION:search', 'QUERY ERROR:', err?.message ?? err);
        return [] as RawRow[];
      });

      // WHY: This is the critical branch. If subStartLogs is empty it means either:
      //   1. The time window is wrong (saveStartTime parsed incorrectly)
      //   2. The submission job hasn't run yet
      //   3. The MappedContentCount log message format changed
      //   4. The App Insights timespan param is filtering it out
      dbg('SUBMISSION:search', `returned ${subStartLogs.length} rows`);
      if (DEBUG) {
        subStartLogs.forEach((r, i) =>
          console.log(`  [sub row ${i}] ${r.timestamp} | opId=${r.operation_Id} | pod=${r.cloud_RoleInstance} | msg=${r.message.substring(0, 120)}`)
        );
      }

      const subOpId = subStartLogs[0]?.operation_Id || null;
      dbg('SUBMISSION:operationId', subOpId ?? 'NOT FOUND — submission logs will be empty');

      if (subOpId) {
        submissionMeta.operationId = subOpId;
        submissionMeta.pod = subStartLogs[0].cloud_RoleInstance || null;
        dbg('SUBMISSION:rows', `fetching all submission rows for opId=${subOpId}`);

        submissionRows = await this.query(`
          traces
          | where operation_Id == '${subOpId}'
          | where message contains 'ImportGenericUpdateApprovedContent'
          | where message !contains '${PATTERNS.submission.excludeBatch}'
                 and message !contains '${PATTERNS.submission.excludeRow}'
                 and message !contains '${PATTERNS.submission.excludeBky}'
          | project timestamp, message, operation_Id, cloud_RoleInstance
          | order by timestamp asc
        `).catch(() => []);

        submissionCountRows = await this.query(`
          traces
          | where operation_Id == '${subOpId}'
          | where message contains 'Data Count'
                 or message contains 'MappedContentCount'
                 or message contains 'Dictionary created'
                 or message contains 'total rows'
          | project timestamp, message, operation_Id, cloud_RoleInstance
          | order by timestamp asc
        `).catch(() => []);

        // Refine submission start/end from actual logs
        for (const r of submissionRows) {
          if (r.message.includes('Bulk Processing started') && !submissionMeta.startTime) {
            submissionMeta.startTime = new Date(r.timestamp);
          }
          if (r.message.includes('Bulk Processing ended')) {
            submissionMeta.endTime = new Date(r.timestamp);
          }
        }
        // Fallback: use first/last row timestamps
        if (!submissionMeta.startTime && submissionRows.length > 0)
          submissionMeta.startTime = new Date(submissionRows[0].timestamp);
        if (!submissionMeta.endTime && submissionRows.length > 0)
          submissionMeta.endTime = new Date(submissionRows[submissionRows.length - 1].timestamp);

        dbg('SUBMISSION:rows', `submissionRows=${submissionRows.length}, countRows=${submissionCountRows.length}`);
      }
    } else {
      // WHY: If we reach here, parseAnchor found no SaveApprovedRecords log.
      // Either the file was never submitted, or the anchor query missed it.
      dbg('SUBMISSION:skip', 'anchor.saveStartTime is null — skipping submission search');
    }

    // ── Step 5: errors ────────────────────────────────────────────────
    // Try operationIds first (validation then submission), fallback to pod + timestamps
    const errorRows = await this.fetchErrors(
      validationMeta,
      submissionMeta,
      anchor,
    );

    // ── Step 6: raw drill-down data ───────────────────────────────────
    const validationPerRowRaw = validationMeta.operationId
      ? await this.fetchValidationPerRowRaw(validationMeta.operationId)
      : [];

    const validationGlobalFetches = validationMeta.operationId
      ? await this.fetchValidationGlobalFetches(validationMeta.operationId)
      : [];

    const [submissionRawAll, submissionAggRows] = submissionMeta.operationId
      ? await Promise.all([
          this.fetchSubmissionRaw(submissionMeta.operationId),
          this.fetchSubmissionAgg(submissionMeta.operationId),
        ])
      : [[], []];

    // Finalise diagnostics
    diagnostics.validationFound = validationRows.length > 0;
    diagnostics.submissionFound = submissionRows.length > 0;
    if (!diagnostics.noDataReason) {
      if (!diagnostics.validationFound && !diagnostics.submissionFound) {
        diagnostics.noDataReason = anchor.validateStartTime
          ? `Anchor logs found (validation triggered at ${anchor.validateStartTime.toISOString()}) but no validation or submission logs could be retrieved. The operation_Id may have changed or logs may be in a different App Insights resource.`
          : anchor.saveStartTime
          ? `SaveApprovedRecords was triggered at ${anchor.saveStartTime.toISOString()} but no submission job logs found within ${SUBMISSION_SEARCH_WINDOW_MINUTES} minutes. The Kubernetes job may not have started, or submission is still in progress.`
          : null;
      } else if (!diagnostics.submissionFound && diagnostics.validationFound) {
        diagnostics.noDataReason = null; // partial data is fine, not an error
      }
    }

    // WHY: Final summary — if submissionFound is false after all the above,
    // the logs above will tell you exactly which step failed to find data.
    dbg('SUMMARY', JSON.stringify({
      anchorRows:       anchorRows.length,
      mappingRows:      mappingRows.length,
      validationRows:   validationRows.length,
      submissionRows:   submissionRows.length,
      errorRows:        errorRows.length,
      validationOpId:   validationMeta.operationId,
      submissionOpId:   submissionMeta.operationId,
      saveStartTime:    anchor.saveStartTime?.toISOString() ?? null,
      diagnostics,
    }, null, 2));

    return {
      anchor,
      diagnostics,
      mappingMeta, validationMeta, submissionMeta, k8sTriggerMeta,
      mappingRows, validationRows, validationAggRows, validationPerRowRaw, validationGlobalFetches,
      submissionRows, submissionRawAll, submissionAggRows, submissionCountRows,
      errorRows,
    };
  }

  private async fetchErrors(
    validationMeta: StepMeta,
    submissionMeta: StepMeta,
    anchor: AnchorInfo,
  ): Promise<RawRow[]> {
    const results: RawRow[] = [];

    // Try validation operationId
    if (validationMeta.operationId) {
      const rows = await this.query(`
        traces
        | where operation_Id == '${validationMeta.operationId}'
        | where severityLevel >= 3
        | project timestamp, message, operation_Id, cloud_RoleInstance, severityLevel
        | order by timestamp asc
        | take 50
      `).catch(() => []);
      results.push(...rows);
    } else if (validationMeta.pod && validationMeta.startTime && validationMeta.endTime) {
      // Fallback: pod + time window
      const t1 = fmtDt(validationMeta.startTime);
      const t2 = fmtDt(addMinutes(validationMeta.endTime, 5));
      const rows = await this.query(`
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where cloud_RoleInstance contains '${validationMeta.pod.split('.')[0]}'
        | where severityLevel >= 3
        | project timestamp, message, operation_Id, cloud_RoleInstance, severityLevel
        | order by timestamp asc
        | take 50
      `).catch(() => []);
      results.push(...rows);
    }

    // Try submission operationId
    if (submissionMeta.operationId) {
      const rows = await this.query(`
        traces
        | where operation_Id == '${submissionMeta.operationId}'
        | where severityLevel >= 3
        | project timestamp, message, operation_Id, cloud_RoleInstance, severityLevel
        | order by timestamp asc
        | take 50
      `).catch(() => []);
      results.push(...rows);
    } else if (submissionMeta.pod && submissionMeta.startTime && submissionMeta.endTime) {
      const t1 = fmtDt(submissionMeta.startTime);
      const t2 = fmtDt(addMinutes(submissionMeta.endTime, 5));
      const rows = await this.query(`
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where cloud_RoleInstance contains '${submissionMeta.pod.split('.')[0]}'
        | where severityLevel >= 3
        | project timestamp, message, operation_Id, cloud_RoleInstance, severityLevel
        | order by timestamp asc
        | take 50
      `).catch(() => []);
      results.push(...rows);
    }

    // Fallback: k8s trigger pod + save time window (catches controller-level errors)
    if (results.length === 0 && anchor.savePod && anchor.saveStartTime) {
      const t1 = fmtDt(addMinutes(anchor.saveStartTime, -1));
      const t2 = fmtDt(addMinutes(anchor.saveStartTime, SUBMISSION_SEARCH_WINDOW_MINUTES));
      const rows = await this.query(`
        traces
        | where timestamp between (datetime('${t1}') .. datetime('${t2}'))
        | where cloud_RoleInstance contains '${anchor.savePod.split('.')[0]}'
        | where severityLevel >= 3
        | project timestamp, message, operation_Id, cloud_RoleInstance, severityLevel
        | order by timestamp asc
        | take 50
      `).catch(() => []);
      results.push(...rows);
    }

    // Deduplicate by itemId (timestamp + message)
    const seen = new Set<string>();
    return results.filter(r => {
      const key = `${r.timestamp}|${r.message.substring(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async fetchValidationByOpId(opId: string): Promise<RawRow[]> {
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'ImportGenericUpdateFile:'
      | where message !contains '${PATTERNS.validation.excludeChunk}'
             and message !contains '${PATTERNS.validation.excludeIdentifiers}'
      | project timestamp, message, operation_Id, cloud_RoleInstance
      | order by timestamp asc
    `).catch(() => []);
  }

  private async fetchValidationAggByOpId(opId: string): Promise<RawRow[]> {
    // Exclude known one-time global fetches that are NOT per-row:
    // "Fetched batch size from redis", "Fetched existing users"
    // These run once per chunk, not once per row — including them skews avg/count
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'UploadGenericUpdateAccountDataWithValidations:'
      | where message !contains 'BulkInsert for rows'
      | where message !contains 'Fetched batch size from redis'
      | where message !contains 'Fetched existing users'
      | summarize
          avg_ms = avg(todouble(extract(@'(\\d+(?:\\.\\d+)?)\\s*ms', 1, message))),
          max_ms = max(todouble(extract(@'(\\d+(?:\\.\\d+)?)\\s*ms', 1, message))),
          count_ = count()
          by step = extract(@'UploadGenericUpdateAccountDataWithValidations: (.+?) (in|took|for)', 1, message)
      | order by max_ms desc
    `).catch(() => []);
  }

  /** Fetch one-time global fetches separately (not per-row, run once per chunk) */
  async fetchValidationGlobalFetches(opId: string): Promise<RawRow[]> {
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'UploadGenericUpdateAccountDataWithValidations:'
      | where message contains 'Fetched batch size from redis'
             or message contains 'Fetched existing users'
      | project timestamp, message, operation_Id, cloud_RoleInstance
      | order by timestamp asc
    `).catch(() => []);
  }

  /** Fetch ALL per-row checkpoint logs for slow-row detection (includes Batch/Row lines) */
  async fetchValidationPerRowRaw(opId: string): Promise<RawRow[]> {
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'UploadGenericUpdateAccountDataWithValidations:'
      | project timestamp, message, operation_Id, cloud_RoleInstance
      | order by timestamp asc
    `).catch(() => []);
  }

  /** Fetch ALL submission batch/bundle raw rows for drill-down */
  async fetchSubmissionRaw(opId: string): Promise<RawRow[]> {
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'ImportGenericUpdateApprovedContent'
      | project timestamp, message, operation_Id, cloud_RoleInstance
      | order by timestamp asc
    `).catch(() => []);
  }

  /** Aggregated per-row stats for submission — covers Checkpoint, MpStatusFetch, BKY logs */
  async fetchSubmissionAgg(opId: string): Promise<RawRow[]> {
    // Covers all row-level log patterns from the submission process:
    //   "Batch: K Row: J {StepName} Checkpoint: {ms}"
    //   "Batch: K Row: J MpStatusFetch: {ms}"
    //   "Row J | BKY {label}: ... | {ms}ms"
    return this.query(`
      traces
      | where operation_Id == '${opId}'
      | where message contains 'ImportGenericUpdateApprovedContent'
      | where (message contains 'Checkpoint:' and message contains 'Row')
             or message contains 'MpStatusFetch:'
             or (message contains 'BKY ' and message contains 'ms')
      | extend step = case(
          message contains 'MpStatusFetch:',
            'MpStatusFetch',
          message contains 'BKY ',
            trim(' ', extract(@'BKY\\s+([^|]+?)\\s*:', 1, message)),
          trim(' ', extract(@'Row:\\s*\\d+\\s+(.+?)\\s+Checkpoint:', 1, message))
        )
      | extend ms_val = case(
          message contains 'Checkpoint:',
            todouble(extract(@'Checkpoint:\\s*(\\d+(?:\\.\\d+)?)', 1, message)),
          todouble(extract(@'(\\d+(?:\\.\\d+)?)\\s*ms', 1, message))
        )
      | where isnotempty(step) and ms_val > 0
      | summarize
          avg_ms = avg(ms_val),
          max_ms = max(ms_val),
          count_ = count()
          by step
      | order by avg_ms desc
    `).catch(() => []);
  }

  private parseAnchor(clientFileUploadId: string, rows: RawRow[]): AnchorInfo {
    const info: AnchorInfo = {
      clientFileUploadId,
      rowCount: null,
      validateStartTime: null,
      validateEndTime: null,
      validatePod: null,
      validateOperationId: null,
      saveStartTime: null,
      saveEndTime: null,
      savePod: null,
    };

    for (const row of rows) {
      const msg = row.message;
      const ts = new Date(row.timestamp);

      if (msg.includes('ValidateGenericUpdateContent') && msg.includes('started')) {
        info.validateStartTime = ts;
        info.validatePod = row.cloud_RoleInstance;
        info.validateOperationId = row.operation_Id || null;
      }
      if (msg.includes('ValidateGenericUpdateContent') && msg.includes('ended')) {
        info.validateEndTime = ts;
      }
      if (msg.includes('SaveApprovedRecords') && msg.includes('started')) {
        info.saveStartTime = ts;
        info.savePod = row.cloud_RoleInstance;
        const rowMatch = msg.match(/Number of rows in excel:\s*(\d+)/i);
        if (rowMatch) info.rowCount = parseInt(rowMatch[1], 10);
      }
      if (msg.includes('SaveApprovedRecords') && msg.includes('ended')) {
        info.saveEndTime = ts;
      }
    }

    return info;
  }
}
