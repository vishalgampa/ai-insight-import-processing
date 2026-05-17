# Implementation Plan: AI-Powered Root Cause Analysis Assistant

## Overview

Implement the AI-powered RCA Assistant as a TypeScript application with modular components for Azure integration, telemetry processing, pattern detection, correlation analysis, root cause identification, symptom classification, AI reasoning, report generation, and a natural language query interface. Each component is built incrementally, wired together through the Analysis Orchestrator, and validated with property-based and unit tests using `fast-check` and Jest.

## Tasks

- [x] 1. Set up project structure, core types, and testing framework
  - [x] 1.1 Initialize TypeScript project with Jest and fast-check
    - Create `package.json`, `tsconfig.json`, and Jest configuration
    - Install dependencies: `typescript`, `jest`, `ts-jest`, `fast-check`, `@azure/identity`, `@azure/monitor-query`
    - Create directory structure: `src/`, `src/types/`, `src/azure/`, `src/telemetry/`, `src/analysis/`, `src/correlation/`, `src/rootcause/`, `src/symptoms/`, `src/ai/`, `src/report/`, `src/query/`, `src/errors/`, `tests/`
    - _Requirements: All_

  - [x] 1.2 Define core data model interfaces and types
    - Create `src/types/telemetry.ts` with `TelemetryEvent`, `Exception`, `RequestMetric`, `DependencyMetric`, `DeploymentEvent`
    - Create `src/types/analysis.ts` with `Anomaly`, `CorrelatedEventGroup`, `CausalGraph`, `CausalEdge`, `RootCause`, `Symptom`, `Recommendation`
    - Create `src/types/report.ts` with `IncidentReport`, `Timeline`, `TimelineEvent`, `Evidence`
    - Create `src/types/common.ts` with `TimeRange`, `Baseline`, `AzureCredentials`, `AuthToken`, `QueryFilters`
    - Create `src/types/errors.ts` with `ErrorResponse`, `AuthenticationError`, `NetworkError`, `QueryValidationError`, `PermissionError`
    - _Requirements: 1.1, 1.3, 7.1, 9.3, 9.5_

  - [x] 1.3 Create shared error classes and logging utility
    - Implement custom error classes in `src/errors/` extending `Error`: `AuthenticationError`, `NetworkError`, `QueryValidationError`, `PermissionError`, `AnalysisTimeoutError`
    - Implement `src/errors/logger.ts` with structured logging (error, warning, info, debug levels) including timestamp, error type, message, and stack trace
    - _Requirements: 9.2, 9.5_

- [x] 2. Implement Azure Integration Layer
  - [x] 2.1 Implement Azure authenticator and rate limit handler
    - Create `src/azure/authenticator.ts` implementing credential validation and token management
    - Create `src/azure/rateLimitHandler.ts` implementing exponential backoff retry logic (1s, 2s, 4s, max 3 retries)
    - Return `AuthenticationError` with descriptive message on invalid credentials
    - _Requirements: 1.1, 1.3, 1.5, 9.2_

  - [ ]* 2.2 Write property test for authentication error handling
    - **Property 2: Authentication Error Handling**
    - **Validates: Requirements 1.3**

  - [x] 2.3 Implement Application Insights client
    - Create `src/azure/applicationInsightsClient.ts` implementing `IAzureIntegrationLayer`
    - Implement `queryTelemetry()`, `getExceptions()`, `getRequestMetrics()`, `getDependencyMetrics()`, `getDeploymentEvents()`
    - Support time range filtering on all query methods
    - Implement pagination for large result sets (>1000 events)
    - _Requirements: 1.1, 1.2, 1.4, 10.2_

  - [ ]* 2.4 Write property tests for Azure Integration
    - **Property 1: Azure Connection with Valid Credentials**
    - **Property 3: Time Range Filtering**
    - **Property 33: Pagination for Large Datasets**
    - **Validates: Requirements 1.1, 1.2, 1.4, 10.2**

  - [ ]* 2.5 Write unit tests for Azure Integration Layer
    - Test authentication success and failure scenarios
    - Test rate limit retry behavior with exponential backoff
    - Test time range filtering on telemetry queries
    - Test handling of empty results
    - _Requirements: 1.1, 1.3, 1.5_

- [x] 3. Implement Telemetry Processing Engine
  - [x] 3.1 Implement telemetry normalizer and data filter
    - Create `src/telemetry/normalizer.ts` converting raw Azure telemetry into `NormalizedTelemetry`
    - Create `src/telemetry/dataFilter.ts` implementing service name and time range filtering
    - _Requirements: 2.1, 8.3_

  - [x] 3.2 Implement time series builder and baseline calculator
    - Create `src/telemetry/timeSeriesBuilder.ts` constructing time series from discrete events with configurable granularity
    - Create `src/telemetry/baselineCalculator.ts` computing mean, standard deviation, and percentiles from historical data
    - Implement `aggregateByTimeWindow()` for metric aggregation
    - _Requirements: 2.1, 2.4_

  - [ ]* 3.3 Write unit tests for Telemetry Processing Engine
    - Test normalization of different telemetry event types
    - Test time series construction with various granularities
    - Test baseline calculation accuracy
    - Test filtering by service name and time range
    - _Requirements: 2.1, 2.4, 8.3_

- [x] 4. Implement Pattern Detection Module
  - [x] 4.1 Implement anomaly and spike detectors
    - Create `src/analysis/anomalyDetector.ts` implementing z-score method (>3 std devs) and IQR method (>1.5×IQR)
    - Create `src/analysis/spikeDetector.ts` implementing rate-of-change and moving average detection
    - Implement `detectLatencyIncrease()` for request metric analysis
    - Implement `detectDependencyFailures()` for dependency metric analysis
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Implement anomaly severity ranking
    - Create `src/analysis/severityRanker.ts` implementing `rankAnomaliesBySeverity()`
    - Rank by severity level (critical > high > medium > low), then by deviation score within same severity
    - _Requirements: 2.5_

  - [ ]* 4.3 Write property tests for Pattern Detection
    - **Property 4: Anomaly Detection Across Metric Types**
    - **Property 5: Anomaly Severity Ranking**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [ ]* 4.4 Write unit tests for Pattern Detection
    - Test z-score detection with known anomalous values
    - Test IQR detection with outlier values
    - Test spike detection with sudden rate changes
    - Test empty and single-element time series edge cases
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Correlation Engine
  - [x] 6.1 Implement temporal correlator and clock skew handler
    - Create `src/correlation/temporalCorrelator.ts` grouping events within ±30 second windows
    - Implement `accountForClockSkew()` adjusting timestamps based on configurable max skew
    - _Requirements: 3.1, 3.5_

  - [x] 6.2 Implement causal graph builder and failure propagation tracer
    - Create `src/correlation/causalGraphBuilder.ts` constructing directed `CausalGraph` from correlated event groups
    - Create `src/correlation/propagationAnalyzer.ts` implementing `traceFailurePropagation()` and `identifyUpstreamCause()`
    - Support trace ID correlation, service dependency correlation, and exception type correlation
    - Determine chronological order of failure propagation
    - _Requirements: 3.2, 3.3, 3.4_

  - [ ]* 6.3 Write property tests for Correlation Engine
    - **Property 6: Temporal Correlation Detection**
    - **Property 7: Failure Propagation Tracing**
    - **Property 8: Chronological Failure Ordering**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [ ]* 6.4 Write unit tests for Correlation Engine
    - Test temporal correlation with events inside and outside time window
    - Test causal graph construction with known dependency chains
    - Test failure propagation tracing through multi-service chains
    - Test clock skew adjustment
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. Implement Root Cause Identifier
  - [x] 7.1 Implement causal analyzer and evidence scorer
    - Create `src/rootcause/causalAnalyzer.ts` implementing `findEarliestFailure()` finding root nodes (no incoming edges) in causal graph
    - Create `src/rootcause/evidenceScorer.ts` implementing `scoreRootCauseEvidence()` based on temporal priority, evidence strength, dependency position, and exception uniqueness
    - Implement `identifyRootCauses()` returning ranked root causes
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Implement deployment correlator and resource analyzer
    - Create `src/rootcause/deploymentCorrelator.ts` flagging deployments within 1 hour of incident as potential root causes
    - Create `src/rootcause/resourceAnalyzer.ts` identifying resource exhaustion (CPU >90%, memory >95%, disk >95%)
    - Implement exception grouping by type and similar stack traces
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ]* 7.3 Write property tests for Root Cause Identifier
    - **Property 9: Root Cause Identification from Causal Graph**
    - **Property 10: Root Cause Ranking by Evidence**
    - **Property 11: Deployment Correlation**
    - **Property 12: Resource Constraint Identification**
    - **Property 13: Exception Grouping**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [ ]* 7.4 Write unit tests for Root Cause Identifier
    - Test earliest failure identification in simple and complex graphs
    - Test evidence scoring with varying evidence strength
    - Test deployment correlation within and outside 1-hour window
    - Test resource constraint detection at threshold boundaries
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 8. Implement Symptom Classifier
  - [x] 8.1 Implement symptom detector and cascade analyzer
    - Create `src/symptoms/symptomDetector.ts` implementing `classifyFindings()` labeling each finding as "symptom" or "root cause" based on causal graph position
    - Create `src/symptoms/cascadeAnalyzer.ts` implementing `identifySymptoms()` detecting downstream cascade effects
    - Implement `classifyTimeouts()` classifying timeout errors with upstream degradation as symptoms
    - Implement `linkSymptomsToRootCauses()` ensuring every symptom links to at least one root cause
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.2 Write property tests for Symptom Classifier
    - **Property 14: Symptom vs Root Cause Classification**
    - **Property 15: Cascade Symptom Identification**
    - **Property 16: Symptom-to-Cause Linking**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [ ]* 8.3 Write unit tests for Symptom Classifier
    - Test classification of findings with and without upstream causes
    - Test cascade detection in multi-service failure scenarios
    - Test timeout classification with upstream degradation
    - Test symptom-to-cause linking completeness
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement AI Reasoning Module
  - [x] 10.1 Implement LLM client and prompt builder
    - Create `src/ai/llmClient.ts` interfacing with LLM API (e.g., Azure OpenAI) with error handling and fallback
    - Create `src/ai/promptBuilder.ts` constructing structured prompts with incident summary, telemetry findings, and root cause candidates following the design's prompt template
    - _Requirements: 6.1, 9.3_

  - [x] 10.2 Implement reasoning engine and recommendation generator
    - Create `src/ai/reasoningEngine.ts` implementing `analyzeIncident()` and `generateExplanation()` orchestrating AI analysis
    - Create `src/ai/recommendationGenerator.ts` implementing `generateRecommendations()` and `prioritizeRecommendations()`
    - Include rollback recommendation for deployment-related root causes
    - Include scaling recommendation for resource constraint root causes
    - Include diagnostic steps for low-confidence root causes (confidence < 0.5)
    - Ensure each recommendation is concise (<200 characters) and specific
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 10.3 Write property tests for AI Reasoning Module
    - **Property 17: Recommendation Generation**
    - **Property 18: Recommendation Prioritization**
    - **Property 19: Deployment Rollback Recommendation**
    - **Property 20: Resource Scaling Recommendation**
    - **Property 21: Diagnostic Recommendations for Low Confidence**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

  - [ ]* 10.4 Write unit tests for AI Reasoning Module
    - Test recommendation generation for different root cause categories
    - Test prioritization ordering by impact and effort
    - Test fallback behavior when LLM fails
    - Test prompt construction with various incident contexts
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.3_

- [x] 11. Implement Report Generation Module
  - [x] 11.1 Implement report formatter and timeline builder
    - Create `src/report/reportFormatter.ts` implementing `generateReport()` assembling all sections: summary, timeline, root causes, symptoms, recommendations, evidence
    - Create `src/report/timelineBuilder.ts` implementing `buildTimeline()` ordering events chronologically
    - Distinguish primary root cause from contributing causes when multiple exist
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 11.2 Implement Markdown renderer
    - Create `src/report/markdownRenderer.ts` implementing `renderAsMarkdown()` producing valid Markdown with all required section headers
    - Follow the report structure template from the design document
    - _Requirements: 7.5_

  - [ ]* 11.3 Write property tests for Report Generation
    - **Property 22: Report Completeness**
    - **Property 23: Timeline Chronological Ordering**
    - **Property 24: Primary vs Contributing Cause Distinction**
    - **Property 25: Report Structure Validation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  - [ ]* 11.4 Write unit tests for Report Generation
    - Test report generation with single and multiple root causes
    - Test timeline ordering with out-of-order events
    - Test Markdown output structure and section headers
    - Test primary vs contributing cause labeling
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 12. Implement Query Interface and Analysis Orchestrator
  - [x] 12.1 Implement query parser
    - Create `src/query/queryParser.ts` implementing `parseQuery()` extracting time range, service names, and incident type from natural language input
    - Implement `requestClarification()` returning clarification requests when required parameters are missing
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 12.2 Implement Analysis Orchestrator
    - Create `src/query/analysisOrchestrator.ts` implementing `executeAnalysis()` coordinating the full pipeline: Azure data retrieval → telemetry processing → pattern detection → correlation → root cause identification → symptom classification → AI reasoning → report generation
    - Implement timeout handling to prevent indefinite processing
    - Implement graceful degradation when telemetry data is incomplete (proceed with available data, note limitations)
    - Implement AI failure fallback returning raw telemetry with error message
    - Implement data prioritization for large datasets (>10,000 events) and intelligent sampling for very large datasets (>50,000 events)
    - _Requirements: 8.1, 8.5, 9.1, 9.3, 9.4, 10.1, 10.4, 10.5_

  - [x] 12.3 Implement response formatter
    - Create `src/query/responseFormatter.ts` implementing `formatResponse()` converting report into natural language answers addressing the user's query
    - _Requirements: 8.5_

  - [ ]* 12.4 Write property tests for Query Interface
    - **Property 26: Query Parameter Extraction**
    - **Property 27: Time Range Query Scoping**
    - **Property 28: Service-Focused Analysis**
    - **Property 29: Clarification Request for Ambiguous Queries**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ]* 12.5 Write property tests for Error Handling and Resilience
    - **Property 30: Graceful Degradation with Incomplete Data**
    - **Property 31: AI Failure Fallback**
    - **Property 32: Error Logging**
    - **Validates: Requirements 9.1, 9.3, 9.5**

  - [ ]* 12.6 Write property tests for Performance and Scalability
    - **Property 34: Data Prioritization**
    - **Property 35: Intelligent Sampling**
    - **Validates: Requirements 10.4, 10.5**

  - [ ]* 12.7 Write unit tests for Query Interface and Orchestrator
    - Test query parsing with various natural language inputs (time expressions, service names, incident types)
    - Test clarification requests for ambiguous queries
    - Test orchestrator end-to-end flow with mocked components
    - Test timeout handling and graceful degradation
    - Test data sampling for large datasets
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.3, 9.4, 10.4, 10.5_

- [x] 13. Integration wiring and entry point
  - [x] 13.1 Create application entry point and dependency wiring
    - Create `src/index.ts` wiring all components together via dependency injection
    - Export public API for programmatic usage
    - Implement concurrent request handling
    - _Requirements: 10.3_

  - [ ]* 13.2 Write integration tests for end-to-end workflows
    - Test complete RCA workflow from natural language query to Markdown report with mocked Azure data
    - Test multi-service failure correlation scenario
    - Test deployment-related incident analysis scenario
    - Test graceful degradation with partial/missing data
    - _Requirements: 1.1, 1.2, 7.1, 8.1, 9.1_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (35 properties total)
- Unit tests validate specific examples and edge cases
- All code is TypeScript, tested with Jest and fast-check
