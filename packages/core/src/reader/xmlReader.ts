// ============================================================
// XML Reader: Flow XML -> FlowML Document
// ============================================================

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  FlowMLDocument, FlowHeader, TriggerBlock, StartBlock,
  VariableDeclaration, FormulaDeclaration, TextTemplateDeclaration,
  ConstantDeclaration, ChoiceSetDeclaration, ChoiceDeclaration,
  FlowStep, LookupStep, DecisionStep, AssignmentStep,
  RecordCreateStep, RecordUpdateStep, RecordDeleteStep,
  LoopStep, FilterStep, TransformStep, ActionStep,
  SubflowStep, RawStep, ConditionList, ScheduledPath,
  CustomErrorStep, WaitStep, WaitEvent, RecordLockStep, RecordRollbackStep,
  ReadOptions, SortOption, FlowStage, ProcessMetadataValue,
} from '../types.js';
import { BOILERPLATE_PROCESS_METADATA } from '../mappings.js';
import {
  xmlConditionToString,
  xmlAssignmentToString,
  extractXmlValue,
  getXmlValueTag,
  inferParsedValue,
  needsXmlTagPreservation,
} from '../parsers.js';
import { buildGraph } from '../ordering/graph.js';
import { linearize } from '../ordering/linearize.js';
import { readScreenFields } from './screenReader.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ARRAY_TAGS.has(name),
  parseTagValue: false,
  trimValues: false,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: false,
});

/** Tags that should always be parsed as arrays */
const ARRAY_TAGS = new Set([
  'processMetadataValues',
  'variables',
  'formulas',
  'textTemplates',
  'constants',
  'dynamicChoiceSets',
  'recordChoiceSets',
  'choices',
  'decisions',
  'assignments',
  'recordLookups',
  'recordCreates',
  'recordUpdates',
  'recordDeletes',
  'loops',
  'collectionProcessors',
  'transforms',
  'actionCalls',
  'subflows',
  'screens',
  'rules',
  'conditions',
  'assignmentItems',
  'inputAssignments',
  'outputAssignments',
  'outputParameters',
  'inputParameters',
  'fields',
  'filters',
  'scheduledPaths',
  'queriedFields',
  'outputParameters',
  'waitEvents',
  'stages',
  'columns',
  'choiceReferences',
  'visibilityRule',
  'sortOptions',
  'customErrors',
  'customErrorMessages',
  'waits',
  'recordLocks',
  'recordRollbacks',
  'steps',
  'orchestratedStages',
  'dataTypeMappings',
]);

/**
 * Convert Salesforce Flow XML string to FlowML document object.
 */
export function readFlowXml(xmlString: string, options?: ReadOptions): FlowMLDocument {
  const parsed = xmlParser.parse(xmlString);
  const flow = parsed.Flow;
  if (!flow) throw new Error('Invalid Flow XML: no <Flow> root element');

  // --- Flow Header ---
  const header = readHeader(flow, options);

  // --- Trigger / Start ---
  let trigger: TriggerBlock | undefined;
  let start: StartBlock | undefined;
  const startEl = flow.start !== undefined && typeof flow.start === 'object'
    ? flow.start as Record<string, unknown>
    : {};

  if (flow.start !== undefined) {
    const triggerType = detectTriggerType(flow, startEl);
    if (triggerType) {
      trigger = readTrigger(flow, startEl, triggerType);
      if (!options?.compact) {
        if (startEl.locationX !== undefined) trigger.locationX = Number(str(startEl.locationX));
        if (startEl.locationY !== undefined) trigger.locationY = Number(str(startEl.locationY));
      }
    } else {
      start = { next: getConnectorTarget(startEl.connector) ?? '' };
      if (!options?.compact) {
        if (startEl.locationX !== undefined) start.locationX = Number(str(startEl.locationX));
        if (startEl.locationY !== undefined) start.locationY = Number(str(startEl.locationY));
      }
    }
  }

  // --- Declarations ---
  const variables = readVariables(ensureArray(flow.variables));
  const formulas = readFormulas(ensureArray(flow.formulas));
  const textTemplates = readTextTemplates(ensureArray(flow.textTemplates));
  const constants = readConstants(ensureArray(flow.constants));
  const choiceSets = readChoiceSets(
    ensureArray(flow.dynamicChoiceSets),
    ensureArray(flow.recordChoiceSets)
  );
  const choices = readChoices(ensureArray(flow.choices));
  const stages = readStages(ensureArray(flow.stages));
  const customProperties = readCustomProperties(flow);

  // --- Elements -> Steps ---
  const rawElements = collectElements(flow, options);
  const startName = trigger?.next ?? start?.next;
  const scheduledPathStarts = trigger?.scheduledPaths?.map(sp => sp.next).filter(Boolean) as string[] ?? [];
  const graph = buildGraph(rawElements, startName, scheduledPathStarts);
  const order = linearize(graph);

  // Build step map
  const stepMap = new Map<string, FlowStep>();
  for (const el of rawElements) {
    stepMap.set(el.name, el.step);
  }

  const steps: FlowStep[] = [];
  for (const name of order) {
    const step = stepMap.get(name);
    if (step) steps.push(step);
  }

  // Add any elements not in the order (shouldn't happen, but safety net)
  for (const el of rawElements) {
    if (!order.includes(el.name)) {
      steps.push(el.step);
    }
  }

  // --- Build document ---
  const doc: FlowMLDocument = { flow: header, steps };
  if (trigger) doc.trigger = trigger;
  if (start) doc.start = start;
  if (Object.keys(variables).length) doc.variables = variables;
  if (Object.keys(formulas).length) doc.formulas = formulas;
  if (Object.keys(textTemplates).length) doc.textTemplates = textTemplates;
  if (Object.keys(constants).length) doc.constants = constants;
  if (Object.keys(choiceSets).length) doc.choiceSets = choiceSets;
  if (Object.keys(choices).length) doc.choices = choices;
  if (stages.length) doc.stages = stages;
  if (customProperties && Object.keys(customProperties).length) doc.customProperties = customProperties;

  return doc;
}

// ============================================================
// Header
// ============================================================

/** Simple top-level Flow properties to preserve through round-trip */
const EXTRA_FLOW_PROPERTIES = [
  'areMetricsLoggedToDataCloud',
  'isOverridable',
  'isTemplate',
  'migratedFromDesignerVersion',
  'overriddenFlow',
  'sourceTemplate',
  'triggerOrder',
  'timeZoneSidKey',
  'segment',
  'migratedFromWorkflowRuleName',
  'startElementReference',
];

function readHeader(flow: Record<string, unknown>, options?: ReadOptions): FlowHeader {
  const header: FlowHeader = {
    name: str(flow.fullName) || options?.fallbackName || str(flow.label) || '',
    label: str(flow.label) || '',
    processType: str(flow.processType) || 'AutoLaunchedFlow',
    apiVersion: str(flow.apiVersion) || '65.0',
    status: str(flow.status) || 'Draft',
  };

  // Track whether original XML had a fullName element
  if (flow.fullName !== undefined) header.hasFullName = true;
  if (flow.status === undefined) header.hasStatus = false;
  if (flow.apiVersion === undefined) header.hasApiVersion = false;
  if (flow.environments === undefined) {
    header.hasEnvironments = false;
  } else {
    header.environments = str(flow.environments);
  }

  if (flow.description) header.description = str(flow.description);
  if (flow.interviewLabel) header.interviewLabel = str(flow.interviewLabel);
  if (flow.runInMode) header.runInMode = str(flow.runInMode);
  if (flow.isAdditionalPermissionRequiredToRun !== undefined) {
    header.isAdditionalPermissionRequiredToRun = flow.isAdditionalPermissionRequiredToRun === 'true' || flow.isAdditionalPermissionRequiredToRun === true;
  }

  // Preserve simple extra properties
  const extra: Record<string, string> = {};
  for (const prop of EXTRA_FLOW_PROPERTIES) {
    if (flow[prop] !== undefined) {
      extra[prop] = str(flow[prop]);
    }
  }
  if (Object.keys(extra).length) header.extraProperties = extra;

  // Process metadata
  const pmv = ensureArray(flow.processMetadataValues as unknown[]);

  if (!options?.compact) {
    // Default (full fidelity): preserve all PMV entries in original order for 1:1 round-trip.
    // Always set rawProcessMetadata (even as empty array) so the writer can distinguish
    // "default mode, no source PMVs" (skip defensive defaults) from compact mode
    // (regenerate defensive boilerplate).
    header.rawProcessMetadata = readProcessMetadataEntries(pmv);
  } else {
    // Compact mode: skip boilerplate, preserve only custom entries
    const preserved: Record<string, string> = {};
    for (const pm of pmv) {
      const p = pm as Record<string, unknown>;
      const name = str(p.name);
      if (BOILERPLATE_PROCESS_METADATA.has(name)) continue;
      const val = p.value as Record<string, unknown> | undefined;
      if (val) {
        const extracted = extractXmlValue(val);
        if (extracted) preserved[name] = String(extracted.value);
      }
    }
    if (Object.keys(preserved).length) header.processMetadata = preserved;
  }

  return header;
}

// ============================================================
// Trigger / Start Detection
// ============================================================

function detectTriggerType(flow: Record<string, unknown>, startEl: Record<string, unknown>): string | null {
  const processType = str(flow.processType);

  // Check triggerType directly first
  const triggerType = str(startEl.triggerType) || '';

  // Scheduled trigger
  if (triggerType === 'Scheduled' || processType === 'ScheduledFlow' || startEl.schedule) {
    return 'Scheduled';
  }

  // Record-triggered
  if (startEl.recordTriggerType || triggerType) {
    if (triggerType === 'RecordBeforeDelete' || str(startEl.recordTriggerType) === 'Delete') {
      return 'RecordBeforeDelete';
    }
    if (triggerType === 'RecordBeforeSave') return 'RecordBeforeSave';
    if (triggerType === 'RecordAfterSave') return 'RecordAfterSave';
    // Default for record-triggered
    return 'RecordAfterSave';
  }

  // Platform event
  if (str(startEl.object)?.endsWith('__e') || processType === 'PlatformEventTriggeredFlow') {
    return 'PlatformEvent';
  }

  if (startEl.object) {
    return 'RecordAfterSave';
  }

  return null;
}

function readTrigger(flow: Record<string, unknown>, startEl: Record<string, unknown>, triggerType: string): TriggerBlock {
  const trigger: TriggerBlock = {
    type: triggerType as TriggerBlock['type'],
    object: str(startEl.object) || '',
  };

  if (startEl.recordTriggerType) {
    trigger.recordTriggerType = str(startEl.recordTriggerType);
  }

  if (startEl.doesRequireRecordChangedToMeetCriteria === 'true' || startEl.doesRequireRecordChangedToMeetCriteria === true) {
    trigger.requiresRecordChangedToMeetCriteria = true;
  }

  // Entry conditions
  const filters = ensureArray(startEl.filters as unknown[]);
  if (filters.length) {
    trigger.entryConditions = readConditions(filters, str(startEl.filterLogic));
  }

  // Formula-based entry criteria (alternative to filters)
  if (startEl.filterFormula) {
    trigger.filterFormula = str(startEl.filterFormula);
  }

  // Schedule
  if (startEl.schedule) {
    const sched = startEl.schedule as Record<string, unknown>;
    trigger.schedule = {
      frequency: str(sched.frequency) || '',
      startDate: str(sched.startDate) || '',
      startTime: str(sched.startTime) || '',
    };
    if (sched.dayOfMonthToRun !== undefined) {
      trigger.schedule.dayOfMonthToRun = str(sched.dayOfMonthToRun);
    }
    if (sched.frequencyNumber !== undefined) {
      trigger.schedule.frequencyNumber = Number(str(sched.frequencyNumber));
    }
  }

  // Main connector
  const nextTarget = getConnectorTarget(startEl.connector);
  if (nextTarget) trigger.next = nextTarget;

  // Scheduled paths
  const scheduledPaths = ensureArray(startEl.scheduledPaths as unknown[]);
  if (scheduledPaths.length) {
    trigger.scheduledPaths = scheduledPaths.map(sp => readScheduledPath(sp as Record<string, unknown>));
  }

  return trigger;
}

function readScheduledPath(sp: Record<string, unknown>): ScheduledPath {
  const path: ScheduledPath = {
    name: str(sp.name) || '',
  };
  if (sp.label) path.label = str(sp.label);
  if (sp.pathType) path.pathType = str(sp.pathType);
  if (sp.timeSource) path.timeSource = str(sp.timeSource);
  if (sp.offsetNumber !== undefined) path.offsetNumber = Number(sp.offsetNumber);
  if (sp.offsetUnit) path.offsetUnit = str(sp.offsetUnit);
  if (sp.maxBatchSize !== undefined) path.maxBatchSize = Number(str(sp.maxBatchSize));
  const next = getConnectorTarget(sp.connector);
  if (next) path.next = next;
  if (sp.recordField) path.timeField = str(sp.recordField);
  return path;
}

// ============================================================
// Declarations
// ============================================================

function readVariables(vars: unknown[]): Record<string, VariableDeclaration> {
  const result: Record<string, VariableDeclaration> = {};
  for (const v of vars) {
    const vr = v as Record<string, unknown>;
    const name = str(vr.name);
    if (!name) continue;
    const decl: VariableDeclaration = {
      dataType: str(vr.dataType) || 'String',
    };
    if (vr.apexClass) decl.apexClass = str(vr.apexClass);
    if (vr.objectType) decl.objectType = str(vr.objectType);
    if (vr.isCollection === 'true' || vr.isCollection === true) decl.isCollection = true;
    if (vr.isInput === 'true' || vr.isInput === true) decl.isInput = true;
    if (vr.isOutput === 'true' || vr.isOutput === true) decl.isOutput = true;
    if (vr.description) decl.description = str(vr.description);
    if (vr.scale !== undefined) decl.scale = Number(str(vr.scale));
    if (vr.value !== undefined) {
      const val = vr.value as Record<string, unknown>;
      const extracted = extractXmlValue(val);
      if (extracted) {
        decl.defaultValue = extracted.value;
        if (extracted.originalString) decl.defaultValueString = extracted.originalString;
        if (
          extracted.originalXmlTag
          && extracted.originalXmlTag !== getXmlValueTag(inferParsedValue(extracted.value))
        ) {
          decl.valueXmlTag = extracted.originalXmlTag;
        }
      }
    }
    result[name] = decl;
  }
  return result;
}

function readFormulas(formulas: unknown[]): Record<string, FormulaDeclaration> {
  const result: Record<string, FormulaDeclaration> = {};
  for (const f of formulas) {
    const fr = f as Record<string, unknown>;
    const name = str(fr.name);
    if (!name) continue;
    const decl: FormulaDeclaration = {
      dataType: str(fr.dataType) || 'String',
      expression: str(fr.expression) || '',
    };
    if (fr.scale !== undefined) decl.scale = Number(str(fr.scale));
    if (fr.description) decl.description = str(fr.description);
    const processMetadataValues = readProcessMetadataEntries(
      ensureArray(fr.processMetadataValues as unknown[])
    );
    if (processMetadataValues.length) decl.processMetadataValues = processMetadataValues;
    result[name] = decl;
  }
  return result;
}

function readTextTemplates(templates: unknown[]): Record<string, TextTemplateDeclaration> {
  const result: Record<string, TextTemplateDeclaration> = {};
  for (const t of templates) {
    const tr = t as Record<string, unknown>;
    const name = str(tr.name);
    if (!name) continue;
    const decl: TextTemplateDeclaration = {
      text: str(tr.text) || '',
    };
    if (tr.isViewedAsPlainText !== undefined) {
      decl.isViewedAsPlainText = tr.isViewedAsPlainText === 'true' || tr.isViewedAsPlainText === true;
    }
    if (tr.description) decl.description = str(tr.description);
    result[name] = decl;
  }
  return result;
}

function readConstants(constants: unknown[]): Record<string, ConstantDeclaration> {
  const result: Record<string, ConstantDeclaration> = {};
  for (const c of constants) {
    const cr = c as Record<string, unknown>;
    const name = str(cr.name);
    if (!name) continue;
    const val = cr.value as Record<string, unknown> | undefined;
    const extracted = val ? extractXmlValue(val) : undefined;
    const declaration: ConstantDeclaration = {
      dataType: str(cr.dataType) || 'String',
      value: extracted?.value ?? '',
    };
    if (
      extracted?.originalXmlTag
      && extracted.originalXmlTag !== getXmlValueTag(inferParsedValue(extracted.value))
    ) {
      declaration.valueXmlTag = extracted.originalXmlTag;
    }
    result[name] = declaration;
  }
  return result;
}

function isNilElement(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>)['@_xsi:nil'] === 'true';
}

function readChoiceSets(
  dynamicChoiceSets: unknown[],
  recordChoiceSets: unknown[]
): Record<string, ChoiceSetDeclaration> {
  const result: Record<string, ChoiceSetDeclaration> = {};

  for (const d of dynamicChoiceSets) {
    const dr = d as Record<string, unknown>;
    const name = str(dr.name);
    if (!name) continue;
    // Salesforce's own classification rule (Metadata API, FlowDynamicChoiceSet):
    // picklistField/picklistObject present -> picklist choice; otherwise the
    // element is a record (or collection-backed) choice.
    const cs: ChoiceSetDeclaration = {
      type: (dr.picklistField || dr.picklistObject) ? 'dynamicPicklist' : 'recordChoice',
    };
    if (dr.collectionReference) cs.collectionReference = str(dr.collectionReference);
    if (dr.picklistObject) cs.picklistObject = str(dr.picklistObject);
    if (dr.picklistField) cs.field = str(dr.picklistField);
    if (dr.description) cs.description = str(dr.description);
    const outputAssignments = ensureArray(dr.outputAssignments as unknown[]);
    if (outputAssignments.length) {
      cs.outputAssignments = outputAssignments.map(assignment => {
        const ar = assignment as Record<string, unknown>;
        return {
          assignToReference: str(ar.assignToReference),
          field: str(ar.field),
        };
      });
    }
    if (dr.dataType) cs.dataType = str(dr.dataType);
    // Detect xsi:nil on displayField and object
    const nils: string[] = [];
    if (isNilElement(dr.displayField)) {
      nils.push('displayField');
    } else if (dr.displayField) {
      cs.displayField = str(dr.displayField);
    }
    if (isNilElement(dr.object)) {
      nils.push('object');
    } else if (dr.object) {
      cs.object = str(dr.object);
    }
    if (nils.length) cs.nilFields = nils;
    if (dr.valueField) cs.valueField = str(dr.valueField);
    if (dr.sortField) cs.sortField = str(dr.sortField);
    if (dr.sortOrder) cs.sortOrder = str(dr.sortOrder);
    if (dr.limit !== undefined) {
      if (typeof dr.limit === 'object') {
        const lv = extractXmlValue(dr.limit as Record<string, unknown>);
        if (lv) { cs.limit = Number(lv.value); cs.limitString = lv.originalString; }
      } else {
        cs.limit = Number(dr.limit);
        cs.limitString = String(dr.limit);
        cs.limitXmlTag = '__scalar__';
      }
    }
    const filters = ensureArray(dr.filters as unknown[]);
    if (filters.length) {
      cs.where = readConditions(filters, str(dr.filterLogic));
    }
    result[name] = cs;
  }

  // Salesforce never emits <recordChoiceSets> — the element does not exist in
  // the Flow metadata schema. Older FlowML versions wrote it by mistake, so
  // keep reading it here to heal that XML back into a valid record choice.
  for (const r of recordChoiceSets) {
    const rr = r as Record<string, unknown>;
    const name = str(rr.name);
    if (!name) continue;
    const cs: ChoiceSetDeclaration = {
      type: 'recordChoice',
      object: str(rr.object) || '',
    };
    if (rr.displayField) cs.displayField = str(rr.displayField);
    if (rr.valueField) cs.valueField = str(rr.valueField);
    if (rr.dataType) cs.dataType = str(rr.dataType);
    const filters = ensureArray(rr.filters as unknown[]);
    if (filters.length) {
      cs.where = readConditions(filters, str(rr.filterLogic));
    }
    if (rr.sortField) cs.sortField = str(rr.sortField);
    if (rr.sortOrder) cs.sortOrder = str(rr.sortOrder);
    if (rr.limit !== undefined) {
      if (typeof rr.limit === 'object') {
        const lv = extractXmlValue(rr.limit as Record<string, unknown>);
        if (lv) { cs.limit = Number(lv.value); cs.limitString = lv.originalString; }
      } else {
        cs.limit = Number(rr.limit);
        cs.limitString = String(rr.limit);
        cs.limitXmlTag = '__scalar__';
      }
    }
    result[name] = cs;
  }

  return result;
}

function readChoices(choices: unknown[]): Record<string, ChoiceDeclaration> {
  const result: Record<string, ChoiceDeclaration> = {};
  for (const c of choices) {
    const cr = c as Record<string, unknown>;
    const name = str(cr.name);
    if (!name) continue;
    const val = cr.value as Record<string, unknown> | undefined;
    const extracted = val ? extractXmlValue(val) : undefined;
    const declaration: ChoiceDeclaration = {
      dataType: str(cr.dataType) || 'String',
      label: str(cr.choiceText) || str(cr.label) || '',
      value: extracted?.value ?? '',
    };
    if (!val) {
      declaration.valueXmlTag = '__empty__';
    } else if (extracted?.originalXmlTag) {
      declaration.valueXmlTag = extracted.originalXmlTag;
    }
    if (extracted?.originalString !== undefined) {
      declaration.valueString = extracted.originalString;
    }
    result[name] = declaration;
  }
  return result;
}

function readStages(stages: unknown[]): FlowStage[] {
  return stages.map(stage => {
    const sr = stage as Record<string, unknown>;
    const result: FlowStage = { name: str(sr.name) };
    if (sr.label !== undefined) result.label = str(sr.label);
    if (sr.description !== undefined) result.description = str(sr.description);
    if (sr.isActive !== undefined) {
      result.isActive = sr.isActive === 'true' || sr.isActive === true;
    }
    if (sr.stageOrder !== undefined) result.stageOrder = Number(str(sr.stageOrder));
    return result;
  });
}

function readCustomProperties(flow: Record<string, unknown>): Record<string, string> | undefined {
  const customProps = ensureArray(flow.customProperties as unknown[]);
  if (!customProps.length) return undefined;
  const result: Record<string, string> = {};
  for (const cp of customProps) {
    const cpr = cp as Record<string, unknown>;
    const name = str(cpr.name);
    if (!name) continue;
    // Value may be a simple string or a wrapped value object { stringValue: '...' }
    const rawVal = cpr.value;
    if (typeof rawVal === 'object' && rawVal !== null) {
      const extracted = extractXmlValue(rawVal as Record<string, unknown>);
      result[name] = extracted ? String(extracted.value) : '';
    } else {
      result[name] = str(rawVal) || '';
    }
  }
  return Object.keys(result).length ? result : undefined;
}

// ============================================================
// Element Collection
// ============================================================

interface RawElement {
  name: string;
  elementType: string;
  step: FlowStep;
  connectorTarget?: string;
  faultTarget?: string;
  iterationNext?: string;
  afterLastNext?: string;
  ruleBranches?: string[];
  defaultBranch?: string;
}

function collectElements(flow: Record<string, unknown>, options?: ReadOptions): RawElement[] {
  const elements: RawElement[] = [];
  let xmlOrder = 0;

  function pushElement(rawEl: RawElement): void {
    (rawEl.step as any)._xmlOrder = xmlOrder++;
    elements.push(rawEl);
  }

  function readWithLocations(el: Record<string, unknown>, readFn: (el: Record<string, unknown>) => RawElement): void {
    const rawEl = readFn(el);
    if (!options?.compact) {
      if (el.locationX !== undefined) (rawEl.step as any).locationX = Number(str(el.locationX));
      if (el.locationY !== undefined) (rawEl.step as any).locationY = Number(str(el.locationY));
    }
    pushElement(rawEl);
  }

  // Record Lookups
  for (const el of ensureArray(flow.recordLookups as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordLookup);
  }

  // Decisions
  for (const el of ensureArray(flow.decisions as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readDecision);
  }

  // Assignments
  for (const el of ensureArray(flow.assignments as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readAssignment);
  }

  // Record Creates
  for (const el of ensureArray(flow.recordCreates as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordCreate);
  }

  // Record Updates
  for (const el of ensureArray(flow.recordUpdates as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordUpdate);
  }

  // Record Deletes
  for (const el of ensureArray(flow.recordDeletes as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordDelete);
  }

  // Loops
  for (const el of ensureArray(flow.loops as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readLoop);
  }

  // Collection Processors (filters and transforms)
  for (const el of ensureArray(flow.collectionProcessors as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readCollectionProcessor);
  }

  // Transforms (standalone transform elements)
  for (const el of ensureArray(flow.transforms as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readTransform);
  }

  // Action Calls
  for (const el of ensureArray(flow.actionCalls as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readActionCall);
  }

  // Subflows
  for (const el of ensureArray(flow.subflows as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readSubflow);
  }

  // Screens
  for (const el of ensureArray(flow.screens as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readScreen);
  }

  // Custom Errors
  for (const el of ensureArray(flow.customErrors as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readCustomError);
  }

  // Waits
  for (const el of ensureArray(flow.waits as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readWait);
  }

  // Record Locks
  for (const el of ensureArray(flow.recordLocks as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordLock);
  }

  // Record Rollbacks
  for (const el of ensureArray(flow.recordRollbacks as unknown[])) {
    readWithLocations(el as Record<string, unknown>, readRecordRollback);
  }

  // Unknown element types -> raw
  const knownTypes = new Set([
    'recordLookups', 'decisions', 'assignments', 'recordCreates',
    'recordUpdates', 'recordDeletes', 'loops', 'collectionProcessors',
    'transforms', 'actionCalls', 'subflows', 'screens',
    'customErrors', 'waits', 'recordLocks', 'recordRollbacks',
    'stages',
  ]);
  const skipTypes = new Set([
    'start', 'variables', 'formulas', 'textTemplates', 'constants',
    'dynamicChoiceSets', 'recordChoiceSets', 'choices', 'customProperties',
    'processMetadataValues', 'label', 'fullName', 'description', 'apiVersion',
    'processType', 'status', 'interviewLabel', 'runInMode',
    '@_xmlns', '#text', 'environments', 'migratedFromDesignerVersion',
    'isTemplate', 'isOverridable', 'isAdditionalPermissionRequiredToRun',
    'scheduledPaths', 'areMetricsLoggedToDataCloud',
    'overriddenFlow', 'sourceTemplate',
    'triggerOrder', 'timeZoneSidKey', 'segment',
    'migratedFromWorkflowRuleName', 'startElementReference',
  ]);

  for (const [key, value] of Object.entries(flow)) {
    if (knownTypes.has(key) || skipTypes.has(key)) continue;
    if (key.startsWith('@_') || key.startsWith('#')) continue;
    // Check if it looks like an element type (has name property)
    const items = ensureArray(value as unknown[]);
    for (const item of items) {
      if (typeof item === 'object' && item !== null && 'name' in (item as Record<string, unknown>)) {
        readWithLocations(item as Record<string, unknown>, (el) => readRawElement(key, el));
      }
    }
  }

  return elements;
}

// ============================================================
// Element Readers
// ============================================================

function readRecordLookup(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: LookupStep = {
    lookup: name,
    label: str(el.label) || undefined,
    object: str(el.object) || '',
  };
  if (el.getFirstRecordOnly !== undefined) {
    step.getFirst = el.getFirstRecordOnly === 'true' || el.getFirstRecordOnly === true;
  }

  // Output mode: fields, outputs, or automatic
  const queriedFields = ensureArray(el.queriedFields as unknown[]);
  if (queriedFields.length) {
    step.fields = queriedFields.map(f => str(f as string));
  }

  const outputAssignments = ensureArray(el.outputAssignments as unknown[]);
  if (outputAssignments.length) {
    step.outputs = {};
    for (const oa of outputAssignments) {
      const oar = oa as Record<string, unknown>;
      step.outputs[str(oar.field)] = str(oar.assignToReference);
    }
  }

  if (el.assignNullValuesIfNoRecordsFound !== undefined) {
    step.assignNullValuesIfNoRecordsFound = el.assignNullValuesIfNoRecordsFound === 'true' || el.assignNullValuesIfNoRecordsFound === true;
  }
  if (el.outputReference) step.outputReference = str(el.outputReference);
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }

  // Where conditions
  const filters = ensureArray(el.filters as unknown[]);
  if (filters.length) {
    step.where = readConditions(filters, str(el.filterLogic));
    step.conditionProcessMetadataValues = readConditionProcessMetadata(filters);
  }

  if (el.sortField) step.sortField = str(el.sortField);
  if (el.sortOrder) step.sortOrder = str(el.sortOrder);
  if (el.limit !== undefined) {
    if (typeof el.limit === 'object') {
      const lv = extractXmlValue(el.limit as Record<string, unknown>);
      if (lv) { step.limit = Number(lv.value); step.limitString = lv.originalString; }
    } else {
      step.limit = Number(el.limit);
      step.limitString = String(el.limit);
      step.limitXmlTag = '__scalar__';
    }
  }
  if (el.description) step.description = str(el.description);

  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'recordLookups', step, connectorTarget, faultTarget };
}

function readDecision(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const rules = ensureArray(el.rules as unknown[]);

  const ruleBranches: string[] = [];
  const mappedRules = rules.map(r => {
    const rr = r as Record<string, unknown>;
    const ruleTarget = getConnectorTarget(rr.connector);
    const ruleIsGoTo = getConnectorIsGoTo(rr.connector);
    if (ruleTarget) ruleBranches.push(ruleTarget);

    const conditions = ensureArray(rr.conditions as unknown[]);
    const conditionLogic = str(rr.conditionLogic);

    const rule: any = {
      name: str(rr.name) || '',
      label: str(rr.label) || undefined,
      conditionLogic: conditionLogic && conditionLogic !== 'and' ? conditionLogic : undefined,
      when: readConditions(conditions, conditionLogic) as ConditionList,
      next: ruleTarget || undefined,
    };
    if (ruleIsGoTo) rule.isGoTo = true;
    if (
      rr.doesRequireRecordChangedToMeetCriteria === 'true'
      || rr.doesRequireRecordChangedToMeetCriteria === true
    ) {
      rule.doesRequireRecordChangedToMeetCriteria = true;
    }
    const ruleProcessMetadata = readProcessMetadataEntries(
      ensureArray(rr.processMetadataValues as unknown[])
    );
    if (ruleProcessMetadata.length) rule.processMetadataValues = ruleProcessMetadata;
    const conditionProcessMetadata = readConditionProcessMetadata(conditions);
    if (conditionProcessMetadata) {
      rule.conditionProcessMetadataValues = conditionProcessMetadata;
    }
    return rule;
  });

  const defaultTarget = getConnectorTarget(el.defaultConnector);
  if (defaultTarget) ruleBranches.push(defaultTarget);

  const defaultIsGoTo = getConnectorIsGoTo(el.defaultConnector);
  const step: DecisionStep = {
    decision: name,
    label: str(el.label) || undefined,
    rules: mappedRules,
    default: {
      label: str(el.defaultConnectorLabel) || undefined,
      next: defaultTarget || undefined,
      isGoTo: defaultIsGoTo || undefined,
    },
  };
  if (el.description) step.description = str(el.description);
  const processMetadataValues = readProcessMetadataEntries(
    ensureArray(el.processMetadataValues as unknown[])
  );
  if (processMetadataValues.length) step.processMetadataValues = processMetadataValues;

  return {
    name,
    elementType: 'decisions',
    step,
    ruleBranches,
    defaultBranch: defaultTarget,
  };
}

function readAssignment(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);

  const items = ensureArray(el.assignmentItems as unknown[]);
  const operations = items.map(item => {
    const ir = item as Record<string, unknown>;
    return xmlAssignmentToString({
      assignToReference: str(ir.assignToReference),
      operator: str(ir.operator),
      value: ir.value as Record<string, unknown> | undefined,
    });
  });

  const step: AssignmentStep = {
    assignment: name,
    label: str(el.label) || undefined,
    operations,
  };
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'assignments', step, connectorTarget };
}

function readRecordCreate(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: RecordCreateStep = {
    recordCreate: name,
    label: str(el.label) || undefined,
  };

  if (el.inputReference) {
    step.inputReference = str(el.inputReference);
  } else if (el.object) {
    step.object = str(el.object);
    const iaResult = readInputAssignmentsAsFields(ensureArray(el.inputAssignments as unknown[]));
    step.fields = iaResult.fields;
    if (iaResult.xmlTags) step.inputXmlTags = iaResult.xmlTags;
    if (iaResult.complexValueTypes) step.inputComplexValueTypes = iaResult.complexValueTypes;
    if (iaResult.setupReferenceTypes) step.inputSetupReferenceTypes = iaResult.setupReferenceTypes;
    if (iaResult.processMetadataValues) {
      step.inputProcessMetadataValues = iaResult.processMetadataValues;
    }
  }

  if (el.assignRecordIdToReference) {
    step.assignRecordIdToReference = str(el.assignRecordIdToReference);
  }
  if (el.doesUpsert !== undefined) {
    step.doesUpsert = el.doesUpsert === 'true' || el.doesUpsert === true;
  }
  // Upsert metadata (filters for matching, operation modes)
  const rcFilters = ensureArray(el.filters as unknown[]);
  if (rcFilters.length) {
    step.upsertWhere = readConditions(rcFilters, str(el.filterLogic));
    step.conditionProcessMetadataValues = readConditionProcessMetadata(rcFilters);
  }
  if (el.operationMultMatchingRecords) step.operationMultMatchingRecords = str(el.operationMultMatchingRecords);
  if (el.operationOneMatchingRecord) step.operationOneMatchingRecord = str(el.operationOneMatchingRecord);
  if (el.operationZeroMatchingRecords) step.operationZeroMatchingRecords = str(el.operationZeroMatchingRecords);
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }
  if (el.description) step.description = str(el.description);

  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'recordCreates', step, connectorTarget, faultTarget };
}

function readRecordUpdate(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: RecordUpdateStep = {
    recordUpdate: name,
    label: str(el.label) || undefined,
  };

  if (el.inputReference) {
    step.inputReference = str(el.inputReference);
    // Filters can coexist with inputReference
    const filters = ensureArray(el.filters as unknown[]);
    if (filters.length) {
      step.where = readConditions(filters, str(el.filterLogic));
      step.conditionProcessMetadataValues = readConditionProcessMetadata(filters);
    }
    // By-reference with inline field overrides
    const inputAssignments = ensureArray(el.inputAssignments as unknown[]);
    if (inputAssignments.length) {
      const iaResult = readInputAssignmentsAsFields(inputAssignments);
      step.fields = iaResult.fields;
      if (iaResult.xmlTags) step.inputXmlTags = iaResult.xmlTags;
      if (iaResult.complexValueTypes) step.inputComplexValueTypes = iaResult.complexValueTypes;
      if (iaResult.setupReferenceTypes) step.inputSetupReferenceTypes = iaResult.setupReferenceTypes;
      if (iaResult.processMetadataValues) {
        step.inputProcessMetadataValues = iaResult.processMetadataValues;
      }
    }
  } else if (el.object) {
    step.object = str(el.object);
    const filters = ensureArray(el.filters as unknown[]);
    if (filters.length) {
      step.where = readConditions(filters, str(el.filterLogic));
      step.conditionProcessMetadataValues = readConditionProcessMetadata(filters);
    }
    const iaResult = readInputAssignmentsAsFields(ensureArray(el.inputAssignments as unknown[]));
    step.fields = iaResult.fields;
    if (iaResult.xmlTags) step.inputXmlTags = iaResult.xmlTags;
    if (iaResult.complexValueTypes) step.inputComplexValueTypes = iaResult.complexValueTypes;
    if (iaResult.setupReferenceTypes) step.inputSetupReferenceTypes = iaResult.setupReferenceTypes;
    if (iaResult.processMetadataValues) {
      step.inputProcessMetadataValues = iaResult.processMetadataValues;
    }
  }

  if (el.description) step.description = str(el.description);
  const processMetadataValues = readProcessMetadataEntries(
    ensureArray(el.processMetadataValues as unknown[])
  );
  if (processMetadataValues.length) step.processMetadataValues = processMetadataValues;
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'recordUpdates', step, connectorTarget, faultTarget };
}

function readRecordDelete(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: RecordDeleteStep = {
    recordDelete: name,
    label: str(el.label) || undefined,
  };

  if (el.inputReference) {
    step.inputReference = str(el.inputReference);
  } else if (el.object) {
    step.object = str(el.object);
    const filters = ensureArray(el.filters as unknown[]);
    if (filters.length) {
      step.where = readConditions(filters, str(el.filterLogic));
      step.conditionProcessMetadataValues = readConditionProcessMetadata(filters);
    }
  }

  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'recordDeletes', step, connectorTarget, faultTarget };
}

function readLoop(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const iterationNext = getConnectorTarget(el.nextValueConnector);
  const afterLastNext = getConnectorTarget(el.noMoreValuesConnector);

  const step: LoopStep = {
    loop: name,
    label: str(el.label) || undefined,
    collection: str(el.collectionReference) || '',
  };

  if (el.iterationOrder) step.iterationOrder = str(el.iterationOrder);
  if (el.description) step.description = str(el.description);
  if (iterationNext) step.iterationNext = iterationNext;
  if (afterLastNext) step.afterLastNext = afterLastNext;

  return { name, elementType: 'loops', step, iterationNext, afterLastNext };
}

function readCollectionProcessor(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const collectionProcessorType = str(el.collectionProcessorType);

  if (collectionProcessorType === 'FilterCollectionProcessor') {
    const filters = ensureArray(el.conditions as unknown[]);
    const step: FilterStep = {
      filter: name,
      label: str(el.label) || undefined,
      collection: str(el.collectionReference) || '',
      where: readConditions(filters, str(el.conditionLogic)),
    };
    step.conditionProcessMetadataValues = readConditionProcessMetadata(filters);
    if (el.assignNextValueToReference) step.itemVariable = str(el.assignNextValueToReference);
    if (el.elementSubtype) step.elementSubtype = str(el.elementSubtype);
    if (el.description) step.description = str(el.description);
    if (connectorTarget) step.next = connectorTarget;
    if (connectorIsGoTo) step.isGoTo = true;
    return { name, elementType: 'collectionProcessors', step, connectorTarget };
  }

  // Transform (MapCollectionProcessor, SortCollectionProcessor)
  const step: TransformStep = {
    transform: name,
    label: str(el.label) || undefined,
    outputDataType: str(el.outputSObjectType) || str((el.mapItems as any)?.[0]?.outputDataType) || '',
    transformType: collectionProcessorType === 'SortCollectionProcessor' ? 'sort' : 'map',
    expression: str(el.formula) || '',
    collection: str(el.collectionReference) || '',
  };
  if (el.isCollection === 'true' || el.isCollection === true) step.isCollection = true;
  if (el.elementSubtype) step.elementSubtype = str(el.elementSubtype);
  // sortOptions for SortCollectionProcessor
  const rawSortOptions = ensureArray(el.sortOptions as unknown[]);
  if (rawSortOptions.length) {
    step.sortOptions = rawSortOptions.map(so => {
      const s = so as Record<string, unknown>;
      return {
        doesPutEmptyStringAndNullFirst: s.doesPutEmptyStringAndNullFirst === 'true' || s.doesPutEmptyStringAndNullFirst === true,
        sortField: str(s.sortField),
        sortOrder: str(s.sortOrder),
      };
    });
  }
  if (el.limit !== undefined) {
    if (typeof el.limit === 'object') {
      const lv = extractXmlValue(el.limit as Record<string, unknown>);
      if (lv) { step.limit = Number(lv.value); step.limitString = lv.originalString; }
    } else {
      step.limit = Number(el.limit);
      step.limitString = String(el.limit);
      step.limitXmlTag = '__scalar__';
    }
  }
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'collectionProcessors', step, connectorTarget };
}

function readTransform(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);

  // Extract transform expression from transformValues
  let expression = '';
  let transformType = 'map';
  const transformValues = el.transformValues as Record<string, unknown> | undefined;
  if (transformValues) {
    const actions = ensureArray(transformValues.transformValueActions as unknown[]);
    for (const action of actions) {
      const a = action as Record<string, unknown>;
      if (a.transformType) transformType = str(a.transformType);
      if (a.value) {
        const extracted = extractXmlValue(a.value as Record<string, unknown>);
        if (extracted) expression = String(extracted.value);
      }
    }
  }

  const step: TransformStep = {
    transform: name,
    label: str(el.label) || undefined,
    outputDataType: str(el.dataType) || 'String',
    transformType,
    expression,
    collection: str(el.collectionReference) || '',
    sourceTag: 'transforms',
  };
  if (el.isCollection === 'true' || el.isCollection === true) step.isCollection = true;
  if (el.scale !== undefined) step.scale = Number(str(el.scale));
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'transforms', step, connectorTarget };
}

function readActionCall(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  // Combine actionType and actionName per PRD: apex actions become "apex:ClassName"
  const rawActionType = str(el.actionType) || '';
  const actionName = str(el.actionName) || '';
  let actionType = rawActionType;
  if (rawActionType === 'apex' && actionName) {
    actionType = `apex:${actionName}`;
  }

  const step: ActionStep = {
    action: name,
    label: str(el.label) || undefined,
    actionType,
  };
  if (
    rawActionType !== 'apex'
    && actionName
    && actionName !== (str(el.nameSegment) || rawActionType)
  ) {
    step.actionName = actionName;
  }

  const dataTypeMappings = ensureArray(el.dataTypeMappings as unknown[]);
  if (dataTypeMappings.length) {
    step.dataTypeMappings = dataTypeMappings.map(mapping => {
      const mr = mapping as Record<string, unknown>;
      return { typeName: str(mr.typeName), typeValue: str(mr.typeValue) };
    });
  }

  const inputParams = ensureArray(el.inputParameters as unknown[]);
  if (inputParams.length) {
    step.inputs = {};
    for (const ip of inputParams) {
      const ipr = ip as Record<string, unknown>;
      const paramName = str(ipr.name);
      const val = ipr.value as Record<string, unknown> | undefined;
      if (val) {
        // Read inputConfiguratorMode before extracting value
        if (val.inputConfiguratorMode) {
          if (!step.inputConfiguratorModes) step.inputConfiguratorModes = {};
          step.inputConfiguratorModes[paramName] = str(val.inputConfiguratorMode);
        }
        const extracted = extractXmlValue(val);
        if (extracted) {
          step.inputs[paramName] = extracted.value;
          if (extracted.originalString !== undefined) {
            if (!step.inputValueStrings) step.inputValueStrings = {};
            step.inputValueStrings[paramName] = extracted.originalString;
          }
          if (extracted.complexValueType) {
            if (!step.inputComplexValueTypes) step.inputComplexValueTypes = {};
            step.inputComplexValueTypes[paramName] = extracted.complexValueType;
          }
          if (extracted.setupReferenceType) {
            if (!step.inputSetupReferenceTypes) step.inputSetupReferenceTypes = {};
            step.inputSetupReferenceTypes[paramName] = extracted.setupReferenceType;
          }
          if (extracted.collectionElementTypes) {
            if (!step.inputCollectionElementTypes) step.inputCollectionElementTypes = {};
            step.inputCollectionElementTypes[paramName] = extracted.collectionElementTypes;
          }
          // Preserve xml tag when inferParsedValue would give wrong result
          if (needsXmlTagPreservation(extracted)) {
            if (!step.inputXmlTags) step.inputXmlTags = {};
            step.inputXmlTags[paramName] = extracted.originalXmlTag!;
          }
        }
      } else {
        // Distinguish an explicit empty <value/> from an omitted value.
        if (!step.inputs) step.inputs = {};
        step.inputs[paramName] = null;
        if (ipr.value !== undefined) {
          if (!step.inputXmlTags) step.inputXmlTags = {};
          step.inputXmlTags[paramName] = '__empty__';
        }
      }
    }
  }

  const outputParams = ensureArray(el.outputParameters as unknown[]);
  if (outputParams.length) {
    step.outputs = {};
    for (const op of outputParams) {
      const opr = op as Record<string, unknown>;
      step.outputs[str(opr.name)] = str(opr.assignToReference);
    }
  }

  if (el.nameSegment) step.nameSegment = str(el.nameSegment);
  if (el.offset !== undefined) step.offset = Number(el.offset);
  if (el.flowTransactionModel) step.flowTransactionModel = str(el.flowTransactionModel);
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }
  if (el.versionString) step.versionString = str(el.versionString);
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'actionCalls', step, connectorTarget, faultTarget };
}

function readSubflow(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: SubflowStep = {
    subflow: name,
    label: str(el.label) || undefined,
    flowName: str(el.flowName) || '',
  };

  const inputAssignments = ensureArray(el.inputAssignments as unknown[]);
  if (inputAssignments.length) {
    step.inputs = {};
    for (const ia of inputAssignments) {
      const iar = ia as Record<string, unknown>;
      const paramName = str(iar.name);
      const val = iar.value as Record<string, unknown> | undefined;
      if (val) {
        const extracted = extractXmlValue(val);
        if (extracted) {
          step.inputs[paramName] = extracted.value;
          if (extracted.complexValueType) {
            if (!step.inputComplexValueTypes) step.inputComplexValueTypes = {};
            step.inputComplexValueTypes[paramName] = extracted.complexValueType;
          }
          if (extracted.setupReferenceType) {
            if (!step.inputSetupReferenceTypes) step.inputSetupReferenceTypes = {};
            step.inputSetupReferenceTypes[paramName] = extracted.setupReferenceType;
          }
          if (extracted.collectionElementTypes) {
            if (!step.inputCollectionElementTypes) step.inputCollectionElementTypes = {};
            step.inputCollectionElementTypes[paramName] = extracted.collectionElementTypes;
          }
          // Preserve xml tag when inferParsedValue would give wrong result
          if (needsXmlTagPreservation(extracted)) {
            if (!step.inputXmlTags) step.inputXmlTags = {};
            step.inputXmlTags[paramName] = extracted.originalXmlTag!;
          }
        }
      } else {
        // Null-clear: input with no value
        step.inputs[paramName] = null;
      }
    }
  }

  const outputAssignments = ensureArray(el.outputAssignments as unknown[]);
  if (outputAssignments.length) {
    step.outputs = {};
    for (const oa of outputAssignments) {
      const oar = oa as Record<string, unknown>;
      step.outputs[str(oar.name)] = str(oar.assignToReference);
    }
  }

  if (el.flowTransactionModel) step.flowTransactionModel = str(el.flowTransactionModel);
  if (el.storeOutputAutomatically !== undefined) {
    step.storeOutputAutomatically = el.storeOutputAutomatically === 'true' || el.storeOutputAutomatically === true;
  }
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'subflows', step, connectorTarget, faultTarget };
}

function readScreen(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);

  const screenFields = ensureArray(el.fields as unknown[]);
  const step: any = {
    screen: name,
    label: str(el.label) || undefined,
    fields: readScreenFields(screenFields),
  };

  if (el.allowBack !== undefined) step.allowBack = el.allowBack === 'true' || el.allowBack === true;
  if (el.allowFinish !== undefined) step.allowFinish = el.allowFinish === 'true' || el.allowFinish === true;
  if (el.allowPause !== undefined) step.allowPause = el.allowPause === 'true' || el.allowPause === true;
  if (el.showFooter !== undefined) step.showFooter = el.showFooter === 'true' || el.showFooter === true;
  if (el.showHeader !== undefined) step.showHeader = el.showHeader === 'true' || el.showHeader === true;
  if (el.description) step.description = str(el.description);
  if (el.backButtonLabel) step.backButtonLabel = str(el.backButtonLabel);
  if (el.helpText) step.helpText = str(el.helpText);
  if (el.nextOrFinishButtonLabel) step.nextOrFinishButtonLabel = str(el.nextOrFinishButtonLabel);
  if (el.pausedText) step.pausedText = str(el.pausedText);
  if (el.stageReference) {
    if (typeof el.stageReference === 'object') {
      const extracted = extractXmlValue(el.stageReference as Record<string, unknown>);
      if (extracted) {
        step.stageReference = String(extracted.value);
        step.stageReferenceXmlTag = extracted.originalXmlTag;
      }
    } else {
      step.stageReference = str(el.stageReference);
    }
  }
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'screens', step, connectorTarget };
}

function serializeRawElementXml(el: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(el)) {
    if (key === 'connector' || key === 'faultConnector') continue;
    filtered[key] = value;
  }
  const xml = xmlBuilder.build({ _wrapper: filtered });
  // Strip the wrapper tags added by XMLBuilder
  const inner = typeof xml === 'string'
    ? xml.replace(/^\s*<_wrapper>\n?/, '').replace(/<\/_wrapper>\s*$/, '').trim()
    : '';
  return inner;
}

function readRawElement(elementType: string, el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: RawStep = {
    raw: name,
    elementType,
    xml: serializeRawElementXml(el),
  };
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType, step, connectorTarget, faultTarget };
}

// ============================================================
// Condition Reading
// ============================================================

function readConditions(filters: unknown[], filterLogic?: string): ConditionList {
  if (!filters.length) return [];

  const conditions = filters.map(f => {
    const fr = f as Record<string, unknown>;
    return xmlConditionToString({
      leftValueReference: str(fr.leftValueReference) || str(fr.field),
      operator: str(fr.operator) || 'EqualTo',
      rightValue: fr.rightValue as Record<string, unknown> | undefined
        ?? (fr.value !== undefined ? fr.value as Record<string, unknown> : undefined),
    });
  });

  // Simple AND logic or no logic -> simple list
  if (!filterLogic || filterLogic === 'and' || filterLogic === 'AND') {
    return conditions;
  }

  // OR logic — preserve as ComplexCondition so the writer emits 'or'
  if (filterLogic === 'or' || filterLogic === 'OR') {
    const numbered: Record<string, string> = {};
    for (let i = 0; i < conditions.length; i++) {
      numbered[String(i + 1)] = conditions[i];
    }
    return { logic: 'or', conditions: numbered };
  }

  // Complex numbered logic
  const numbered: Record<string, string> = {};
  for (let i = 0; i < conditions.length; i++) {
    numbered[String(i + 1)] = conditions[i];
  }
  return { logic: filterLogic, conditions: numbered };
}

function readConditionProcessMetadata(
  filters: unknown[]
): ProcessMetadataValue[][] | undefined {
  const metadata = filters.map(filter => readProcessMetadataEntries(
    ensureArray((filter as Record<string, unknown>).processMetadataValues as unknown[])
  ));
  return metadata.some(entries => entries.length > 0) ? metadata : undefined;
}

// ============================================================
// Input Assignments -> Fields
// ============================================================

function readInputAssignmentsAsFields(assignments: unknown[]): {
  fields: Record<string, unknown>;
  xmlTags?: Record<string, string>;
  complexValueTypes?: Record<string, string>;
  setupReferenceTypes?: Record<string, string>;
  processMetadataValues?: Record<string, ProcessMetadataValue[]>;
} {
  const fields: Record<string, unknown> = {};
  let xmlTags: Record<string, string> | undefined;
  let complexValueTypes: Record<string, string> | undefined;
  let setupReferenceTypes: Record<string, string> | undefined;
  let processMetadataValues: Record<string, ProcessMetadataValue[]> | undefined;
  for (const a of assignments) {
    const ar = a as Record<string, unknown>;
    const fieldName = str(ar.field);
    const metadata = readProcessMetadataEntries(
      ensureArray(ar.processMetadataValues as unknown[])
    );
    if (metadata.length) {
      if (!processMetadataValues) processMetadataValues = {};
      processMetadataValues[fieldName] = metadata;
    }
    const val = ar.value as Record<string, unknown> | undefined;
    if (val) {
      const extracted = extractXmlValue(val);
      if (extracted) {
        fields[fieldName] = extracted.value;
        if (extracted.complexValueType) {
          if (!complexValueTypes) complexValueTypes = {};
          complexValueTypes[fieldName] = extracted.complexValueType;
        }
        if (extracted.setupReferenceType) {
          if (!setupReferenceTypes) setupReferenceTypes = {};
          setupReferenceTypes[fieldName] = extracted.setupReferenceType;
        }
        if (extracted.collectionElementTypes) {
          // Record assignment collection values use the same XML-tag map to
          // retain their wrapper; element types are not currently a legal
          // record-assignment shape.
          if (!xmlTags) xmlTags = {};
          xmlTags[fieldName] = 'collectionElements';
        }
        // Preserve xml tag when inferParsedValue would give wrong result
        if (needsXmlTagPreservation(extracted)) {
          if (!xmlTags) xmlTags = {};
          xmlTags[fieldName] = extracted.originalXmlTag!;
        }
      }
    } else {
      // Null-clear: field with no value
      fields[fieldName] = null;
    }
  }
  return { fields, xmlTags, complexValueTypes, setupReferenceTypes, processMetadataValues };
}

// ============================================================
// New Element Readers
// ============================================================

function readCustomError(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);

  const step: CustomErrorStep = {
    customError: name,
    label: str(el.label) || undefined,
  };

  const msgs = ensureArray(el.customErrorMessages as unknown[]);
  if (msgs.length) {
    step.messages = msgs.map(m => {
      const mr = m as Record<string, unknown>;
      const msg: any = {
        errorMessage: str(mr.errorMessage) || '',
        isFieldError: mr.isFieldError === 'true' || mr.isFieldError === true,
      };
      if (mr.fieldSelection) msg.fieldSelection = str(mr.fieldSelection);
      return msg;
    });
  }

  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'customErrors', step, connectorTarget };
}

function readWait(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.defaultConnector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: WaitStep = {
    wait: name,
    label: str(el.label) || undefined,
    events: [],
  };

  if (connectorTarget) step.defaultNext = connectorTarget;
  if (el.defaultConnectorLabel) step.defaultLabel = str(el.defaultConnectorLabel);

  const waitEvents = ensureArray(el.waitEvents as unknown[]);
  for (const we of waitEvents) {
    const wer = we as Record<string, unknown>;
    const event: WaitEvent = {
      name: str(wer.name) || '',
      eventType: str(wer.eventType) || '',
    };
    if (wer.label) event.label = str(wer.label);
    if (wer.conditionLogic) event.conditionLogic = str(wer.conditionLogic);
    const conditions = ensureArray(wer.conditions as unknown[]);
    if (conditions.length) {
      event.conditions = readConditions(conditions, str(wer.conditionLogic));
    }
    const eventInputs = ensureArray(wer.inputParameters as unknown[]);
    if (eventInputs.length) {
      event.inputs = {};
      for (const ip of eventInputs) {
        const ipr = ip as Record<string, unknown>;
        const paramName = str(ipr.name);
        const val = ipr.value as Record<string, unknown> | undefined;
        if (val) {
          const extracted = extractXmlValue(val);
          if (extracted) {
            event.inputs[paramName] = extracted.value;
            if (extracted.originalXmlTag) {
              if (!event.inputXmlTags) event.inputXmlTags = {};
              event.inputXmlTags[paramName] = extracted.originalXmlTag;
            }
            if (extracted.complexValueType) {
              if (!event.inputComplexValueTypes) event.inputComplexValueTypes = {};
              event.inputComplexValueTypes[paramName] = extracted.complexValueType;
            }
            if (extracted.setupReferenceType) {
              if (!event.inputSetupReferenceTypes) event.inputSetupReferenceTypes = {};
              event.inputSetupReferenceTypes[paramName] = extracted.setupReferenceType;
            }
          }
        }
      }
    }
    const eventOutputs = ensureArray(wer.outputParameters as unknown[]);
    if (eventOutputs.length) {
      event.outputs = {};
      for (const op of eventOutputs) {
        const opr = op as Record<string, unknown>;
        event.outputs[str(opr.name)] = str(opr.assignToReference);
      }
    }
    const eventNext = getConnectorTarget(wer.connector);
    if (eventNext) event.next = eventNext;
    step.events.push(event);
  }

  if (el.description) step.description = str(el.description);
  if (faultTarget) step.faultNext = faultTarget;

  return { name, elementType: 'waits', step, connectorTarget, faultTarget };
}

function readRecordLock(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);
  const faultTarget = getConnectorTarget(el.faultConnector);

  const step: RecordLockStep = {
    recordLock: name,
    label: str(el.label) || undefined,
  };

  if (el.inputReference) step.inputReference = str(el.inputReference);
  if (el.lockOrUnlock) step.lockOrUnlock = str(el.lockOrUnlock);
  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;
  if (faultTarget) step.faultNext = faultTarget;
  const faultIsGoTo = getConnectorIsGoTo(el.faultConnector);
  if (faultIsGoTo) step.faultIsGoTo = true;

  return { name, elementType: 'recordLocks', step, connectorTarget, faultTarget };
}

function readRecordRollback(el: Record<string, unknown>): RawElement {
  const name = str(el.name);
  const connectorTarget = getConnectorTarget(el.connector);
  const connectorIsGoTo = getConnectorIsGoTo(el.connector);

  const step: RecordRollbackStep = {
    recordRollback: name,
    label: str(el.label) || undefined,
  };

  if (el.description) step.description = str(el.description);
  if (connectorTarget) step.next = connectorTarget;
  if (connectorIsGoTo) step.isGoTo = true;

  return { name, elementType: 'recordRollbacks', step, connectorTarget };
}

// ============================================================
// Utilities
// ============================================================

function readProcessMetadataEntries(entries: unknown[]): ProcessMetadataValue[] {
  return entries.map(entry => {
    const er = entry as Record<string, unknown>;
    const value = er.value as Record<string, unknown> | undefined;
    const extracted = value ? extractXmlValue(value) : undefined;
    const result: ProcessMetadataValue = {
      name: str(er.name),
      value: extracted?.originalString ?? String(extracted?.value ?? ''),
    };
    if (extracted?.originalXmlTag) {
      result.xmlTag = extracted.originalXmlTag;
    } else {
      result.xmlTag = '__empty__';
    }
    return result;
  });
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (obj['@_xsi:nil'] === 'true') return '';
    const contentKeys = Object.keys(obj).filter(key => !key.startsWith('@_'));
    if (contentKeys.length === 1 && contentKeys[0] === '#text') {
      return String(obj['#text']);
    }
    return '';
  }
  return String(v);
}

function ensureArray(v: unknown): unknown[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function getConnectorTarget(connector: unknown): string | undefined {
  if (!connector) return undefined;
  const c = connector as Record<string, unknown>;
  if (c.targetReference) return str(c.targetReference);
  return undefined;
}

function getConnectorIsGoTo(connector: unknown): boolean | undefined {
  if (!connector) return undefined;
  const c = connector as Record<string, unknown>;
  if (c.isGoTo === 'true' || c.isGoTo === true) return true;
  return undefined;
}
