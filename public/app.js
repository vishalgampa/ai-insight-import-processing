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
                
                (i.validationBundleStats || []).forEach((b) => {
                    const bKey = b.bundleIdx;
                    if (!vBundles.has(bKey)) vBundles.set(bKey, { ms: 0, rows: 0, count: 0 });
                    const vb = vBundles.get(bKey); vb.ms += (b.totalMs || 0); vb.rows += (b.rowCount || 0); vb.count++;
                });

                (i.validationBatchStats || []).forEach((b, idx) => {
                    const bIdx = Math.floor(b.startRow / (i.bundleSize || 5000));
                    if (!vBatches.has(idx)) vBatches.set(idx, { ms: 0, count: 0, s: b.startRow, e: b.endRow, bIdx });
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
    const btn = document.getElementById('importBtn');
    const id = document.getElementById('importClientId').value.trim();
    const appId = document.getElementById('appId').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const question = document.getElementById('importQuestion').value.trim();
    const results = document.getElementById('importResults');
    
    if (!appId || !apiKey) { alert('Please enter Application ID and API Key above'); return; }
    if (!id) { alert('Please enter a Client File Upload ID'); return; }
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Fetching logs...';
    results.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)"><span class="spinner" style="width:24px;height:24px;border-width:3px"></span><br><br>Running hop chain: anchor ➔ validation ➔ submission...</div>';

    fetch('/api/import-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, apiKey, clientFileUploadId: id, question })
    }).then(r => r.json()).then(data => {
        if (data.error) {
            results.innerHTML = errorCard(data.error);
            return;
        }
        renderImportResults(data, question);
    }).catch(e => {
        results.innerHTML = errorCard(e.message);
    }).finally(() => {
        btn.disabled = false;
        btn.innerHTML = 'Analyze Import';
    });
}

function renderImportResults(data, question) {
    const r = document.getElementById('importResults');
    window._vLists = {};
    window._tableData = {};
    let html = '';

    const diag = data.diagnostics;
    if (diag && diag.noDataReason) {
        html += `<div style="background:#1a0a0a;border:2px solid var(--red);border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:1.2rem">⚠️</span>
            <span style="font-size:0.85rem;font-weight:600;color:var(--red)">Could not retrieve import data</span>
          </div>
          <div style="font-size:0.85rem;line-height:1.6;color:var(--text)">${esc(diag.noDataReason)}</div>
          <div style="margin-top:10px;font-size:0.75rem;color:var(--muted)">
            Anchor logs found: ${diag.anchorFound ? `✓ (${diag.anchorRowCount} rows)` : '✗ none'} &nbsp;•&nbsp;
            Validation: ${diag.validationFound ? '✓' : '✗'} &nbsp;•&nbsp;
            Submission: ${diag.submissionFound ? '✓' : '✗'}
          </div>
        </div>`;
        r.innerHTML = html;
        return;
    }

    if (data.plainAnswer && question) {
        html += `<div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);border:2px solid var(--accent);border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <span style="font-size:1.2rem">💬</span>
            <div style="font-size:0.75rem;font-weight:600;color:var(--accent);text-transform:uppercase">Answer to: "${esc(question)}"</div>
          </div>
          <div style="font-size:0.9rem;line-height:1.7;color:var(--text);white-space:pre-wrap">${esc(data.plainAnswer)}</div>
        </div>`;
    }

    if (data.type === 'comparison' && data.comparison) {
        html += renderComparison(data);
    } else {
        html += renderSingleImport(data.primary);
    }

    r.innerHTML = html;
    attachTableListeners();
}

function renderSingleImport(a, suffix = '') {
    if (!a) return errorCard('No analysis data returned');
    let html = '';

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
            if (!d) continue;
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

    if (a.insights && a.insights.length > 0) {
        html += `<div style="background:#0d1b2a;border:1px solid var(--accent);border-radius:12px;padding:16px;margin-bottom:16px">`;
        html += `<div style="font-size:0.75rem;font-weight:600;color:var(--accent);margin-bottom:10px;text-transform:uppercase">AI Insights</div>`;
        for (const ins of a.insights) {
            const color = ins.startsWith('❌') ? 'var(--red)' : ins.startsWith('⚠️') ? 'var(--yellow)' : 'var(--green)';
            html += `<div style="font-size:0.85rem;line-height:1.5;margin-bottom:8px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;color:${color}">${esc(ins)}</div>`;
        }
        html += `</div>`;
    }
    html += `<div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Performance Visualizations</div>`;
    html += generateSvgChartsHtml(a);

    if (a.validationBundleStats && a.validationBundleStats.length > 0) {
        html += sectionLabel('Validation — Bundle Stats (1× per chunk)');
        html += sortableTable('val-bundle' + suffix, a.validationBundleStats.map(b => ({
          chunk: b.chunkIndex,
          rows: b.rowCount ?? '—',
          existingUsersMs: b.existingUsersMs ?? 0,
          redisBatchSizeMs: b.redisBatchSizeMs ?? 0,
          flag: 'ok',
        })), ['Chunk', 'Rows', 'Fetched existing users (ms)', 'Fetched batch size from redis (ms)'],
          ['chunk', 'rows', 'existingUsersMs', 'redisBatchSizeMs']);
    }

    if (a.validationBatchStats && a.validationBatchStats.length > 0) {
        html += sectionLabel('Validation — Batch Stats (BulkInsert, 1× per 500-row batch)');
        html += sortableTable('val-batch' + suffix, a.validationBatchStats.map(b => ({
          range: `${b.startRow}–${b.endRow}`,
          bulkInsertSec: b.bulkInsertMs != null ? +(b.bulkInsertMs / 1000).toFixed(2) : 0,
          timestamp: fmtTimestampShort(b.timestamp),
          flag: b.bulkInsertMs > 3000 ? 'critical' : b.bulkInsertMs > 1000 ? 'slow' : 'ok',
        })), ['Row Range', 'BulkInsert Duration (s)', 'Timestamp (UTC)'],
          ['range', 'bulkInsertSec', 'timestamp']);
    }

    if (a.validationRowInsights && a.validationRowInsights.length > 0) {
        html += sectionLabel('Validation — Per-Row Step Analysis (conditional, fires when >0ms)');
        html += sortableTable('val-perrow' + suffix, a.validationRowInsights.map(p => ({
          stepName: p.stepName, avgMs: p.avgMs, maxMs: p.maxMs, occurrences: p.occurrences,
          projected: p.projectedTotalMin > 0 ? p.projectedTotalMin.toFixed(1) + ' min' : '—',
          flag: p.flag, note: p.note || '',
        })), ['Step', 'Avg/row (ms)', 'Max/row (ms)', 'Count', 'Projected', 'Note'],
          ['stepName', 'avgMs', 'maxMs', 'occurrences', 'projected', 'note']);
    }

    if (a.submissionStageStats && a.submissionStageStats.length > 0) {
        html += sectionLabel('Submission — Stage Stats (1× per job)');
        html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px">`;
        html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
          <thead style="position:sticky;top:0;z-index:1;background:#1e293b">
            <tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:500">Step</th>
              <th style="text-align:right;padding:8px 12px;color:var(--muted);font-weight:500">Duration (ms)</th>
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

    if (a.submissionBundleStats && a.submissionBundleStats.length > 0) {
        html += sectionLabel('Submission — Bundle Stats (1× per 5000-row chunk)');
        html += sortableTable('sub-bundle' + suffix, a.submissionBundleStats.map(b => ({
          bundle: b.bundleIdx,
          rows: b.startRow != null && b.endRow != null ? `${b.startRow}–${b.endRow}` : '—',
          bundleDbFetchSec: b.bundleDbFetchMs != null ? +(b.bundleDbFetchMs / 1000).toFixed(2) : 0,
          attrCount: b.attributeCount ?? '—',
          accounts: b.accountIds ?? '—',
          linked: b.linkedAccountIds ?? '—',
          flag: (b.bundleDbFetchMs ?? 0) > 5000 ? 'critical' : (b.bundleDbFetchMs ?? 0) > 2000 ? 'slow' : 'ok',
        })), ['Bundle', 'Row Range', 'Bundle DB Fetch (s)', 'Attr Count', 'Accounts', 'Linked Accts'],
          ['bundle', 'rows', 'bundleDbFetchSec', 'attrCount', 'accounts', 'linked']);
    }

    if (a.submissionBatchStats && a.submissionBatchStats.length > 0) {
        html += sectionLabel('Submission — Batch Stats (1× per 500-row batch, grouped by bundle)');

        const batchesByBundle = new Map();
        for (const b of a.submissionBatchStats) {
            if (!batchesByBundle.has(b.bundleIdx)) batchesByBundle.set(b.bundleIdx, []);
            batchesByBundle.get(b.bundleIdx).push(b);
        }

        for (const [bundleIdx, batches] of [...batchesByBundle.entries()].sort((a, b) => a[0] - b[0])) {
            const totalBulkMs = batches.reduce((s, b) => s + (b.bulkProcessingMs ?? 0), 0);
            const totalLoopMs = batches.reduce((s, b) => s + (b.loopProcessingMs ?? 0), 0);
            const slowCount = batches.filter(b => (b.bulkProcessingMs ?? 0) > 5000).length;
            const totalLoopSec = (totalLoopMs / 1000).toFixed(2) + 's';
            const totalBulkSec = (totalBulkMs / 1000).toFixed(2) + 's';

            html += `<details style="margin-bottom:10px">
              <summary style="cursor:pointer;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;list-style:none;display:flex;justify-content:space-between;align-items:center;font-size:0.82rem">
                <span style="font-weight:500">Bundle starting at row <span style="font-family:monospace;color:var(--accent)">${(bundleIdx * 5000).toLocaleString()}</span></span>
                <div style="display:flex;gap:14px;align-items:center">
                  ${slowCount > 0 ? `<span style="font-size:0.7rem;background:var(--yellow);color:#000;padding:1px 7px;border-radius:4px;font-weight:600">${slowCount} slow</span>` : ''}
                  <span style="font-size:0.75rem;color:var(--muted)">${batches.length} batches</span>
                  <span style="font-size:0.75rem;color:var(--muted)">Loop total: <span style="font-family:monospace">${totalLoopSec}</span></span>
                  <span style="font-size:0.75rem;color:var(--muted)">Bulk total: <span style="font-family:monospace;color:var(--accent)">${totalBulkSec}</span></span>
                </div>
              </summary>
              <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">`;

            const tblId = `sub-batch-${bundleIdx}${suffix}`;
            html += sortableTable(tblId, batches.map(b => ({
              batchStart: b.batchIdx,
              endRow: b.endRow ?? '—',
              loopSec: b.loopProcessingMs != null ? +(b.loopProcessingMs / 1000).toFixed(2) : 0,
              bulkSec: b.bulkProcessingMs != null ? +(b.bulkProcessingMs / 1000).toFixed(2) : 0,
              start: b.startTime ? fmtTimestampShort(b.startTime) : '—',
              flag: (b.bulkProcessingMs ?? 0) > 5000 ? 'critical' : (b.bulkProcessingMs ?? 0) > 2000 ? 'slow' : 'ok',
            })), ['Batch Start Row', 'End Row', 'Loop Processing (s)', 'Bulk Processing (s)', 'Start (UTC)'],
              ['batchStart', 'endRow', 'loopSec', 'bulkSec', 'start']);

            html += `</div></details>`;
        }
    }

    if (a.submissionRowInsights && a.submissionRowInsights.length > 0) {
        html += sectionLabel('Submission — Per-Row Step Analysis (fires on every row)');
        html += sortableTable('sub-perrow' + suffix, a.submissionRowInsights.map(s => ({
          stepName: s.stepName, avgMs: s.avgMs, maxMs: s.maxMs, occurrences: s.occurrences,
          projected: s.projectedTotalMin > 0 ? s.projectedTotalMin.toFixed(1) + ' min' : '—',
          flag: s.flag, note: s.note || '',
        })), ['Step', 'Avg/row (ms)', 'Max/row (ms)', 'Count', 'Projected', 'Note'],
          ['stepName', 'avgMs', 'maxMs', 'occurrences', 'projected', 'note']);
    }

    if (a.slowCheckpoints && a.slowCheckpoints.length > 0) {
        html += slowCheckpointsSection(a.slowCheckpoints);
    }

    return html;
}

function sectionLabel(text) {
    return `<div style="font-size:0.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;margin-top:24px">${esc(text)}</div>`;
}

function slowCheckpointsSection(checkpoints) {
    if (!checkpoints || checkpoints.length === 0) return '';

    const byStep = new Map();
    for (const c of checkpoints) {
        if (!byStep.has(c.step)) byStep.set(c.step, []);
        byStep.get(c.step).push(c);
    }

    let html = `<div style="background:#1a0f00;border:2px solid var(--yellow);border-radius:12px;padding:16px;margin-bottom:16px;margin-top:24px">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--yellow);text-transform:uppercase">⚠️ Slow Checkpoints (&gt;5ms on synchronous ops)</div>
      <span style="font-size:0.75rem;color:var(--muted)">${checkpoints.length} occurrences across ${byStep.size} step type(s)</span>
    </div>`;

    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">`;
    for (const [step, items] of [...byStep.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const maxMs = Math.max(...items.map(i => i.ms));
        const avgMs = items.reduce((s, i) => s + i.ms, 0) / items.length;
        html += `<div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:6px;padding:6px 12px;font-size:0.75rem">
          <div style="color:var(--yellow);font-weight:500">${esc(step)}</div>
          <div style="color:var(--muted);margin-top:2px">${items.length}× • avg ${avgMs.toFixed(1)}ms • max ${maxMs.toFixed(1)}ms</div>
        </div>`;
    }
    html += `</div>`;

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

function sortableTable(id, rows, headers, keys) {
    window._tableData[id] = { rows, headers, keys, sortKey: null, sortDir: 1, filter: '' };
    return `<div class="stbl-wrap" data-id="${id}" style="margin-bottom:16px; margin-top:8px">
      <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
        <input type="text" placeholder="Search..." oninput="filterTable('${id}',this.value)"
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

    let visible = filter
      ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(filter.toLowerCase())))
      : rows;

    if (sortKey) {
        visible = [...visible].sort((a, b) => {
          const av = a[sortKey], bv = b[sortKey];
          const an = parseFloat(av), bn = parseFloat(bv);
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
          return String(av).localeCompare(String(bv)) * sortDir;
        });
    }

    const countEl = document.getElementById(`stbl-count-${id}`);
    if (countEl) countEl.textContent = `${visible.length} / ${rows.length} rows`;

    const head = document.getElementById(`stbl-head-${id}`);
    if (head) {
        head.innerHTML = `<tr style="border-bottom:2px solid var(--border)">` +
          headers.map((h, i) => {
            const k = keys[i];
            const active = sortKey === k;
            const arrow = active ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
            return `<th onclick="sortTable('${id}','${k}')" style="text-align:${i === 0 ? 'left' : 'right'};padding:8px 12px;color:${active ? 'var(--accent)' : 'var(--muted)'};font-weight:500;cursor:pointer;white-space:nowrap;user-select:none">${esc(h)}${arrow}</th>`;
          }).join('') + `</tr>`;
    }

    const body = document.getElementById(`stbl-body-${id}`);
    if (!body) return;
    const fc = r => r.flag === 'critical' ? 'var(--red)' : r.flag === 'slow' ? 'var(--yellow)' : 'var(--text)';
    body.innerHTML = visible.map(r =>
      `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">` +
      keys.map((k, i) => {
        const val = r[k];
        const isNum = typeof val === 'number';
        const display = isNum
          ? (k.endsWith('Sec') ? val.toFixed(2) + 's' : (k === 'avgMs' || k === 'maxMs' || k.endsWith('Ms') ? val.toFixed(2) + 'ms' : val))
          : (val ?? '—');
        const color = i === 0 ? fc(r) : (k === 'avgMs' || k === 'maxMs' || k.endsWith('Ms') || k.endsWith('Sec') ? fc(r) : 'var(--text)');
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
    for (const id of Object.keys(window._tableData)) {
      renderTableData(id);
    }
}

function fmtTimestamp(iso) {
    try {
      const d = new Date(iso);
      return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') + ' UTC';
    } catch { return iso; }
}

function renderComparison(data) {
    let html = '';
    const c = data.comparison;

    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">`;
    html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <h2 style="font-size:1.1rem; color:var(--accent); margin:0">Comparison: ${esc(c.idA)} vs ${esc(c.idB)}</h2>
        <a href="/reports/comparison/${esc(c.idA)}/vs/${esc(c.idB)}" target="_blank" class="btn" style="text-decoration:none">View Comparison HTML Report</a>
    </div>`;
    html += `<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px">`;
    html += `<div><div style="font-size:0.7rem;color:var(--muted)">Import A (Primary)</div><div style="font-family:monospace;font-size:0.8rem">${esc(c.idA)}</div>${c.rowCountA ? `<div style="font-size:0.75rem;color:var(--muted)">${c.rowCountA.toLocaleString()} rows</div>` : ''}</div>`;
    html += `<div style="color:var(--muted);align-self:center;font-size:1.2rem">vs</div>`;
    html += `<div><div style="font-size:0.7rem;color:var(--muted)">Import B (Secondary)</div><div style="font-family:monospace;font-size:0.8rem">${esc(c.idB)}</div>${c.rowCountB ? `<div style="font-size:0.75rem;color:var(--muted)">${c.rowCountB.toLocaleString()} rows</div>` : ''}</div>`;
    html += `</div></div>`;

    if (c.insights && c.insights.length > 0) {
        html += `<div style="background:#1a1a2e;border:1px solid var(--accent);border-radius:12px;padding:16px;margin-bottom:16px">`;
        html += `<div style="font-size:0.8rem;font-weight:600;color:var(--accent);margin-bottom:10px;text-transform:uppercase">Comparison Insights</div>`;
        for (const ins of c.insights) {
            html += `<div style="font-size:0.85rem;line-height:1.5;margin-bottom:6px;color:var(--yellow)">${esc(ins)}</div>`;
        }
        html += `</div>`;
    }

    if (c.stepDiff && c.stepDiff.length > 0) {
        html += sectionTitle('Step-by-Step Comparison');
        html += `<div style="overflow-x:auto;margin-bottom:24px;background:var(--surface);border:1px solid var(--border);border-radius:8px">`;
        html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
          <thead>
            <tr style="border-bottom:2px solid var(--border);background:rgba(255,255,255,0.02);color:var(--muted)">
              <th style="text-align:left;padding:10px 14px">Step</th>
              <th style="text-align:right;padding:10px 14px">Primary (Import A)</th>
              <th style="text-align:right;padding:10px 14px">Secondary (Import B)</th>
              <th style="text-align:right;padding:10px 14px">Delta</th>
              <th style="text-align:right;padding:10px 14px">Change</th>
            </tr>
          </thead>
          <tbody>`;
        for (const s of c.stepDiff) {
            const flagColor = s.flag === 'slower' ? 'var(--red)' : s.flag === 'faster' ? 'var(--green)' : 'var(--muted)';
            const deltaSign = s.deltaMs > 0 ? '+' : '';
            html += `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 14px">${esc(s.stepName)}</td>
              <td style="padding:10px 14px;text-align:right;font-family:monospace">${fmtMs(s.msA)}</td>
              <td style="padding:10px 14px;text-align:right;font-family:monospace">${fmtMs(s.msB)}</td>
              <td style="padding:10px 14px;text-align:right;color:${flagColor};font-weight:600;font-family:monospace">${deltaSign}${fmtMs(s.deltaMs)}</td>
              <td style="padding:10px 14px;text-align:right;color:${flagColor};font-family:monospace">${deltaSign}${s.deltaPercent}%</td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    let valBundleHtml = '';
    if (c.validationBundleDiff && c.validationBundleDiff.length > 0) {
        valBundleHtml = `
            <div style="margin-top:24px">
                ${sectionTitle('Validation Bundle Deep-Dive (Primary vs Secondary)')}
                <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden">
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                        <tr style="background:rgba(255,255,255,0.03); color:var(--muted); border-bottom:2px solid var(--border)">
                            <th style="padding:10px 14px; text-align:left">Bundle</th>
                            <th style="padding:10px 14px; text-align:right">Primary</th>
                            <th style="padding:10px 14px; text-align:right">Secondary</th>
                            <th style="padding:10px 14px; text-align:right">Delta</th>
                        </tr>
                        ${c.validationBundleDiff.map(b => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${b.index}</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:var(--muted)">${fmtMs(b.msA)}</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace">${fmtMs(b.msB)}</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:${b.deltaMs > 0 ? 'var(--red)' : b.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${b.deltaMs > 0 ? '+' : ''}${fmtMs(b.deltaMs)}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            </div>
        `;
    }

    let subBatchHtml = '';
    if (c.submissionBatchDiff && c.submissionBatchDiff.length > 0) {
        subBatchHtml = `
            <div style="margin-top:24px">
                ${sectionTitle('Submission Batch Deep-Dive (Primary vs Secondary)')}
                <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden">
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                        <tr style="background:rgba(255,255,255,0.03); color:var(--muted); border-bottom:2px solid var(--border)">
                            <th style="padding:10px 14px; text-align:left">Bundle / Batch</th>
                            <th style="padding:10px 14px; text-align:left">Row Range</th>
                            <th style="padding:10px 14px; text-align:right">Primary (Total / Bulk)</th>
                            <th style="padding:10px 14px; text-align:right">Secondary (Total / Bulk)</th>
                            <th style="padding:10px 14px; text-align:right">Delta (Total)</th>
                        </tr>
                        ${c.submissionBatchDiff.map(b => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">Bundle ${b.bundleIdx} Batch ${b.batchIdx}</td>
                                <td style="padding:10px 14px; color:var(--muted)">Rows ${(b.startRow || 0).toLocaleString()} – ${(b.endRow || 0).toLocaleString()}</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:var(--muted)">${fmtMs(b.msA)} (${fmtMs(b.bulkMsA)})</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace">${fmtMs(b.msB)} (${fmtMs(b.bulkMsB)})</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:${b.deltaMs > 0 ? 'var(--red)' : b.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${b.deltaMs > 0 ? '+' : ''}${fmtMs(b.deltaMs)}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            </div>
        `;
    }

    let rowInsightHtml = '';
    if (c.rowInsightDiff && c.rowInsightDiff.length > 0) {
        rowInsightHtml = `
            <div style="margin-top:24px">
                ${sectionTitle('Row-Level Rules Deep-Dive (Avg Duration)')}
                <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden">
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                        <tr style="background:rgba(255,255,255,0.03); color:var(--muted); border-bottom:2px solid var(--border)">
                            <th style="padding:10px 14px; text-align:left">Rule / Step Name</th>
                            <th style="padding:10px 14px; text-align:right">Primary</th>
                            <th style="padding:10px 14px; text-align:right">Secondary</th>
                            <th style="padding:10px 14px; text-align:right">Delta</th>
                        </tr>
                        ${c.rowInsightDiff.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).map(r => `
                            <tr style="border-bottom:1px solid var(--border)">
                                <td style="padding:10px 14px">${esc(r.stepName)}</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:var(--muted)">${r.avgMsA.toFixed(2)}ms</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace">${r.avgMsB.toFixed(2)}ms</td>
                                <td style="padding:10px 14px; text-align:right; font-family:monospace; color:${r.deltaMs > 0 ? 'var(--red)' : r.deltaMs < 0 ? 'var(--green)' : 'var(--text)'}">${r.deltaMs > 0 ? '+' : ''}${r.deltaMs.toFixed(2)}ms</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            </div>
        `;
    }

    html += valBundleHtml;
    html += subBatchHtml;
    html += rowInsightHtml;

    html += `<div style="margin-top:32px; border-top: 2px solid var(--border); padding-top:24px">
        ${sectionTitle('Side-by-Side Detailed Breakdown')}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:16px">
            <div style="overflow-x:auto">
                <div style="font-size:0.9rem; font-weight:700; color:var(--accent); margin-bottom:16px; text-transform:uppercase; border-bottom:1px solid var(--border); padding-bottom:8px">Primary Import (Import A)</div>
                ${renderSingleImport(data.primary, '-primary')}
            </div>
            <div style="overflow-x:auto">
                <div style="font-size:0.9rem; font-weight:700; color:var(--accent); margin-bottom:16px; text-transform:uppercase; border-bottom:1px solid var(--border); padding-bottom:8px">Secondary Import (Import B)</div>
                ${renderSingleImport(data.secondary, '-secondary')}
            </div>
        </div>
    </div>`;

    return html;
}

function metaRow(label, value, mono = false) {
    return `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;font-size:0.75rem">
      <span style="color:var(--muted);white-space:nowrap">${esc(label)}</span>
      <span style="${mono ? 'font-family:monospace;' : ''}color:var(--text);text-align:right;word-break:break-all">${esc(value)}</span>
    </div>`;
}

function generateSvgChartsHtml(analysis) {
  const formatDuration = (ms) => {
    if (ms == null || isNaN(ms)) return "—";
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return (ms / 60000).toFixed(1) + "min";
  };

  const stepMs = (name) => {
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
    <div class="charts-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 24px; margin-top: 16px;">
      <div class="chart-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
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

      <div class="chart-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Validation Per-Row Rules</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Cumulative time spent running specific validation code functions across all rows (Average row-duration &times; count). Pinpoints business rule code bottlenecks.">i</span>
        </div>
        ${valInsightsHtml}
      </div>

      <div class="chart-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Submission Per-Row Steps</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Cumulative time spent running specific submission code steps inside the processing loop across all rows. Highlights row-by-row CPU loop bottlenecks.">i</span>
        </div>
        ${subInsightsHtml}
      </div>

      <div class="chart-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Validation Database & I/O</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Total cumulative duration spent in Validation infrastructure and database layers (Initial configuration DB fetch, BLOB downloads, and Batch Bulk Inserts).">i</span>
        </div>
        ${valBlocksHtml}
      </div>

      <div class="chart-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span>Submission Database & I/O</span>
          <span style="cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: var(--muted); font-family: monospace; font-weight: bold;" title="Total cumulative duration spent in Submission infrastructure and database layers (Chunk DB fetches, Row-by-Row loop overhead, and Batch Bulk Database inserts).">i</span>
        </div>
        ${subBlocksHtml}
      </div>
    </div>
  `;
}

