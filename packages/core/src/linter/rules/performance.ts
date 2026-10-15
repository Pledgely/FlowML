// ============================================================
// Performance & Bulk Safety Rules (20 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type { FlowMLDocument, LookupStep, RecordCreateStep, RecordUpdateStep, RecordDeleteStep } from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';
import { getStepInfo } from '../graphBuilder.js';

// Salesforce ID prefixes for common object key prefixes
const SF_ID_PATTERN = /\b(001|003|005|006|00Q|00U|00G|00e|00D|00k|00T|00P|00I|00O|a[0-9A-Za-z]{2})[a-zA-Z0-9]{12,15}\b/;

const storeOutputAuto: LintRule = {
  id: 'store-output-auto',
  severity: 'warning',
  category: 'performance',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if ('lookup' in step) {
        const ls = step as LookupStep;
        if (!ls.storeOutputAutomatically) continue;
        // Legitimate exception: dotted relationship paths (e.g. Contact.Email on an
        // AccountContactRelation lookup) can only be read when storeOutputAutomatically
        // is true, since <queriedFields> rejects dotted names. If the author documented
        // the reason via `description`, downgrade to informational — the warning has
        // been acknowledged.
        const hasDocumentedReason = typeof ls.description === 'string' && ls.description.trim().length > 0;
        if (hasDocumentedReason) {
          results.push({
            ruleId: 'store-output-auto',
            severity: 'info',
            category: 'performance',
            message: `Lookup "${ls.lookup}" uses storeOutputAutomatically — accepted because a description documents the reason (expected when reading dotted relationship fields). Review periodically to ensure the exception still applies.`,
            stepName: ls.lookup,
            deduction: 0,
          });
          continue;
        }
        results.push({
          ruleId: 'store-output-auto',
          severity: 'warning',
          category: 'performance',
          message: `Lookup "${ls.lookup}" uses storeOutputAutomatically — stores ALL fields, potential data leak and performance impact. If you need dotted relationship fields (e.g., Contact.Email), document the reason in the lookup's description to suppress this warning.`,
          stepName: ls.lookup,
          deduction: 3,
        });
      }
    }
    return results;
  },
};

const sameObjectQuery: LintRule = {
  id: 'same-object-query',
  severity: 'info',
  category: 'performance',
  maxDeduction: 2,
  check(doc: FlowMLDocument): LintResult[] {
    if (!doc.trigger?.object) return [];
    const triggerObj = doc.trigger.object;
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if ('lookup' in step) {
        const ls = step as LookupStep;
        if (ls.object === triggerObj) {
          results.push({
            ruleId: 'same-object-query',
            severity: 'info',
            category: 'performance',
            message: `Lookup "${ls.lookup}" queries trigger object "${triggerObj}" — use $Record instead`,
            stepName: ls.lookup,
            deduction: 2,
          });
        }
      }
    }
    return results;
  },
};

const missingFilters: LintRule = {
  id: 'missing-filters',
  severity: 'info',
  category: 'performance',
  maxDeduction: 2,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if ('lookup' in step) {
        const ls = step as LookupStep;
        if (!ls.where || (Array.isArray(ls.where) && ls.where.length === 0)) {
          results.push({
            ruleId: 'missing-filters',
            severity: 'info',
            category: 'performance',
            message: `Lookup "${ls.lookup}" has no filter conditions — may return too many records`,
            stepName: ls.lookup,
            deduction: 2,
          });
        }
      }
    }
    return results;
  },
};

const preferGetFirst: LintRule = {
  id: 'prefer-get-first',
  severity: 'info',
  category: 'performance',
  maxDeduction: 1,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if ('lookup' in step) {
        const ls = step as LookupStep;
        if (!ls.getFirst && !ls.storeOutputAutomatically) {
          // Only flag if name suggests single record
          const singleIndicators = /^(Get_|Fetch_|Find_|Lookup_)/i;
          if (singleIndicators.test(ls.lookup)) {
            results.push({
              ruleId: 'prefer-get-first',
              severity: 'info',
              category: 'performance',
              message: `Lookup "${ls.lookup}" may benefit from getFirst: true if expecting single record`,
              stepName: ls.lookup,
              deduction: 1,
            });
          }
        }
      }
    }
    return results;
  },
};

const hardcodedIds: LintRule = {
  id: 'hardcoded-ids',
  severity: 'warning',
  category: 'performance',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    // Scan all string values in the document for Salesforce ID patterns
    const text = JSON.stringify(doc.steps) + JSON.stringify(doc.variables ?? {});
    if (!SF_ID_PATTERN.test(text)) return [];

    const matches: string[] = [];
    for (const step of doc.steps) {
      const stepText = JSON.stringify(step);
      if (SF_ID_PATTERN.test(stepText)) {
        const info = getStepInfo(step);
        matches.push(info.name);
      }
    }

    if (matches.length === 0) return [];
    return [{
      ruleId: 'hardcoded-ids',
      severity: 'warning',
      category: 'performance',
      message: `Hardcoded Salesforce IDs detected in ${matches.length} element(s): ${matches.slice(0, 3).join(', ')} — IDs are org-specific and cause deployment failures`,
      deduction: 5,
    }];
  },
};

const dmlBetweenScreens: LintRule = {
  id: 'dml-between-screens',
  severity: 'warning',
  category: 'performance',
  maxDeduction: 3,
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    // Only relevant for screen flows
    if (doc.flow.processType !== 'Flow') return [];

    const DML_ELEMENT_TYPES = new Set(['recordCreates', 'recordUpdates', 'recordDeletes']);
    const screenNodes: string[] = [];
    for (const [name, node] of graph.nodes) {
      if (node.elementType === 'screens') screenNodes.push(name);
    }
    if (screenNodes.length < 2) return [];

    const results: LintResult[] = [];
    for (const screenName of screenNodes) {
      const screenNode = graph.nodes.get(screenName);
      if (!screenNode) continue;
      // Walk from screen's connector until we hit another screen
      const visited = new Set<string>();
      let current = screenNode.edges[0];
      while (current && !visited.has(current)) {
        visited.add(current);
        const node = graph.nodes.get(current);
        if (!node) break;
        if (node.elementType === 'screens') break; // reached next screen
        if (DML_ELEMENT_TYPES.has(node.elementType)) {
          results.push({
            ruleId: 'dml-between-screens',
            severity: 'warning',
            category: 'performance',
            message: `DML "${node.name}" between screens — back button can cause data issues`,
            stepName: node.name,
            deduction: 3,
          });
        }
        current = node.edges[0];
      }
    }
    return results;
  },
};

const highSoqlCount: LintRule = {
  id: 'high-soql-count',
  severity: 'warning',
  category: 'performance',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    let count = 0;
    for (const step of doc.steps) {
      if ('lookup' in step) count++;
    }
    if (count > 50) {
      return [{
        ruleId: 'high-soql-count',
        severity: 'warning',
        category: 'performance',
        message: `${count} SOQL queries — may exceed governor limits (100 per transaction)`,
        deduction: 5,
      }];
    }
    if (count > 30) {
      return [{
        ruleId: 'high-soql-count',
        severity: 'warning',
        category: 'performance',
        message: `${count} SOQL queries — monitor for governor limits`,
        deduction: 3,
      }];
    }
    return [];
  },
};

const highDmlCount: LintRule = {
  id: 'high-dml-count',
  severity: 'warning',
  category: 'performance',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    let count = 0;
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (['recordCreate', 'recordUpdate', 'recordDelete'].includes(info.key)) count++;
    }
    if (count > 100) {
      return [{
        ruleId: 'high-dml-count',
        severity: 'warning',
        category: 'performance',
        message: `${count} DML operations — may exceed governor limits (150 per transaction)`,
        deduction: 5,
      }];
    }
    if (count > 50) {
      return [{
        ruleId: 'high-dml-count',
        severity: 'warning',
        category: 'performance',
        message: `${count} DML operations — monitor for governor limits`,
        deduction: 2,
      }];
    }
    return [];
  },
};

const lookupFieldsFlatOnly: LintRule = {
  id: 'lookup-fields-flat-only',
  severity: 'critical',
  category: 'performance',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if (!('lookup' in step)) continue;
      const ls = step as LookupStep;
      if (!ls.fields) continue;
      const dotted = ls.fields.filter(f => f.includes('.'));
      if (dotted.length === 0) continue;
      results.push({
        ruleId: 'lookup-fields-flat-only',
        severity: 'critical',
        category: 'performance',
        message: `Lookup "${ls.lookup}" has relationship paths in fields: [${dotted.join(', ')}] — <queriedFields> requires flat field names. Use storeOutputAutomatically: true or add a second lookup.`,
        stepName: ls.lookup,
        deduction: 10,
      });
    }
    return results;
  },
};

/**
 * storeOutputAutomatically + fields is legal — Salesforce emits exactly this
 * combination on org-retrieved flows, where <queriedFields> narrows which
 * fields the automatic output actually carries. It is not a deploy failure, so
 * this is an advisory about the narrowing, not a critical.
 */
const lookupStoreAutoAndFields: LintRule = {
  id: 'lookup-store-auto-and-fields',
  severity: 'info',
  category: 'performance',
  maxDeduction: 0,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if (!('lookup' in step)) continue;
      const ls = step as LookupStep;
      if (ls.storeOutputAutomatically && ls.fields && ls.fields.length > 0) {
        results.push({
          ruleId: 'lookup-store-auto-and-fields',
          severity: 'info',
          category: 'performance',
          message: `Lookup "${ls.lookup}" combines storeOutputAutomatically: true with fields: [${ls.fields.join(', ')}] — the automatic output carries only those fields. Any other field referenced off "${ls.lookup}" will be null at runtime.`,
          stepName: ls.lookup,
          deduction: 0,
        });
      }
    }
    return results;
  },
};

export const performanceRules: LintRule[] = [
  storeOutputAuto,
  sameObjectQuery,
  missingFilters,
  preferGetFirst,
  hardcodedIds,
  dmlBetweenScreens,
  highSoqlCount,
  highDmlCount,
  lookupFieldsFlatOnly,
  lookupStoreAutoAndFields,
];
