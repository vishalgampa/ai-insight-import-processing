/**
 * Known log message patterns for the Generic Update import pipeline.
 * Mapping → Validation → Submission (each step can run on a different pod/operationId)
 */

export const PATTERNS = {
  // ── Anchor (clientFileUploadId appears here) ──────────────────────────
  anchor: {
    validateStarted:   'ValidateGenericUpdateContent for',   // + clientFileUploadId + 'started'
    validateEnded:     'ValidateGenericUpdateContent for',   // + clientFileUploadId + 'ended'
    saveStarted:       'SaveApprovedRecords for',            // + clientFileUploadId + 'started'
    saveEnded:         'SaveApprovedRecords for',            // + clientFileUploadId + 'ended'
  },

  // ── Mapping step ──────────────────────────────────────────────────────
  mapping: {
    started:  'ImportgenericUpdateFileMapping started',
    ended:    'ImportgenericUpdateFileMapping ended',
    content:  'GetGenericClientFileMappedContent',
  },

  // ── Validation step ───────────────────────────────────────────────────
  validation: {
    started:          'ImportGenericUpdateFile: ImportGenericUpdateFile started',
    ended:            'ImportGenericUpdateFile: ImportGenericUpdateFile ended',
    allDbFetches:     'ImportGenericUpdateFile: All DB Fetchs',
    bundleSize:       'ImportGenericUpdateFile: Starting processing with bundle size',
    blobDownload:     'ImportGenericUpdateFile: BLOB file download operation completed',
    chunksCompleted:  'ImportGenericUpdateFile: Processing all chunks completed',
    bulkInsert:       'UploadGenericUpdateAccountDataWithValidations: BulkInsert for rows',
    perRowPrefix:     'UploadGenericUpdateAccountDataWithValidations:',
    // noise to exclude
    excludeChunk:     'Processing generic update chunk',
    excludeIdentifiers: 'Processing existingIdentifiers',
  },

  // ── Submission step ───────────────────────────────────────────────────
  submission: {
    mappedContentFetch: 'ImportGenericUpdateApprovedContent: MappedContentCount',
    dictCreated:        'ImportGenericUpdateApprovedContent: Dictionary created',
    globalDbFetch:      'ImportGenericUpdateApprovedContent: Global DB fetch',
    dataCount:          'ImportGenericUpdateApprovedContent: Data Count',
    attrFetchStarted:   'ImportGenericUpdateApprovedContent: Attributes Status fetch started',
    bundleDbFetch:      'ImportGenericUpdateApprovedContent: Bundle DB fetch',
    bulkStarted:        'ImportGenericUpdateApprovedContent Bulk Processing started',
    bulkEnded:          'ImportGenericUpdateApprovedContent Bulk Processing ended',
    loopProcessing:     'ImportGenericUpdateApprovedContent: Loop Processing batch',
    // noise to exclude
    excludeBatch:       'Batch:',
    excludeRow:         'Row: ',   // was 'Row ' — too broad, was excluding "For bundle...startRow = ..."
    excludeBky:         'BKY ',
  },
} as const;

/** Thresholds for flagging slow steps (milliseconds) */
export const THRESHOLDS = {
  dbFetchMs:        5_000,   // any single DB fetch > 5s is worth flagging
  bulkInsertMs:     3_000,   // bulk insert > 3s
  blobDownloadMs:   2_000,   // blob download > 2s
  perRowStepMs:     10,      // per-row step avg > 10ms is significant at scale
  totalStepSec:     60,      // any step > 60s total
  projectedMinutes: 5,       // projected contribution > 5 min is flagged as high
};

/** How long after SaveApprovedRecords to search for the actual submission job logs */
export const SUBMISSION_SEARCH_WINDOW_MINUTES = 15;
