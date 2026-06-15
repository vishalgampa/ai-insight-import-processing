import { ImportLogFetcher, QueryFn } from '../imports/importLogFetcher';
import { ImportOrchestrator } from '../imports/importOrchestrator';
import { analyzeImport, compareAgainstBaseline, ImportAnalysis } from '../imports/timingAnalyzer';
import { IReportRepository } from '../persistence/IReportRepository';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

import { renderImportToHtml } from '../report/importReportRenderer';

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
    const htmlContent = renderImportToHtml(analysis);
    fs.writeFileSync(htmlPath, htmlContent);
  }

  private saveComparisonReport(id: string, comparison: any) {
    const reportsDir = path.join(process.cwd(), 'reports');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pathJson = path.join(reportsDir, `comparison_${id}_${timestamp}.json`);
    fs.writeFileSync(pathJson, JSON.stringify(comparison, null, 2));
  }

  start() {
    // Schedule to run at 2 AM daily
    cron.schedule('0 2 * * *', () => {
      this.runDailyAnalysis();
    });
    console.log('[ImportMonitor] Scheduler started: Daily analysis at 02:00 AM');
  }
}
