# InsightRCA — How It Works

**Last updated:** May 22, 2026  
**Codebase:** TypeScript / Express / Azure Application Insights

---

## Overview

InsightRCA is a two-feature tool built on top of Azure Application Insights:

1. **RCA Assistant** — General-purpose root cause analysis for any production incident. Takes a natural language query and a time range, fetches telemetry from App Insights, runs a multi-stage analysis pipeline, and returns a structured incident report with root causes, symptoms, and recommendations.

2. **Import Analyzer** — Specialized performance diagnostics for the "Generic Update" file import pipeline. Takes a `clientFileUploadId` UUID, runs a hop-chain query sequence across multiple Kubernetes pods and operation IDs, and returns a detailed timing breakdown of all three pipeline stages (Mapping → Validation → Submission).

Both features share the same Express server (`server.ts`) and the same App Insights REST client. The frontend (`public/index.html` + `public/app.js`) is a single-page app with two tabs — one per feature.

---

## Architecture

```
Browser (index.html + app.js)
    │
    ├── POST /api/analyze          → RCA Assistant pipeline
    └── POST /api/import-analyze   → Import Analyzer pipeline

server.ts
    ├── queryAppInsights()         → HTTPS calls to api.applicationinsights.io
    ├── RCA pipeline (inline)      → Uses src/* modules
    └── ImportOrchestrator         → Uses src/imports/* modules
```

The server is stateless per request. Each call to `/api/analyze` or `/api/import-analyze` creates fresh instances of all analysis components. The only exception is the `ImportOrchestrator`, which maintains an in-memory UUID → parsed result cache within a single request session (so follow-up questions about the same import don't re-fetch logs).

---

## Part 1: RCA Assistant

### Entry Point

`POST /api/analyze` in `server.ts`. Accepts:
- `appId` — Application Insights App ID
- `apiKey` — Application Insights API Key
- `timespan` — ISO 8601 duration (e.g. `P7D`, `PT6H`)
- `query` — Natural language question (e.g. "What caused the recent issues?")
- `geminiApiKey` — Optional. If provided, enables Gemini 2.0 Flash AI narrative.

### Pipeline Steps

The pipeline runs sequentially and emits a `steps[]` array to the frontend so users can see what ran.

#### Step 1 — Discovery
Runs a union KQL query to count rows in `exceptions`, `requests`, `dependencies`, and `traces`. This tells the user what data is available before the main fetch.

#### Step 2 — Fetch
Fetches up to 500 rows from each table in parallel:
- `exceptions | order by timestamp desc | take 500`
- `requests | order by timestamp desc | take 500`
- `dependencies | order by timestamp desc | take 500`
- `traces | where severityLevel >= 2 | order by timestamp desc | take 500`

Traces with `severityLevel >= 3` are treated as exceptions; others as requests.

#### Step 3 — Normalize (`src/telemetry/normalizer.ts`)
Converts raw App Insights rows into typed `TelemetryEvent` objects:
- `Exception` — has `exceptionType`, `message`, `stackTrace`, `severity`
- `RequestMetric` — has `operationName`, `duration`, `responseCode`, `success`
- `DependencyMetric` — has `dependencyName`, `dependencyType`, `duration`, `success`
- `DeploymentEvent` — has `deploymentId`, `version`, `deployedBy`

Malformed records are skipped with a warning. All events are sorted by timestamp ascending.

#### Step 4 — Baseline & Anomaly Detection
- `TimeSeriesBuilder` buckets events into 5-minute windows and computes an error rate time series.
- `BaselineCalculator` computes mean and standard deviation of the time series.
- `AnomalyDetector` flags data points more than 2 standard deviations from the mean (z-score method). Also supports IQR method for outlier detection.
- `SeverityRanker` sorts anomalies: `critical > high > medium > low`, then by deviation score within the same level.

#### Step 5 — Correlation (`src/correlation/`)
- `TemporalCorrelator` groups events that occur within ±30 seconds of each other into `CorrelatedEventGroup` objects. Correlation score is a weighted combination of group size (40%) and temporal proximity (60%). Clock skew between services is handled by nudging timestamps based on dependency relationships.
- `CausalGraphBuilder` builds a directed `CausalGraph` from the correlated groups. Four types of edges:
  - **Temporal** — earlier event → later event within a group (confidence decreases with time distance)
  - **Dependency** — dependency call event → events in the target service (confidence 0.8)
  - **Trace** — events sharing the same `traceId`, linked chronologically (confidence 0.9)
  - **Pattern** — same exception type across different services (confidence 0.6)

#### Step 6 — Root Cause Identification (`src/rootcause/causalAnalyzer.ts`)
Root nodes in the causal graph (nodes with no incoming edges) are root cause candidates. For each candidate, `CausalAnalyzer` computes:

**Evidence score** (via `EvidenceScorer`):
- `temporalPriority` (30%) — how early the event occurred relative to downstream events
- `evidenceStrength` (30%) — log-scaled count of supporting downstream events
- `exceptionUniqueness` (20%) — rarer exception types score higher
- `dependencyPosition` (20%) — dependency events score 1.0, exceptions 0.7, requests 0.4

**Boost factors** added on top:
- `errorPatternBoost` — high-frequency errors spanning multiple services
- `propagationBoost` — deeper cascade depth and more affected services
- `deploymentBoost` (+0.15) — event occurred within 1 hour of a deployment
- `anomalyBoost` — correlated anomaly within 60 seconds

**Category classification:**
- `deployment` — event is a deployment, or occurred within 1 hour of one
- `dependency` — event is a dependency call
- `resource` — exception message contains "pool", "memory", "cpu", "disk", "timeout", "exhausted"
- `code` — other exceptions
- `infrastructure` — everything else

Root causes are sorted by final confidence score descending. The server then groups them by `category + service` and picks the highest-confidence representative per group, producing `groupedRootCauses` for the UI.

#### Step 7 — Issues (Merged Error Groups)
`groupErrors()` (inline in `server.ts`) groups all exceptions by `errorType + service`, counting occurrences and tracking first/last seen timestamps. `CascadeAnalyzer` identifies which services are downstream symptoms vs. root causes. Each error group is tagged `isDownstream: true/false` and linked to the root cause explanation if downstream.

#### Step 7b — Session & Login Exceptions
A separate pass filters all exception events for keywords: `session`, `login`, `signin`, `authenticate`, `sessioncontroller`, `logon`. These are grouped and surfaced separately in the UI with a purple highlight.

#### Step 8 — Recommendations (`src/ai/recommendationGenerator.ts`)
Rule-based recommendations generated per root cause category:
- `deployment` → rollback recommendation (high impact, minutes effort)
- `resource` → scale recommendation (infers CPU/memory/disk from explanation text)
- `confidence < 0.5` → collect diagnostics recommendation
- All others → category-specific default (check dependencies, review code, investigate infrastructure)

Recommendations are sorted by impact (`high > medium > low`) then effort (`minutes < hours < days`), deduplicated by normalized action text, and re-numbered.

#### Step 9 — AI Narrative (Optional)
If `geminiApiKey` is provided, `ReasoningEngine` builds a structured prompt via `PromptBuilder` and calls Gemini 2.0 Flash. The prompt includes:
- Time range and affected services
- Anomaly list with severity and deviation scores
- Correlation groups with event counts and services
- Root cause candidates with confidence and evidence scores
- Symptom descriptions

If the LLM call fails, a rule-based fallback explanation is generated from the root cause data.

#### Step 10 — Report & Response
`ReportFormatter` assembles the `IncidentReport`. When multiple root causes exist, the highest-confidence one is marked `[Primary]` and the rest `[Contributing]`. `MarkdownRenderer` renders the report as Markdown. `QueryParser` + `ResponseFormatter` generate a natural language answer to the user's original question.

---

## Part 2: Import Analyzer

### Entry Point

`POST /api/import-analyze` in `server.ts`. Accepts:
- `appId`, `apiKey` — App Insights credentials
- `clientFileUploadId` — UUID of the import to analyze (or two UUIDs space/comma-separated for comparison)
- `question` — Optional natural language question about the import

The server creates an `ImportOrchestrator` with a `queryFn` that calls `queryAppInsights` with a 90-day timespan, then calls `orchestrator.answer(idToUse)`.

### The Import Pipeline Being Analyzed

The "Generic Update" pipeline processes CSV/Excel files through three stages, each running on a **different Kubernetes pod** with a **different `operation_Id`** in App Insights:

```
Mapping pod (operation_Id A)
    → Validation pod (operation_Id B)
    → k8s trigger (SaveApprovedRecords) on Validation pod
        → Submission job pod (operation_Id C) — starts 0–15 min later
```

There is **no shared trace context** between the trigger and the submission job. This is the core technical challenge the tool solves.

### The Hop Chain (`src/imports/importLogFetcher.ts`)

`ImportLogFetcher.fetchAll()` runs a 6-step sequential query chain:

#### Hop 1 — Anchor Query
```kql
traces
| where timestamp > ago(90d)
| where message contains '{clientFileUploadId}'
| project timestamp, message, operation_Id, cloud_RoleInstance
| order by timestamp asc
```
This is the **only query that uses the UUID**. It finds the controller-level logs that contain the UUID and extracts:
- `validateStartTime` / `validateEndTime` / `validatePod` / `validateOperationId` — from `ValidateGenericUpdateContent started/ended`
- `saveStartTime` / `saveEndTime` / `savePod` — from `SaveApprovedRecords started/ended`
- `rowCount` — from `Number of rows in excel: N` in the SaveApprovedRecords log

Everything downstream is derived from these timestamps and IDs.

#### Hop 2 — Mapping Logs
Searches a ±30-minute window around `validateStartTime` for `ImportgenericUpdateFileMapping` and `GetGenericClientFileMappedContent` messages. No `operation_Id` is used — mapping is found purely by time proximity.

#### Hop 3 — Validation Logs (with fallback)
Three-level fallback:
1. **Primary:** Use `validateOperationId` directly → `where operation_Id == '{opId}'`
2. **Fallback 1:** If no `operation_Id` in anchor, search pod + time window for `ImportGenericUpdateFile started` to find the real `operation_Id`, then use that
3. **Fallback 2 (last resort):** Pod + time window with message filter, no `operation_Id`

#### Hop 4 — Submission Logs (the hard part)
The submission Kubernetes job starts on a completely new pod with no shared `operation_Id`. The tool uses a two-level strategy:

**Primary path — MappedContentCount search:**
1. Opens a 15-minute time window starting at `saveStartTime`
2. Searches for `ImportGenericUpdateApprovedContent: MappedContentCount` — the first log the submission job emits
3. Extracts the `operation_Id` from that log
4. Uses that `operation_Id` for all subsequent submission queries

```kql
traces
| where timestamp between (datetime('{saveStartTime}') .. datetime('{saveStartTime + 15min}'))
| where message contains 'ImportGenericUpdateApprovedContent: MappedContentCount'
| order by timestamp desc
| take 1
```

**Fallback path — completion log time-window search:**
When the `MappedContentCount` search returns nothing (e.g. the log was not emitted, the window was too narrow, or the `operation_Id` field is absent), the tool falls back to bounding the time window using the process completion log:

```
ExportGenericUpdateContentCSVBackground completed successfully for userId: ...,
clientFileUploadId: {uuid}, Time Elapsed: 00:00:00.6883086
```

This log contains the UUID so it is findable via the anchor query results. It marks the true end of the submission process. The fallback:
1. Searches for this completion log using the UUID
2. Uses `[saveStartTime, completionTime + 2min]` as the time window
3. Fetches all `ImportGenericUpdateApprovedContent` logs in that window (no `operation_Id` filter)
4. Derives `operation_Id` and pod from the first row found in the results

This means submission data is recovered even when the primary `operation_Id` resolution fails.

The `SUBMISSION_SEARCH_WINDOW_MINUTES = 15` constant in `knownPatterns.ts` controls the primary search window.

#### Hop 5 — Errors
Fetches `severityLevel >= 3` traces, trying operationIds first (validation then submission), falling back to pod + time window for each. A final fallback uses the k8s trigger pod + save time window to catch controller-level errors. Results are deduplicated by `timestamp + message`.

#### Hop 6 — Raw Drill-Down Data
Fetches additional detail in parallel:
- `validationPerRowRaw` — all `UploadGenericUpdateAccountDataWithValidations:` logs (for slow checkpoint detection)
- `validationGlobalFetches` — per-chunk fetches (redis batch size, existing users)
- `submissionRawAll` — all `ImportGenericUpdateApprovedContent` logs
- `submissionAggRows` — KQL `summarize avg/max/count by step` for per-row submission timing

### Log Parsing (`src/imports/importLogParser.ts`)

`parseImportLogs()` processes the raw rows into a structured `ParsedImportLogs` object organized by the 5-level hierarchy:

```
Process → Stage → Bundle (5000 rows) → Batch (500 rows) → Row
```

**Mapping:**
- Extracts `mappingDurationSec` from `ImportgenericUpdateFileMapping ended` log

**Validation — Stage level:**
- `allDbFetchesMs` from `All DB Fetchs: N ms`
- `blobDownloadMs` from `BLOB file download operation completed in N ms`
- `chunksCompletedMs` from `Processing all chunks completed: N ms`
- `bundleSize` from `Starting processing with bundle size: N`
- `validationDurationSec` from `ImportGenericUpdateFile ended`

**Validation — Bundle level (1× per 5000-row chunk):**
- Chunk index and row count from `Processing generic update chunk N with X rows`
- `existingUsersMs` from `Fetched existing users in N ms`
- `redisBatchSizeMs` from `Fetched batch size from redis in N ms`
- Bundle assignment uses a stateful `currentChunk` tracker as logs are scanned in order

**Validation — Batch level (1× per 500-row batch):**
- `bulkInsertMs`, `startRow`, `endRow` from `BulkInsert for rows N to M took X ms`

**Validation — Row level (26 steps, aggregated by KQL):**
- The KQL `summarize avg_ms, max_ms, count() by step` query extracts step names via regex: `UploadGenericUpdateAccountDataWithValidations: (.+?) (in|took|for)`
- Excludes `BulkInsert`, `Fetched batch size from redis`, `Fetched existing users` (these are bundle-level, not per-row)
- Slow checkpoints (>5ms) are also extracted individually for drill-down

**Submission — Stage level (1× per job):**
- `MappedContent & total rows fetch` — ms and total row count
- `Dictionary build` — ms and entry count
- `Global DB fetch` — ms

**Submission — Bundle level:**
- Two-pass algorithm: Pass 1 builds a `forBundleTimeline` (timestamp → bundleIdx). Pass 2 assigns `Data Count` logs to bundles by finding the next `For bundle` log after each `Data Count` timestamp. This is necessary because `Data Count` fires **before** `For bundle` in the log stream.
- Per bundle: `startRow`, `endRow`, `attributeCount`, `bundleDbFetchMs`, `accountIds`, `linkedAccountIds`, `customFields`, `bankruptcyRecords`

**Submission — Batch level:**
- `loopProcessingMs` from `Loop Processing batch N: X`
- `bulkProcessingMs` from `Bulk Processing ended` (duration in seconds, converted to ms)
- Batch size inferred from gaps between consecutive `batchIdx` values
- Bundle membership assigned by checking `batchIdx >= bundleIdx && batchIdx < bundleIdx + bundleSize`

**Submission — Row level (aggregated by KQL):**
- Three log patterns covered:
  - `Batch: K Row: J {StepName} Checkpoint: {ms}` — checkpoint steps
  - `Batch: K Row: J MpStatusFetch: {ms}` — MP status fetch
  - `Row J | BKY {label}: ... | {ms}ms` — bankruptcy check steps

### Timing Analysis (`src/imports/timingAnalyzer.ts`)

`analyzeImport()` takes the `ParsedImportLogs` and produces an `ImportAnalysis`:

**Step contributions:** All timed steps are collected into a flat list with their durations. Total is summed. Each step gets a `percentOfTotal` and a `flag` (`ok` / `slow` / `critical`) based on `THRESHOLDS`:
- `dbFetchMs: 5000` — any DB fetch > 5s
- `bulkInsertMs: 3000` — bulk insert > 3s
- `blobDownloadMs: 2000` — blob download > 2s

**Per-row insights (`toInsight()`):** For each of the 26 validation steps and submission row steps:
- `projectedTotalMs = avgMs × rowCount`
- `projectedTotalMin = projectedTotalMs / 60000`
- Flag as `slow` if projected > 5 minutes, `critical` if projected > 10 minutes
- Flag as `slow` if `avgMs > 10` (the `perRowStepMs` threshold)
- Generates a human-readable note: `"X ms/row × N rows = Y min projected"`

**Automated insights:** Rule-based text generation:
- Initial DB fetches > 10s → fixed cost warning
- Top 3 slow validation/submission row steps → projected time warnings
- Total BulkInsert time > 5s → batch insert warning
- Submission bundles with DB fetch > 5s → bundle DB warning
- Errors → categorized by message pattern (truncation, missing config, duplicate trigger, k8s job exists)

### Comparison (`compareImports()`)

When two UUIDs are provided, `compareImports()` builds a step map for each import (step name → duration ms) and computes a diff:
- `deltaMs = msB - msA`
- `deltaPercent = (deltaMs / msA) × 100`
- `flag = 'slower'` if delta > 10%, `'faster'` if delta < -10%, `'same'` otherwise
- Sorted by `|deltaMs|` descending
- Auto-generates insight strings for steps that are >1s slower or faster

### Log Catalog (`src/imports/logCatalog.ts`)

A typed catalog of all 26+ known log patterns, organized as `LogEntry` objects with:
- `contains[]` — all substrings that must be present
- `notContains[]` — substrings that must not be present (for disambiguation)
- `extract[]` — named regex capture groups with type (`int` / `float` / `string`)
- `level` — `process | stage | bundle | batch | row`
- `process` — `validation | submission | mapping`

The `matchLog()` function applies a `LogEntry` to a message string and returns extracted values or `null`. This is the single source of truth for log patterns — adding a new checkpoint step requires only adding an entry here.

### Plain-English Answer Generation

`generatePlainAnswer()` in `server.ts` takes the user's question and the `ImportAnalysis` and generates a text response by keyword matching:
- "time" / "how long" / "duration" → lists all step timings
- "slow" / "bottleneck" / "issue" → lists flagged steps with notes
- "count" / "how many" / "rows" → data counts summary
- "error" / "fail" → error insights
- "compare" / "vs" → comparison instructions
- Fallback → general summary with row count, total time, and top insights

---

## Part 3: Shared Infrastructure

### App Insights REST Client (`server.ts` — `queryAppInsights()`)

Direct HTTPS calls to `api.applicationinsights.io/v1/apps/{appId}/query`. Sends KQL as a POST body with `x-api-key` header. Parses the columnar response format (columns array + rows array) into flat record objects.

No SDK is used — this is intentional to avoid dependency on the Azure SDK and to keep the server lightweight.

### Thresholds (`src/imports/knownPatterns.ts`)

All performance thresholds are centralized:

| Threshold | Value | Meaning |
|---|---|---|
| `dbFetchMs` | 5,000 ms | Any single DB fetch above this is flagged |
| `bulkInsertMs` | 3,000 ms | Bulk insert above this is flagged |
| `blobDownloadMs` | 2,000 ms | Blob download above this is flagged |
| `perRowStepMs` | 10 ms | Per-row step avg above this is significant at scale |
| `totalStepSec` | 60 s | Any step above this total is flagged |
| `projectedMinutes` | 5 min | Projected per-row contribution above this is flagged |
| `SUBMISSION_SEARCH_WINDOW_MINUTES` | 15 min | How long after SaveApprovedRecords to search for submission job |

### Diagnostics

`FetchDiagnostics` is returned with every import analysis:
- `anchorFound` — whether any logs were found for the UUID
- `anchorRowCount` — how many anchor logs were found
- `validationFound` — whether validation logs were retrieved
- `submissionFound` — whether submission logs were retrieved
- `noDataReason` — human-readable explanation if data is missing (e.g., "No logs found containing ID X in the last 90 days")

The UI shows a red banner with the `noDataReason` if data retrieval failed.

### Caching

`ImportOrchestrator` maintains a `Map<string, { logs: StepLogs; parsed: ParsedImportLogs }>` cache keyed by UUID. Within a single request session, if the same UUID is analyzed twice (e.g., in a comparison where one UUID appears in both slots), the logs are not re-fetched.

---

## Frontend (`public/app.js`)

Two tabs:

**RCA Assistant tab:**
- Inputs: App ID, API Key, Gemini API Key (optional), time range selector, query text
- Calls `POST /api/analyze`
- Renders: pipeline steps, telemetry discovery counts, failure dependency map metrics, grouped root causes (with problem/fix cards, evidence breakdown, affected services), issues list (root vs downstream), session/login exceptions, recommendations, AI narrative, NL summary, full markdown report

**Import Analyzer tab:**
- Inputs: App ID, API Key, Client File Upload ID (one or two UUIDs), optional question
- Calls `POST /api/import-analyze`
- Renders:
  - Diagnostic banner if data is missing
  - Plain-English answer to the question (if asked)
  - For single import: file header, step metadata panel (operation IDs + pods + timestamps per stage), AI insights, step timing breakdown table, validation bundle/batch/row tables, submission stage/bundle/batch/row tables, slow checkpoints, errors
  - For comparison: side-by-side diff table sorted by delta, automated insights

All tables support client-side sorting (click column header) and search filtering. Large tables use a virtual list renderer (shows 50 rows at a time with a "Show more" button) to avoid DOM performance issues.

---

## Key Design Decisions

**Why not use the Azure SDK?** The server uses raw HTTPS calls to the App Insights REST API. This keeps the server dependency-free from Azure SDK versioning and works with any App Insights resource given just an App ID and API key.

**Why a hop chain instead of distributed tracing?** The submission Kubernetes job has no shared `operation_Id` with the trigger. Azure's distributed tracing cannot correlate them. The hop chain is the only reliable way to find the submission job logs.

**Why regex parsing instead of structured logs?** The pipeline logs are unstructured text messages. The `logCatalog.ts` catalog centralizes all patterns so adding a new log type is a one-line change.

**Why in-memory caching?** The import analysis involves 8–12 KQL queries per UUID. Caching the parsed result means follow-up questions (e.g., "now compare with this other import") don't re-run all queries. The cache is per-request (not shared across requests) so there are no stale data concerns.

**Why project per-row costs?** A step that takes 5ms per row is negligible for 100 rows but adds 8+ minutes for 100,000 rows. The projection (`avgMs × rowCount`) surfaces this before it becomes a production incident.
