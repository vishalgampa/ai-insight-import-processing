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

function esc(s) { 
    if (s == null) return '';
    const d = document.createElement('div'); 
    d.textContent = String(s); 
    return d.innerHTML; 
}

function fmtTimestampShort(iso) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch { return iso; }
}

function fmtMs(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'min';
}

function sectionTitle(text) {
  return `<div style="font-size:0.9rem;font-weight:700;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:10px">
    <div style="width:4px;height:16px;background:var(--accent);border-radius:2px"></div>${esc(text)}</div>`;
}

function metricCard(label, value, color) {
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 18px;min-width:140px">
    <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;margin-bottom:4px">${esc(label)}</div>
    <div style="font-size:1.2rem;font-weight:700;color:${color}">${esc(value)}</div>
  </div>`;
}

function renderResults(data) {
  const r = document.getElementById('results');
  let html = '';
  const steps = data.steps || [];
  html += '<div class="pipeline">';
  html += sectionTitle('Pipeline Steps');
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">';
  for (const s of steps) {
    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:0.8rem">
      <span style="color:var(--green)">✓</span> ${esc(s.name)}</div>`;
  }
  html += '</div>';
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
    html += `<div style="background:var(--surface);border:1px solid var(--yellow);border-radius:12px;padding:24px;color:var(--yellow);margin-bottom:24px">⚠ ${esc(data.error)}</div>`;
    r.innerHTML = html;
    return;
  }
  r.innerHTML = html;
}

function switchTab(tab) {
  const panels = ['rca', 'import', 'studio', 'history'];
  panels.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.style.display = p === tab ? '' : 'none';
    const btn = document.getElementById(`tab-${p}`);
    if (btn) {
        btn.style.background = p === tab ? 'var(--surface)' : 'var(--bg)';
        btn.style.color = p === tab ? 'var(--text)' : 'var(--muted)';
    }
  });
  window.location.hash = tab;
  if (tab === 'history') fetchHistory();
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (['rca', 'import', 'studio', 'history'].includes(hash)) {
    switchTab(hash);
  }
});

window.addEventListener('load', () => {
  const hash = window.location.hash.replace('#', '');
  if (['rca', 'import', 'studio', 'history'].includes(hash)) {
    switchTab(hash);
  }
});

// ── History Studio ────────────────────────────────────────────────────────

async function fetchHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<div style="padding:40px; text-align:center"><span class="spinner"></span> Loading history...</div>';
    try {
        const res = await fetch('/api/import-history');
        const data = await res.json();
        if (data.error) { list.innerHTML = errorCard(data.error); return; }
        if (data.history.length === 0) {
            list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted)">No run history found.</div>';
            return;
        }
        list.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem">
            <thead>
                <tr style="background:rgba(255,255,255,0.02); color:var(--muted); border-bottom:2px solid var(--border)">
                    <th style="text-align:left; padding:12px">Timestamp (UTC)</th>
                    <th style="text-align:left; padding:12px">Client File Upload ID</th>
                    <th style="text-align:right; padding:12px">Rows</th>
                    <th style="text-align:right; padding:12px">Bucket</th>
                    <th style="text-align:center; padding:12px">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${data.history.map(h => `
                    <tr style="border-bottom:1px solid var(--border)">
                        <td style="padding:12px; color:var(--muted)">${fmtTimestampShort(h.timestamp)}</td>
                        <td style="padding:12px; font-family:monospace">${h.clientFileUploadId}</td>
                        <td style="padding:12px; text-align:right">${(h.rowCount || 0).toLocaleString()}</td>
                        <td style="padding:12px; text-align:right">${h.sizeBucket/1000}k</td>
                        <td style="padding:12px; text-align:center">
                            <button class="btn" style="padding:4px 12px; font-size:0.7rem; background:var(--surface); border:1px solid var(--border)" onclick="compareHistoryItem('${h.clientFileUploadId}')">Compare Baseline</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    } catch (e) { list.innerHTML = errorCard(e.message); }
}

async function compareHistoryItem(id) {
    const modal = document.getElementById('baselineModal');
    const content = document.getElementById('baselineModalContent');
    modal.style.display = 'block';
    content.innerHTML = '<div style="text-align:center; padding:40px"><span class="spinner"></span> Comparing against baseline...</div>';
    try {
        const res = await fetch('/api/import-compare-baseline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.error) { content.innerHTML = errorCard(data.error); return; }
        const comp = data.comparison;
        let deepDiveHtml = '';

        if (comp.validationBundleDiff) {
            deepDiveHtml += `<h3 style="font-size:0.8rem; color:var(--muted); margin:24px 0 12px; text-transform:uppercase">Validation Deep-Dive (Bundles)</h3>
            <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow-x:auto">
                <table style="width:100%; border-collapse:collapse; font-size:0.75rem">
                    ${comp.validationBundleDiff.map(b => `<tr><td style="padding:8px 12px">Bundle ${b.index}</td><td style="text-align:right; padding:8px 12px">${fmtMs(b.msB)}</td></tr>`).join('')}
                </table>
            </div>`;
        }

        content.innerHTML = `<h2 style="font-size:1.2rem; margin-bottom:20px">Comparison vs ${comp.idA}</h2>${deepDiveHtml}`;
    } catch (e) { content.innerHTML = errorCard(e.message); }
}

function closeBaselineModal() { document.getElementById('baselineModal').style.display = 'none'; }

// ── Comparison Studio ──────────────────────────────────────────────────────

let _studioRawData = [];

async function fetchStudioImports() {
  const btn = document.getElementById('studioFetchBtn');
  const appId = document.getElementById('appId').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const startDate = document.getElementById('studioStart').value;
  const endDate = document.getElementById('studioEnd').value;
  if (!appId || !apiKey || !startDate || !endDate) { alert('Missing fields'); return; }
  btn.disabled = true;
  try {
    const res = await fetch('/api/import-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, apiKey, startDate, endDate }),
    });
    const data = await res.json();
    document.getElementById('studioListArea').style.display = 'block';
    document.getElementById('studioList').innerHTML = data.imports.map(i => `
        <div style="padding:10px; border-bottom:1px solid var(--border)">
            <input type="checkbox" value="${i.clientFileUploadId}" checked> ${i.clientFileUploadId}
        </div>`).join('');
  } finally { btn.disabled = false; }
}

async function runStudioAnalysis() {
  const btn = document.getElementById('studioAnalyzeBtn');
  const appId = document.getElementById('appId').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const saveReports = document.getElementById('studioSaveReports').checked;
  const ids = Array.from(document.querySelectorAll('#studioList input:checked')).map(cb => cb.value);
  if (ids.length === 0) return;
  btn.disabled = true;
  document.getElementById('studioProgressArea').style.display = 'block';
  _studioRawData = [];
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('studioProgressText').innerText = `Analyzing ${i+1} of ${ids.length}...`;
    try {
      const res = await fetch('/api/import-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, apiKey, clientFileUploadId: ids[i], saveIndividualReports: saveReports }),
      });
      const data = await res.json();
      if (data.primary) _studioRawData.push(data.primary);
      const pct = Math.round(((i+1)/ids.length*100));
      document.getElementById('studioProgressBar').style.width = pct + '%';
      document.getElementById('studioProgressPercent').innerText = pct + '%';
    } catch (e) {}
  }
  btn.disabled = false;
  document.getElementById('studioDashboard').style.display = 'block';
  updateStudioDashboard();
}

function updateStudioDashboard() {
    const container = document.getElementById('studioTable');
    const chartContainer = document.getElementById('studioCharts');
    const groupType = document.getElementById('studioGroup').value;
    const bucketSize = parseInt(document.getElementById('studioBucketSize').value);

    if (!_studioRawData || _studioRawData.length === 0) return;

    const timeGroups = new Map();
    const flatGroupsForChart = [];

    _studioRawData.forEach(a => {
        let timeKey = 'All Time';
        const dateStr = a.stepMeta.validation.startTime || a.stepMeta.mapping.startTime || a.stepMeta.submission.startTime;
        if (dateStr && groupType !== 'none') {
            const d = new Date(dateStr);
            if (groupType === 'day') timeKey = d.toISOString().split('T')[0];
            else if (groupType === 'week') {
                const first = d.getDate() - d.getDay();
                const sunday = new Date(d.setDate(first));
                timeKey = 'Week of ' + sunday.toISOString().split('T')[0];
            }
            else if (groupType === 'month') timeKey = d.toISOString().substring(0, 7);
        }

        const bucket = Math.floor((a.rowCount || 0) / bucketSize) * bucketSize;
        const bucketKey = `${bucket/1000}k Bucket`;

        if (!timeGroups.has(timeKey)) timeGroups.set(timeKey, new Map());
        const bucketMap = timeGroups.get(timeKey);
        if (!bucketMap.has(bucketKey)) bucketMap.set(bucketKey, []);
        bucketMap.get(bucketKey).push(a);
    });

    const sortedTimeKeys = Array.from(timeGroups.keys()).sort((a,b) => a.localeCompare(b));
    sortedTimeKeys.forEach(tk => {
        const bucketMap = timeGroups.get(tk);
        Array.from(bucketMap.entries()).sort((a,b) => a[0].localeCompare(b[0])).forEach(([bk, items]) => {
            const avg = items.reduce((s, i) => s + i.totalEstimatedMs, 0) / items.length;
            flatGroupsForChart.push({ label: groupType === 'none' ? bk : `${tk}<br>${bk}`, avg });
        });
    });

    // Render Bar Chart
    let chartHtml = `
        <div style="grid-column: span 2; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px">
            <h3 style="font-size:0.8rem; margin-bottom:20px; color:var(--muted); text-transform:uppercase; letter-spacing:1px">Avg Total Duration</h3>
            <div style="display:flex; align-items:flex-end; gap:20px; height:240px; padding-bottom:50px; overflow-x:auto; padding-left:10px">
    `;
    const maxAvg = Math.max(...flatGroupsForChart.map(g => g.avg), 1);
    flatGroupsForChart.forEach(g => {
        const h = Math.max(2, (g.avg / maxAvg) * 100);
        chartHtml += `
            <div style="flex:0 0 auto; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; width:80px; height:100%; position:relative">
                <div style="font-size:0.65rem; color:var(--text); margin-bottom:6px; font-weight:700">${fmtMs(g.avg)}</div>
                <div style="width:44px; background:linear-gradient(to top, var(--accent), #60a5fa); border-radius:6px 6px 0 0; height:${h}%" title="Avg: ${fmtMs(g.avg)}"></div>
                <div style="position:absolute; bottom:-40px; width:100px; text-align:center; font-size:0.6rem; color:var(--muted); line-height:1.3">${g.label}</div>
            </div>
        `;
    });
    chartHtml += '</div></div>';
    chartContainer.innerHTML = chartHtml;

    const stripRow = (name) => name.replace(/^Row\s+\d+\s*:?\s*/i, '').trim();

    let html = '';
    for (const tk of sortedTimeKeys) {
        if (groupType !== 'none') {
            html += `<h2 style="margin: 40px 0 20px; font-size:1.4rem; border-left:4px solid var(--accent); padding-left:16px">${tk}</h2>`;
        }
        
        const bucketMap = timeGroups.get(tk);
        const sortedBuckets = Array.from(bucketMap.entries()).sort((a,b) => a[0].localeCompare(b[0]));
        
        for (const [bk, items] of sortedBuckets) {
            const avgTotal = items.reduce((s, i) => s + i.totalEstimatedMs, 0) / items.length;
            const rowId = `details-${tk.replace(/[^a-z0-9]/gi, '-')}-${bk.replace(/[^a-z0-9]/gi, '-')}`;
            
            // Aggregators
            const vGlobal = { mapping: 0, db: 0, blob: 0, chunks: 0, count: 0 };
            const vBundles = new Map(), vBatches = new Map(), vRows = new Map();
            const sGlobal = new Map(), sBundles = new Map(), sBatches = new Map(), sRows = new Map();

            items.forEach(i => {
                const findStep = (name) => {
                    const s = i.stepContributions.find(c => c.stepName === name);
                    return s ? s.durationMs : 0;
                };

                vGlobal.mapping += findStep('Mapping');
                vGlobal.db += findStep('Validation: Initial DB Fetches');
                vGlobal.blob += findStep('Validation: BLOB Download');
                vGlobal.chunks += findStep('Validation: All Chunks');
                vGlobal.count++;
                
                (i.validationBundleStats || []).forEach((b, idx) => {
                    if (!vBundles.has(idx)) vBundles.set(idx, { ms: 0, rows: 0, count: 0 });
                    const vb = vBundles.get(idx); vb.ms += (b.totalMs || 0); vb.rows += (b.rowCount || 0); vb.count++;
                });

                (i.validationBatchStats || []).forEach((b, idx) => {
                    if (!vBatches.has(idx)) vBatches.set(idx, { ms: 0, count: 0, s: b.startRow, e: b.endRow, bIdx: 0 });
                    const vb = vBatches.get(idx); vb.ms += (b.bulkInsertMs || 0); vb.count++;
                });

                (i.validationRowInsights || []).forEach(r => {
                    const name = stripRow(r.stepName);
                    if (!vRows.has(name)) vRows.set(name, { ms: 0, c: 0, p: 0 });
                    const vr = vRows.get(name); vr.ms += r.avgMs; vr.c++; vr.p += r.projectedTotalMs;
                });

                (i.submissionStageStats || []).forEach(s => {
                    if (!sGlobal.has(s.stepName)) sGlobal.set(s.stepName, { ms: 0, c: 0 });
                    const sg = sGlobal.get(s.stepName); sg.ms += (s.valueMs || 0); sg.c++;
                });

                (i.submissionBundleStats || []).forEach((b, idx) => {
                    const bKey = b.bundleIdx;
                    if (!sBundles.has(bKey)) sBundles.set(bKey, { fetch: 0, accounts: 0, linked: 0, custom: 0, count: 0 });
                    const sb = sBundles.get(bKey); sb.fetch += (b.bundleDbFetchMs || 0); sb.accounts += (b.accountIds || 0); sb.linked += (b.linkedAccountIds || 0); sb.custom += (b.customFields || 0); sb.count++;
                });

                (i.submissionBatchStats || []).forEach((b, idx) => {
                    const bKey = `${b.bundleIdx}:${b.batchIdx}`;
                    if (!sBatches.has(bKey)) sBatches.set(bKey, { bulk: 0, loop: 0, total: 0, count: 0, s: b.startRow, e: b.endRow, bIdx: b.bundleIdx });
                    const sb = sBatches.get(bKey); sb.bulk += (b.bulkProcessingMs || 0); sb.loop += (b.loopProcessingMs || 0); sb.total += (b.totalProcessingMs || 0); sb.count++;
                });

                (i.submissionRowInsights || []).forEach(r => {
                    const name = stripRow(r.stepName);
                    if (!sRows.has(name)) sRows.set(name, { ms: 0, c: 0, p: 0 });
                    const sr = sRows.get(name); sr.ms += r.avgMs; sr.c++; sr.p += r.projectedTotalMs;
                });
            });

            const renderTable = (title, headers, rowsHtml) => `
                <h5 style="font-size:0.7rem; color:var(--muted); margin:16px 0 8px; text-transform:uppercase; letter-spacing:0.5px">${title}</h5>
                <div style="background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:20px">
                    <table style="width:100%; border-collapse:collapse; font-size:0.75rem">
                        <tr style="background:rgba(255,255,255,0.03); color:var(--muted); border-bottom:1px solid var(--border)">
                            ${headers.map(h => `<th style="text-align:${h.a||'left'}; padding:10px 14px; font-weight:600">${h.l}</th>`).join('')}
                        </tr>
                        ${rowsHtml}
                    </table>
                </div>`;

            html += `<div style="background:var(--surface); margin-bottom:16px; border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow:0 4px 6px rgba(0,0,0,0.1)">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:20px 24px; background:linear-gradient(to right, rgba(255,255,255,0.02), transparent)">
                    <div>
                        <div style="font-size:1.1rem; font-weight:800; color:var(--accent)">${bk}</div>
                        <div style="font-size:0.85rem; color:var(--muted); margin-top:4px">${items.length} imports • Avg: <span style="color:var(--text); font-weight:600">${fmtMs(avgTotal)}</span></div>
                    </div>
                    <button class="btn" style="padding:8px 20px; font-size:0.8rem; background:var(--bg); border:1px solid var(--border); border-radius:6px" onclick="toggleRow('${rowId}')">Deep-Dive Analysis</button>
                </div>
                
                <div id="${rowId}" style="display:none; padding:24px; border-top:1px solid var(--border); background:rgba(0,0,0,0.05)">
                    
                    <div style="margin-bottom:32px">
                        <h4 style="font-size:0.9rem; color:var(--accent); margin-bottom:16px; border-bottom:1px solid var(--accent); padding-bottom:6px; display:inline-block">VALIDATION ANALYSIS</h4>
                        
                        ${renderTable('Global Validation Stats', [{l:'Step'},{l:'Avg Duration',a:'right'}], `
                            <tr style="border-bottom:1px solid var(--border)"><td style="padding:10px 14px">Mapping Stage</td><td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(vGlobal.mapping/vGlobal.count)}</td></tr>
                            <tr style="border-bottom:1px solid var(--border)"><td style="padding:10px 14px">Initial DB Fetches</td><td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(vGlobal.db/vGlobal.count)}</td></tr>
                            <tr style="border-bottom:1px solid var(--border)"><td style="padding:10px 14px">BLOB Download</td><td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(vGlobal.blob/vGlobal.count)}</td></tr>
                            <tr style="border-bottom:1px solid var(--border)"><td style="padding:10px 14px">Total Chunk Processing</td><td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(vGlobal.chunks/vGlobal.count)}</td></tr>
                        `)}

                        ${renderTable('Bundle Logs', [{l:'Bundle'},{l:'Avg Rows',a:'right'},{l:'Avg Global Work',a:'right'}], 
                            Array.from(vBundles.entries()).map(([idx, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${idx}</td>
                                <td style="text-align:right; padding:10px 14px; color:var(--muted)">${Math.round(v.rows/v.count).toLocaleString()}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.ms/v.count)}</td>
                            </tr>`).join(''))}
                            
                        ${renderTable('Batch Logs (Bulk Insert)', [{l:'Bundle'},{l:'Range'},{l:'Avg Duration',a:'right'}], 
                            Array.from(vBatches.entries()).map(([idx, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${v.bIdx}</td>
                                <td style="padding:10px 14px; color:var(--muted)">Rows ${v.s} - ${v.e}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.ms/v.count)}</td>
                            </tr>`).join(''))}
                            
                        ${renderTable('Per-Row Rules (Aggregated)', [{l:'Rule Name'},{l:'Avg Ms/Row',a:'right'},{l:'Projected Total',a:'right'}], 
                            Array.from(vRows.entries()).sort((a,b) => b[1].p - a[1].p).map(([name, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">${esc(name)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${(v.ms/v.c).toFixed(2)}ms</td>
                                <td style="text-align:right; padding:10px 14px; color:var(--orange); font-weight:600">${fmtMs(v.p/v.c)}</td>
                            </tr>`).join(''))}
                    </div>
                    
                    <div style="margin-bottom:32px">
                        <h4 style="font-size:0.9rem; color:var(--accent); margin-bottom:16px; border-bottom:1px solid var(--accent); padding-bottom:6px; display:inline-block">SUBMISSION ANALYSIS</h4>
                        
                        ${renderTable('Global Submission Stats', [{l:'Step'},{l:'Avg Duration',a:'right'}], 
                            Array.from(sGlobal.entries()).map(([name, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">${esc(name)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.ms/v.c)}</td>
                            </tr>`).join(''))}

                        ${renderTable('Bundle Logs (DB Fetch)', [{l:'Bundle'},{l:'Avg Accounts',a:'right'},{l:'Avg Fetch',a:'right'}], 
                            Array.from(sBundles.entries()).map(([idx, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${idx}</td>
                                <td style="text-align:right; padding:10px 14px; color:var(--muted)">${Math.round(v.accounts/v.count)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.fetch/v.count)}</td>
                            </tr>`).join(''))}
                            
                        ${renderTable('Batch Logs', [{l:'Bundle'},{l:'Range'},{l:'Loop',a:'right'},{l:'Bulk',a:'right'},{l:'Total',a:'right'}], 
                            Array.from(sBatches.entries()).map(([idx, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${v.bIdx}</td>
                                <td style="padding:10px 14px; color:var(--muted)">Rows ${v.s} - ${v.e}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.loop/v.count)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${fmtMs(v.bulk/v.count)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace; font-weight:700; color:var(--accent)">${fmtMs(v.total/v.count)}</td>
                            </tr>`).join(''))}
                            
                        ${renderTable('Per-Row Steps (Aggregated)', [{l:'Step Name'},{l:'Avg Ms/Row',a:'right'},{l:'Projected Total',a:'right'}], 
                            Array.from(sRows.entries()).sort((a,b) => b[1].p - a[1].p).map(([name, v]) => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">${esc(name)}</td>
                                <td style="text-align:right; padding:10px 14px; font-family:monospace">${(v.ms/v.c).toFixed(2)}ms</td>
                                <td style="text-align:right; padding:10px 14px; color:var(--orange); font-weight:600">${fmtMs(v.p/v.c)}</td>
                            </tr>`).join(''))}
                    </div>
                    
                    <div>
                        <h4 style="font-size:0.9rem; color:var(--muted); margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:6px">SOURCE IMPORTS</h4>
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:12px">
                            ${items.map(i => `
                                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); padding:12px 16px; border-radius:8px; border:1px solid var(--border)">
                                    <div style="overflow:hidden">
                                        <div style="font-size:0.75rem; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${i.clientFileUploadId}</div>
                                        <div style="font-size:0.65rem; color:var(--accent); margin-top:4px">${fmtMs(i.totalEstimatedMs)}</div>
                                    </div>
                                    <a href="/reports/import_${i.clientFileUploadId}.html" target="_blank" class="btn" style="padding:4px 12px; font-size:0.7rem; background:var(--surface); border:1px solid var(--border); white-space:nowrap">View Report</a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                </div>
            </div>`;
        }
    }
    container.innerHTML = html;
}

function toggleRow(id) {
    const el = document.getElementById(id);
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function runImportAnalysis() {
    const id = document.getElementById('importClientId').value.trim();
    const appId = document.getElementById('appId').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const results = document.getElementById('importResults');
    
    if (!id || !appId || !apiKey) { alert('Missing fields'); return; }
    
    results.innerHTML = '<div style="padding:40px; text-align:center"><span class="spinner"></span> Analyzing import pipeline...</div>';

    fetch('/api/import-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, apiKey, clientFileUploadId: id })
    }).then(r => r.json()).then(data => {
        if (data.error) {
            results.innerHTML = errorCard(data.error);
            return;
        }
        
        if (data.type === 'comparison') {
            let html = `
                <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:24px">
                    <h2 style="font-size:1.1rem; color:var(--accent); margin-bottom:20px">Comparison: ${data.primary.clientFileUploadId} vs ${data.secondary.clientFileUploadId}</h2>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px">
                        <div style="background:var(--bg); padding:16px; border-radius:8px; border:1px solid var(--border)">
                            <div style="font-size:0.75rem; color:var(--muted); margin-bottom:8px">Primary (${data.primary.rowCount} rows)</div>
                            <div style="font-size:1.1rem; font-weight:700">${fmtMs(data.primary.totalEstimatedMs)}</div>
                            <a href="/reports/import_${data.primary.clientFileUploadId}.html" target="_blank" style="font-size:0.75rem; color:var(--accent); text-decoration:none; margin-top:8px; display:inline-block">View Report</a>
                        </div>
                        <div style="background:var(--bg); padding:16px; border-radius:8px; border:1px solid var(--border)">
                            <div style="font-size:0.75rem; color:var(--muted); margin-bottom:8px">Secondary (${data.secondary.rowCount} rows)</div>
                            <div style="font-size:1.1rem; font-weight:700">${fmtMs(data.secondary.totalEstimatedMs)}</div>
                            <a href="/reports/import_${data.secondary.clientFileUploadId}.html" target="_blank" style="font-size:0.75rem; color:var(--accent); text-decoration:none; margin-top:8px; display:inline-block">View Report</a>
                        </div>
                    </div>

                    ${sectionTitle('Performance Delta')}
                    <div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; overflow:hidden">
                        <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                            <tr style="background:rgba(255,255,255,0.03); color:var(--muted)">
                                <th style="text-align:left; padding:10px 14px">Step Name</th>
                                <th style="text-align:right; padding:10px 14px">Delta</th>
                                <th style="text-align:right; padding:10px 14px">%</th>
                            </tr>
                            ${data.comparison.stepDiff.map(s => `
                                <tr style="border-bottom:1px solid var(--border)">
                                    <td style="padding:10px 14px">${esc(s.stepName)}</td>
                                    <td style="text-align:right; padding:10px 14px; font-family:monospace; color:${s.flag === 'slower' ? 'var(--red)' : s.flag === 'faster' ? 'var(--green)' : 'var(--text)'}">${s.deltaMs > 0 ? '+' : ''}${fmtMs(s.deltaMs)}</td>
                                    <td style="text-align:right; padding:10px 14px; font-family:monospace; color:${s.flag === 'slower' ? 'var(--red)' : s.flag === 'faster' ? 'var(--green)' : 'var(--text)'}">${s.deltaPercent > 0 ? '+' : ''}${s.deltaPercent}%</td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>

                    <div style="margin-top:24px">
                        ${sectionTitle('Comparison Insights')}
                        <ul style="padding-left:20px; font-size:0.85rem; color:var(--muted)">
                            ${data.comparison.insights.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
            results.innerHTML = html;
            return;
        }

        let html = `
            <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:24px">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px">
                    <h2 style="font-size:1.1rem; color:var(--accent)">Analysis Complete: ${id}</h2>
                    <a href="/reports/import_${id}.html" target="_blank" class="btn" style="text-decoration:none">View HTML Report</a>
                </div>
                <div style="font-size:0.85rem; color:var(--muted); margin-bottom:12px">Raw JSON Response:</div>
                <pre style="font-size:0.7rem; background:var(--bg); padding:16px; border-radius:8px; overflow:auto; max-height:400px">${JSON.stringify(data, null, 2)}</pre>
            </div>
        `;
        results.innerHTML = html;
    }).catch(e => {
        results.innerHTML = errorCard(e.message);
    });
}
