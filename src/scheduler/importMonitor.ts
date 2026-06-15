import { ImportLogFetcher, QueryFn } from '../imports/importLogFetcher';
import { ImportOrchestrator } from '../imports/importOrchestrator';
import { analyzeImport, compareAgainstBaseline, ImportAnalysis } from '../imports/timingAnalyzer';
import { IReportRepository } from '../persistence/IReportRepository';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

export class ImportMonitor {
  constructor(
    private orchestrator: ImportOrchestrator,
    private repository: IReportRepository,
    private queryFn: QueryFn
  ) {}

  async runDailyAnalysis() {
    console.log('[ImportMonitor] Starting daily analysis of generic updates...');
    
    // 1. Fetch all clientFileUploadIds for "generic update" in last 24h
    const kql = `
      traces
      | where timestamp > ago(24h)
      | where message contains 'ValidateGenericUpdateContent' and message contains 'started'
      | project message
    `;
    const rows = await this.queryFn(kql);
    
    // Extract UUIDs
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const ids = new Set<string>();
    for (const row of rows) {
      const matches = row.message.match(uuidRegex);
      if (matches) matches.forEach(id => ids.add(id.toLowerCase()));
    }

    console.log(`[ImportMonitor] Found ${ids.size} unique import IDs to check.`);

    for (const id of ids) {
      try {
        if (await this.repository.isReportProcessed(id)) {
          console.log(`[ImportMonitor] Skipping ${id}, already processed.`);
          continue;
        }

        console.log(`[ImportMonitor] Analyzing ${id}...`);
        const result = await this.orchestrator.answer(id);
        const analysis = result.primary;
        
        // Save reports (JSON + HTML)
        await this.saveReportDual(analysis);
        
        const bucket = Math.floor((analysis.rowCount ?? 0) / 5000) * 5000;

        // 2. Comparison against baseline
        const baseline = await this.repository.getBucketAverages(bucket, 30); // 30 day baseline
        let comparisonId = undefined;
        if (baseline) {
          const comparison = compareAgainstBaseline(analysis, baseline);
          comparisonId = `comparison_${id}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          this.saveComparisonReport(id, comparison);
        }

        // Save to Database (with potential comparisonId)
        await this.repository.saveReport({
          clientFileUploadId: id,
          rowCount: analysis.rowCount,
          sizeBucket: bucket,
          timestamp: new Date().toISOString(),
          analysisJson: JSON.stringify(analysis),
          comparisonId
        });

      } catch (err: any) {
        console.error(`[ImportMonitor] Error analyzing ${id}:`, err.message);
      }
    }
    console.log('[ImportMonitor] Daily analysis complete.');
  }

  private async saveReportDual(analysis: ImportAnalysis) {
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const id = analysis.clientFileUploadId;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // JSON
    const jsonPath = path.join(reportsDir, `import_${id}_${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));

    // HTML (Basic wrapper)
    const htmlPath = path.join(reportsDir, `import_${id}_${timestamp}.html`);
    const htmlContent = this.renderToHtml(analysis);
    fs.writeFileSync(htmlPath, htmlContent);
  }

  private saveComparisonReport(id: string, comparison: any) {
    const reportsDir = path.join(process.cwd(), 'reports');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pathJson = path.join(reportsDir, `comparison_${id}_${timestamp}.json`);
    fs.writeFileSync(pathJson, JSON.stringify(comparison, null, 2));
  }

  private renderToHtml(analysis: ImportAnalysis): string {
    // Simple HTML template for now
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Import Report - ${analysis.clientFileUploadId}</title>
    <style>
        body { font-family: sans-serif; line-height: 1.5; color: #333; max-width: 900px; margin: 40px auto; padding: 20px; }
        h1 { color: #0056b3; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #0056b3; }
        .stat-value { font-size: 1.2rem; font-weight: bold; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
        th { background: #f2f2f2; }
        .flag-slow { color: #856404; background: #fff3cd; padding: 2px 6px; border-radius: 4px; }
        .flag-critical { color: #721c24; background: #f8d7da; padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Import Analysis Report</h1>
    <div class="stat-grid">
        <div class="stat-card">
            <div>Client File Upload ID</div>
            <div class="stat-value">${analysis.clientFileUploadId}</div>
        </div>
        <div class="stat-card">
            <div>Row Count</div>
            <div class="stat-value">${analysis.rowCount?.toLocaleString() ?? 'Unknown'}</div>
        </div>
        <div class="stat-card">
            <div>Total Estimated Duration</div>
            <div class="stat-value">${(analysis.totalEstimatedMs / 1000).toFixed(1)}s</div>
        </div>
    </div>

    <h2>High-Level Step Breakdown</h2>
    <table>
        <thead>
            <tr>
                <th>Step Name</th>
                <th>Duration (s)</th>
                <th>% of Total</th>
                <th>Note</th>
            </tr>
        </thead>
        <tbody>
            ${analysis.stepContributions.map(s => `
                <tr>
                    <td>${s.stepName}</td>
                    <td>${(s.durationMs / 1000).toFixed(2)}s</td>
                    <td>${s.percentOfTotal}%</td>
                    <td><span class="flag-${s.flag}">${s.note ?? ''}</span></td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <h2>Insights</h2>
    <ul>
        ${analysis.insights.map(i => `<li>${i}</li>`).join('')}
    </ul>
</body>
</html>
    `;
  }

  start() {
    // Schedule to run at 2 AM daily
    cron.schedule('0 2 * * *', () => {
      this.runDailyAnalysis();
    });
    console.log('[ImportMonitor] Scheduler started: Daily analysis at 02:00 AM');
  }
}
