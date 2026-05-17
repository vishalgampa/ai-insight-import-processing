/**
 * Reasoning engine that orchestrates AI-based incident analysis.
 * Falls back to rule-based explanations when the LLM is unavailable.
 */

import { RootCause, Recommendation } from '../types/analysis';
import { Evidence } from '../types/report';
import { LLMClient } from './llmClient';
import { PromptBuilder, IncidentPromptContext } from './promptBuilder';
import { RecommendationGenerator } from './recommendationGenerator';
import { logger } from '../errors';

/** Result of an AI-powered incident analysis */
export interface AIAnalysis {
  explanation: string;
  recommendations: Recommendation[];
  rawResponse: string;
}

export class ReasoningEngine {
  private llmClient: LLMClient;
  private promptBuilder: PromptBuilder;

  constructor(llmClient: LLMClient, promptBuilder: PromptBuilder) {
    this.llmClient = llmClient;
    this.promptBuilder = promptBuilder;
  }

  /**
   * Orchestrate AI analysis by building a prompt and calling the LLM.
   * Falls back to rule-based analysis when the LLM fails.
   */
  async analyzeIncident(context: IncidentPromptContext): Promise<AIAnalysis> {
    const prompt = this.promptBuilder.buildIncidentAnalysisPrompt(context);
    const recGenerator = new RecommendationGenerator();

    try {
      const rawResponse = await this.llmClient.complete(prompt);
      const recommendations = recGenerator.generateRecommendations(
        context.rootCauseCandidates,
        { affectedServices: context.affectedServices },
      );

      return {
        explanation: rawResponse,
        recommendations: recGenerator.prioritizeRecommendations(recommendations),
        rawResponse,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warning('LLM analysis failed, falling back to rule-based analysis', {
        error: err.message,
      });

      const explanation = this.buildRuleBasedExplanation(context);
      const recommendations = recGenerator.generateRecommendations(
        context.rootCauseCandidates,
        { affectedServices: context.affectedServices },
      );

      return {
        explanation,
        recommendations: recGenerator.prioritizeRecommendations(recommendations),
        rawResponse: '',
      };
    }
  }

  /**
   * Generate a human-readable explanation for a root cause.
   * Falls back to rule-based explanation when the LLM fails.
   */
  async generateExplanation(rootCause: RootCause, supportingEvidence: Evidence[]): Promise<string> {
    const prompt = this.buildExplanationPrompt(rootCause, supportingEvidence);

    try {
      return await this.llmClient.complete(prompt);
    } catch {
      return this.buildFallbackExplanation(rootCause, supportingEvidence);
    }
  }

  private buildExplanationPrompt(rootCause: RootCause, evidence: Evidence[]): string {
    const evidenceLines = evidence
      .map((e) => `- [${e.type}] ${e.description}`)
      .join('\n');

    return [
      'Explain the following root cause in 2-3 concise sentences for an engineer:',
      '',
      `Category: ${rootCause.category}`,
      `Confidence: ${(rootCause.confidence * 100).toFixed(0)}%`,
      `Current explanation: ${rootCause.explanation}`,
      '',
      'Supporting evidence:',
      evidenceLines || 'No additional evidence available.',
      '',
      'Be specific and actionable.',
    ].join('\n');
  }

  private buildFallbackExplanation(rootCause: RootCause, evidence: Evidence[]): string {
    const evidenceCount = evidence.length;
    const confidencePct = (rootCause.confidence * 100).toFixed(0);

    return (
      `Root cause identified: ${rootCause.explanation} ` +
      `(category: ${rootCause.category}, confidence: ${confidencePct}%). ` +
      `This conclusion is supported by ${evidenceCount} piece${evidenceCount !== 1 ? 's' : ''} of evidence.`
    );
  }

  private buildRuleBasedExplanation(context: IncidentPromptContext): string {
    const { rootCauseCandidates, affectedServices, anomalies } = context;

    if (rootCauseCandidates.length === 0) {
      return (
        'No definitive root cause was identified. ' +
        `${anomalies.length} anomalies were detected across ${affectedServices.length} service(s). ` +
        'Further investigation is recommended.'
      );
    }

    const primary = rootCauseCandidates[0];
    const parts: string[] = [
      `The most likely root cause is a ${primary.category} issue: ${primary.explanation} ` +
        `(confidence: ${(primary.confidence * 100).toFixed(0)}%).`,
    ];

    if (rootCauseCandidates.length > 1) {
      parts.push(
        `${rootCauseCandidates.length - 1} additional contributing factor(s) were identified.`,
      );
    }

    if (affectedServices.length > 0) {
      parts.push(`Affected services: ${affectedServices.join(', ')}.`);
    }

    return parts.join(' ');
  }
}
