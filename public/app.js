async function runAnalysis() {
  const btn = document.getElementById('analyzeBtn');
  const results = document.getElementById('results');
  const appId = document.getElementById('appId').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
  const timespan = document.getElementById('timespan').value;
  const query = document.getElementById('query').value.trim();

  if (!appId || !apiKey) { alert('Please enter Application ID and API Key'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing...';
  const aiNote = geminiApiKey ? ' + Gemini AI narrative...' : '';
  results.innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted)"><span class="spinner" style="width:24px;height:24px;border-width:3px"></span><br><br>Fetching telemetry and running analysis pipeline${aiNote}</div>`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, apiKey, geminiApiKey: geminiApiKey || undefined, timespan, query }),
    });
    const data = await res.json();
    if (data.error && !data.steps) { results.innerHTML = errorCard(data.error); return; }
    renderResults(data);
  } catch (e) {
    results.innerHTML = errorCard(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Analyze';
  }
}

function errorCard(msg) {
  return `<div style="background:#1e293b;border:1px solid #ef4444;border-radius:12px;padding:24px;color:#ef4444">
    <strong>Error:</strong> ${esc(msg)}</div>`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderResults(data) {
  const r = document.getElementById('results');
  let html = '';

  // Pipeline steps
  const steps = data.steps || [];
  html += '<div class="pipeline">';
  html += sectionTitle('Pipeline Steps');
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">';
  for (const s of steps) {
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:0.8rem">
      <span style="color:var(--green)">✓</span> ${esc(s.name)}</div>`;
  }
  html += '</div>';

  // Discovery
  const disc = steps.find(s => s.name === 'Discovery');
  if (disc && disc.tableCounts) {
    html += sectionTitle('Telemetry Discovery');
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">';
    for (const [table, count] of Object.entries(disc.tableCounts)) {
      html += metricCard(table, count, count > 0 ? 'var(--accent)' : 'var(--muted)');
    }
    html += '</div>';
  }

  if (data.error) {
    html += `<div style="background:var(--surface);border:1px solid var(--yellow);border-radius:12px;padding:24px;color:var(--yellow);margin-bottom:24px">
      ⚠ ${esc(data.error)}</div>`;
    r.innerHTML = html;
    return;
  }

  // Failure Dependency Map
  const corr = steps.find(s => s.name === 'Correlation');
  if (corr) {
    html += sectionTitle('Failure Dependency Map');
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">`;
    html += metricCard('Correlated Clusters', corr.groups, 'var(--accent)');
    html += metricCard('Failing Components', corr.nodes, 'var(--text)');
    html += metricCard('Cause → Effect Links', corr.edges, 'var(--yellow)');
    html += `</div>`;
    html += `<p style="color:var(--muted);font-size:0.8rem;margin-bottom:24px">Related failures grouped by time proximity, service dependencies, and shared trace context to map how issues propagate.</p>`;
  }

  // Root Causes (Grouped)
  const rc = steps.find(s => s.name === 'RootCauses');
  const rcItems = rc && rc.groupedRootCauses && rc.groupedRootCauses.length > 0 ? rc.groupedRootCauses : null;
  if (rcItems) {
    const totalRaw = rc.count || rcItems.reduce((s, g) => s + g.count, 0);
    html += sectionTitle(`Root Cause Analysis (${totalRaw} total, ${rcItems.length} unique)`);
    html += '<div style="margin-bottom:24px">';
    for (let i = 0; i < rcItems.length; i++) {
      const g = rcItems[i];
      const conf = ((g.confidence || 0) * 100).toFixed(0);
      const confColor = Number(conf) > 80 ? 'var(--green)' : Number(conf) > 50 ? 'var(--yellow)' : 'var(--orange)';
      const catColor = { deployment: '#ef4444', resource: '#f97316', dependency: '#eab308', code: '#8b5cf6', infrastructure: '#6366f1' }[g.category] || 'var(--muted)';

      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px">`;

      // Header row with count badge
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="background:${catColor};color:white;padding:3px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;text-transform:uppercase">${esc(g.category || 'unknown')}</span>
          ${i === 0 ? '<span style="background:var(--accent);color:white;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:600">PRIMARY</span>' : ''}
          ${g.count > 1 ? '<span style="background:var(--accent);color:white;padding:3px 10px;border-radius:12px;font-size:0.8rem;font-weight:700">×' + g.count + '</span>' : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:1.2rem;font-weight:700;color:${confColor}">${conf}%</div>
          <div style="font-size:0.7rem;color:var(--muted)">confidence</div>
        </div>
      </div>`;

      // Explanation
      html += `<p style="font-size:0.9rem;line-height:1.5;margin-bottom:14px">${esc(g.explanation || '')}</p>`;

      // Problem statement
      if (g.problem) {
        html += `<div style="background:#1a1a2e;border:1px solid #ef4444;border-radius:8px;padding:14px;margin-bottom:12px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span style="font-size:1rem">🔴</span>
            <span style="font-size:0.8rem;font-weight:600;color:#ef4444;text-transform:uppercase">Problem</span>
          </div>
          <p style="font-size:0.85rem;line-height:1.5;color:var(--text)">${esc(g.problem)}</p>
        </div>`;
      }

      // Suggested fix
      if (g.fix) {
        html += `<div style="background:#0a1f1a;border:1px solid #22c55e;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span style="font-size:1rem">🟢</span>
            <span style="font-size:0.8rem;font-weight:600;color:#22c55e;text-transform:uppercase">Suggested Fix</span>
          </div>
          <pre style="font-size:0.82rem;line-height:1.6;color:var(--text);white-space:pre-wrap;margin:0;font-family:inherit">${esc(g.fix)}</pre>
        </div>`;
      }

      // Metrics
      html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">`;
      html += miniMetric('Failure Spread', g.propagationDepth, 'steps');
      html += miniMetric('Outgoing Links', g.fanOut, '');
      html += miniMetric('Services Hit', g.affectedServiceCount, '');
      html += miniMetric('Errors per 5min', g.errorFrequency, '');
      if (g.timeToImpact !== null && g.timeToImpact !== undefined) {
        html += miniMetric('Time to Spread', (g.timeToImpact / 1000).toFixed(1), 'sec');
      }
      html += `</div>`;

      // Affected services
      if (g.affectedServices && g.affectedServices.length > 0) {
        html += `<div style="margin-bottom:10px"><span style="font-size:0.75rem;color:var(--muted)">Affected: </span>`;
        for (const svc of g.affectedServices) {
          html += `<span style="background:var(--bg);padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-right:4px">${esc(svc)}</span>`;
        }
        html += `</div>`;
      }

      // Related exception types
      if (g.relatedExceptionTypes && g.relatedExceptionTypes.length > 0) {
        html += `<div style="margin-bottom:10px"><span style="font-size:0.75rem;color:var(--muted)">Related Exceptions: </span>`;
        for (const ex of g.relatedExceptionTypes.slice(0, 5)) {
          html += `<span style="background:#1a1a2e;border:1px solid #334155;padding:2px 8px;border-radius:4px;font-size:0.7rem;margin-right:4px;font-family:monospace">${esc(ex)}</span>`;
        }
        html += `</div>`;
      }

      // Evidence breakdown (collapsible)
      const eb = g.evidenceBreakdown;
      if (eb) {
        html += `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--accent);font-size:0.8rem">Evidence Breakdown</summary>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">`;
        html += evidenceBar('Temporal Priority', eb.temporalPriority);
        html += evidenceBar('Evidence Strength', eb.evidenceStrength);
        html += evidenceBar('Exception Uniqueness', eb.exceptionUniqueness);
        html += evidenceBar('Dependency Position', eb.dependencyPosition);
        html += evidenceBar('Error Pattern', eb.errorPatternBoost, true);
        html += evidenceBar('Propagation', eb.propagationBoost, true);
        html += evidenceBar('Deployment', eb.deploymentBoost, true);
        html += evidenceBar('Anomaly', eb.anomalyBoost, true);
        html += `</div></details>`;
      }

      html += `</div>`;
    }
    html += '</div>';
  } else {
    html += sectionTitle('Root Cause Analysis');
    html += '<p style="color:var(--muted);margin-bottom:24px">No root causes identified from available telemetry.</p>';
  }

  // Issues (merged errors + symptoms)
  const iss = steps.find(s => s.name === 'Issues');
  if (iss && iss.issues && iss.issues.length > 0) {
    const rootCount = iss.rootCauseErrors || 0;
    const downCount = iss.downstreamErrors || 0;
    html += sectionTitle(`Issues (${iss.totalErrors} total, ${iss.uniqueGroups} unique)`);
    html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">`;
    html += metricCard('Root Cause Errors', rootCount, 'var(--red)');
    html += metricCard('Downstream Effects', downCount, 'var(--orange)');
    html += `</div>`;
    html += '<div style="margin-bottom:24px">';
    for (const g of iss.issues) {
      const sevColor = g.severity === 'critical' ? 'var(--red)' : g.severity === 'error' ? 'var(--orange)' : 'var(--yellow)';
      const borderColor = g.isDownstream ? 'var(--yellow)' : sevColor;
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${borderColor};border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="background:${sevColor};color:white;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:600">${esc(g.severity.toUpperCase())}</span>
            ${g.isDownstream ? '<span style="background:var(--yellow);color:#000;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:600">DOWNSTREAM</span>' : '<span style="background:var(--red);color:white;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:600">ROOT</span>'}
            <span style="font-family:monospace;font-size:0.8rem;color:var(--text)">${esc(g.errorType)}</span>
            <span style="color:var(--muted);font-size:0.75rem">in ${esc(g.service)}</span>
          </div>
          <span style="background:var(--accent);color:white;padding:3px 10px;border-radius:12px;font-size:0.8rem;font-weight:700;white-space:nowrap">×${g.count}</span>
        </div>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90%">${esc(g.sampleMessage)}</p>
        <div style="font-size:0.7rem;color:var(--muted)">
          First: ${esc(formatTime(g.firstSeen))} · Last: ${esc(formatTime(g.lastSeen))}
          ${g.count > 1 ? ' · Span: ' + esc(timeDiff(g.firstSeen, g.lastSeen)) : ''}
        </div>
        ${g.isDownstream && g.linkedRootCause ? '<div style="margin-top:6px;font-size:0.75rem;color:var(--yellow);border-top:1px solid var(--border);padding-top:6px">↳ Caused by: ' + esc(g.linkedRootCause) + '</div>' : ''}
      </div>`;
    }
    html += '</div>';
  }

  // Session & Login Exceptions (highlighted)
  const sle = steps.find(s => s.name === 'SessionLoginExceptions');
  if (sle && sle.groups && sle.groups.length > 0) {
    html += `<div style="background:linear-gradient(135deg, #1a0a2e 0%, #1e1040 100%);border:2px solid #a855f7;border-radius:14px;padding:20px;margin-bottom:24px">`;
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <span style="font-size:1.3rem">🔐</span>
      <h2 style="font-size:1rem;font-weight:600;color:#a855f7;margin:0">Session & Login Exceptions (${sle.totalErrors} total, ${sle.uniqueGroups} unique)</h2>
    </div>`;
    for (const g of sle.groups) {
      const sevColor = g.severity === 'critical' ? 'var(--red)' : g.severity === 'error' ? '#a855f7' : 'var(--yellow)';
      html += `<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.3);border-left:3px solid ${sevColor};border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="background:${sevColor};color:white;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:600">${esc(g.severity.toUpperCase())}</span>
            <span style="font-family:monospace;font-size:0.8rem;color:var(--text)">${esc(g.errorType)}</span>
            <span style="color:var(--muted);font-size:0.75rem">in ${esc(g.service)}</span>
          </div>
          <span style="background:#a855f7;color:white;padding:3px 10px;border-radius:12px;font-size:0.8rem;font-weight:700;white-space:nowrap">×${g.count}</span>
        </div>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90%">${esc(g.sampleMessage)}</p>
        <div style="font-size:0.7rem;color:var(--muted)">
          First: ${esc(formatTime(g.firstSeen))} · Last: ${esc(formatTime(g.lastSeen))}
          ${g.count > 1 ? ' · Span: ' + esc(timeDiff(g.firstSeen, g.lastSeen)) : ''}
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // Recommendations
  const rec = steps.find(s => s.name === 'Recommendations');
  if (rec && rec.recommendations && rec.recommendations.length > 0) {
    html += sectionTitle('Recommendations');
    html += '<div style="margin-bottom:24px">';
    for (let i = 0; i < rec.recommendations.length; i++) {
      const r_ = rec.recommendations[i];
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">
        <div style="display:flex;gap:12px;align-items:start">
          <span style="background:var(--accent);color:white;min-width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700">${i + 1}</span>
          <div>
            <p style="font-weight:500;margin-bottom:4px">${esc(r_.action || '')}</p>
            <p style="font-size:0.8rem;color:var(--muted)">${esc(r_.rationale || '')}</p>
            ${r_.impact ? `<span style="font-size:0.75rem;background:var(--bg);padding:2px 8px;border-radius:4px;margin-top:6px;display:inline-block">Impact: ${esc(r_.impact)} · Effort: ${esc(r_.effort || 'unknown')}</span>` : ''}
          </div>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  // Affected Services
  if (data.affectedServices && data.affectedServices.length > 0) {
    html += sectionTitle('Affected Services');
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">';
    for (const svc of data.affectedServices) {
      html += `<span style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-size:0.8rem">${esc(svc)}</span>`;
    }
    html += '</div>';
  }

  // AI Narrative (Gemini Flash)
  if (data.aiNarrative) {
    html += sectionTitle('AI Narrative (Gemini Flash)');
    html += `<div style="background:linear-gradient(135deg,#0d1b2a 0%,#0a1f1a 100%);border:2px solid var(--accent);border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:1.1rem">✨</span>
        <span style="font-size:0.75rem;font-weight:600;color:var(--accent);text-transform:uppercase">Gemini 2.0 Flash Analysis</span>
      </div>
      <div style="font-size:0.9rem;line-height:1.7;color:var(--text);white-space:pre-wrap">${esc(data.aiNarrative)}</div>
    </div>`;
  }

  // NL Response
  if (data.nlResponse) {
    html += sectionTitle('Natural Language Summary');
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px;font-size:0.9rem;line-height:1.6;white-space:pre-wrap">${esc(data.nlResponse)}</div>`;
  }

  // Markdown Report (collapsible)
  if (data.markdown) {
    html += sectionTitle('Full Markdown Report');
    html += `<details style="margin-bottom:24px"><summary style="cursor:pointer;color:var(--accent);font-size:0.85rem;margin-bottom:8px">Click to expand</summary>
      <pre style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;overflow-x:auto;font-size:0.8rem;line-height:1.5;white-space:pre-wrap">${esc(data.markdown)}</pre></details>`;
  }

  html += '</div>';
  r.innerHTML = html;
}

function sectionTitle(text) {
  return `<h2 style="font-size:1rem;font-weight:600;margin-bottom:12px;color:var(--text)">${text}</h2>`;
}

function metricCard(label, value, color) {
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 18px;min-width:120px;text-align:center">
    <div style="font-size:1.5rem;font-weight:700;color:${color}">${value}</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">${esc(label)}</div>
  </div>`;
}

function miniMetric(label, value, unit) {
  return `<div style="background:var(--bg);border-radius:6px;padding:6px 12px;text-align:center;min-width:80px">
    <div style="font-size:1rem;font-weight:600;color:var(--text)">${value}<span style="font-size:0.7rem;color:var(--muted);margin-left:2px">${unit}</span></div>
    <div style="font-size:0.65rem;color:var(--muted)">${esc(label)}</div>
  </div>`;
}

function evidenceBar(label, value, isBoost) {
  const pct = isBoost ? Math.min(100, value * 500) : Math.min(100, value * 100);
  const color = pct > 60 ? 'var(--green)' : pct > 30 ? 'var(--yellow)' : 'var(--muted)';
  const displayVal = isBoost ? (value > 0 ? '+' + value.toFixed(3) : '0') : value.toFixed(2);
  return `<div style="flex:1;min-width:120px;background:var(--bg);border-radius:6px;padding:6px 10px">
    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:3px">
      <span style="color:var(--muted)">${esc(label)}</span>
      <span style="color:${color}">${displayVal}</span>
    </div>
    <div style="background:var(--border);border-radius:2px;height:4px;overflow:hidden">
      <div style="background:${color};height:100%;width:${pct}%;border-radius:2px"></div>
    </div>
  </div>`;
}


function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString();
  } catch { return isoStr; }
}

function timeDiff(start, end) {
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(0) + 's';
    if (ms < 3600000) return (ms / 60000).toFixed(0) + 'min';
    if (ms < 86400000) return (ms / 3600000).toFixed(1) + 'hr';
    return (ms / 86400000).toFixed(1) + 'd';
  } catch { return ''; }
}

// ── Tab switching ──────────────────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('panel-rca').style.display = tab === 'rca' ? '' : 'none';
  document.getElementById('panel-import').style.display = tab === 'import' ? '' : 'none';
  document.getElementById('tab-rca').style.background = tab === 'rca' ? 'var(--surface)' : 'var(--bg)';
  document.getElementById('tab-rca').style.color = tab === 'rca' ? 'var(--text)' : 'var(--muted)';
  document.getElementById('tab-import').style.background = tab === 'import' ? 'var(--surface)' : 'var(--bg)';
  document.getElementById('tab-import').style.color = tab === 'import' ? 'var(--text)' : 'var(--muted)';
}

// ── Import Analyzer ────────────────────────────────────────────────────────

async function runImportAnalysis() {
  const btn = document.getElementById('importBtn');
  const results = document.getElementById('importResults');
  const appId = document.getElementById('appId').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const clientFileUploadId = document.getElementById('importClientId').value.trim();
  const question = document.getElementById('importQuestion').value.trim();

  if (!appId || !apiKey) { alert('Please enter Application ID and API Key above'); return; }
  if (!clientFileUploadId) { alert('Please enter a Client File Upload ID'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Fetching logs...';
  results.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)"><span class="spinner" style="width:24px;height:24px;border-width:3px"></span><br><br>Running hop chain: anchor → validation → submission...</div>';

  try {
    const res = await fetch('/api/import-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, apiKey, clientFileUploadId, question }),
    });
    const data = await res.json();
    if (data.error) { results.innerHTML = errorCard(data.error); return; }
    renderImportResults(data, question);
  } catch (e) {
    results.innerHTML = errorCard(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Analyze Import';
  }
}

function renderImportResults(data, question) {
  const r = document.getElementById('importResults');
  // Reset virtual list and table state for this fresh render
  window._vLists = {};
  window._tableData = {};
  let html = '';

  // ── No-data / diagnostic banner ───────────────────────────────────
  const diag = data.diagnostics;
  if (diag && diag.noDataReason) {
    html += `<div style="background:#1a0a0a;border:2px solid var(--red);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:1.2rem">⚠️</span>
        <span style="font-size:0.85rem;font-weight:600;color:var(--red)">Could not retrieve import data</span>
      </div>
      <div style="font-size:0.85rem;line-height:1.6;color:var(--text)">${esc(diag.noDataReason)}</div>
      <div style="margin-top:10px;font-size:0.75rem;color:var(--muted)">
        Anchor logs found: ${diag.anchorFound ? `✓ (${diag.anchorRowCount} rows)` : '✗ none'} &nbsp;·&nbsp;
        Validation: ${diag.validationFound ? '✓' : '✗'} &nbsp;·&nbsp;
        Submission: ${diag.submissionFound ? '✓' : '✗'}
      </div>
    </div>`;
    r.innerHTML = html;
    return;
  }

  // ── Plain-English answer (if question was asked) ──────────────────
  if (data.plainAnswer && question) {
    html += `<div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);border:2px solid var(--accent);border-radius:12px;padding:20px;margin-bottom:16px">`;
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:1.2rem">💬</span>
      <div style="font-size:0.75rem;font-weight:600;color:var(--accent);text-transform:uppercase">Answer to: "${esc(question)}"</div>
    </div>`;
    html += `<div style="font-size:0.9rem;line-height:1.7;color:var(--text);white-space:pre-wrap">${esc(data.plainAnswer)}</div>`;
    html += `</div>`;
  }

  if (data.type === 'comparison' && data.comparison) {
    html += renderComparison(data);
  } else {
    html += renderSingleImport(data.primary);
  }

  r.innerHTML = html;
  // Attach sort/search listeners after DOM is ready
  attachTableListeners();
}

function renderSingleImport(a) {
  if (!a) return errorCard('No analysis data returned');
  let html = '';

  // ── Header: file info ──────────────────────────────────────────────
  html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px">`;
  html += `<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">`;
  html += `<div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px;text-transform:uppercase">Client File Upload ID</div>
    <div style="font-family:monospace;font-size:0.85rem">${esc(a.clientFileUploadId)}</div>
  </div>`;
  if (a.rowCount) {
    html += `<div style="text-align:right">
      <div style="font-size:1.8rem;font-weight:700;color:var(--accent)">${a.rowCount.toLocaleString()}</div>
      <div style="font-size:0.7rem;color:var(--muted)">rows in file</div>
    </div>`;
  }
  html += `</div>`;
  if (a.countsSummary) {
    html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:0.8rem;color:var(--muted)">${esc(a.countsSummary)}</div>`;
  }
  html += `</div>`;

  // ── Step metadata panel ────────────────────────────────────────────
  if (a.stepMeta) {
    html += `<div style="margin-bottom:16px">`;
    html += `<div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Step IDs & Timestamps</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">`;

    const metaSteps = [
      { label: 'Mapping', data: a.stepMeta.mapping, color: '#6366f1' },
      { label: 'Validation', data: a.stepMeta.validation, color: '#3b82f6' },
      { label: 'Submission (Job)', data: a.stepMeta.submission, color: '#22c55e' },
    ];

    for (const s of metaSteps) {
      const d = s.data;
      const hasData = d.pod || d.operationId || d.startTime;
      if (!hasData) continue;
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${s.color};border-radius:0 8px 8px 0;padding:12px">`;
      html += `<div style="font-size:0.75rem;font-weight:600;color:${s.color};margin-bottom:8px">${esc(s.label)}</div>`;
      if (d.operationId) html += metaRow('Operation ID', d.operationId, true);
      if (d.pod) html += metaRow('Pod', d.pod, true);
      if (d.startTime) html += metaRow('Start', fmtTimestamp(d.startTime));
      if (d.endTime) html += metaRow('End', fmtTimestamp(d.endTime));
      if (d.startTime && d.endTime) {
        const dur = new Date(d.endTime).getTime() - new Date(d.startTime).getTime();
        html += metaRow('Duration', fmtMs(dur));
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  // ── AI Insights ────────────────────────────────────────────────────
  if (a.insights && a.insights.length > 0) {
    html += `<div style="background:#0d1b2a;border:1px solid var(--accent);border-radius:12px;padding:16px;margin-bottom:16px">`;
    html += `<div style="font-size:0.75rem;font-weight:600;color:var(--accent);margin-bottom:10px;text-transform:uppercase">AI Insights</div>`;
    for (const ins of a.insights) {
      const color = ins.startsWith('❌') ? 'var(--red)' : ins.startsWith('⚠️') ? 'var(--yellow)' : 'var(--green)';
      html += `<div style="font-size:0.85rem;line-height:1.5;margin-bottom:8px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;color:${color}">${esc(ins)}</div>`;
    }
    html += `</div>`;
  }

  // ── Step timing: clean list, no progress bars ──────────────────────
  if (a.stepContributions && a.stepContributions.length > 0) {
    html += `<div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Step Timing Breakdown</div>`;
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.82rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border);background:rgba(255,255,255,0.02)">
          <th style="text-align:left;padding:10px 14px;color:var(--muted);font-weight:500">Step</th>
          <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">Duration</th>
          <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">% of Total</th>
          <th style="text-align:left;padding:10px 14px;color:var(--muted);font-weight:500">Note</th>
        </tr>
      </thead>
      <tbody>`;
    for (const s of a.stepContributions) {
      const fc = s.flag === 'critical' ? 'var(--red)' : s.flag === 'slow' ? 'var(--yellow)' : 'var(--text)';
      const badge = s.flag !== 'ok' ? `<span style="font-size:0.65rem;background:${fc};color:#000;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:600">${s.flag.toUpperCase()}</span>` : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 14px">${esc(s.stepName)}${badge}</td>
        <td style="padding:10px 14px;text-align:right;font-weight:600;color:${fc};font-family:monospace">${fmtMs(s.durationMs)}</td>
        <td style="padding:10px 14px;text-align:right;color:var(--muted)">${s.percentOfTotal}%</td>
        <td style="padding:10px 14px;font-size:0.75rem;color:var(--yellow)">${s.note ? esc(s.note) : ''}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── VALIDATION — Bundle stats (1× per 5000-row chunk) ─────────────
  if (a.validationBundleStats && a.validationBundleStats.length > 0) {
    html += sectionLabel('Validation — Bundle Stats (1× per chunk)');
    html += sortableTable('val-bundle', a.validationBundleStats.map(b => ({
      chunk: b.chunkIndex,
      rows: b.rowCount ?? '—',
      existingUsersMs: b.existingUsersMs ?? 0,
      redisBatchSizeMs: b.redisBatchSizeMs ?? 0,
      flag: 'ok',
    })), ['Chunk', 'Rows', 'Fetched existing users', 'Fetched batch size from redis'],
      ['chunk', 'rows', 'existingUsersMs', 'redisBatchSizeMs']);
  }

  // ── VALIDATION — Batch stats (1× per 500-row batch) ───────────────
  if (a.validationBatchStats && a.validationBatchStats.length > 0) {
    html += sectionLabel('Validation — Batch Stats (BulkInsert, 1× per 500-row batch)');
    html += sortableTable('val-batch', a.validationBatchStats.map(b => ({
      range: `${b.startRow}–${b.endRow}`,
      bulkInsertMs: b.bulkInsertMs,
      timestamp: fmtTimestampShort(b.timestamp),
      flag: b.bulkInsertMs > 3000 ? 'critical' : b.bulkInsertMs > 1000 ? 'slow' : 'ok',
    })), ['Row Range', 'BulkInsert Duration', 'Timestamp (UTC)'],
      ['range', 'bulkInsertMs', 'timestamp']);
  }

  // ── VALIDATION — Row stats (per-row, conditional) ─────────────────
  if (a.validationRowInsights && a.validationRowInsights.length > 0) {
    html += sectionLabel('Validation — Per-Row Step Analysis (conditional, fires when >0ms)');
    html += sortableTable('val-perrow', a.validationRowInsights.map(p => ({
      stepName: p.stepName, avgMs: p.avgMs, maxMs: p.maxMs, occurrences: p.occurrences,
      projected: p.projectedTotalMin > 0 ? p.projectedTotalMin.toFixed(1) + ' min' : '—',
      flag: p.flag, note: p.note || '',
    })), ['Step', 'Avg/row', 'Max/row', 'Count', 'Projected', 'Note'],
      ['stepName', 'avgMs', 'maxMs', 'occurrences', 'projected', 'note']);
  }

  // ── SUBMISSION — Stage stats (1× per job) ─────────────────────────
  if (a.submissionStageStats && a.submissionStageStats.length > 0) {
    html += sectionLabel('Submission — Stage Stats (1× per job)');
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
      <thead style="position:sticky;top:0;z-index:1;background:#1e293b">
        <tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:500">Step</th>
          <th style="text-align:right;padding:8px 12px;color:var(--muted);font-weight:500">Duration</th>
          <th style="text-align:right;padding:8px 12px;color:var(--muted);font-weight:500">Extra</th>
        </tr>
      </thead><tbody>`;
    for (const s of a.submissionStageStats) {
      const fc = (s.valueMs ?? 0) > 5000 ? 'var(--red)' : (s.valueMs ?? 0) > 2000 ? 'var(--yellow)' : 'var(--text)';
      html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
        <td style="padding:7px 12px">${esc(s.stepName)}</td>
        <td style="padding:7px 12px;text-align:right;font-family:monospace;color:${fc}">${s.valueMs != null ? fmtMs(s.valueMs) : '—'}</td>
        <td style="padding:7px 12px;text-align:right;color:var(--muted);font-size:0.75rem">${s.extra ? esc(s.extra) : ''}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── SUBMISSION — Bundle stats (1× per 5000-row chunk) ─────────────
  if (a.submissionBundleStats && a.submissionBundleStats.length > 0) {
    html += sectionLabel('Submission — Bundle Stats (1× per 5000-row chunk)');
    html += sortableTable('sub-bundle', a.submissionBundleStats.map(b => ({
      bundle: b.bundleIdx,
      rows: b.startRow != null && b.endRow != null ? `${b.startRow}–${b.endRow}` : '—',
      bundleDbFetchMs: b.bundleDbFetchMs ?? 0,
      attrCount: b.attributeCount ?? '—',
      accounts: b.accountIds ?? '—',
      linked: b.linkedAccountIds ?? '—',
      flag: (b.bundleDbFetchMs ?? 0) > 5000 ? 'critical' : (b.bundleDbFetchMs ?? 0) > 2000 ? 'slow' : 'ok',
    })), ['Bundle', 'Row Range', 'Bundle DB Fetch', 'Attr Count', 'Accounts', 'Linked Accts'],
      ['bundle', 'rows', 'bundleDbFetchMs', 'attrCount', 'accounts', 'linked']);
  }

  // ── SUBMISSION — Batch stats (1× per 500-row batch) ───────────────
  if (a.submissionBatchStats && a.submissionBatchStats.length > 0) {
    html += sectionLabel('Submission — Batch Stats (1× per 500-row batch, grouped by bundle)');

    // Group batches by bundleIdx
    const batchesByBundle = new Map();
    for (const b of a.submissionBatchStats) {
      if (!batchesByBundle.has(b.bundleIdx)) batchesByBundle.set(b.bundleIdx, []);
      batchesByBundle.get(b.bundleIdx).push(b);
    }

    for (const [bundleIdx, batches] of [...batchesByBundle.entries()].sort((a, b) => a[0] - b[0])) {
      const totalBulkMs = batches.reduce((s, b) => s + (b.bulkProcessingMs ?? 0), 0);
      const totalLoopMs = batches.reduce((s, b) => s + (b.loopProcessingMs ?? 0), 0);
      const slowCount = batches.filter(b => (b.bulkProcessingMs ?? 0) > 5000).length;

      html += `<details style="margin-bottom:10px">
        <summary style="cursor:pointer;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;list-style:none;display:flex;justify-content:space-between;align-items:center;font-size:0.82rem">
          <span style="font-weight:500">Bundle starting at row <span style="font-family:monospace;color:var(--accent)">${bundleIdx.toLocaleString()}</span></span>
          <div style="display:flex;gap:14px;align-items:center">
            ${slowCount > 0 ? `<span style="font-size:0.7rem;background:var(--yellow);color:#000;padding:1px 7px;border-radius:4px;font-weight:600">${slowCount} slow</span>` : ''}
            <span style="font-size:0.75rem;color:var(--muted)">${batches.length} batches</span>
            <span style="font-size:0.75rem;color:var(--muted)">Loop total: <span style="font-family:monospace">${fmtMs(totalLoopMs)}</span></span>
            <span style="font-size:0.75rem;color:var(--muted)">Bulk total: <span style="font-family:monospace;color:var(--accent)">${fmtMs(totalBulkMs)}</span></span>
          </div>
        </summary>
        <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">`;

      const tblId = `sub-batch-${bundleIdx}`;
      html += sortableTable(tblId, batches.map(b => ({
        batchStart: b.batchIdx,
        endRow: b.endRow ?? '—',
        loopMs: b.loopProcessingMs ?? 0,
        bulkMs: b.bulkProcessingMs ?? 0,
        start: b.startTime ? fmtTimestampShort(b.startTime) : '—',
        flag: (b.bulkProcessingMs ?? 0) > 5000 ? 'critical' : (b.bulkProcessingMs ?? 0) > 2000 ? 'slow' : 'ok',
      })), ['Batch Start Row', 'End Row', 'Loop Processing', 'Bulk Processing', 'Start (UTC)'],
        ['batchStart', 'endRow', 'loopMs', 'bulkMs', 'start']);

      html += `</div></details>`;
    }
  }

  // ── SUBMISSION — Row stats (per-row, unconditional) ────────────────
  if (a.submissionRowInsights && a.submissionRowInsights.length > 0) {
    html += sectionLabel('Submission — Per-Row Step Analysis (fires on every row)');
    html += sortableTable('sub-perrow', a.submissionRowInsights.map(s => ({
      stepName: s.stepName, avgMs: s.avgMs, maxMs: s.maxMs, occurrences: s.occurrences,
      projected: s.projectedTotalMin > 0 ? s.projectedTotalMin.toFixed(1) + ' min' : '—',
      flag: s.flag, note: s.note || '',
    })), ['Step', 'Avg/row', 'Max/row', 'Count', 'Projected', 'Note'],
      ['stepName', 'avgMs', 'maxMs', 'occurrences', 'projected', 'note']);
  }

  // ── Slow checkpoints ───────────────────────────────────────────────
  if (a.slowCheckpoints && a.slowCheckpoints.length > 0) {
    html += slowCheckpointsSection(a.slowCheckpoints);
  }

  return html;
}

function sectionLabel(text) {
  return `<div style="font-size:0.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;margin-top:16px">${esc(text)}</div>`;
}

// ── Virtual scroll for raw bundle tables ──────────────────────────────────
// Renders only visible rows. ROW_H = row height in px.
const VROW_H = 30;
const VLIST_H = 320; // viewport height

window._vLists = {}; // id → { allRows, filteredRows, filter, scrollTop }

function rawBundlesSection(title, bundles) {
  let html = `<details style="margin-bottom:16px">`;
  html += `<summary style="cursor:pointer;font-size:0.75rem;font-weight:600;color:var(--accent);text-transform:uppercase;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;list-style:none;display:flex;justify-content:space-between;align-items:center">
    <span>${esc(title)}</span>
    <span style="color:var(--muted);font-weight:400">${bundles.length} bundle(s) — click to expand</span>
  </summary>`;
  html += `<div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">`;

  for (const bundle of bundles) {
    const slowCount = bundle.timings.filter(t => t.ms > 5).length;
    const totalEntries = bundle.timings.length;
    const vid = `vlist-${title.replace(/\W/g, '')}-${bundle.label.replace(/\W/g, '')}`;

    // Store data keyed by vid
    window._vLists[vid] = {
      allRows: bundle.timings,
      filteredRows: bundle.timings,
      filter: '',
      scrollTop: 0,
    };

    html += `<details style="border-bottom:1px solid var(--border)">`;
    html += `<summary style="cursor:pointer;padding:10px 14px;background:rgba(255,255,255,0.02);display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;list-style:none" onclick="setTimeout(()=>vlistInit('${vid}'),0)">
      <span style="font-weight:500">${esc(bundle.label)}</span>
      <div style="display:flex;gap:12px;align-items:center">
        ${slowCount > 0 ? `<span style="font-size:0.7rem;background:var(--yellow);color:#000;padding:1px 7px;border-radius:4px;font-weight:600">${slowCount} slow</span>` : ''}
        <span style="font-family:monospace;color:var(--accent)">${fmtMs(bundle.totalMs)}</span>
        <span style="color:var(--muted);font-size:0.75rem">${totalEntries} entries</span>
      </div>
    </summary>`;

    html += `<div style="border-top:1px solid var(--border)">
      <!-- search + count bar -->
      <div style="display:flex;gap:8px;padding:8px 12px;align-items:center;background:rgba(0,0,0,0.15)">
        <input type="text" placeholder="Search…" oninput="vlistFilter('${vid}',this.value)"
          style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:0.75rem">
        <span style="font-size:0.7rem;color:var(--muted);white-space:nowrap" id="${vid}-count">${totalEntries} rows</span>
      </div>
      <!-- sticky header -->
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
        <thead style="background:#1e293b">
          <tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 12px;color:var(--muted);font-weight:500;width:160px">Timestamp (UTC)</th>
            <th style="text-align:left;padding:6px 12px;color:var(--muted);font-weight:500">Step</th>
            <th style="text-align:right;padding:6px 12px;color:var(--muted);font-weight:500;width:80px">Duration</th>
          </tr>
        </thead>
      </table>
      <!-- virtual scroll viewport -->
      <div id="${vid}-vp" style="height:${VLIST_H}px;overflow-y:auto;position:relative" onscroll="vlistScroll('${vid}',this.scrollTop)">
        <!-- total height spacer -->
        <div id="${vid}-spacer" style="height:${totalEntries * VROW_H}px;position:relative">
          <!-- rendered rows injected here -->
          <table id="${vid}-tbl" style="width:100%;border-collapse:collapse;font-size:0.78rem;position:absolute;top:0;left:0;right:0">
            <colgroup><col style="width:160px"><col><col style="width:80px"></colgroup>
            <tbody id="${vid}-tbody"></tbody>
          </table>
        </div>
      </div>
    </div></details>`;
  }

  html += `</div></details>`;
  return html;
}

function vlistInit(vid) {
  const state = window._vLists[vid];
  if (!state || document.getElementById(vid + '-tbody').dataset.init) return;
  document.getElementById(vid + '-tbody').dataset.init = '1';
  vlistRender(vid, 0);
}

function vlistFilter(vid, val) {
  const state = window._vLists[vid];
  if (!state) return;
  state.filter = val.toLowerCase();
  state.filteredRows = val
    ? state.allRows.filter(t =>
      t.step.toLowerCase().includes(state.filter) ||
      fmtTimestampShort(t.timestamp).includes(state.filter) ||
      String(t.ms).includes(state.filter))
    : state.allRows;
  // Update spacer height and count
  const spacer = document.getElementById(vid + '-spacer');
  if (spacer) spacer.style.height = (state.filteredRows.length * VROW_H) + 'px';
  const countEl = document.getElementById(vid + '-count');
  if (countEl) countEl.textContent = `${state.filteredRows.length} / ${state.allRows.length} rows`;
  // Reset scroll and re-render
  const vp = document.getElementById(vid + '-vp');
  if (vp) vp.scrollTop = 0;
  vlistRender(vid, 0);
}

function vlistScroll(vid, scrollTop) {
  window._vLists[vid].scrollTop = scrollTop;
  vlistRender(vid, scrollTop);
}

function vlistRender(vid, scrollTop) {
  const state = window._vLists[vid];
  if (!state) return;
  const rows = state.filteredRows;
  const total = rows.length;
  if (total === 0) {
    const tbody = document.getElementById(vid + '-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="padding:12px;color:var(--muted);text-align:center;font-size:0.75rem">No results</td></tr>`;
    const tbl = document.getElementById(vid + '-tbl');
    if (tbl) tbl.style.top = '0px';
    return;
  }

  // Which rows are visible?
  const startIdx = Math.max(0, Math.floor(scrollTop / VROW_H) - 3);       // 3-row overscan
  const endIdx = Math.min(total - 1, Math.ceil((scrollTop + VLIST_H) / VROW_H) + 3);

  const tbl = document.getElementById(vid + '-tbl');
  const tbody = document.getElementById(vid + '-tbody');
  if (!tbl || !tbody) return;

  // Position the rendered table at the start of the visible window
  tbl.style.top = (startIdx * VROW_H) + 'px';

  tbody.innerHTML = rows.slice(startIdx, endIdx + 1).map(t => {
    const fc = t.ms > 50 ? 'var(--red)' : t.ms > 5 ? 'var(--yellow)' : 'var(--text)';
    return `<tr style="height:${VROW_H}px;border-bottom:1px solid rgba(255,255,255,0.04)">
      <td style="padding:0 12px;color:var(--muted);font-family:monospace;white-space:nowrap;font-size:0.73rem;vertical-align:middle">${esc(fmtTimestampShort(t.timestamp))}</td>
      <td style="padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle" title="${esc(t.step)}">${esc(t.step)}</td>
      <td style="padding:0 12px;text-align:right;font-family:monospace;font-weight:${t.ms > 5 ? '600' : '400'};color:${fc};vertical-align:middle">${t.ms.toFixed(1)}ms</td>
    </tr>`;
  }).join('');
}


function slowCheckpointsSection(checkpoints) {
  if (!checkpoints || checkpoints.length === 0) return '';

  // Group by step name for summary
  const byStep = new Map();
  for (const c of checkpoints) {
    if (!byStep.has(c.step)) byStep.set(c.step, []);
    byStep.get(c.step).push(c);
  }

  let html = `<div style="background:#1a0f00;border:2px solid var(--yellow);border-radius:12px;padding:16px;margin-bottom:16px">`;
  html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-size:0.8rem;font-weight:600;color:var(--yellow);text-transform:uppercase">⚠ Slow Checkpoints (&gt;5ms on synchronous ops)</div>
    <span style="font-size:0.75rem;color:var(--muted)">${checkpoints.length} occurrences across ${byStep.size} step type(s)</span>
  </div>`;

  // Summary by step
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">`;
  for (const [step, items] of [...byStep.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const maxMs = Math.max(...items.map(i => i.ms));
    const avgMs = items.reduce((s, i) => s + i.ms, 0) / items.length;
    html += `<div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:6px;padding:6px 12px;font-size:0.75rem">
      <div style="color:var(--yellow);font-weight:500">${esc(step)}</div>
      <div style="color:var(--muted);margin-top:2px">${items.length}× · avg ${avgMs.toFixed(1)}ms · max ${maxMs.toFixed(1)}ms</div>
    </div>`;
  }
  html += `</div>`;

  // Full list collapsible
  html += `<details><summary style="cursor:pointer;font-size:0.78rem;color:var(--accent)">Show all ${checkpoints.length} slow entries</summary>`;
  html += `<div style="overflow-x:auto;margin-top:8px">`;
  html += `<table style="width:100%;border-collapse:collapse;font-size:0.78rem">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:500">Timestamp (UTC)</th>
      <th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:500">Chunk</th>
      <th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:500">Step</th>
      <th style="text-align:right;padding:6px 10px;color:var(--muted);font-weight:500">Duration</th>
    </tr></thead>
    <tbody>`;
  for (const c of checkpoints.slice(0, 200)) {
    const fc = c.ms > 50 ? 'var(--red)' : 'var(--yellow)';
    html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
      <td style="padding:5px 10px;color:var(--muted);font-family:monospace;white-space:nowrap">${esc(fmtTimestampShort(c.timestamp))}</td>
      <td style="padding:5px 10px;color:var(--muted)">${c.batch}</td>
      <td style="padding:5px 10px">${esc(c.step)}</td>
      <td style="padding:5px 10px;text-align:right;font-family:monospace;font-weight:600;color:${fc}">${c.ms.toFixed(1)}ms</td>
    </tr>`;
  }
  if (checkpoints.length > 200) {
    html += `<tr><td colspan="4" style="padding:8px 10px;color:var(--muted);font-size:0.75rem;text-align:center">... and ${checkpoints.length - 200} more</td></tr>`;
  }
  html += `</tbody></table></div></details>`;
  html += `</div>`;
  return html;
}

function fmtTimestampShort(iso) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch { return iso; }
}

// ── Sortable + searchable + virtualized table ──────────────────────────────
// Each table gets a unique id. Data stored in window._tableData[id].
// Renders max 200 rows in DOM; search filters in-memory.

window._tableData = {};

function sortableTable(id, rows, headers, keys) {
  window._tableData[id] = { rows, headers, keys, sortKey: null, sortDir: 1, filter: '' };
  return `<div class="stbl-wrap" data-id="${id}" style="margin-bottom:16px">
    <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
      <input type="text" placeholder="Search…" oninput="filterTable('${id}',this.value)"
        style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.78rem">
      <span style="font-size:0.72rem;color:var(--muted)" id="stbl-count-${id}">${rows.length} rows</span>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:360px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem" id="stbl-${id}">
        <thead id="stbl-head-${id}" style="position:sticky;top:0;z-index:1;background:#1e293b"></thead>
        <tbody id="stbl-body-${id}"></tbody>
      </table>
    </div>
  </div>`;
}

function renderTableData(id) {
  const d = window._tableData[id];
  if (!d) return;
  const { rows, headers, keys, sortKey, sortDir, filter } = d;

  // Filter
  let visible = filter
    ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(filter.toLowerCase())))
    : rows;

  // Sort
  if (sortKey) {
    visible = [...visible].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }

  // Update count
  const countEl = document.getElementById(`stbl-count-${id}`);
  if (countEl) countEl.textContent = `${visible.length} / ${rows.length} rows`;

  // Render header — sticky, same table as body so columns always align
  const head = document.getElementById(`stbl-head-${id}`);
  if (head) {
    head.innerHTML = `<tr style="border-bottom:2px solid var(--border)">` +
      headers.map((h, i) => {
        const k = keys[i];
        const active = sortKey === k;
        const arrow = active ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
        return `<th onclick="sortTable('${id}','${k}')" style="text-align:${i === 0 ? 'left' : 'right'};padding:8px 12px;color:${active ? 'var(--accent)' : 'var(--muted)'};font-weight:500;cursor:pointer;white-space:nowrap;user-select:none">${esc(h)}${arrow}</th>`;
      }).join('') + `</tr>`;
  }

  // Render all visible rows (no cap — virtualisation via CSS scroll)
  const body = document.getElementById(`stbl-body-${id}`);
  if (!body) return;
  const fc = r => r.flag === 'critical' ? 'var(--red)' : r.flag === 'slow' ? 'var(--yellow)' : 'var(--text)';
  body.innerHTML = visible.map(r =>
    `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">` +
    keys.map((k, i) => {
      const val = r[k];
      const isNum = typeof val === 'number';
      const display = isNum
        ? (k === 'avgMs' || k === 'maxMs' ? val.toFixed(1) + 'ms' : val)
        : (val ?? '—');
      const color = i === 0 ? fc(r) : (k === 'avgMs' || k === 'maxMs' ? fc(r) : 'var(--text)');
      return `<td style="padding:7px 12px;text-align:${i === 0 ? 'left' : 'right'};color:${color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(String(val ?? ''))}">${esc(String(display))}</td>`;
    }).join('') + `</tr>`
  ).join('');
}

function sortTable(id, key) {
  const d = window._tableData[id];
  if (!d) return;
  d.sortDir = d.sortKey === key ? d.sortDir * -1 : 1;
  d.sortKey = key;
  renderTableData(id);
}

function filterTable(id, val) {
  const d = window._tableData[id];
  if (!d) return;
  d.filter = val;
  renderTableData(id);
}

function attachTableListeners() {
  // Render all tables that were registered during this render pass
  for (const id of Object.keys(window._tableData)) {
    renderTableData(id);
  }
}

function stepStatsTable(rows) {
  let html = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px">`;
  html += `<table style="width:100%;border-collapse:collapse;font-size:0.82rem">
    <thead>
      <tr style="border-bottom:1px solid var(--border);background:rgba(255,255,255,0.02)">
        <th style="text-align:left;padding:10px 14px;color:var(--muted);font-weight:500">Step</th>
        <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">Avg</th>
        <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">Max</th>
        <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">Count</th>
        <th style="text-align:right;padding:10px 14px;color:var(--muted);font-weight:500">Projected</th>
        <th style="text-align:left;padding:10px 14px;color:var(--muted);font-weight:500">Note</th>
      </tr>
    </thead>
    <tbody>`;
  for (const r of rows) {
    const fc = r.flag === 'critical' ? 'var(--red)' : r.flag === 'slow' ? 'var(--yellow)' : 'var(--text)';
    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 14px;color:${fc}">${esc(r.stepName)}</td>
      <td style="padding:10px 14px;text-align:right;font-family:monospace">${r.avgMs.toFixed(1)}ms</td>
      <td style="padding:10px 14px;text-align:right;font-family:monospace">${r.maxMs.toFixed(1)}ms</td>
      <td style="padding:10px 14px;text-align:right;color:var(--muted)">${r.occurrences}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:${r.extra?.flag !== 'ok' ? '600' : '400'};color:${r.extra?.flag === 'critical' ? 'var(--red)' : r.extra?.flag === 'slow' ? 'var(--yellow)' : 'var(--muted)'}">
        ${r.extra ? esc(r.extra.value) : '—'}
      </td>
      <td style="padding:10px 14px;font-size:0.75rem;color:var(--yellow)">${r.note ? esc(r.note) : ''}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function metaRow(label, value, mono = false) {
  return `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;font-size:0.75rem">
    <span style="color:var(--muted);white-space:nowrap">${esc(label)}</span>
    <span style="${mono ? 'font-family:monospace;' : ''}color:var(--text);text-align:right;word-break:break-all">${esc(value)}</span>
  </div>`;
}

function fmtTimestamp(iso) {
  // Always show in UTC
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') + ' UTC';
  } catch { return iso; }
}

function renderComparison(data) {
  let html = '';
  const c = data.comparison;

  html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px">`;
  html += `<div style="font-size:0.8rem;font-weight:600;color:var(--accent);margin-bottom:12px;text-transform:uppercase">Comparison</div>`;
  html += `<div style="display:flex;gap:24px;flex-wrap:wrap">`;
  html += `<div><div style="font-size:0.7rem;color:var(--muted)">Import A</div><div style="font-family:monospace;font-size:0.8rem">${esc(c.idA)}</div>${c.rowCountA ? `<div style="font-size:0.75rem;color:var(--muted)">${c.rowCountA.toLocaleString()} rows</div>` : ''}</div>`;
  html += `<div style="color:var(--muted);align-self:center;font-size:1.2rem">vs</div>`;
  html += `<div><div style="font-size:0.7rem;color:var(--muted)">Import B</div><div style="font-family:monospace;font-size:0.8rem">${esc(c.idB)}</div>${c.rowCountB ? `<div style="font-size:0.75rem;color:var(--muted)">${c.rowCountB.toLocaleString()} rows</div>` : ''}</div>`;
  html += `</div></div>`;

  // Comparison insights
  if (c.insights && c.insights.length > 0) {
    html += `<div style="background:#1a1a2e;border:1px solid var(--accent);border-radius:12px;padding:16px;margin-bottom:16px">`;
    html += `<div style="font-size:0.8rem;font-weight:600;color:var(--accent);margin-bottom:10px;text-transform:uppercase">Comparison Insights</div>`;
    for (const ins of c.insights) {
      html += `<div style="font-size:0.85rem;line-height:1.5;margin-bottom:6px;color:var(--yellow)">${esc(ins)}</div>`;
    }
    html += `</div>`;
  }

  // Step diff table
  if (c.stepDiff && c.stepDiff.length > 0) {
    html += sectionTitle('Step-by-Step Comparison');
    html += `<div style="overflow-x:auto;margin-bottom:16px">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--muted)">
          <th style="text-align:left;padding:8px 12px">Step</th>
          <th style="text-align:right;padding:8px 12px">Import A</th>
          <th style="text-align:right;padding:8px 12px">Import B</th>
          <th style="text-align:right;padding:8px 12px">Delta</th>
          <th style="text-align:right;padding:8px 12px">Change</th>
        </tr>
      </thead>
      <tbody>`;
    for (const s of c.stepDiff) {
      const flagColor = s.flag === 'slower' ? 'var(--red)' : s.flag === 'faster' ? 'var(--green)' : 'var(--muted)';
      const deltaSign = s.deltaMs > 0 ? '+' : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 12px">${esc(s.stepName)}</td>
        <td style="padding:8px 12px;text-align:right">${fmtMs(s.msA)}</td>
        <td style="padding:8px 12px;text-align:right">${fmtMs(s.msB)}</td>
        <td style="padding:8px 12px;text-align:right;color:${flagColor};font-weight:600">${deltaSign}${fmtMs(s.deltaMs)}</td>
        <td style="padding:8px 12px;text-align:right;color:${flagColor}">${deltaSign}${s.deltaPercent}%</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Individual analyses
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">`;
  html += `<div><div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px">IMPORT A DETAILS</div>${renderSingleImport(data.primary)}</div>`;
  html += `<div><div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px">IMPORT B DETAILS</div>${renderSingleImport(data.secondary)}</div>`;
  html += `</div>`;

  return html;
}

function fmtMs(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'min';
}
