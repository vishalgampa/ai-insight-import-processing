import { ImportAnalysis } from '../imports/timingAnalyzer';

export interface ReportMetadata {
  id?: number;
  clientFileUploadId: string;
  rowCount: number | null;
  sizeBucket: number;
  timestamp: string;
  analysisJson: string;
  comparisonId?: string; // Link to a generated comparison file
}

export interface BucketAverages {
  sizeBucket: number;
  avgTotalMs: number;
  count: number;
  stepAverages: Record<string, number>;
  // Deep-dive averages (for mirror-matching Single Run view)
  validationBundleAverages: Record<number, number>; // index -> avgMs
  submissionBatchAverages: Record<number, { total: number, bulk: number }>; // index -> { avgTotal, avgBulk }
  rowInsightAverages: Record<string, number>; // stepName -> avgMs
  sourceReports: { id: string, rowCount: number | null, timestamp: string }[];
}

export interface IReportRepository {
  saveReport(metadata: ReportMetadata): Promise<void>;
  getReportByUploadId(uploadId: string): Promise<ReportMetadata | null>;
  getLatestReportsByBucket(bucket: number, limit: number): Promise<ReportMetadata[]>;
  getReportsByBucket(bucket: number, daysLookback: number): Promise<ReportMetadata[]>;
  getBucketAverages(bucket: number, daysLookback: number): Promise<BucketAverages | null>;
  isReportProcessed(uploadId: string): Promise<boolean>;
  getAllHistory(limit: number): Promise<ReportMetadata[]>;
}
