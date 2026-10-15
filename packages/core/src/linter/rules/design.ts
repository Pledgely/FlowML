// ============================================================
// Design & Naming Rules (20 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type { FlowMLDocument, DecisionStep, WaitStep } from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';
import { getStepInfo } from '../graphBuilder.js';

const descriptionPresent: LintRule = {
  id: 'description-present',
  severity: 'warning',
  category: 'design',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    const desc = doc.flow.description;
    if (!desc || desc.trim().length < 20) {
      return [{
        ruleId: 'description-present',
        severity: 'warning',
        category: 'design',
        message: 'Flow description is missing or too short (minimum 20 characters)',
        deduction: 5,
      }];
    }
    return [];
  },
};

const flowNamingConvention: LintRule = {
  id: 'flow-naming-convention',
  severity: 'info',
  category: 'design',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    const name = doc.flow.name;
    // Pattern: Object_TriggerType_Purpose or similar underscore-separated
    // At minimum, should have 2+ underscore-separated segments
    const segments = name.split('_').filter(Boolean);
    if (segments.length < 2) {
      return [{
        ruleId: 'flow-naming-convention',
        severity: 'info',
        category: 'design',
        message: `Flow name "${name}" does not follow Object_TriggerType_Purpose convention`,
        deduction: 5,
      }];
    }
    return [];
  },
};

const noCopyOfNames: LintRule = {
  id: 'no-copy-of-names',
  severity: 'info',
  category: 'design',
  maxDeduction: 2,
  check(doc: FlowMLDocument): LintResult[] {
    const copyPattern = /^Copy_(\d+_of_|of_)/i;
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (copyPattern.test(info.name)) {
        results.push({
          ruleId: 'no-copy-of-names',
          severity: 'info',
          category: 'design',
          message: `Element "${info.name}" has a "Copy_of" name — rename with a meaningful name`,
          stepName: info.name,
          deduction: 2,
        });
      }
    }
    return results;
  },
};

const noDefaultNames: LintRule = {
  id: 'no-default-names',
  severity: 'info',
  category: 'design',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    // Common default name patterns from Flow Builder
    const defaultPattern = /^(Decision_\d|myRule_\d|Get_Records|Loop_\d|Assignment_\d|Screen_\d)$/;
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (defaultPattern.test(info.name)) {
        results.push({
          ruleId: 'no-default-names',
          severity: 'info',
          category: 'design',
          message: `Element "${info.name}" uses a default Flow Builder name — rename descriptively`,
          stepName: info.name,
          deduction: 3,
        });
      }
    }
    return results;
  },
};

const variableNaming: LintRule = {
  id: 'variable-naming',
  severity: 'info',
  category: 'design',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    if (!doc.variables) return [];
    const knownPrefixes = /^(var|col|rec|inp|out|for|con|txt|ch|cs)[A-Z_]/;
    const badNames: string[] = [];
    for (const name of Object.keys(doc.variables)) {
      // Skip system variables
      if (name.startsWith('$')) continue;
      if (!knownPrefixes.test(name)) {
        badNames.push(name);
      }
    }
    if (badNames.length === 0) return [];
    return [{
      ruleId: 'variable-naming',
      severity: 'info',
      category: 'design',
      message: `${badNames.length} variable(s) don't follow naming conventions: ${badNames.slice(0, 3).join(', ')}${badNames.length > 3 ? '...' : ''}`,
      deduction: Math.min(5, badNames.length),
    }];
  },
};

const uniqueElementNames: LintRule = {
  id: 'unique-element-names',
  severity: 'critical',
  category: 'design',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];

    // Global namespace: top-level element names must be unique across steps,
    // scheduled paths, and all resources. Salesforce deploy fails with
    // "Duplicate name" errors when two elements share a name.
    const seenGlobal = new Map<string, string>();
    const reportCollision = (name: string, kind: string, existingKind: string): void => {
      results.push({
        ruleId: 'unique-element-names',
        severity: 'critical',
        category: 'design',
        message: `Name "${name}" is used by both ${existingKind} and ${kind} — element names must be unique across the flow (deploy will fail)`,
        stepName: name,
        deduction: 10,
      });
    };
    const registerGlobal = (name: string, kind: string): void => {
      if (!name) return;
      const existing = seenGlobal.get(name);
      if (existing) {
        reportCollision(name, kind, existing);
      } else {
        seenGlobal.set(name, kind);
      }
    };

    for (const step of doc.steps) {
      const info = getStepInfo(step);
      registerGlobal(info.name, `a ${info.key} step`);
    }
    for (const name of Object.keys(doc.variables ?? {})) registerGlobal(name, 'a variable');
    for (const name of Object.keys(doc.formulas ?? {})) registerGlobal(name, 'a formula');
    for (const name of Object.keys(doc.textTemplates ?? {})) registerGlobal(name, 'a text template');
    for (const name of Object.keys(doc.constants ?? {})) registerGlobal(name, 'a constant');
    for (const name of Object.keys(doc.choices ?? {})) registerGlobal(name, 'a choice');
    for (const name of Object.keys(doc.choiceSets ?? {})) registerGlobal(name, 'a choice set');
    for (const path of doc.trigger?.scheduledPaths ?? []) {
      registerGlobal(path.name, 'a scheduled path');
    }

    // Decision rule names must be unique within their parent decision.
    for (const step of doc.steps) {
      if (!('decision' in step)) continue;
      const ds = step as DecisionStep;
      const ruleNameCounts = new Map<string, number>();
      for (const rule of ds.rules ?? []) {
        if (!rule.name) continue;
        ruleNameCounts.set(rule.name, (ruleNameCounts.get(rule.name) ?? 0) + 1);
      }
      for (const [name, count] of ruleNameCounts) {
        if (count > 1) {
          results.push({
            ruleId: 'unique-element-names',
            severity: 'critical',
            category: 'design',
            message: `Decision "${ds.decision}" has ${count} rules named "${name}" — rule names must be unique within a decision (deploy will fail)`,
            stepName: ds.decision,
            deduction: 10,
          });
        }
      }
    }

    // Wait event names must be unique within their parent wait.
    for (const step of doc.steps) {
      if (!('wait' in step)) continue;
      const ws = step as WaitStep;
      const eventNameCounts = new Map<string, number>();
      for (const event of ws.events ?? []) {
        if (!event.name) continue;
        eventNameCounts.set(event.name, (eventNameCounts.get(event.name) ?? 0) + 1);
      }
      for (const [name, count] of eventNameCounts) {
        if (count > 1) {
          results.push({
            ruleId: 'unique-element-names',
            severity: 'critical',
            category: 'design',
            message: `Wait "${ws.wait}" has ${count} events named "${name}" — event names must be unique within a wait (deploy will fail)`,
            stepName: ws.wait,
            deduction: 10,
          });
        }
      }
    }

    return results;
  },
};

const flowNameInvalidChars: LintRule = {
  id: 'flow-name-invalid-chars',
  severity: 'critical',
  category: 'design',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const name = doc.flow.name;
    if (!name) {
      return [{
        ruleId: 'flow-name-invalid-chars',
        severity: 'critical',
        category: 'design',
        message: 'Flow name is empty — required for deploy',
        deduction: 10,
      }];
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      return [{
        ruleId: 'flow-name-invalid-chars',
        severity: 'critical',
        category: 'design',
        message: `Flow name "${name}" contains invalid characters — only letters, numbers, and underscores are allowed (must start with a letter). Put the human-readable text in "label" instead.`,
        deduction: 10,
      }];
    }
    return [];
  },
};

export const designRules: LintRule[] = [
  descriptionPresent,
  flowNamingConvention,
  noCopyOfNames,
  noDefaultNames,
  variableNaming,
  uniqueElementNames,
  flowNameInvalidChars,
];
