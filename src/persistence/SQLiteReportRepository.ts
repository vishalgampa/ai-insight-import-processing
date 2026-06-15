import Database from 'better-sqlite3';
import { IReportRepository, ReportMetadata, BucketAverages } from './IReportRepository';
import path from 'path';

export class SQLiteReportRepository implements IReportRepository {
  private db: Database.Database;

  constructor(dbPath: string = 'reports.db') {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientFileUploadId TEXT UNIQUE,
        rowCount INTEGER,
        sizeBucket INTEGER,
        timestamp TEXT,
        analysisJson TEXT,
        comparisonId TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bucket_ts ON reports (sizeBucket, timestamp);
    `);

    // Migration: Add comparisonId if missing (for existing databases)
    try {
        const info = this.db.pragma('table_info(reports)') as any[];
        if (!info.some(c => c.name === 'comparisonId')) {
            this.db.exec('ALTER TABLE reports ADD COLUMN comparisonId TEXT');
            console.log('[SQLite] Migration: Added comparisonId column to reports table.');
        }
    } catch (e) {
        console.warn('[SQLite] Migration failed (non-critical):', e);
    }
  }

  async saveReport(metadata: ReportMetadata): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO reports (clientFileUploadId, rowCount, sizeBucket, timestamp, analysisJson, comparisonId)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      metadata.clientFileUploadId,
      metadata.rowCount,
      metadata.sizeBucket,
      metadata.timestamp,
      metadata.analysisJson,
      metadata.comparisonId || null
    );
  }

  async getReportByUploadId(uploadId: string): Promise<ReportMetadata | null> {
    const stmt = this.db.prepare('SELECT * FROM reports WHERE clientFileUploadId = ?');
    const row = stmt.get(uploadId) as ReportMetadata | undefined;
    return row || null;
  }

  async isReportProcessed(uploadId: string): Promise<boolean> {
    const stmt = this.db.prepare('SELECT 1 FROM reports WHERE clientFileUploadId = ? LIMIT 1');
    return !!stmt.get(uploadId);
  }

  async getLatestReportsByBucket(bucket: number, limit: number): Promise<ReportMetadata[]> {
    const stmt = this.db.prepare('SELECT * FROM reports WHERE sizeBucket = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(bucket, limit) as ReportMetadata[];
  }

  async getAllHistory(limit: number): Promise<ReportMetadata[]> {
    const stmt = this.db.prepare('SELECT * FROM reports ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit) as ReportMetadata[];
  }

  async getReportsByBucket(bucket: number, daysLookback: number): Promise<ReportMetadata[]> {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - daysLookback);
    const dateStr = dateLimit.toISOString();

    const stmt = this.db.prepare(`
      SELECT * FROM reports 
      WHERE sizeBucket = ? AND timestamp >= ?
      ORDER BY timestamp DESC
    `);
    return stmt.all(bucket, dateStr) as ReportMetadata[];
  }

  async getBucketAverages(bucket: number, daysLookback: number): Promise<BucketAverages | null> {
    const rows = await this.getReportsByBucket(bucket, daysLookback);

    if (rows.length === 0) return null;

    let totalMs = 0;
    const stepTotals: Record<string, number> = {};
    const stepCounts: Record<string, number> = {};
    const sourceReports: { id: string, rowCount: number | null, timestamp: string }[] = [];

    // Deep-dive accumulators
    const valBundleTotals: Record<number, number> = {}, valBundleCounts: Record<number, number> = {};
    const subBatchTotals: Record<number, { total: number, bulk: number }> = {}, subBatchCounts: Record<number, number> = {};
    const rowInsightTotals: Record<string, number> = {}, rowInsightCounts: Record<string, number> = {};

    for (const row of rows) {
      const analysis = JSON.parse(row.analysisJson);
      totalMs += analysis.totalEstimatedMs || 0;
      sourceReports.push({ 
        id: row.clientFileUploadId, 
        rowCount: row.rowCount, 
        timestamp: row.timestamp 
      });
      
      if (analysis.stepContributions) {
        for (const step of analysis.stepContributions) {
          stepTotals[step.stepName] = (stepTotals[step.stepName] || 0) + step.durationMs;
          stepCounts[step.stepName] = (stepCounts[step.stepName] || 0) + 1;
        }
      }

      // Average Validation Bundles
      if (analysis.validationBundleStats) {
        analysis.validationBundleStats.forEach((b: any) => {
            valBundleTotals[b.bundleIdx] = (valBundleTotals[b.bundleIdx] || 0) + (b.totalMs ?? 0);
            valBundleCounts[b.bundleIdx] = (valBundleCounts[b.bundleIdx] || 0) + 1;
        });
      }

      // Average Submission Batches
      if (analysis.submissionBatchStats) {
        analysis.submissionBatchStats.forEach((b: any) => {
            if (!subBatchTotals[b.batchIdx]) subBatchTotals[b.batchIdx] = { total: 0, bulk: 0 };
            subBatchTotals[b.batchIdx].total += (b.totalProcessingMs ?? 0);
            subBatchTotals[b.batchIdx].bulk += (b.bulkProcessingMs ?? 0);
            subBatchCounts[b.batchIdx] = (subBatchCounts[b.batchIdx] || 0) + 1;
        });
      }

      // Average Row Insights (specific rules)
      if (analysis.validationRowInsights) {
        analysis.validationRowInsights.forEach((r: any) => {
            rowInsightTotals[r.stepName] = (rowInsightTotals[r.stepName] || 0) + r.avgMs;
            rowInsightCounts[r.stepName] = (rowInsightCounts[r.stepName] || 0) + 1;
        });
      }
    }

    const stepAverages: Record<string, number> = {};
    for (const name in stepTotals) stepAverages[name] = stepTotals[name] / stepCounts[name];

    const validationBundleAverages: Record<number, number> = {};
    for (const idx in valBundleTotals) validationBundleAverages[idx] = valBundleTotals[idx] / valBundleCounts[idx];

    const submissionBatchAverages: Record<number, { total: number, bulk: number }> = {};
    for (const idx in subBatchTotals) {
        submissionBatchAverages[idx] = { 
            total: subBatchTotals[idx].total / subBatchCounts[idx],
            bulk: subBatchTotals[idx].bulk / subBatchCounts[idx]
        };
    }

    const rowInsightAverages: Record<string, number> = {};
    for (const name in rowInsightTotals) rowInsightAverages[name] = rowInsightTotals[name] / rowInsightCounts[name];

    return {
      sizeBucket: bucket,
      avgTotalMs: totalMs / rows.length,
      count: rows.length,
      stepAverages,
      validationBundleAverages,
      submissionBatchAverages,
      rowInsightAverages,
      sourceReports
    };
  }
}
