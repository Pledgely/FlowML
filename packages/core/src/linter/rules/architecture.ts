// ============================================================
// Architecture & Orchestration Rules (15 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type { FlowMLDocument, LoopStep } from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';
import { getStepInfo } from '../graphBuilder.js';

const DML_AND_SOQL_TYPES = new Set([
  'recordCreates', 'recordUpdates', 'recordDeletes', 'recordLookups',
]);

const complexWithoutSubflows: LintRule = {
  id: 'complex-without-subflows',
  severity: 'info',
  category: 'architecture',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    let dataElementCount = 0;
    let hasSubflow = false;
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (['lookup', 'recordCreate', 'recordUpdate', 'recordDelete'].includes(info.key)) {
        dataElementCount++;
      }
      if ('decision' in step) dataElementCount++;
      if (info.key === 'subflow') hasSubflow = true;
    }
    if (dataElementCount > 10 && !hasSubflow) {
      return [{
        ruleId: 'complex-without-subflows',
        severity: 'info',
        category: 'architecture',
        message: `${dataElementCount} data/decision elements with no subflows — consider breaking into components`,
        deduction: 3,
      }];
    }
    return [];
  },
};

const flowTooLarge: LintRule = {
  id: 'flow-too-large',
  severity: 'info',
  category: 'architecture',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    if (doc.steps.length > 50) {
      return [{
        ruleId: 'flow-too-large',
        severity: 'info',
        category: 'architecture',
        message: `Flow has ${doc.steps.length} steps — consider splitting into orchestrator + subflows`,
        deduction: 5,
      }];
    }
    return [];
  },
};

const unusedVariables: LintRule = {
  id: 'unused-variables',
  severity: 'info',
  category: 'architecture',
  maxDeduction: 2,
  check(doc: FlowMLDocument): LintResult[] {
    if (!doc.variables) return [];

    const defined = new Set(Object.keys(doc.variables));
    if (defined.size === 0) return [];

    // Collect all string references from steps
    const referenced = new Set<string>();
    const fullText = JSON.stringify(doc.steps) +
      JSON.stringify(doc.formulas ?? {}) +
      JSON.stringify(doc.trigger ?? {}) +
      JSON.stringify(doc.start ?? {});

    for (const varName of defined) {
      if (fullText.includes(varName)) {
        referenced.add(varName);
      }
    }

    const unused = [...defined].filter(v => !referenced.has(v));
    if (unused.length === 0) return [];
    return [{
      ruleId: 'unused-variables',
      severity: 'info',
      category: 'architecture',
      message: `${unused.length} unused variable(s): ${unused.slice(0, 3).join(', ')}${unused.length > 3 ? '...' : ''}`,
      deduction: 2,
    }];
  },
};

const orphanedElements: LintRule = {
  id: 'orphaned-elements',
  severity: 'warning',
  category: 'architecture',
  maxDeduction: 3,
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    // BFS from start + scheduled paths to find reachable nodes
    const reachable = new Set<string>();
    const queue: string[] = [];
    if (graph.startName) queue.push(graph.startName);
    for (const sp of graph.scheduledPathStarts) queue.push(sp);

    while (queue.length > 0) {
      const name = queue.shift()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      const node = graph.nodes.get(name);
      if (!node) continue;
      for (const edge of node.edges) {
        if (!reachable.has(edge)) queue.push(edge);
      }
    }

    const orphans: string[] = [];
    for (const step of doc.steps) {
      const info = getStepInfo(step);
      if (!reachable.has(info.name)) {
        orphans.push(info.name);
      }
    }

    if (orphans.length === 0) return [];
    return [{
      ruleId: 'orphaned-elements',
      severity: 'warning',
      category: 'architecture',
      message: `${orphans.length} orphaned element(s) not reachable from start: ${orphans.slice(0, 3).join(', ')}${orphans.length > 3 ? '...' : ''}`,
      deduction: 3,
    }];
  },
};

const autolaunchedWithoutIo: LintRule = {
  id: 'autolaunched-without-io',
  severity: 'info',
  category: 'architecture',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    // Only applies to autolaunched flows without a trigger (i.e., subflows/invocable)
    if (doc.trigger) return [];
    if (doc.flow.processType !== 'AutoLaunchedFlow') return [];

    if (!doc.variables) {
      return [{
        ruleId: 'autolaunched-without-io',
        severity: 'info',
        category: 'architecture',
        message: 'Autolaunched flow has no input/output variables — add isInput/isOutput for reusability',
        deduction: 3,
      }];
    }

    const hasIo = Object.values(doc.variables).some(v => v.isInput || v.isOutput);
    if (!hasIo) {
      return [{
        ruleId: 'autolaunched-without-io',
        severity: 'info',
        category: 'architecture',
        message: 'Autolaunched flow has no input/output variables — add isInput/isOutput for reusability',
        deduction: 3,
      }];
    }
    return [];
  },
};

const multiLoopSameCollection: LintRule = {
  id: 'multi-loop-same-collection',
  severity: 'warning',
  category: 'architecture',
  maxDeduction: 4,
  check(doc: FlowMLDocument): LintResult[] {
    const byCollection = new Map<string, string[]>();
    for (const step of doc.steps) {
      if (!('loop' in step)) continue;
      const ls = step as LoopStep;
      if (!ls.collection) continue;
      const list = byCollection.get(ls.collection) ?? [];
      list.push(ls.loop);
      byCollection.set(ls.collection, list);
    }

    const results: LintResult[] = [];
    for (const [collection, loops] of byCollection) {
      if (loops.length < 2) continue;
      results.push({
        ruleId: 'multi-loop-same-collection',
        severity: 'warning',
        category: 'architecture',
        message: `Loops "${loops.join('", "')}" all iterate collection "${collection}" — consolidate into one loop with chained in-loop decisions (scenario dispatch). Each duplicated loop typically brings a duplicated guard decision and multiplies review cost.`,
        deduction: 4,
      });
    }
    return results;
  },
};

export const architectureRules: LintRule[] = [
  complexWithoutSubflows,
  flowTooLarge,
  unusedVariables,
  orphanedElements,
  autolaunchedWithoutIo,
  multiLoopSameCollection,
];
