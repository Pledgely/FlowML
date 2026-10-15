// ============================================================
// Error Handling & Observability Rules (20 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type { FlowMLDocument } from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';
import { getStepInfo } from '../graphBuilder.js';

const DML_KEYS = new Set(['recordCreate', 'recordUpdate', 'recordDelete']);

const recursiveAfterUpdate: LintRule = {
  id: 'recursive-after-update',
  severity: 'critical',
  category: 'errorHandling',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    if (!doc.trigger) return [];
    const triggerType = doc.trigger.type;
    if (!triggerType || !triggerType.includes('AfterSave')) return [];

    const triggerObj = doc.trigger.object;
    if (!triggerObj) return [];

    // Check if any recordUpdate targets the same object
    for (const step of doc.steps) {
      if (!('recordUpdate' in step)) continue;
      const s = step as unknown as Record<string, unknown>;
      const stepObj = s.object as string | undefined;
      const inputRef = s.inputReference as string | undefined;

      const updatesSameObj = stepObj === triggerObj || inputRef === '$Record';
      if (!updatesSameObj) continue;

      // Check if entry conditions exist
      const hasEntryConditions = doc.trigger.entryConditions &&
        ((Array.isArray(doc.trigger.entryConditions) && doc.trigger.entryConditions.length > 0) ||
         (!Array.isArray(doc.trigger.entryConditions) && doc.trigger.entryConditions.logic));

      if (!hasEntryConditions) {
        return [{
          ruleId: 'recursive-after-update',
          severity: 'critical',
          category: 'errorHandling',
          message: `After-save flow updates trigger object "${triggerObj}" without entry conditions — INFINITE LOOP RISK`,
          stepName: s.recordUpdate as string,
          deduction: 10,
        }];
      }
    }
    return [];
  },
};

const missingFaultPaths: LintRule = {
  id: 'missing-fault-paths',
  severity: 'warning',
  category: 'errorHandling',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (!DML_KEYS.has(info.key) && info.key !== 'recordLock') continue;
      const sd = step as unknown as Record<string, unknown>;
      if (!sd.faultNext) {
        results.push({
          ruleId: 'missing-fault-paths',
          severity: 'warning',
          category: 'errorHandling',
          message: `${info.key} "${info.name}" has no fault path — errors will be unhandled`,
          stepName: info.name,
          deduction: 2,
        });
      }
    }
    return results;
  },
};

const nullCheckAfterLookup: LintRule = {
  id: 'null-check-after-lookup',
  severity: 'info',
  category: 'errorHandling',
  maxDeduction: 6,
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if (!('lookup' in step)) continue;
      const s = step as unknown as Record<string, unknown>;
      const lookupName = s.lookup as string;
      const nextTarget = s.next as string | undefined;
      if (!nextTarget) continue;

      // Check if the next element is a decision
      const nextNode = graph.nodes.get(nextTarget);
      if (nextNode && nextNode.elementType !== 'decisions') {
        results.push({
          ruleId: 'null-check-after-lookup',
          severity: 'info',
          category: 'errorHandling',
          message: `Lookup "${lookupName}" is not followed by a null-check decision`,
          stepName: lookupName,
          deduction: 2,
        });
      }
    }
    return results;
  },
};

const noErrorLogging: LintRule = {
  id: 'no-error-logging',
  severity: 'info',
  category: 'errorHandling',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    // Check if any DML exists first
    let hasDml = false;
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (DML_KEYS.has(info.key)) { hasDml = true; break; }
    }
    if (!hasDml) return [];

    // Look for error logging patterns
    for (const step of doc.steps) {
      if ('subflow' in step) {
        const sf = step as unknown as Record<string, unknown>;
        const flowName = (sf.flowName as string ?? '').toLowerCase();
        const subflowName = (sf.subflow as string ?? '').toLowerCase();
        if (flowName.includes('error') || flowName.includes('log') ||
            subflowName.includes('error') || subflowName.includes('log')) {
          return []; // Has error logging
        }
      }
      // Check for inline error logging via customError
      if ('customError' in step) return [];
    }

    return [{
      ruleId: 'no-error-logging',
      severity: 'info',
      category: 'errorHandling',
      message: 'No error logging pattern detected — consider adding a Sub_LogError subflow in fault paths',
      deduction: 10,
    }];
  },
};

export const errorHandlingRules: LintRule[] = [
  recursiveAfterUpdate,
  missingFaultPaths,
  nullCheckAfterLookup,
  noErrorLogging,
];
