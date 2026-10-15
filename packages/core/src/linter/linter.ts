// ============================================================
// FlowML Linter Engine — Run rules and calculate scores
// Scoring rubric and rules adapted from the sf-flow skill in sf-skills (MIT, Jag Valaiyapathy); see NOTICE.md
// ============================================================

import type { FlowMLDocument } from '../types.js';
import type { LintRule, LintResult, LintCategory, CategoryScore, ScoreReport } from './types.js';
import { CATEGORY_LABELS, CATEGORY_MAX_POINTS } from './types.js';
import { buildGraphFromDocument } from './graphBuilder.js';

import { designRules } from './rules/design.js';
import { logicRules } from './rules/logic.js';
import { architectureRules } from './rules/architecture.js';
import { performanceRules } from './rules/performance.js';
import { errorHandlingRules } from './rules/errorHandling.js';
import { securityRules } from './rules/security.js';

const ALL_RULES: LintRule[] = [
  ...designRules,
  ...logicRules,
  ...architectureRules,
  ...performanceRules,
  ...errorHandlingRules,
  ...securityRules,
];

const CATEGORIES: LintCategory[] = [
  'design', 'logic', 'architecture', 'performance', 'errorHandling', 'security',
];

function getRating(percentage: number): string {
  if (percentage >= 80) return 'Production-ready';
  if (percentage >= 68) return 'Good with review items';
  if (percentage >= 55) return 'Needs stronger guardrails';
  return 'Unsafe for deployment';
}

/**
 * Lint a FlowMLDocument and produce a scored report.
 */
export function lintFlow(doc: FlowMLDocument): ScoreReport {
  const graph = buildGraphFromDocument(doc);

  // Run all rules and collect results
  const allResults: LintResult[] = [];
  for (const rule of ALL_RULES) {
    const results = rule.check(doc, graph);
    // Apply maxDeduction cap per rule
    let totalDeduction = 0;
    for (const result of results) {
      if (totalDeduction + result.deduction > rule.maxDeduction) {
        result.deduction = Math.max(0, rule.maxDeduction - totalDeduction);
      }
      totalDeduction += result.deduction;
      allResults.push(result);
    }
  }

  // Build category scores
  const categories: CategoryScore[] = CATEGORIES.map(cat => {
    const maxPoints = CATEGORY_MAX_POINTS[cat];
    const results = allResults.filter(r => r.category === cat);
    const totalDeduction = results.reduce((sum, r) => sum + r.deduction, 0);
    const score = Math.max(0, maxPoints - totalDeduction);
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      maxPoints,
      score,
      results,
    };
  });

  const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
  const maxScore = categories.reduce((sum, c) => sum + c.maxPoints, 0);
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 100;

  const criticalCount = allResults.filter(r => r.severity === 'critical').length;

  return {
    flowName: doc.flow.label || doc.flow.name,
    apiVersion: doc.flow.apiVersion,
    totalScore,
    maxScore,
    percentage,
    rating: criticalCount > 0 ? 'Unsafe for deployment' : getRating(percentage),
    criticalCount,
    categories,
  };
}
