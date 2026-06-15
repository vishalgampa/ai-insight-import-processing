import { ImportAnalysis } from "../imports/timingAnalyzer";

export function renderSingleImportBody(analysis: ImportAnalysis): string {
  const stepMs = (name: string) => {
    const s = analysis.stepContributions?.find(c => c.stepName === name);
    return s ? s.durationMs : 0;
  };

  const fmtMs = (ms: number | null | undefined) => {
    if (ms == null) return "—";
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return (ms / 60000).toFixed(1) + "min";
  };

  return `
    <div class="stat-grid">
        <div class="stat-card">
            <div class="stat-label">Client File Upload ID</div>
            <div class="stat-value" style="font-size:1rem; word-break:break-all">${analysis.clientFileUploadId}</div>
            ${analysis.countsSummary ? `<div class="meta-text">${analysis.countsSummary}</div>` : ""}
        </div>
        <div class="stat-card">
            <div class="stat-label">Row Count</div>
            <div class="stat-value">${analysis.rowCount?.toLocaleString() ?? "Unknown"}</div>
            <div class="meta-text">Total import records</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Estimated Duration</div>
            <div class="stat-value" style="color:var(--accent)">${(analysis.totalEstimatedMs / 1000).toFixed(1)}s</div>
            <div class="meta-text">Estimated execution span</div>
        </div>
    </div>

    ${analysis.insights?.length ? `
    <div class="ai-insights">
        <h3 style="margin-top:0; color:var(--accent)">AI Performance Insights</h3>
        ${analysis.insights.map(i => {
          const cls = i.startsWith('❌') ? 'insight-error' : i.startsWith('⚠️') ? 'insight-warn' : 'insight-ok';
          return `<div class="insight-item ${cls}">${i}</div>`;
        }).join('')}
    </div>
    ` : ""}
    <h2>Performance Visualizations</h2>
    ${generateSvgChartsHtml(analysis)}

    <h2>Validation Analysis</h2>

    <h3>Global Validation Stats</h3>
    <table>
        <thead>
            <tr>
                <th>Step / Phase</th>
                <th class="text-right">Duration</th>
            </tr>
        </thead>
        <tbody>
            <tr><td>Mapping Stage</td><td class="text-right mono">${fmtMs(stepMs('Mapping'))}</td></tr>
            <tr><td>Initial DB Fetches</td><td class="text-right mono">${fmtMs(stepMs('Validation: Initial DB Fetches'))}</td></tr>
            <tr><td>BLOB Download</td><td class="text-right mono">${fmtMs(stepMs('Validation: BLOB Download'))}</td></tr>
            <tr><td>Total Chunk Processing</td><td class="text-right mono">${fmtMs(stepMs('Validation: All Chunks'))}</td></tr>
        </tbody>
    </table>

    ${analysis.validationBundleStats?.length ? `
    <h3>Bundle Logs (1× per chunk)</h3>
    <table>
        <thead>
            <tr>
                <th>Bundle</th>
                <th class="text-right">Rows</th>
                <th class="text-right">Existing Users Fetch</th>
                <th class="text-right">Redis Batch Size Fetch</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.validationBundleStats.map(b => `
                <tr>
                    <td>Bundle ${b.bundleIdx}</td>
                    <td class="text-right mono">${b.rowCount?.toLocaleString() ?? "—"}</td>
                    <td class="text-right mono">${fmtMs(b.existingUsersMs)}</td>
                    <td class="text-right mono">${fmtMs(b.redisBatchSizeMs)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.validationBatchStats?.length ? `
    <h3>Batch Logs (Bulk Insert, 1× per 500-row batch)</h3>
    <table>
        <thead>
            <tr>
                <th>Row Range</th>
                <th class="text-right">BulkInsert Duration</th>
                <th>Timestamp (UTC)</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.validationBatchStats.map(b => `
                <tr>
                    <td>Rows ${b.startRow} - ${b.endRow}</td>
                    <td class="text-right mono">${(b.bulkInsertMs / 1000).toFixed(2)}s</td>
                    <td class="mono">${b.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '')}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.validationRowInsights?.length ? `
    <h3>Per-Row Rules (Aggregated)</h3>
    <table>
        <thead>
            <tr>
                <th>Rule Name</th>
                <th class="text-right">Avg Ms/Row</th>
                <th class="text-right">Occurrences</th>
                <th class="text-right">Projected Total</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.validationRowInsights.map(r => `
                <tr>
                    <td>${r.stepName}</td>
                    <td class="text-right mono">${r.avgMs.toFixed(2)}ms</td>
                    <td class="text-right mono">${r.occurrences.toLocaleString()}</td>
                    <td class="text-right mono" style="color:var(--orange); font-weight:600">${fmtMs(r.projectedTotalMs)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    <h2>Submission Analysis</h2>

    ${analysis.submissionStageStats?.length ? `
    <h3>Global Submission Stats</h3>
    <table>
        <thead>
            <tr>
                <th>Step</th>
                <th class="text-right">Duration</th>
                <th>Details</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.submissionStageStats.map(s => `
                <tr>
                    <td>${s.stepName}</td>
                    <td class="text-right mono">${fmtMs(s.valueMs)}</td>
                    <td>${s.extra ?? "—"}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.submissionBundleStats?.length ? `
    <h3>Bundle Logs (1× per chunk)</h3>
    <table>
        <thead>
            <tr>
                <th>Bundle</th>
                <th class="text-right">Accounts</th>
                <th class="text-right">DB Fetch Duration</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.submissionBundleStats.map(b => `
                <tr>
                    <td>Bundle ${b.bundleIdx}</td>
                    <td class="text-right mono">${b.accountIds?.toLocaleString() ?? "—"}</td>
                    <td class="text-right mono">${fmtMs(b.bundleDbFetchMs)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.submissionBatchStats?.length ? `
    <h3>Batch Logs (1× per 500-row batch)</h3>
    <table>
        <thead>
            <tr>
                <th>Bundle</th>
                <th>Range</th>
                <th class="text-right">Loop</th>
                <th class="text-right">Bulk</th>
                <th class="text-right">Total</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.submissionBatchStats.map(b => `
                <tr>
                    <td>Bundle ${b.bundleIdx}</td>
                    <td class="mono">Rows ${b.startRow} - ${b.endRow}</td>
                    <td class="text-right mono">${fmtMs(b.loopProcessingMs)}</td>
                    <td class="text-right mono">${fmtMs(b.bulkProcessingMs)}</td>
                    <td class="text-right mono" style="color:var(--accent); font-weight:600">${fmtMs(b.totalProcessingMs)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.submissionRowInsights?.length ? `
    <h3>Per-Row Steps (Aggregated)</h3>
    <table>
        <thead>
            <tr>
                <th>Step Name</th>
                <th class="text-right">Avg Ms/Row</th>
                <th class="text-right">Occurrences</th>
                <th class="text-right">Projected Total</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.submissionRowInsights.map(r => `
                <tr>
                    <td>${r.stepName}</td>
                    <td class="text-right mono">${r.avgMs.toFixed(2)}ms</td>
                    <td class="text-right mono">${r.occurrences.toLocaleString()}</td>
                    <td class="text-right mono" style="color:var(--orange); font-weight:600">${fmtMs(r.projectedTotalMs)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}

    ${analysis.slowCheckpoints?.length ? `
    <h2>Slow Checkpoints (&gt;5ms per-row ops)</h2>
    <table>
        <thead>
            <tr>
                <th>Timestamp (UTC)</th>
                <th>Chunk</th>
                <th>Step</th>
                <th class="text-right">Duration</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.slowCheckpoints.map(c => `
                <tr>
                    <td class="mono">${c.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '')}</td>
                    <td>Chunk ${c.chunk}</td>
                    <td>${c.step}</td>
                    <td class="text-right mono" style="color:var(--yellow); font-weight:600">${c.ms.toFixed(1)}ms</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    ` : ""}
  `;
}

export function renderImportToHtml(analysis: ImportAnalysis): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Import Performance Analysis Report - ${analysis.clientFileUploadId}</title>
    <style>
        :root {
            --bg: #0b0f19;
            --surface: #131926;
            --border: #232d42;
            --accent: #3b82f6;
            --muted: #64748b;
            --text: #f8fafc;
            --green: #22c55e;
            --yellow: #eab308;
            --red: #ef4444;
            --orange: #f97316;
            --font: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        body {
            font-family: var(--font);
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            max-width: 1100px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        h1, h2, h3, h4 {
            color: var(--text);
            font-weight: 700;
        }

        h1 {
            font-size: 2.2rem;
            margin-bottom: 30px;
            background: linear-gradient(135deg, var(--text) 30%, var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
        }

        h2 {
            font-size: 1.3rem;
            margin-top: 40px;
            margin-bottom: 20px;
            color: var(--accent);
            border-left: 4px solid var(--accent);
            padding-left: 16px;
        }

        h3 {
            font-size: 1.1rem;
            margin-top: 30px;
            margin-bottom: 16px;
            color: var(--text);
            opacity: 0.9;
        }

        .stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            transition: transform 0.2s;
        }

        .stat-card:hover {
            transform: translateY(-2px);
        }

        .stat-label {
            font-size: 0.75rem;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
        }

        .stat-value {
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--text);
            font-family: monospace;
        }

        .meta-text {
            font-size: 0.8rem;
            color: var(--muted);
            margin-top: 10px;
            border-top: 1px solid var(--border);
            padding-top: 10px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
            font-size: 0.85rem;
        }

        th, td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        th {
            background: rgba(255,255,255,0.02);
            color: var(--muted);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover td {
            background: rgba(255,255,255,0.01);
        }

        .text-right {
            text-align: right;
        }

        .mono {
            font-family: monospace;
        }

        .flag-ok { color: var(--text); }
        .flag-slow { color: var(--yellow); font-weight: 600; }
        .flag-critical { color: var(--red); font-weight: 600; }

        .ai-insights {
            background: rgba(59, 130, 246, 0.05);
            border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 30px;
        }

        .insight-item {
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
            font-size: 0.9rem;
        }

        .insight-item:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .insight-warn { color: var(--yellow); }
        .insight-error { color: var(--red); }
        .insight-ok { color: var(--green); }
    </style>
</head>
<body>
    <h1>Import Performance Analysis Report</h1>
    ${renderSingleImportBody(analysis)}
</body>
</html>
  `;
}

export function renderComparisonToHtml(data: any): string {
  const c = data.comparison;
  if (!c) return "<h3>No comparison data available</h3>";

  const fmtMs = (ms: number | null | undefined) => {
    if (ms == null) return "—";
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return (ms / 60000).toFixed(1) + "min";
  };

  const esc = (s: any) => {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  let valBundleHtml = '';
  if (c.validationBundleDiff && c.validationBundleDiff.length > 0) {
      valBundleHtml = `
          <h2>Validation Bundle Deep-Dive (Primary vs Secondary)</h2>
          <table>
              <thead>
                  <tr>
                      <th>Bundle</th>
                      <th class="text-right">Primary</th>
                      <th class="text-right">Secondary</th>
                      <th class="text-right">Delta</th>
                  </tr>
              </thead>
              <tbody>
                  ${c.validationBundleDiff.map((b: any) => `
                      <tr>
                          <td>Bundle ${b.index}</td>
                          <td class="text-right mono">${fmtMs(b.msA)}</td>
                          <td class="text-right mono">${fmtMs(b.msB)}</td>
                          <td class="text-right mono" style="color:${b.deltaMs > 0 ? 'var(--red)' : b.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${b.deltaMs > 0 ? '+' : ''}${fmtMs(b.deltaMs)}</td>
                      </tr>
                  `).join('')}
              </tbody>
          </table>
      `;
  }

  let subBatchHtml = '';
  if (c.submissionBatchDiff && c.submissionBatchDiff.length > 0) {
      subBatchHtml = `
          <h2>Submission Batch Deep-Dive (Primary vs Secondary)</h2>
          <table>
              <thead>
                  <tr>
                      <th>Bundle / Batch</th>
                      <th>Row Range</th>
                      <th class="text-right">Primary (Total / Bulk)</th>
                      <th class="text-right">Secondary (Total / Bulk)</th>
                      <th class="text-right">Delta (Total)</th>
                  </tr>
              </thead>
              <tbody>
                  ${c.submissionBatchDiff.map((b: any) => `
                      <tr>
                          <td>Bundle ${b.bundleIdx} Batch ${b.batchIdx}</td>
                          <td class="mono">Rows ${(b.startRow || 0).toLocaleString()} – ${(b.endRow || 0).toLocaleString()}</td>
                          <td class="text-right mono">${fmtMs(b.msA)} (${fmtMs(b.bulkMsA)})</td>
                          <td class="text-right mono">${fmtMs(b.msB)} (${fmtMs(b.bulkMsB)})</td>
                          <td class="text-right mono" style="color:${b.deltaMs > 0 ? 'var(--red)' : b.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${b.deltaMs > 0 ? '+' : ''}${fmtMs(b.deltaMs)}</td>
                      </tr>
                  `).join('')}
              </tbody>
          </table>
      `;
  }

  let rowInsightHtml = '';
  if (c.rowInsightDiff && c.rowInsightDiff.length > 0) {
      rowInsightHtml = `
          <h2>Row-Level Rules Deep-Dive (Avg Duration)</h2>
          <table>
              <thead>
                  <tr>
                      <th>Rule / Step Name</th>
                      <th class="text-right">Primary</th>
                      <th class="text-right">Secondary</th>
                      <th class="text-right">Delta</th>
                  </tr>
              </thead>
              <tbody>
                  ${c.rowInsightDiff.sort((a: any, b: any) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).map((r: any) => `
                      <tr>
                          <td>${esc(r.stepName)}</td>
                          <td class="text-right mono">${r.avgMsA.toFixed(2)}ms</td>
                          <td class="text-right mono">${r.avgMsB.toFixed(2)}ms</td>
                          <td class="text-right mono" style="color:${r.deltaMs > 0 ? 'var(--red)' : r.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${r.deltaMs > 0 ? '+' : ''}${r.deltaMs.toFixed(2)}ms</td>
                      </tr>
                  `).join('')}
              </tbody>
          </table>
      `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Import Comparison Analysis Report - ${c.idA} vs ${c.idB}</title>
    <style>
        :root {
            --bg: #0b0f19;
            --surface: #131926;
            --border: #232d42;
            --accent: #3b82f6;
            --muted: #64748b;
            --text: #f8fafc;
            --green: #22c55e;
            --yellow: #eab308;
            --red: #ef4444;
            --orange: #f97316;
            --font: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        body {
            font-family: var(--font);
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        h1, h2, h3, h4 {
            color: var(--text);
            font-weight: 700;
        }

        h1 {
            font-size: 2.2rem;
            margin-bottom: 30px;
            background: linear-gradient(135deg, var(--text) 30%, var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
        }

        h2 {
            font-size: 1.3rem;
            margin-top: 40px;
            margin-bottom: 20px;
            color: var(--accent);
            border-left: 4px solid var(--accent);
            padding-left: 16px;
        }

        h3 {
            font-size: 1.1rem;
            margin-top: 30px;
            margin-bottom: 16px;
            color: var(--text);
            opacity: 0.9;
        }

        .stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            transition: transform 0.2s;
        }

        .stat-label {
            font-size: 0.75rem;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
        }

        .stat-value {
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--text);
            font-family: monospace;
        }

        .meta-text {
            font-size: 0.8rem;
            color: var(--muted);
            margin-top: 10px;
            border-top: 1px solid var(--border);
            padding-top: 10px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
            font-size: 0.85rem;
        }

        th, td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        th {
            background: rgba(255,255,255,0.02);
            color: var(--muted);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover td {
            background: rgba(255,255,255,0.01);
        }

        .text-right {
            text-align: right;
        }

        .mono {
            font-family: monospace;
        }

        .comparison-insights {
            background: rgba(234, 179, 8, 0.05);
            border: 1px solid rgba(234, 179, 8, 0.2);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 30px;
        }

        .insight-item {
            margin-bottom: 10px;
            font-size: 0.9rem;
            color: var(--yellow);
        }

        .insight-item:last-child {
            margin-bottom: 0;
        }

        .side-by-side-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-top: 40px;
            border-top: 2px solid var(--border);
            padding-top: 30px;
        }

        @media (max-width: 900px) {
            .side-by-side-grid {
                grid-template-columns: 1fr;
            }
        }
        
        .flag-ok { color: var(--text); }
        .flag-slow { color: var(--yellow); font-weight: 600; }
        .flag-critical { color: var(--red); font-weight: 600; }
        
        .ai-insights {
            background: rgba(59, 130, 246, 0.05);
            border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .insight-item {
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
            font-size: 0.9rem;
        }

        .insight-item:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .insight-warn { color: var(--yellow); }
        .insight-error { color: var(--red); }
        .insight-ok { color: var(--green); }
    </style>
</head>
<body>

    <h1>Import Comparison Analysis</h1>

    <div class="stat-grid">
        <div class="stat-card">
            <div class="stat-label">Primary Import (A)</div>
            <div class="stat-value" style="font-size:0.95rem; word-break:break-all">${c.idA}</div>
            <div class="meta-text">Rows: ${c.rowCountA?.toLocaleString() ?? "—"} • Duration: ${data.primary ? fmtMs(data.primary.totalEstimatedMs) : "—"}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Secondary Import (B)</div>
            <div class="stat-value" style="font-size:0.95rem; word-break:break-all">${c.idB}</div>
            <div class="meta-text">Rows: ${c.rowCountB?.toLocaleString() ?? "—"} • Duration: ${data.secondary ? fmtMs(data.secondary.totalEstimatedMs) : "—"}</div>
        </div>
    </div>

    ${c.insights?.length ? `
    <div class="comparison-insights">
        <h3 style="margin-top:0; color:var(--yellow)">Comparison Insights</h3>
        ${c.insights.map((i: string) => `<div class="insight-item">${esc(i)}</div>`).join('')}
    </div>
    ` : ""}

    ${c.stepDiff?.length ? `
    <h2>Step-by-Step Comparison</h2>
    <table>
        <thead>
            <tr>
                <th>Step</th>
                <th class="text-right">Primary</th>
                <th class="text-right">Secondary</th>
                <th class="text-right">Delta</th>
                <th class="text-right">Change</th>
            </tr>
        </thead>
        <tbody>
            ${c.stepDiff.map((s: any) => {
              const flagColor = s.flag === 'slower' ? 'var(--red)' : s.flag === 'faster' ? 'var(--green)' : 'var(--muted)';
              const deltaSign = s.deltaMs > 0 ? '+' : '';
              return `
              <tr>
                  <td>${esc(s.stepName)}</td>
                  <td class="text-right mono">${fmtMs(s.msA)}</td>
                  <td class="text-right mono">${fmtMs(s.msB)}</td>
                  <td class="text-right mono" style="color:${flagColor}; font-weight:600">${deltaSign}${fmtMs(s.deltaMs)}</td>
                  <td class="text-right mono" style="color:${flagColor}">${deltaSign}${s.deltaPercent}%</td>
              </tr>`;
            }).join('')}
        </tbody>
    </table>
    ` : ""}

    ${valBundleHtml}
    ${subBatchHtml}
    ${rowInsightHtml}

    <div class="side-by-side-grid">
        <div>
            <h2 style="color: var(--accent); border-color: var(--accent)">Primary Import Details (A)</h2>
            ${data.primary ? renderSingleImportBody(data.primary) : "<p>No primary details available</p>"}
        </div>
        <div>
            <h2 style="color: var(--green); border-color: var(--green)">Secondary Import Details (B)</h2>
            ${data.secondary ? renderSingleImportBody(data.secondary) : "<p>No secondary details available</p>"}
        </div>
    </div>

</body>
</html>
  `;
}

function generateSvgChartsHtml(analysis: ImportAnalysis): string {
  const formatDuration = (ms: number | null | undefined): string => {
    if (ms == null || isNaN(ms)) return "—";
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return (ms / 60000).toFixed(1) + "min";
  };

  const esc = (str: string): string => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const stepMs = (name: string) => {
    const s = analysis.stepContributions?.find(c => c.stepName === name);
    return s ? s.durationMs : 0;
  };

  const mappingMs = stepMs('Mapping');
  const validationMs = stepMs('Validation: Initial DB Fetches') + 
                       stepMs('Validation: BLOB Download') + 
                       stepMs('Validation: All Chunks');
  const totalMs = analysis.totalEstimatedMs || 0;
  const submissionMs = Math.max(0, totalMs - mappingMs - validationMs);

  const totalCalc = mappingMs + validationMs + submissionMs;
  const pMap = totalCalc > 0 ? (mappingMs / totalCalc) * 100 : 0;
  const pVal = totalCalc > 0 ? (validationMs / totalCalc) * 100 : 0;
  const pSub = totalCalc > 0 ? (submissionMs / totalCalc) * 100 : 0;

  let currentAngle = -90;
  let pieSlicesHtml = '';
  
  const slices = [
    { name: 'Mapping', ms: mappingMs, pct: pMap, grad: 'grad-mapping', color: '#6366f1' },
    { name: 'Validation', ms: validationMs, pct: pVal, grad: 'grad-validation', color: '#3b82f6' },
    { name: 'Submission', ms: submissionMs, pct: pSub, grad: 'grad-submission', color: '#22c55e' }
  ];

  if (totalCalc === 0) {
    pieSlicesHtml = `<circle cx="100" cy="100" r="25" fill="none" stroke="#232d42" stroke-width="50" />`;
  } else {
    for (const slice of slices) {
      if (slice.pct <= 0) continue;
      const strokeLength = (slice.pct / 100) * 157.08;
      pieSlicesHtml += `<circle cx="100" cy="100" r="25" fill="none" 
        stroke="url(#${slice.grad})" stroke-width="50" 
        stroke-dasharray="${strokeLength} 157.08" 
        transform="rotate(${currentAngle}, 100, 100)" />`;
      currentAngle += (slice.pct / 100) * 360;
    }
  }

  // Chart 2: Validation Per-Row Rules
  const valInsights = [...(analysis.validationRowInsights || [])]
    .sort((a, b) => b.projectedTotalMs - a.projectedTotalMs)
    .slice(0, 8);

  let valInsightsHtml = '';
  if (valInsights.length === 0) {
    valInsightsHtml = `<div style="height: 190px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 0.85rem;">No row-level validation rules triggered (&gt;0ms)</div>`;
  } else {
    const maxValProj = Math.max(...valInsights.map(i => i.projectedTotalMs));
    const maxBarW = 180;
    let barsHtml = '';
    valInsights.forEach((item, idx) => {
      const y = 20 + idx * 22;
      const barW = maxValProj > 0 ? (item.projectedTotalMs / maxValProj) * maxBarW : 0;
      const truncName = item.stepName.length > 35 ? item.stepName.slice(0, 32) + '...' : item.stepName;
      barsHtml += `
        <text x="210" y="${y + 7}" fill="var(--text)" font-size="10px" text-anchor="end" font-family="inherit">${esc(truncName)}<title>${esc(item.stepName)}</title></text>
        <rect x="220" y="${y}" width="${maxBarW}" height="8" rx="4" ry="4" fill="rgba(255,255,255,0.05)" />
        <rect x="220" y="${y}" width="${barW}" height="8" rx="4" ry="4" fill="url(#grad-val-rules)" />
        <text x="${220 + barW + 6}" y="${y + 7}" fill="var(--muted)" font-size="9px" text-anchor="start" font-family="inherit">${formatDuration(item.projectedTotalMs)}</text>
      `;
    });
    valInsightsHtml = `
      <svg width="100%" height="200" viewBox="0 0 480 200" style="display: block;">
        <defs>
          <linearGradient id="grad-val-rules" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fb923c" />
            <stop offset="100%" stop-color="#f97316" />
          </linearGradient>
        </defs>
        ${barsHtml}
      </svg>
    `;
  }

  // Chart 3: Submission Per-Row Steps
  const subInsights = [...(analysis.submissionRowInsights || [])]
    .sort((a, b) => b.projectedTotalMs - a.projectedTotalMs)
    .slice(0, 8);

  let subInsightsHtml = '';
  if (subInsights.length === 0) {
    subInsightsHtml = `<div style="height: 190px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 0.85rem;">No row-level submission steps triggered (&gt;0ms)</div>`;
  } else {
    const maxSubProj = Math.max(...subInsights.map(i => i.projectedTotalMs));
    const maxBarW = 180;
    let barsHtml = '';
    subInsights.forEach((item, idx) => {
      const y = 20 + idx * 22;
      const barW = maxSubProj > 0 ? (item.projectedTotalMs / maxSubProj) * maxBarW : 0;
      const truncName = item.stepName.length > 35 ? item.stepName.slice(0, 32) + '...' : item.stepName;
      barsHtml += `
        <text x="210" y="${y + 7}" fill="var(--text)" font-size="10px" text-anchor="end" font-family="inherit">${esc(truncName)}<title>${esc(item.stepName)}</title></text>
        <rect x="220" y="${y}" width="${maxBarW}" height="8" rx="4" ry="4" fill="rgba(255,255,255,0.05)" />
        <rect x="220" y="${y}" width="${barW}" height="8" rx="4" ry="4" fill="url(#grad-sub-rules)" />
        <text x="${220 + barW + 6}" y="${y + 7}" fill="var(--muted)" font-size="9px" text-anchor="start" font-family="inherit">${formatDuration(item.projectedTotalMs)}</text>
      `;
    });
    subInsightsHtml = `
      <svg width="100%" height="200" viewBox="0 0 480 200" style="display: block;">
        <defs>
          <linearGradient id="grad-sub-rules" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#2dd4bf" />
            <stop offset="100%" stop-color="#0d9488" />
          </linearGradient>
        </defs>
        ${barsHtml}
      </svg>
    `;
  }

  // Chart 4: Validation Database & I/O
  const valDbMs = stepMs('Validation: Initial DB Fetches');
  const valBlobMs = stepMs('Validation: BLOB Download');
  const valBulkMs = (analysis.validationBatchStats || []).reduce((sum, b) => sum + (b.bulkInsertMs || 0), 0);

  const valBlocks = [
    { label: 'DB Fetch', val: valDbMs, grad: 'grad-val-db' },
    { label: 'Blob Download', val: valBlobMs, grad: 'grad-val-blob' },
    { label: 'Bulk Insert', val: valBulkMs, grad: 'grad-val-bulk' }
  ];

  const maxValBlock = Math.max(...valBlocks.map(b => b.val));
  const maxBlockHeight = 135;
  let valBlocksHtml = '';
  
  if (maxValBlock === 0 && valDbMs === 0 && valBlobMs === 0 && valBulkMs === 0) {
    valBlocksHtml = `<div style="height: 190px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 0.85rem;">No validation system operations data</div>`;
  } else {
    let colsHtml = '';
    const maxValForCalc = maxValBlock || 1;
    valBlocks.forEach((block, idx) => {
      const x = 70 + idx * 85;
      const h = (block.val / maxValForCalc) * maxBlockHeight;
      colsHtml += `
        <rect x="${x}" y="25" width="32" height="${maxBlockHeight}" rx="4" ry="4" fill="rgba(255,255,255,0.02)" />
        <rect x="${x}" y="${160 - h}" width="32" height="${h}" rx="4" ry="4" fill="url(#${block.grad})" />
        <text x="${x + 16}" y="${160 - h - 6}" fill="var(--text)" font-size="9px" text-anchor="middle" font-family="inherit">${formatDuration(block.val)}</text>
        <text x="${x + 16}" y="178" fill="var(--muted)" font-size="9px" text-anchor="middle" font-family="inherit">${block.label}</text>
      `;
    });
    valBlocksHtml = `
      <svg width="100%" height="200" viewBox="0 0 360 200" style="display: block;">
        <defs>
          <linearGradient id="grad-val-db" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#3b82f6" />
          </linearGradient>
          <linearGradient id="grad-val-blob" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#60a5fa" />
          </linearGradient>
          <linearGradient id="grad-val-bulk" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#1d4ed8" />
          </linearGradient>
        </defs>
        <line x1="30" y1="92.5" x2="330" y2="92.5" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
        <line x1="30" y1="25" x2="330" y2="25" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
        ${colsHtml}
      </svg>
    `;
  }

  // Chart 5: Submission Database & I/O
  const subDbMs = (analysis.submissionBundleStats || []).reduce((sum, b) => sum + (b.bundleDbFetchMs || 0), 0);
  const subLoopMs = (analysis.submissionBatchStats || []).reduce((sum, b) => sum + (b.loopProcessingMs || 0), 0);
  const subBulkMs = (analysis.submissionBatchStats || []).reduce((sum, b) => sum + (b.bulkProcessingMs || 0), 0);

  const subBlocks = [
    { label: 'DB Fetch', val: subDbMs, grad: 'grad-sub-db' },
    { label: 'Loop Proc', val: subLoopMs, grad: 'grad-sub-loop' },
    { label: 'Bulk Proc', val: subBulkMs, grad: 'grad-sub-bulk' }
  ];

  const maxSubBlock = Math.max(...subBlocks.map(b => b.val));
  let subBlocksHtml = '';
  
  if (maxSubBlock === 0 && subDbMs === 0 && subLoopMs === 0 && subBulkMs === 0) {
    subBlocksHtml = `<div style="height: 190px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 0.85rem;">No submission system operations data</div>`;
  } else {
    let colsHtml = '';
    const maxSubForCalc = maxSubBlock || 1;
    subBlocks.forEach((block, idx) => {
      const x = 70 + idx * 85;
      const h = (block.val / maxSubForCalc) * maxBlockHeight;
      colsHtml += `
        <rect x="${x}" y="25" width="32" height="${maxBlockHeight}" rx="4" ry="4" fill="rgba(255,255,255,0.02)" />
        <rect x="${x}" y="${160 - h}" width="32" height="${h}" rx="4" ry="4" fill="url(#${block.grad})" />
        <text x="${x + 16}" y="${160 - h - 6}" fill="var(--text)" font-size="9px" text-anchor="middle" font-family="inherit">${formatDuration(block.val)}</text>
        <text x="${x + 16}" y="178" fill="var(--muted)" font-size="9px" text-anchor="middle" font-family="inherit">${block.label}</text>
      `;
    });
    subBlocksHtml = `
      <svg width="100%" height="200" viewBox="0 0 360 200" style="display: block;">
        <defs>
          <linearGradient id="grad-sub-db" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#10b981" />
          </linearGradient>
          <linearGradient id="grad-sub-loop" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#34d399" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#34d399" />
          </linearGradient>
          <linearGradient id="grad-sub-bulk" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#047857" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#047857" />
          </linearGradient>
        </defs>
        <line x1="30" y1="92.5" x2="330" y2="92.5" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
        <line x1="30" y1="25" x2="330" y2="25" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
        ${colsHtml}
      </svg>
    `;
  }

  return `
    <div class="charts-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; margin-top: 20px;">
      <div class="chart-card" style="background: rgba(19, 25, 38, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Stage Breakdown</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="High-level summary of time spent in each major pipeline phase: Mapping (data format translation), Validation (analyzing file structure/rules), and Submission (saving records to database).">i</span>
        </div>
        <svg width="100%" height="200" viewBox="0 0 360 200" style="display: block;">
          <defs>
            <linearGradient id="grad-mapping" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#818cf8" />
              <stop offset="100%" stop-color="#6366f1" />
            </linearGradient>
            <linearGradient id="grad-validation" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#60a5fa" />
              <stop offset="100%" stop-color="#3b82f6" />
            </linearGradient>
            <linearGradient id="grad-submission" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#34d399" />
              <stop offset="100%" stop-color="#10b981" />
            </linearGradient>
          </defs>
          ${pieSlicesHtml}
          
          <text x="210" y="40" fill="var(--text)" font-size="12px" font-weight="700" font-family="inherit">Total: ${formatDuration(totalMs)}</text>
          
          <circle cx="210" cy="70" r="5" fill="#6366f1" />
          <text x="222" y="74" fill="var(--text)" font-size="10px" font-family="inherit">Mapping: ${formatDuration(mappingMs)} (${pMap.toFixed(1)}%)</text>
          
          <circle cx="210" cy="105" r="5" fill="#3b82f6" />
          <text x="222" y="109" fill="var(--text)" font-size="10px" font-family="inherit">Validation: ${formatDuration(validationMs)} (${pVal.toFixed(1)}%)</text>
          
          <circle cx="210" cy="140" r="5" fill="#10b981" />
          <text x="222" y="144" fill="var(--text)" font-size="10px" font-family="inherit">Submission: ${formatDuration(submissionMs)} (${pSub.toFixed(1)}%)</text>
        </svg>
      </div>

      <div class="chart-card" style="background: rgba(19, 25, 38, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Validation Per-Row Rules</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Cumulative time spent running specific validation code functions across all rows (Average row-duration &times; count). Pinpoints business rule code bottlenecks.">i</span>
        </div>
        ${valInsightsHtml}
      </div>

      <div class="chart-card" style="background: rgba(19, 25, 38, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Submission Per-Row Steps</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Cumulative time spent running specific submission code steps inside the processing loop across all rows. Highlights row-by-row CPU loop bottlenecks.">i</span>
        </div>
        ${subInsightsHtml}
      </div>

      <div class="chart-card" style="background: rgba(19, 25, 38, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Validation Database & I/O</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Total cumulative duration spent in Validation infrastructure and database layers (Initial configuration DB fetch, BLOB downloads, and Batch Bulk Inserts).">i</span>
        </div>
        ${valBlocksHtml}
      </div>

      <div class="chart-card" style="background: rgba(19, 25, 38, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Submission Database & I/O</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Total cumulative duration spent in Submission infrastructure and database layers (Chunk DB fetches, Row-by-Row loop overhead, and Batch Bulk Database inserts).">i</span>
        </div>
        ${subBlocksHtml}
      </div>
    </div>
  `;
}

