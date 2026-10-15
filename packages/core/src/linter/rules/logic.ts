// ============================================================
// Logic & Structure Rules (20 points max)
// ============================================================

import type { LintRule, LintResult } from '../types.js';
import type {
  FlowMLDocument, FilterStep, LookupStep,
  ScreenStep, ScreenField, SectionScreenField,
  ActionStep, SubflowStep, WaitStep,
  RecordCreateStep, RecordUpdateStep, ComponentScreenField,
} from '../../types.js';
import type { ExecutionGraph } from '../../ordering/graph.js';
import { getStepInfo } from '../graphBuilder.js';
import { inferCollectionObjectType } from '../../writer/collectionTypes.js';
import { getXmlValueTag, inferParsedValue, isQuotedLiteral } from '../../parsers.js';

// DML element types in XML naming
const DML_TYPES = new Set(['recordCreates', 'recordUpdates', 'recordDeletes']);
const SOQL_TYPES = new Set(['recordLookups']);
const ACTION_TYPES = new Set(['actionCalls']);

/**
 * DFS from a loop's iterationNext to find if a target element type
 * is reachable within the loop body (before looping back or exiting).
 */
function findInLoopBody(
  graph: ExecutionGraph,
  loopName: string,
  iterationNext: string,
  afterLastNext: string | undefined,
  targetTypes: Set<string>,
): string[] {
  const found: string[] = [];
  const visited = new Set<string>();

  function dfs(name: string): void {
    if (!name || visited.has(name)) return;
    // Back-edge to loop = end of loop body
    if (name === loopName) return;
    // Exit path = outside loop
    if (name === afterLastNext) return;

    visited.add(name);
    const node = graph.nodes.get(name);
    if (!node) return;

    if (targetTypes.has(node.elementType)) {
      found.push(name);
    }

    for (const edge of node.edges) {
      dfs(edge);
    }
  }

  dfs(iterationNext);
  return found;
}

const noDmlInLoop: LintRule = {
  id: 'no-dml-in-loop',
  severity: 'critical',
  category: 'logic',
  maxDeduction: 10,
  check(_doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    const results: LintResult[] = [];
    for (const [, node] of graph.nodes) {
      if (node.iterationNext === undefined) continue;
      const dmlSteps = findInLoopBody(
        graph, node.name, node.iterationNext ?? '', node.afterLastNext, DML_TYPES,
      );
      for (const stepName of dmlSteps) {
        results.push({
          ruleId: 'no-dml-in-loop',
          severity: 'critical',
          category: 'logic',
          message: `DML operation "${stepName}" is inside loop "${node.name}" — will cause governor limit failures with bulk data`,
          stepName,
          deduction: 10,
        });
      }
    }
    return results;
  },
};

const noSoqlInLoop: LintRule = {
  id: 'no-soql-in-loop',
  severity: 'critical',
  category: 'logic',
  maxDeduction: 8,
  check(_doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    const results: LintResult[] = [];
    for (const [, node] of graph.nodes) {
      if (node.iterationNext === undefined) continue;
      const soqlSteps = findInLoopBody(
        graph, node.name, node.iterationNext ?? '', node.afterLastNext, SOQL_TYPES,
      );
      for (const stepName of soqlSteps) {
        results.push({
          ruleId: 'no-soql-in-loop',
          severity: 'critical',
          category: 'logic',
          message: `Query "${stepName}" is inside loop "${node.name}" — will hit SOQL governor limits`,
          stepName,
          deduction: 8,
        });
      }
    }
    return results;
  },
};

const noActionInLoop: LintRule = {
  id: 'no-action-in-loop',
  severity: 'warning',
  category: 'logic',
  maxDeduction: 5,
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    const actionTypeByName = new Map<string, string>();
    for (const step of doc.steps) {
      const s = step as unknown as { action?: string; actionType?: string };
      if (typeof s.action === 'string' && typeof s.actionType === 'string') {
        actionTypeByName.set(s.action, s.actionType);
      }
    }

    const results: LintResult[] = [];
    for (const [, node] of graph.nodes) {
      if (node.iterationNext === undefined) continue;
      const actionSteps = findInLoopBody(
        graph, node.name, node.iterationNext ?? '', node.afterLastNext, ACTION_TYPES,
      );
      for (const stepName of actionSteps) {
        const actionType = actionTypeByName.get(stepName);
        if (actionType === 'emailSimple') {
          // Per-recipient email sends are a legitimate bounded pattern. The cap is
          // 10 sendEmail invocations per transaction — callout-limit framing is wrong.
          results.push({
            ruleId: 'no-action-in-loop',
            severity: 'warning',
            category: 'logic',
            message: `emailSimple "${stepName}" is inside loop "${node.name}" — per-recipient sends count against the 10-per-transaction sendEmail cap. Acceptable only when the collection is bounded (typically 1–5 recipients per triggering record); document the expected bound in the flow description. If the collection could exceed 10, move to batch Apex.`,
            stepName,
            deduction: 3,
          });
          continue;
        }
        results.push({
          ruleId: 'no-action-in-loop',
          severity: 'warning',
          category: 'logic',
          message: `Action "${stepName}" is inside loop "${node.name}" — callout limit risk`,
          stepName,
          deduction: 5,
        });
      }
    }
    return results;
  },
};

const decisionComplexity: LintRule = {
  id: 'decision-complexity',
  severity: 'info',
  category: 'logic',
  maxDeduction: 3,
  check(doc: FlowMLDocument): LintResult[] {
    let count = 0;
    for (const step of doc.steps) {
      if ('decision' in step) count++;
    }
    if (count > 5) {
      return [{
        ruleId: 'decision-complexity',
        severity: 'info',
        category: 'logic',
        message: `${count} decision elements — consider simplifying with subflows`,
        deduction: 3,
      }];
    }
    return [];
  },
};

const preferTransform: LintRule = {
  id: 'prefer-transform',
  severity: 'info',
  category: 'logic',
  maxDeduction: 5,
  check(doc: FlowMLDocument, graph: ExecutionGraph): LintResult[] {
    const results: LintResult[] = [];
    for (const [, node] of graph.nodes) {
      if (node.iterationNext === undefined) continue;
      // Check if the loop body is a single assignment that loops back
      const bodyNode = graph.nodes.get(node.iterationNext ?? '');
      if (!bodyNode) continue;
      if (bodyNode.elementType !== 'assignments') continue;
      // Check if the assignment connects back to the loop
      const mainEdge = bodyNode.edges[0];
      if (mainEdge === node.name) {
        results.push({
          ruleId: 'prefer-transform',
          severity: 'info',
          category: 'logic',
          message: `Loop "${node.name}" body is a single assignment — consider using a Transform element (30-50% faster)`,
          stepName: node.name,
          deduction: 5,
        });
      }
    }
    return results;
  },
};

const GLOBAL_CONSTANT_MAP: Record<string, string> = {
  '$GlobalConstant.True': 'true',
  '$GlobalConstant.False': 'false',
  '$GlobalConstant.EmptyString': '""',
};
const GLOBAL_CONSTANT_PATTERN = /\$GlobalConstant\.(True|False|EmptyString)/g;

const noGlobalConstants: LintRule = {
  id: 'no-global-constants',
  severity: 'warning',
  category: 'logic',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    // Recursively search all strings in the document for $GlobalConstant references
    const seen = new Set<string>();
    function scan(val: unknown): void {
      if (typeof val === 'string') {
        for (const match of val.matchAll(GLOBAL_CONSTANT_PATTERN)) {
          const ref = match[0];
          if (seen.has(ref)) continue;
          seen.add(ref);
          const replacement = GLOBAL_CONSTANT_MAP[ref];
          results.push({
            ruleId: 'no-global-constants',
            severity: 'warning',
            category: 'logic',
            message: `"${ref}" is a Salesforce UI label, not valid Flow XML — use ${replacement} instead`,
            deduction: 5,
          });
        }
      } else if (Array.isArray(val)) {
        for (const item of val) scan(item);
      } else if (val && typeof val === 'object') {
        for (const v of Object.values(val as Record<string, unknown>)) scan(v);
      }
    }
    scan(doc);
    return results;
  },
};

const filterSourceTypeUnknown: LintRule = {
  id: 'filter-source-type-unknown',
  severity: 'warning',
  category: 'logic',
  maxDeduction: 5,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if (!('filter' in step)) continue;
      const filter = step as FilterStep;
      const itemVar = filter.itemVariable ?? `${filter.filter}_CurrentItem`;
      const hasDeclaration = Boolean(doc.variables?.[itemVar]);
      if (hasDeclaration) continue;
      const objectType = inferCollectionObjectType(doc, filter.collection);
      if (objectType) continue;
      results.push({
        ruleId: 'filter-source-type-unknown',
        severity: 'warning',
        category: 'logic',
        message: `Filter "${filter.filter}" uses collection "${filter.collection}" whose SObject type cannot be inferred. Declare itemVariable "${itemVar}" in variables: with dataType: SObject + objectType: <YourObject>, or toxml will fail.`,
        stepName: filter.filter,
        deduction: 5,
      });
    }
    return results;
  },
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const lookupFieldsBlocksDotref: LintRule = {
  id: 'lookup-fields-blocks-dotref',
  severity: 'critical',
  category: 'logic',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const offendingLookups: string[] = [];
    for (const step of doc.steps) {
      if (!('lookup' in step)) continue;
      const ls = step as LookupStep;
      if (!ls.fields || ls.fields.length === 0) continue;
      if (ls.storeOutputAutomatically === true) continue;
      offendingLookups.push(ls.lookup);
    }
    if (offendingLookups.length === 0) return [];

    const patterns = offendingLookups.map(name => ({
      name,
      regex: new RegExp(`\\b${escapeRegex(name)}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'),
    }));

    const results: LintResult[] = [];
    for (const step of doc.steps) {
      const info = getStepInfo(step);

      const seen = new Set<string>();
      function scan(val: unknown): void {
        if (typeof val === 'string') {
          for (const { name, regex } of patterns) {
            for (const m of val.matchAll(regex)) {
              const fieldName = m[1];
              const key = `${name}.${fieldName}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({
                ruleId: 'lookup-fields-blocks-dotref',
                severity: 'critical',
                category: 'logic',
                message: `Reference "${name}.${fieldName}" in "${info.name}" is unsupported because lookup "${name}" uses explicit fields (storeOutputAutomatically: false). Either set storeOutputAutomatically: true on "${name}", or add outputs: { ${fieldName}: <variable> } to "${name}" and reference the variable instead.`,
                stepName: info.name,
                deduction: 10,
              });
            }
          }
        } else if (Array.isArray(val)) {
          for (const item of val) scan(item);
        } else if (val && typeof val === 'object') {
          for (const v of Object.values(val as Record<string, unknown>)) scan(v);
        }
      }
      scan(step);
    }
    return results;
  },
};

const lookupFieldsOutputsConflict: LintRule = {
  id: 'lookup-fields-outputs-conflict',
  severity: 'critical',
  category: 'logic',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const results: LintResult[] = [];
    for (const step of doc.steps) {
      if (!('lookup' in step)) continue;
      const ls = step as LookupStep;
      if (!ls.fields || ls.fields.length === 0) continue;
      if (!ls.outputs || Object.keys(ls.outputs).length === 0) continue;
      results.push({
        ruleId: 'lookup-fields-outputs-conflict',
        severity: 'critical',
        category: 'logic',
        message: `Lookup "${ls.lookup}" has both fields: and outputs: — this emits <queriedFields> alongside <outputAssignments>, which Salesforce rejects at deploy. Use outputs: alone (drop fields:), or use fields: with storeOutputAutomatically: true or an outputReference record variable.`,
        stepName: ls.lookup,
        deduction: 10,
      });
    }
    return results;
  },
};

// Discriminant keys that carry a screen field's element name, in the order
// ScreenField's union declares them.
const SCREEN_FIELD_NAME_KEYS = [
  'input', 'password', 'dropdown', 'multiselect', 'multiselectCheckboxes',
  'radio', 'textarea', 'checkbox', 'toggle', 'display', 'component',
  'repeater', 'objectProvided',
];

function screenFieldName(field: ScreenField): string {
  const record = field as unknown as Record<string, unknown>;
  for (const key of SCREEN_FIELD_NAME_KEYS) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  const section = (field as SectionScreenField).section;
  if (section?.name) return section.name;
  return '(unnamed field)';
}

/** Visit every screen field, descending into section columns and repeaters. */
function forEachScreenField(fields: ScreenField[] | undefined, visit: (f: ScreenField) => void): void {
  for (const field of fields ?? []) {
    visit(field);
    const section = (field as SectionScreenField).section;
    if (section?.columns) {
      for (const column of section.columns) forEachScreenField(column.fields, visit);
    }
    const nested = (field as { fields?: ScreenField[] }).fields;
    if (Array.isArray(nested)) forEachScreenField(nested, visit);
  }
}

const undeclaredChoiceReference: LintRule = {
  id: 'undeclared-choice-reference',
  severity: 'critical',
  category: 'logic',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const declared = new Set([
      ...Object.keys(doc.choices ?? {}),
      ...Object.keys(doc.choiceSets ?? {}),
    ]);
    // Names that resolve to something other than a choice — a
    // defaultSelectedChoiceReference pointing at one of these is not dangling.
    const otherElements = new Set([
      ...Object.keys(doc.variables ?? {}),
      ...Object.keys(doc.formulas ?? {}),
      ...Object.keys(doc.constants ?? {}),
      ...Object.keys(doc.textTemplates ?? {}),
    ]);

    const results: LintResult[] = [];
    const seen = new Set<string>();

    for (const step of doc.steps) {
      if (!('screen' in step)) continue;
      const screen = step as ScreenStep;

      forEachScreenField(screen.fields, field => {
        const record = field as {
          choices?: unknown;
          defaultSelectedChoiceReference?: unknown;
        };
        const refs: Array<{ ref: string; source: string }> = [];

        if (Array.isArray(record.choices)) {
          for (const choice of record.choices) {
            if (typeof choice === 'string' && choice) refs.push({ ref: choice, source: 'choices' });
          }
        }
        if (typeof record.defaultSelectedChoiceReference === 'string' && record.defaultSelectedChoiceReference) {
          refs.push({
            ref: record.defaultSelectedChoiceReference,
            source: 'defaultSelectedChoiceReference',
          });
        }

        for (const { ref, source } of refs) {
          if (declared.has(ref)) continue;
          // Merge fields and dotted paths aren't choice element names
          if (/[.${}]/.test(ref)) continue;
          if (source === 'defaultSelectedChoiceReference' && otherElements.has(ref)) continue;

          const key = `${screen.screen}|${ref}`;
          if (seen.has(key)) continue;
          seen.add(key);

          results.push({
            ruleId: 'undeclared-choice-reference',
            severity: 'critical',
            category: 'logic',
            message: `Screen field "${screenFieldName(field)}" on screen "${screen.screen}" references choice "${ref}" via ${source}, but no choice or choiceSet named "${ref}" is declared — Salesforce will reject the deploy with "No element with name ${ref} found". Declare it under choices: or choiceSets:, or remove the reference.`,
            stepName: screen.screen,
            deduction: 10,
          });
        }
      });
    }
    return results;
  },
};

/**
 * Every name a bare FlowML value could have been meant to resolve to.
 * Mirrors what Salesforce accepts inside <elementReference>.
 */
function collectElementNames(doc: FlowMLDocument): Set<string> {
  const names = new Set<string>([
    ...Object.keys(doc.variables ?? {}),
    ...Object.keys(doc.formulas ?? {}),
    ...Object.keys(doc.constants ?? {}),
    ...Object.keys(doc.textTemplates ?? {}),
    ...Object.keys(doc.choices ?? {}),
    ...Object.keys(doc.choiceSets ?? {}),
  ]);
  for (const stage of doc.stages ?? []) names.add(stage.name);
  for (const step of doc.steps) {
    names.add(getStepInfo(step).name);
    if ('screen' in step) {
      forEachScreenField((step as ScreenStep).fields, field => {
        names.add(screenFieldName(field));
      });
    }
  }
  names.delete('unknown');
  names.delete('(unnamed field)');
  return names;
}

/** One `inputs:` or `fields:` map, plus the provenance maps that pin its wrapper tags. */
interface ValueMapSite {
  stepName: string;
  /** The YAML key holding the map — named in the remediation hint. */
  mapKey: 'inputs' | 'fields';
  /** The YAML key holding the wrapper-tag overrides for this map. */
  tagKey: string;
  values: Record<string, unknown>;
  xmlTags?: Record<string, string>;
  setupReferenceTypes?: Record<string, string>;
  complexValueTypes?: Record<string, string>;
  collectionElementTypes?: Record<string, string[]>;
  /** How the finding names this site, e.g. `Screen component "Order_Summary"`. */
  subject: string;
  /** What actually goes wrong at runtime. */
  consequence: (value: string) => string;
}

function collectValueMapSites(doc: FlowMLDocument): ValueMapSite[] {
  const sites: ValueMapSite[] = [];

  for (const step of doc.steps) {
    const name = getStepInfo(step).name;

    if ('action' in step) {
      const as = step as ActionStep;
      if (as.inputs) {
        sites.push({
          stepName: name,
          mapKey: 'inputs',
          tagKey: 'inputXmlTags',
          values: as.inputs,
          xmlTags: as.inputXmlTags,
          setupReferenceTypes: as.inputSetupReferenceTypes,
          complexValueTypes: as.inputComplexValueTypes,
          collectionElementTypes: as.inputCollectionElementTypes,
          subject: `Action "${name}"`,
          consequence: v => `the action receives the literal text "${v}" instead of the element's value`,
        });
      }
    } else if ('subflow' in step) {
      const ss = step as SubflowStep;
      if (ss.inputs) {
        sites.push({
          stepName: name,
          mapKey: 'inputs',
          tagKey: 'inputXmlTags',
          values: ss.inputs,
          xmlTags: ss.inputXmlTags,
          setupReferenceTypes: ss.inputSetupReferenceTypes,
          complexValueTypes: ss.inputComplexValueTypes,
          collectionElementTypes: ss.inputCollectionElementTypes,
          subject: `Subflow "${name}"`,
          consequence: v => `the subflow receives the literal text "${v}" instead of the element's value`,
        });
      }
    } else if ('wait' in step) {
      for (const event of (step as WaitStep).events ?? []) {
        if (!event.inputs) continue;
        sites.push({
          stepName: name,
          mapKey: 'inputs',
          tagKey: 'inputXmlTags',
          values: event.inputs,
          xmlTags: event.inputXmlTags,
          setupReferenceTypes: event.inputSetupReferenceTypes,
          complexValueTypes: event.inputComplexValueTypes,
          collectionElementTypes: event.inputCollectionElementTypes,
          subject: `Wait event "${event.name}" on "${name}"`,
          consequence: v => `the event receives the literal text "${v}" instead of the element's value`,
        });
      }
    } else if ('recordCreate' in step || 'recordUpdate' in step) {
      const rs = step as RecordCreateStep | RecordUpdateStep;
      if (rs.fields) {
        sites.push({
          stepName: name,
          mapKey: 'fields',
          tagKey: 'inputXmlTags',
          values: rs.fields,
          xmlTags: rs.inputXmlTags,
          setupReferenceTypes: rs.inputSetupReferenceTypes,
          complexValueTypes: rs.inputComplexValueTypes,
          subject: `Record step "${name}"`,
          consequence: v => `the field is written with the literal text "${v}" instead of the element's value`,
        });
      }
    } else if ('screen' in step) {
      const screen = step as ScreenStep;
      forEachScreenField(screen.fields, field => {
        if (!('component' in field)) return;
        const comp = field as ComponentScreenField;
        if (!comp.inputs) return;
        sites.push({
          stepName: screen.screen,
          mapKey: 'inputs',
          tagKey: 'inputXmlTags',
          values: comp.inputs,
          xmlTags: comp.inputXmlTags,
          setupReferenceTypes: comp.inputSetupReferenceTypes,
          complexValueTypes: comp.inputComplexValueTypes,
          collectionElementTypes: comp.inputCollectionElementTypes,
          subject: `Screen component "${comp.component}" on screen "${screen.screen}"`,
          consequence: v =>
            `the component receives the literal text "${v}" and never reacts to changes in "${v}"`,
        });
      });
    }
  }

  return sites;
}

/**
 * A bare value with no dot and no `$` prefix infers to <stringValue>. When that
 * value is also the name of an element in the flow, the author almost certainly
 * meant a reference — and the flow still deploys clean, so nothing else catches it.
 * For screen components this is how reactivity silently dies.
 */
const inputReferenceEmittedAsLiteral: LintRule = {
  id: 'input-reference-emitted-as-literal',
  severity: 'warning',
  category: 'logic',
  maxDeduction: 10,
  check(doc: FlowMLDocument): LintResult[] {
    const elementNames = collectElementNames(doc);
    if (elementNames.size === 0) return [];

    const results: LintResult[] = [];
    const seen = new Set<string>();

    for (const site of collectValueMapSites(doc)) {
      for (const [key, value] of Object.entries(site.values)) {
        // Any pinned wrapper tag wins over inference — nothing to warn about.
        if (site.xmlTags?.[key] !== undefined) continue;
        if (site.setupReferenceTypes?.[key] !== undefined) continue;
        if (site.complexValueTypes?.[key] !== undefined) continue;
        if (site.collectionElementTypes?.[key] !== undefined) continue;

        if (typeof value !== 'string') continue;
        // Explicit double quotes are the documented "force a literal" escape hatch.
        if (isQuotedLiteral(value)) continue;
        if (!elementNames.has(value)) continue;
        // Only bare names are at risk; dotted and $-prefixed values already infer
        // as elementReference.
        if (getXmlValueTag(inferParsedValue(value)) !== 'stringValue') continue;

        const dedupeKey = `${site.subject}|${site.mapKey}|${key}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        results.push({
          ruleId: 'input-reference-emitted-as-literal',
          severity: 'warning',
          category: 'logic',
          message: `${site.subject} sets ${site.mapKey}: { ${key}: ${value} }, and "${value}" names an element in this flow — but a bare name with no dot is emitted as <stringValue>, so ${site.consequence(value)}. The flow still deploys. Pin the reference with ${site.tagKey}: { ${key}: elementReference }, or write the value as '"${value}"' if the literal string is intended.`,
          stepName: site.stepName,
          deduction: 5,
        });
      }
    }
    return results;
  },
};

export const logicRules: LintRule[] = [
  noDmlInLoop,
  noSoqlInLoop,
  noActionInLoop,
  decisionComplexity,
  preferTransform,
  noGlobalConstants,
  filterSourceTypeUnknown,
  lookupFieldsBlocksDotref,
  lookupFieldsOutputsConflict,
  undeclaredChoiceReference,
  inputReferenceEmittedAsLiteral,
];
