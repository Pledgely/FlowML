// ============================================================
// Linter Types — Scoring, rules, and results
// Categories and point weights adapted from the sf-flow skill in sf-skills (MIT, Jag Valaiyapathy); see NOTICE.md
// ============================================================

import type { FlowMLDocument } from '../types.js';
import type { ExecutionGraph } from '../ordering/graph.js';

export type LintSeverity = 'critical' | 'warning' | 'info';

export type LintCategory =
  | 'design'
  | 'logic'
  | 'architecture'
  | 'performance'
  | 'errorHandling'
  | 'security';

export interface LintResult {
  ruleId: string;
  severity: LintSeverity;
  category: LintCategory;
  message: string;
  stepName?: string;
  deduction: number;
}

export interface CategoryScore {
  category: LintCategory;
  label: string;
  maxPoints: number;
  score: number;
  results: LintResult[];
}

export interface ScoreReport {
  flowName: string;
  apiVersion: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  rating: string;
  /** Number of critical findings. Any critical means the flow will not deploy
   *  cleanly, regardless of how high the percentage score is. */
  criticalCount: number;
  categories: CategoryScore[];
}

export interface LintRule {
  id: string;
  severity: LintSeverity;
  category: LintCategory;
  maxDeduction: number;
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[];
}

export const CATEGORY_LABELS: Record<LintCategory, string> = {
  design: 'Design & Naming',
  logic: 'Logic & Structure',
  architecture: 'Architecture & Orchestration',
  performance: 'Performance & Bulk Safety',
  errorHandling: 'Error Handling & Observability',
  security: 'Security & Governance',
};

export const CATEGORY_MAX_POINTS: Record<LintCategory, number> = {
  design: 20,
  logic: 20,
  architecture: 15,
  performance: 20,
  errorHandling: 20,
  security: 15,
};
