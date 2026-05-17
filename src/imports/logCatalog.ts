/**
 * Single source of truth for all Generic Update import log patterns.
 *
 * Each entry defines:
 *   - contains: substring(s) that must appear in the message
 *   - level: where in the hierarchy this log fires
 *   - extract: named capture groups to pull out of the message
 *   - valueKey: which extracted field is the primary timing/ms value
 *
 * The parser iterates this catalog instead of having hardcoded if/else chains.
 * To add or change a log: edit this file only.
 */

export type LogLevel = 'process' | 'stage' | 'bundle' | 'batch' | 'row';
export type LogProcess = 'validation' | 'submission' | 'mapping';

export interface ExtractSpec {
  /** Name of the captured value */
  name: string;
  /** Regex with one capture group */
  pattern: RegExp;
  /** 'int' | 'float' | 'string' */
  type: 'int' | 'float' | 'string';
}

export interface LogEntry {
  /** Human-readable name for this log */
  label: string;
  /** Which process this belongs to */
  process: LogProcess;
  /** Hierarchy level */
  level: LogLevel;
  /**
   * All of these substrings must be present in the message.
   * Use an array so multi-word checks are explicit.
   */
  contains: string[];
  /**
   * None of these substrings may be present (used to disambiguate similar logs).
   */
  notContains?: string[];
  /** Named values to extract from the message */
  extract?: ExtractSpec[];
  /** Which extract.name holds the primary ms/duration value */
  valueKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION PROCESS
// ─────────────────────────────────────────────────────────────────────────────

export const VALIDATION_LOGS: LogEntry[] = [
  // ── Process ──────────────────────────────────────────────────────────────
  {
    label: 'Validation started (controller)',
    process: 'validation', level: 'process',
    contains: ['ValidateGenericUpdateContent', 'started'],
    notContains: ['ended'],
  },
  {
    label: 'Validation ended (controller)',
    process: 'validation', level: 'process',
    contains: ['ValidateGenericUpdateContent', 'ended'],
    extract: [{ name: 'durationSec', pattern: /Duration:\s*([\d.]+)\s*sec/i, type: 'float' }],
    valueKey: 'durationSec',
  },
  {
    label: 'ImportGenericUpdateFile started',
    process: 'validation', level: 'process',
    contains: ['ImportGenericUpdateFile: ImportGenericUpdateFile started'],
  },
  {
    label: 'ImportGenericUpdateFile ended',
    process: 'validation', level: 'process',
    contains: ['ImportGenericUpdateFile: ImportGenericUpdateFile ended'],
    extract: [{ name: 'durationSec', pattern: /Duration:\s*([\d.]+)\s*sec/i, type: 'float' }],
    valueKey: 'durationSec',
  },

  // ── Stage ─────────────────────────────────────────────────────────────────
  {
    label: 'All DB Fetches',
    process: 'validation', level: 'stage',
    contains: ['ImportGenericUpdateFile: All DB Fetchs'],
    extract: [{ name: 'ms', pattern: /:\s*(\d+)\s*ms/i, type: 'int' }],
    valueKey: 'ms',
  },
  {
    label: 'Bundle size config',
    process: 'validation', level: 'stage',
    contains: ['ImportGenericUpdateFile: Starting processing with bundle size'],
    extract: [{ name: 'bundleSize', pattern: /bundle size:\s*(\d+)/i, type: 'int' }],
    valueKey: 'bundleSize',
  },
  {
    label: 'BLOB download started',
    process: 'validation', level: 'stage',
    contains: ['ImportGenericUpdateFile: Starting BLOB file download operation'],
  },
  {
    label: 'BLOB download completed',
    process: 'validation', level: 'stage',
    contains: ['ImportGenericUpdateFile: BLOB file download operation completed'],
    extract: [{ name: 'ms', pattern: /completed in\s*(\d+)\s*ms/i, type: 'int' }],
    valueKey: 'ms',
  },
  {
    label: 'Processing all chunks completed',
    process: 'validation', level: 'stage',
    contains: ['ImportGenericUpdateFile: Processing all chunks completed'],
    extract: [{ name: 'ms', pattern: /completed:\s*(\d+)\s*ms/i, type: 'int' }],
    valueKey: 'ms',
  },

  // ── Bundle (1× per 5000-row chunk) ───────────────────────────────────────
  {
    label: 'Chunk started',
    process: 'validation', level: 'bundle',
    contains: ['ImportGenericUpdateFile: Processing generic update chunk'],
    extract: [
      { name: 'chunkIndex', pattern: /chunk\s+(\d+)\s+with/i, type: 'int' },
      { name: 'rowCount',   pattern: /with\s+(\d+)\s+rows/i,  type: 'int' },
    ],
  },
  {
    label: 'Fetched existing users',
    process: 'validation', level: 'bundle',
    contains: ['UploadGenericUpdateAccountDataWithValidations: Fetched existing users'],
    extract: [{ name: 'ms', pattern: /in\s+(\d+)\s*ms/i, type: 'int' }],
    valueKey: 'ms',
  },
  {
    label: 'Fetched batch size from redis',
    process: 'validation', level: 'bundle',
    contains: ['UploadGenericUpdateAccountDataWithValidations: Fetched batch size from redis'],
    extract: [{ name: 'ms', pattern: /in\s+(\d+)\s*ms/i, type: 'int' }],
    valueKey: 'ms',
  },

  // ── Batch (1× per 500-row batch) ─────────────────────────────────────────
  {
    label: 'BulkInsert',
    process: 'validation', level: 'batch',
    contains: ['UploadGenericUpdateAccountDataWithValidations: BulkInsert for rows'],
    extract: [
      { name: 'startRow', pattern: /rows\s+(\d+)\s+to/i,    type: 'int' },
      { name: 'endRow',   pattern: /to\s+(\d+)\s+took/i,    type: 'int' },
      { name: 'ms',       pattern: /took\s+(\d+)\s*ms/i,    type: 'int' },
    ],
    valueKey: 'ms',
  },

  // ── Row (conditional, 26 steps) ───────────────────────────────────────────
  // These all share the same prefix; step name is extracted generically
  {
    label: 'Per-row validation step',
    process: 'validation', level: 'row',
    contains: ['UploadGenericUpdateAccountDataWithValidations:'],
    notContains: [
      'BulkInsert for rows',
      'Fetched existing users',
      'Fetched batch size from redis',
    ],
    extract: [
      { name: 'stepName', pattern: /UploadGenericUpdateAccountDataWithValidations:\s*(.+?)(?:\s+(?:in|took|for)\s+\d)/i, type: 'string' },
      { name: 'ms',       pattern: /(\d+(?:\.\d+)?)\s*ms/i, type: 'float' },
    ],
    valueKey: 'ms',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION PROCESS
// ─────────────────────────────────────────────────────────────────────────────

export const SUBMISSION_LOGS: LogEntry[] = [
  // ── Process ──────────────────────────────────────────────────────────────
  {
    label: 'SaveApprovedRecords started',
    process: 'submission', level: 'process',
    contains: ['SaveApprovedRecords', 'started'],
    notContains: ['ended'],
    extract: [
      { name: 'rowCount', pattern: /Number of rows in excel:\s*(\d+)/i, type: 'int' },
    ],
  },
  {
    label: 'SaveApprovedRecords ended',
    process: 'submission', level: 'process',
    contains: ['SaveApprovedRecords', 'ended'],
    extract: [{ name: 'durationSec', pattern: /Duration:\s*([\d.]+)\s*sec/i, type: 'float' }],
    valueKey: 'durationSec',
  },

  // ── Stage (1× per job) ────────────────────────────────────────────────────
  {
    label: 'MappedContent & total rows fetch',
    process: 'submission', level: 'stage',
    contains: ['ImportGenericUpdateApprovedContent: MappedContentCount'],
    extract: [
      { name: 'totalRows', pattern: /total rows\((\d+)\)/i,  type: 'int' },
      { name: 'ms',        pattern: /fetch:\s*(\d+)/i,       type: 'int' },
    ],
    valueKey: 'ms',
  },
  {
    label: 'Dictionary build',
    process: 'submission', level: 'stage',
    contains: ['ImportGenericUpdateApprovedContent: Dictionary created'],
    extract: [
      { name: 'entries', pattern: /with\s+(\d+)\s+entries/i, type: 'int' },
      { name: 'ms',      pattern: /in\s+(\d+)\s*ms/i,        type: 'int' },
    ],
    valueKey: 'ms',
  },
  {
    label: 'Global DB fetch',
    process: 'submission', level: 'stage',
    contains: ['ImportGenericUpdateApprovedContent: Global DB fetch'],
    extract: [{ name: 'ms', pattern: /fetch:\s*(\d+)/i, type: 'int' }],
    valueKey: 'ms',
  },

  // ── Bundle (1× per 5000-row chunk) ───────────────────────────────────────
  {
    label: 'Data Count',
    process: 'submission', level: 'bundle',
    contains: ['ImportGenericUpdateApprovedContent: Data Count'],
    extract: [
      { name: 'accountIds',       pattern: /Account IDs:\s*(\d+)/i,        type: 'int' },
      { name: 'linkedAccountIds', pattern: /Linked Account IDs:\s*(\d+)/i, type: 'int' },
      { name: 'customFields',     pattern: /Custom Fields:\s*(\d+)/i,       type: 'int' },
      { name: 'bankruptcyRecords',pattern: /Bankruptcy Records:\s*(\d+)/i,  type: 'int' },
    ],
  },
  {
    label: 'For bundle info',
    process: 'submission', level: 'bundle',
    contains: ['ImportGenericUpdateApprovedContent: For bundle'],
    extract: [
      { name: 'bundleIdx',      pattern: /For bundle\s+(\d+)/i,                    type: 'int' },
      { name: 'startRow',       pattern: /startRow\s*=\s*(\d+)/i,                  type: 'int' },
      { name: 'endRow',         pattern: /endRow\s*=\s*(\d+)/i,                    type: 'int' },
      { name: 'attributeCount', pattern: /Status Attributes Count\s*:\s*(\d+)/i,   type: 'int' },
    ],
  },
  {
    label: 'Bundle DB fetch',
    process: 'submission', level: 'bundle',
    contains: ['ImportGenericUpdateApprovedContent: Bundle DB fetch'],
    extract: [
      { name: 'bundleIdx', pattern: /fetch for\s+(\d+)/i,          type: 'int' },
      { name: 'ms',        pattern: /fetch for\s+\d+:\s*(\d+)/i,   type: 'int' },
    ],
    valueKey: 'ms',
  },

  // ── Batch (1× per 500-row batch) ─────────────────────────────────────────
  {
    label: 'Loop Processing',
    process: 'submission', level: 'batch',
    contains: ['ImportGenericUpdateApprovedContent: Loop Processing batch'],
    extract: [
      { name: 'batchIdx', pattern: /batch\s+(\d+)/i,    type: 'int' },
      { name: 'ms',       pattern: /batch\s+\d+:\s*(\d+)/i, type: 'int' },
    ],
    valueKey: 'ms',
  },
  {
    label: 'Bulk Processing started',
    process: 'submission', level: 'batch',
    contains: ['ImportGenericUpdateApprovedContent Bulk Processing started'],
    extract: [{ name: 'batchIdx', pattern: /batch\s+(\d+)/i, type: 'int' }],
  },
  {
    label: 'Bulk Processing ended',
    process: 'submission', level: 'batch',
    contains: ['ImportGenericUpdateApprovedContent Bulk Processing ended'],
    extract: [
      { name: 'batchIdx',    pattern: /batch\s+(\d+)/i,                    type: 'int' },
      { name: 'durationSec', pattern: /Duration:\s*([\d.]+)\s*sec/i,       type: 'float' },
    ],
    valueKey: 'durationSec',
  },

  // ── Row (unconditional, fires on every row) ───────────────────────────────
  {
    label: 'Checkpoint row step',
    process: 'submission', level: 'row',
    contains: ['ImportGenericUpdateApprovedContent', 'Checkpoint:'],
    notContains: ['Bulk Processing'],
    extract: [
      { name: 'batchIdx', pattern: /Batch:\s*(\d+)/i,                              type: 'int' },
      { name: 'rowIdx',   pattern: /Row:\s*(\d+)/i,                                type: 'int' },
      { name: 'stepName', pattern: /Row:\s*\d+\s+(.+?)\s+Checkpoint:/i,            type: 'string' },
      { name: 'ms',       pattern: /Checkpoint:\s*(\d+(?:\.\d+)?)/i,               type: 'float' },
    ],
    valueKey: 'ms',
  },
  {
    label: 'MpStatusFetch row step',
    process: 'submission', level: 'row',
    contains: ['ImportGenericUpdateApprovedContent', 'MpStatusFetch:'],
    extract: [
      { name: 'batchIdx', pattern: /Batch:\s*(\d+)/i,          type: 'int' },
      { name: 'rowIdx',   pattern: /Row:\s*(\d+)/i,            type: 'int' },
      { name: 'ms',       pattern: /MpStatusFetch:\s*(\d+)/i,  type: 'float' },
    ],
    valueKey: 'ms',
  },
  {
    label: 'BKY row step',
    process: 'submission', level: 'row',
    contains: ['ImportGenericUpdateApprovedContent', 'BKY '],
    extract: [
      { name: 'rowIdx',   pattern: /Row\s+(\d+)/i,                          type: 'int' },
      { name: 'stepName', pattern: /BKY\s+([^|]+?)\s*:/i,                   type: 'string' },
      { name: 'ms',       pattern: /\|\s*(\d+(?:\.\d+)?)\s*ms/i,            type: 'float' },
    ],
    valueKey: 'ms',
  },
];

export const ALL_LOGS = [...VALIDATION_LOGS, ...SUBMISSION_LOGS];

// ─────────────────────────────────────────────────────────────────────────────
// Generic matcher — apply a LogEntry to a message string
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractedValues = Record<string, string | number | null>;

export function matchLog(entry: LogEntry, message: string): ExtractedValues | null {
  // All contains must match
  if (!entry.contains.every(s => message.includes(s))) return null;
  // None of notContains may match
  if (entry.notContains?.some(s => message.includes(s))) return null;

  // Extract named values
  const values: ExtractedValues = {};
  for (const spec of entry.extract ?? []) {
    const m = message.match(spec.pattern);
    if (!m) { values[spec.name] = null; continue; }
    if (spec.type === 'int')    values[spec.name] = parseInt(m[1], 10);
    else if (spec.type === 'float') values[spec.name] = parseFloat(m[1]);
    else values[spec.name] = m[1];
  }
  return values;
}
