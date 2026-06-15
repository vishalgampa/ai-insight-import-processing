# Import Pipeline: Telemetry Fetching & Parsing Logic

This document explains how InsightRCA retrieves and reconstructs the lifecycle of a "Generic Update" import from Azure Application Insights logs.

## The "Hop Chain" Architecture

Because the import process spans multiple Kubernetes pods and different microservices (Controllers vs. Background Jobs), no single `operation_Id` covers the entire process. InsightRCA uses a "Hop Chain" to stitch these disconnected logs together using the `clientFileUploadId` (UUID) as the anchor.

### Phase 1: The Anchor (Identity & Discovery)
**Logs Used:** `traces` containing the `clientFileUploadId`.
**Purpose:**
- Find the **Validation Start/End** timestamps.
- Find the **Submission (Save) Start/End** timestamps.
- Extract the **original row count** from the Save log.
- Identify the **Kubernetes Pod Name** and initial **Operation ID** where the process began.

**Key KQL Pattern:**
```kusto
traces | where message contains '{UUID}' | order by timestamp asc
```

---

### Phase 2: Column Mapping
**Logs Used:** `traces` containing `ImportgenericUpdateFileMapping` or `GetGenericClientFileMappedContent`.
**Purpose:**
- Measure how long the service took to parse the Excel/CSV headers and map them to internal data structures.
- This is usually the very first step before validation starts.

---

### Phase 3: Validation (Rules Engine)
**Logs Used:** `traces` where `message` contains `ImportGenericUpdateFile` or `UploadGenericUpdateAccountDataWithValidations`.
**Purpose:**
- **Per-Row Analysis:** We extract timing for 26+ specific validation rules (e.g., "Check Bankruptcies", "Validate Account ID").
- **Bundle Metrics:** Validation happens in 5,000-row chunks. We track the duration of each chunk.
- **External Fetches:** We monitor the time taken to fetch Redis cache data or Global DB records required for the validation rules.

---

### Phase 4: Submission (The Background Job)
**Logs Used:** `traces` where `message` contains `ImportGenericUpdateApprovedContent`.
**Purpose:**
- **Operation ID Discovery:** The submission job runs in a separate background pod. We find it by looking for the `MappedContentCount` log message that appears immediately after the "Save" button is clicked.
- **Dictionary Creation:** Tracks the time spent building in-memory lookups for the bulk save.
- **BulkInsert:** Tracks the exact duration of the SQL `BulkInsert` operations (usually in 500-row batches).
- **MpStatusFetch:** Tracks the latency of updating the import progress status.

---

### Phase 5: Error Scoping
**Logs Used:** `traces` or `exceptions` where `severityLevel >= 3`.
**Purpose:**
- Collect all errors and warnings that occurred on the specific pods and during the specific time windows discovered in Phases 1-4.
- This ensures that if a background job fails, we capture the exact exception even if it's not explicitly linked to the `clientFileUploadId`.

---

## Log Purpose Summary Table

| Log Pattern / Keyword | Source Step | Purpose |
| :--- | :--- | :--- |
| `ValidateGenericUpdateContent` | Anchor | Finding Validation time window & pod |
| `SaveApprovedRecords` | Anchor | Finding Submission trigger & Row Count |
| `UploadGenericUpdateAccountDataWithValidations` | Validation | Granular per-rule performance metrics |
| `MappedContentCount` | Submission | Connecting to the background job pod |
| `BulkInsert for rows` | Submission | Measuring database write performance |
| `severityLevel >= 3` | All | Root cause identification of failures |

---

## Bulk Discovery (Finding Imports in a Date Range)

To enable manual comparisons and automated daily monitoring, InsightRCA must first find all unique imports that happened.

**KQL Query:**
```kusto
traces
| where timestamp between (datetime('{START}') .. datetime('{END}'))
| where message contains 'ValidateGenericUpdateContent' and message contains 'started'
| project timestamp, message
| order by timestamp desc
```

**Logic:**
1. This query identifies the "start" of the import lifecycle.
2. It extracts the `clientFileUploadId` (UUID) from the message string.
3. This produces a "Candidate List" which is then displayed to the user (Manual Studio) or processed automatically (Daily Monitor).

---

## Comparison & Baselines

### 1. Granular Size Bucketing
Performance comparisons are only valid between files of similar size. InsightRCA uses **5,000-row increments** to bucket data:
- **Bucket 5k:** Files with 1 - 5,000 rows.
- **Bucket 10k:** Files with 5,001 - 10,000 rows.
- **Bucket 25k:** Files with 20,001 - 25,000 rows.

### 2. Historical Baselines (Averaging)
When comparing a current import, the system calculates a "Synthetic Baseline":
1. It queries the local SQLite database (`reports.db`) for all imports in the **same bucket** from the last **7 to 14 days**.
2. It calculates the **average duration** for every single step (e.g., "Check Bankruptcies Avg", "BulkInsert Avg").
3. The current import's performance is then subtracted from this average to determine the **Delta (Δ)** and **Percentage Change**.

### 3. Automated Comparison
In the **Daily Monitor** (running at 2 AM), the system automatically performs this comparison for every new import found and saves a `comparison_{ID}.json` report if a historical baseline exists.
