# Implementation Plan - Scheduled & Manual Import Analyzer Engine

This plan introduces both an automated daily analysis and an interactive manual comparison engine for "generic update" imports. It utilizes SQLite for tracking, features a robust interactive frontend for slicing comparison data, and saves reports in both JSON and HTML formats for maximum utility.

## Objective
- Automate daily import analysis for `generic update` imports.
- Provide a Manual Comparison UI to select date ranges, curate specific imports, and analyze them interactively.
- Build a dynamic client-side comparison engine allowing users to regroup data (daily/weekly/monthly, varying size buckets) without re-fetching.
- Persist reports in both JSON (for programmatic data analysis) and HTML (for easy human viewing).

## Proposed Changes

### 1. Database & Persistence Layer (Storage Enhancements)
- **New Dependency:** Add `better-sqlite3` for high-performance SQLite operations.
- **Repository Pattern (`src/persistence/IReportRepository.ts`):**
    - Tracks metadata: `id`, `clientFileUploadId`, `rowCount`, `sizeBucket`, `timestamp`.
    - Note: Actual heavy JSON/HTML files will be stored on the file system (`reports/` folder), with paths stored in the SQLite DB to keep the DB lean and fast.
- **Dual Format Storage (`server.ts`):**
    - Update `saveReport` helper to generate and save two files for every report: `.json` (raw data/timing stats) and `.html` (rendered template).

### 2. Manual Comparison Workflow (API & UI)
- **New API Endpoint (`/api/import-list`):**
    - Accepts a start and end date.
    - Queries App Insights for all `generic update` operations in that range and returns a lightweight list (ID, timestamp, rough row count if available).
- **New API Endpoint (`/api/import-bulk-analyze`):**
    - Accepts an array of selected `clientFileUploadId`s and a boolean `saveIndividualReports`.
    - Fetches and parses all selected logs concurrently (or in chunks).
    - If `saveIndividualReports` is true, calls `saveReport` (JSON+HTML) for every single import.
    - Returns the bulk parsed data back to the frontend.
- **Frontend UI Updates (`public/index.html` & `public/app.js`):**
    - Create a new "Comparison Studio" tab/modal.
    - **Step 1:** Date picker -> "Fetch Imports" button.
    - **Step 2:** Display list of fetched imports with checkboxes. Let users select/deselect. Include a "Download normal reports" checkbox.
    - **Step 3:** "Analyze Selected" button triggers the bulk analysis and opens the Comparison Engine.

### 3. Dynamic Frontend Comparison Engine
- Once the bulk data is returned to the frontend, it resides in memory.
- Build a new interactive UI component that processes this in-memory data:
    - **Time Grouping Toggle:** Aggregate and compare data Day-by-Day, Weekly, or Month-by-Month.
    - **Size Bucketing Toggle:** Dynamically adjust the size comparison filter (e.g., compare 5k buckets vs 10k buckets).
    - The UI instantly recalculates averages, step timing diffs, and highlights regressions based on the active grouping filters, completely avoiding extra network calls.

### 4. Scheduler Implementation (Automated Pipeline)
- **New Dependency:** Add `node-cron`.
- Create `src/scheduler/importMonitor.ts`:
    - A `runDailyAnalysis` function running at 2 AM.
    - Queries the last 24 hours for `generic update` imports.
    - Skips already processed IDs (checked via SQLite).
    - Generates full analysis (JSON + HTML).
    - Saves the standard 5k-bucket weekly average comparison to the database automatically.

## Verification & Testing

### 1. Automated Tests
- Unit tests for the new `importMonitor` logic and SQLite interactions.
- Unit tests for the frontend data aggregation logic (ensuring weekly/monthly/size bucket grouping calculates averages correctly).

### 2. Manual Verification
- Test the new UI workflow: Select a 3-day range, fetch the list, deselect one item, and run the analysis.
- Toggle the "Download normal reports" checkbox and verify the `reports/` folder contains the correct `.json` and `.html` files.
- In the frontend Comparison Engine, toggle between "Daily" and "Weekly" views and verify the UI updates instantly without network requests.
- Verify the 2 AM cron job executes and correctly captures the day's imports.
