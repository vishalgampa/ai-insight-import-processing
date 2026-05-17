/**
 * Orchestrates the full import log analysis pipeline.
 * Accepts natural language questions and returns structured analysis.
 */

import { ImportLogFetcher, QueryFn, StepLogs } from './importLogFetcher';
import { parseImportLogs, ParsedImportLogs } from './importLogParser';
import { analyzeImport, compareImports, ImportAnalysis, ComparisonResult } from './timingAnalyzer';

// UUID pattern
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface ImportQueryResult {
  type: 'single' | 'comparison';
  primary: ImportAnalysis;
  secondary?: ImportAnalysis;
  comparison?: ComparisonResult;
  diagnostics?: import('./importLogFetcher').FetchDiagnostics;
}

export class ImportOrchestrator {
  private fetcher: ImportLogFetcher;
  private cache = new Map<string, { logs: StepLogs; parsed: ParsedImportLogs }>();

  constructor(queryFn: QueryFn) {
    this.fetcher = new ImportLogFetcher(queryFn);
  }

  /**
   * Parse a natural language question, extract IDs, run analysis.
   * Handles single import queries and comparisons.
   */
  async answer(question: string): Promise<ImportQueryResult> {
    const ids = this.extractIds(question);
    if (ids.length === 0) throw new Error('No clientFileUploadId found in question. Please include the UUID.');

    const primary = await this.analyzeOne(ids[0]);

    if (ids.length >= 2) {
      const secondary = await this.analyzeOne(ids[1]);
      const comparison = compareImports(ids[0], primary.parsed, ids[1], secondary.parsed);
      return {
        type: 'comparison',
        primary: analyzeImport(ids[0], primary.parsed),
        secondary: analyzeImport(ids[1], secondary.parsed),
        comparison,
        diagnostics: primary.logs.diagnostics,
      };
    }

    return {
      type: 'single',
      primary: analyzeImport(ids[0], primary.parsed),
      diagnostics: primary.logs.diagnostics,
    };
  }

  private async analyzeOne(id: string) {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const logs = await this.fetcher.fetchAll(id);
    const parsed = parseImportLogs(
      logs.mappingRows,
      logs.validationRows,
      logs.validationAggRows,
      logs.validationPerRowRaw,
      logs.validationGlobalFetches,
      logs.submissionRows,
      logs.submissionRawAll,
      logs.submissionAggRows,
      logs.submissionCountRows,
      logs.errorRows,
      logs.anchor.rowCount,
      logs.mappingMeta,
      logs.validationMeta,
      logs.submissionMeta,
      logs.k8sTriggerMeta,
    );
    const entry = { logs, parsed };
    this.cache.set(id, entry);
    return entry;
  }

  private extractIds(text: string): string[] {
    return [...text.matchAll(UUID_RE)].map(m => m[0].toLowerCase());
  }
}
