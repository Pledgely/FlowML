// ============================================================
// Build ExecutionGraph from FlowMLDocument
// ============================================================

import type { FlowMLDocument, FlowStep, DecisionStep, LoopStep, WaitStep } from '../types.js';
import { buildGraph, type ExecutionGraph } from '../ordering/graph.js';
import { STEP_KEY_TO_ELEMENT_TYPE } from '../mappings.js';

/** Known discriminant keys for FlowStep union type */
const STEP_KEYS = [
  'lookup', 'decision', 'assignment', 'recordCreate', 'recordUpdate',
  'recordDelete', 'loop', 'filter', 'transform', 'action', 'subflow',
  'screen', 'customError', 'wait', 'recordLock', 'recordRollback', 'raw',
];

export interface StepInfo {
  name: string;
  key: string;
  elementType: string;
}

/** Extract the discriminant key, step name, and XML element type from a FlowStep */
export function getStepInfo(step: FlowStep): StepInfo {
  const s = step as unknown as Record<string, unknown>;
  for (const key of STEP_KEYS) {
    if (key in s && typeof s[key] === 'string') {
      const name = s[key] as string;
      const elementType = STEP_KEY_TO_ELEMENT_TYPE[key] ?? key;
      return { name, key, elementType };
    }
  }
  return { name: 'unknown', key: 'unknown', elementType: 'unknown' };
}

/** Build an ExecutionGraph from a parsed FlowMLDocument */
export function buildGraphFromDocument(doc: FlowMLDocument): ExecutionGraph {
  const elements: Array<{
    name: string;
    elementType: string;
    connectorTarget?: string;
    faultTarget?: string;
    iterationNext?: string;
    afterLastNext?: string;
    ruleBranches?: string[];
    defaultBranch?: string;
  }> = [];

  for (const step of doc.steps) {
    const info = getStepInfo(step);
    const s = step as unknown as Record<string, unknown>;

    if (info.key === 'decision') {
      const ds = step as DecisionStep;
      const ruleBranches = ds.rules.map(r => r.next).filter(Boolean) as string[];
      const defaultBranch = ds.default?.next;
      elements.push({
        name: info.name,
        elementType: info.elementType,
        ruleBranches,
        defaultBranch,
        faultTarget: s.faultNext as string | undefined,
      });
    } else if (info.key === 'loop') {
      const ls = step as LoopStep;
      elements.push({
        name: info.name,
        elementType: info.elementType,
        iterationNext: ls.iterationNext,
        afterLastNext: ls.afterLastNext,
      });
    } else if (info.key === 'wait') {
      const ws = step as WaitStep;
      const ruleBranches = ws.events.map(e => e.next).filter(Boolean) as string[];
      const defaultBranch = ws.defaultNext;
      elements.push({
        name: info.name,
        elementType: info.elementType,
        ruleBranches,
        defaultBranch,
        faultTarget: s.faultNext as string | undefined,
      });
    } else {
      elements.push({
        name: info.name,
        elementType: info.elementType,
        connectorTarget: s.next as string | undefined,
        faultTarget: s.faultNext as string | undefined,
      });
    }
  }

  const startName = doc.trigger?.next ?? doc.start?.next;
  const scheduledPathStarts = (doc.trigger?.scheduledPaths ?? [])
    .map(sp => sp.next)
    .filter(Boolean) as string[];

  return buildGraph(elements, startName, scheduledPathStarts);
}
