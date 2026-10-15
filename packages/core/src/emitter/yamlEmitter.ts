// ============================================================
// YAML Emitter: FlowML Document -> YAML String
// ============================================================

import yaml from 'js-yaml';
import type {
  FlowMLDocument, FlowStep, DecisionStep, ComplexCondition,
} from '../types.js';

/**
 * Convert a FlowML document object to a YAML string.
 */
export function emitYaml(doc: FlowMLDocument): string {
  const ordered = buildOrderedDocument(doc);
  const cleaned = stripUndefined(ordered);
  return yaml.dump(cleaned, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    indent: 2,
  });
}

/**
 * Build document with top-level keys in canonical order per PRD:
 * flow, trigger/start, declarations, steps.
 */
function buildOrderedDocument(doc: FlowMLDocument): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.flow = doc.flow;
  if (doc.trigger) result.trigger = doc.trigger;
  if (doc.start) result.start = doc.start;
  if (doc.stages) result.stages = doc.stages;
  if (doc.variables) result.variables = doc.variables;
  if (doc.formulas) result.formulas = doc.formulas;
  if (doc.textTemplates) result.textTemplates = doc.textTemplates;
  if (doc.constants) result.constants = doc.constants;
  if (doc.choiceSets) result.choiceSets = doc.choiceSets;
  if (doc.choices) result.choices = doc.choices;
  if (doc.customProperties) result.customProperties = doc.customProperties;
  result.steps = prepareSteps(doc.steps);
  return result;
}

/**
 * Prepare steps for YAML emission.
 * For decision rules with ComplexCondition in `when`, flatten to just
 * the numbered map since `conditionLogic` already holds the logic string.
 */
function prepareSteps(steps: FlowStep[]): unknown[] {
  return steps.map(step => {
    if ('decision' in step) {
      return prepareDecisionStep(step as DecisionStep);
    }
    return step;
  });
}

function prepareDecisionStep(step: DecisionStep): unknown {
  return {
    ...step,
    rules: step.rules.map(rule => {
      const when = rule.when;
      if (when && !Array.isArray(when) && 'conditions' in when) {
        return { ...rule, when: (when as ComplexCondition).conditions };
      }
      return rule;
    }),
  };
}

/**
 * Recursively remove undefined values from an object tree.
 * Prevents js-yaml from emitting `null` for undefined values.
 */
function stripUndefined(obj: unknown): unknown {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map(item => stripUndefined(item));
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value === undefined) continue;
      result[key] = stripUndefined(value);
    }
    return result;
  }
  return obj;
}
