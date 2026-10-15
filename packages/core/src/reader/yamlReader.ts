// ============================================================
// YAML Reader: FlowML YAML String -> FlowML Document Object
// ============================================================

import yaml from 'js-yaml';
import Ajv from 'ajv';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  FlowMLDocument, FlowHeader, TriggerBlock, StartBlock,
  VariableDeclaration, FormulaDeclaration, TextTemplateDeclaration,
  ConstantDeclaration, ChoiceSetDeclaration, ChoiceDeclaration,
  FlowStep, LookupStep, DecisionStep, AssignmentStep,
  RecordCreateStep, RecordUpdateStep, RecordDeleteStep,
  LoopStep, FilterStep, TransformStep, ActionStep,
  SubflowStep, ScreenStep, RawStep, ConditionList,
  CustomErrorStep, WaitStep, WaitEvent, RecordLockStep, RecordRollbackStep,
  ScheduledPath, DecisionRule, DecisionDefault,
  ScreenField, SectionScreenField,
  FlowStage, ProcessMetadataValue,
} from '../types.js';
import {
  choiceSetTypeError, isValidChoiceSetType,
  choiceSetMissingObject, choiceSetMissingObjectError,
} from '../mappings.js';

// Load JSON Schema — resolve from both src and dist locations
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the path to the bundled flowml-schema.json */
export function getSchemaPath(): string {
  const candidate1 = resolve(__dirname, '../schema/flowml-schema.json');
  if (existsSync(candidate1)) return candidate1;
  const candidate2 = resolve(__dirname, '../../src/schema/flowml-schema.json');
  if (existsSync(candidate2)) return candidate2;
  return candidate1;
}

const schemaPath = getSchemaPath();

let _ajvValidate: ReturnType<Ajv['compile']> | null = null;

function getValidator(): ReturnType<Ajv['compile']> {
  if (!_ajvValidate) {
    const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    _ajvValidate = ajv.compile(schemaJson);
  }
  return _ajvValidate;
}

export interface YamlReaderOptions {
  validate?: boolean; // default true
}

/**
 * Parse a FlowML YAML string into a FlowMLDocument.
 */
export function readYaml(yamlString: string, options: YamlReaderOptions = {}): FlowMLDocument {
  const { validate = true } = options;

  const raw = yaml.load(yamlString) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid FlowML YAML: could not parse document');
  }

  // Choice set types are checked ahead of the schema so the caller gets the
  // "did you mean" hint rather than a bare enum-mismatch from ajv.
  assertChoiceSetTypes(raw.choiceSets);

  // Schema validation
  if (validate) {
    const valid = getValidator();
    if (!valid(raw)) {
      const errors = valid.errors?.map(e => {
        const allowed = (e.params as { allowedValues?: unknown[] } | undefined)?.allowedValues;
        const suffix = Array.isArray(allowed) ? ` (${allowed.join(', ')})` : '';
        return `${e.instancePath} ${e.message}${suffix}`;
      }).join('; ');
      throw new Error(`FlowML schema validation failed: ${errors}`);
    }
  }

  // Parse sections
  const flow = readHeader(raw.flow as Record<string, unknown>);
  const trigger = raw.trigger ? readTrigger(raw.trigger as Record<string, unknown>) : undefined;
  const start = raw.start ? readStart(raw.start as Record<string, unknown>) : undefined;
  const stages = raw.stages ? readStages(raw.stages as Record<string, unknown>[]) : undefined;
  const variables = raw.variables ? readVariables(raw.variables as Record<string, Record<string, unknown>>) : undefined;
  const formulas = raw.formulas ? readFormulas(raw.formulas as Record<string, Record<string, unknown>>) : undefined;
  const textTemplates = raw.textTemplates ? readTextTemplates(raw.textTemplates as Record<string, Record<string, unknown>>) : undefined;
  const constants = raw.constants ? readConstants(raw.constants as Record<string, Record<string, unknown>>) : undefined;
  const choiceSets = raw.choiceSets ? readChoiceSets(raw.choiceSets as Record<string, Record<string, unknown>>) : undefined;
  const choices = raw.choices ? readChoices(raw.choices as Record<string, Record<string, unknown>>) : undefined;
  const customProperties = raw.customProperties as Record<string, string> | undefined;
  const steps = readSteps(raw.steps as unknown[]);

  const doc: FlowMLDocument = { flow, steps };
  if (trigger) doc.trigger = trigger;
  if (start) doc.start = start;
  if (stages?.length) doc.stages = stages;
  if (variables && Object.keys(variables).length) doc.variables = variables;
  if (formulas && Object.keys(formulas).length) doc.formulas = formulas;
  if (textTemplates && Object.keys(textTemplates).length) doc.textTemplates = textTemplates;
  if (constants && Object.keys(constants).length) doc.constants = constants;
  if (choiceSets && Object.keys(choiceSets).length) doc.choiceSets = choiceSets;
  if (choices && Object.keys(choices).length) doc.choices = choices;
  if (customProperties && Object.keys(customProperties).length) doc.customProperties = customProperties;

  return doc;
}

// ============================================================
// Header
// ============================================================

function readHeader(raw: Record<string, unknown>): FlowHeader {
  const header: FlowHeader = {
    name: String(raw.name || ''),
    label: String(raw.label || ''),
    processType: String(raw.processType || 'AutoLaunchedFlow'),
    apiVersion: String(raw.apiVersion || '65.0'),
    status: String(raw.status || 'Draft'),
  };
  if (raw.description) header.description = String(raw.description);
  if (raw.interviewLabel) header.interviewLabel = String(raw.interviewLabel);
  if (raw.runInMode) header.runInMode = String(raw.runInMode);
  if (raw.processMetadata) header.processMetadata = raw.processMetadata as Record<string, string>;
  if (raw.rawProcessMetadata) {
    header.rawProcessMetadata = raw.rawProcessMetadata as Array<{
      name: string;
      value: string;
      xmlTag?: string;
    }>;
  }
  if (raw.hasFullName !== undefined) header.hasFullName = Boolean(raw.hasFullName);
  if (raw.hasStatus !== undefined) header.hasStatus = Boolean(raw.hasStatus);
  if (raw.hasApiVersion !== undefined) header.hasApiVersion = Boolean(raw.hasApiVersion);
  if (raw.hasEnvironments !== undefined) {
    header.hasEnvironments = Boolean(raw.hasEnvironments);
  }
  if (raw.environments !== undefined) header.environments = String(raw.environments);
  if (raw.isAdditionalPermissionRequiredToRun !== undefined) header.isAdditionalPermissionRequiredToRun = raw.isAdditionalPermissionRequiredToRun === true;
  if (raw.extraProperties) header.extraProperties = raw.extraProperties as Record<string, string>;
  return header;
}

// ============================================================
// Trigger / Start
// ============================================================

function readTrigger(raw: Record<string, unknown>): TriggerBlock {
  const trigger: TriggerBlock = {
    type: raw.type as TriggerBlock['type'],
    object: String(raw.object || ''),
  };
  if (raw.recordTriggerType) trigger.recordTriggerType = String(raw.recordTriggerType);
  if (raw.requiresRecordChangedToMeetCriteria === true) trigger.requiresRecordChangedToMeetCriteria = true;
  if (raw.entryConditions) trigger.entryConditions = readConditionList(raw.entryConditions);
  if (raw.filterFormula) trigger.filterFormula = String(raw.filterFormula);
  if (raw.schedule) {
    const s = raw.schedule as Record<string, unknown>;
    trigger.schedule = {
      frequency: String(s.frequency || ''),
      startDate: String(s.startDate || ''),
      startTime: String(s.startTime || ''),
    };
    if (s.dayOfMonthToRun !== undefined) {
      trigger.schedule.dayOfMonthToRun = String(s.dayOfMonthToRun);
    }
    if (s.frequencyNumber !== undefined) {
      trigger.schedule.frequencyNumber = Number(s.frequencyNumber);
    }
  }
  if (raw.next) trigger.next = String(raw.next);
  if (raw.locationX !== undefined) trigger.locationX = Number(raw.locationX);
  if (raw.locationY !== undefined) trigger.locationY = Number(raw.locationY);
  if (raw.scheduledPaths) {
    trigger.scheduledPaths = (raw.scheduledPaths as Record<string, unknown>[]).map(sp => {
      const path: ScheduledPath = { name: String(sp.name || '') };
      if (sp.label) path.label = String(sp.label);
      if (sp.pathType) path.pathType = String(sp.pathType);
      if (sp.timeSource) path.timeSource = String(sp.timeSource);
      if (sp.timeField) path.timeField = String(sp.timeField);
      if (sp.offsetNumber !== undefined) path.offsetNumber = Number(sp.offsetNumber);
      if (sp.offsetUnit) path.offsetUnit = String(sp.offsetUnit);
      if (sp.maxBatchSize !== undefined) path.maxBatchSize = Number(sp.maxBatchSize);
      if (sp.next) path.next = String(sp.next);
      return path;
    });
  }
  return trigger;
}

function readStart(raw: Record<string, unknown>): StartBlock {
  const start: StartBlock = { next: String(raw.next || '') };
  if (raw.locationX !== undefined) start.locationX = Number(raw.locationX);
  if (raw.locationY !== undefined) start.locationY = Number(raw.locationY);
  return start;
}

function readStages(raw: Record<string, unknown>[]): FlowStage[] {
  return raw.map(stage => {
    const result: FlowStage = { name: String(stage.name || '') };
    if (stage.label !== undefined) result.label = String(stage.label);
    if (stage.description !== undefined) result.description = String(stage.description);
    if (stage.isActive !== undefined) result.isActive = stage.isActive === true;
    if (stage.stageOrder !== undefined) result.stageOrder = Number(stage.stageOrder);
    return result;
  });
}

// ============================================================
// Declarations
// ============================================================

function readVariables(raw: Record<string, Record<string, unknown>>): Record<string, VariableDeclaration> {
  const result: Record<string, VariableDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    const decl: VariableDeclaration = {
      dataType: String(v.dataType || 'String'),
    };
    if (v.apexClass) decl.apexClass = String(v.apexClass);
    if (v.objectType) decl.objectType = String(v.objectType);
    if (v.isCollection === true) decl.isCollection = true;
    if (v.isInput === true) decl.isInput = true;
    if (v.isOutput === true) decl.isOutput = true;
    if (v.defaultValue !== undefined) decl.defaultValue = v.defaultValue;
    if (v.defaultValueString) decl.defaultValueString = String(v.defaultValueString);
    if (v.valueXmlTag) decl.valueXmlTag = String(v.valueXmlTag);
    if (v.description) decl.description = String(v.description);
    if (v.scale !== undefined) decl.scale = Number(v.scale);
    result[name] = decl;
  }
  return result;
}

function readFormulas(raw: Record<string, Record<string, unknown>>): Record<string, FormulaDeclaration> {
  const result: Record<string, FormulaDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    const decl: FormulaDeclaration = {
      dataType: String(v.dataType || 'String'),
      expression: String(v.expression || ''),
    };
    if (v.scale !== undefined) decl.scale = Number(v.scale);
    if (v.description) decl.description = String(v.description);
    if (v.processMetadataValues) {
      decl.processMetadataValues = v.processMetadataValues as ProcessMetadataValue[];
    }
    result[name] = decl;
  }
  return result;
}

function readTextTemplates(raw: Record<string, Record<string, unknown>>): Record<string, TextTemplateDeclaration> {
  const result: Record<string, TextTemplateDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    const decl: TextTemplateDeclaration = { text: String(v.text || '') };
    if (v.isViewedAsPlainText !== undefined) decl.isViewedAsPlainText = v.isViewedAsPlainText === true;
    if (v.description) decl.description = String(v.description);
    result[name] = decl;
  }
  return result;
}

function readConstants(raw: Record<string, Record<string, unknown>>): Record<string, ConstantDeclaration> {
  const result: Record<string, ConstantDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    const declaration: ConstantDeclaration = {
      dataType: String(v.dataType || 'String'),
      value: v.value,
    };
    if (v.valueXmlTag) declaration.valueXmlTag = String(v.valueXmlTag);
    result[name] = declaration;
  }
  return result;
}

/**
 * Reject any choiceSet whose `type` is not a FlowML discriminator. Without this
 * an unrecognized type (e.g. the Salesforce term "recordChoiceSet") matches
 * neither XML writer branch and the whole choice set disappears silently.
 */
function assertChoiceSetTypes(rawChoiceSets: unknown): void {
  if (!rawChoiceSets || typeof rawChoiceSets !== 'object' || Array.isArray(rawChoiceSets)) return;
  for (const [name, v] of Object.entries(rawChoiceSets as Record<string, unknown>)) {
    const type = (v && typeof v === 'object') ? (v as Record<string, unknown>).type : undefined;
    if (!isValidChoiceSetType(type)) {
      throw new Error(choiceSetTypeError(name, type));
    }
  }
}

function readChoiceSets(raw: Record<string, Record<string, unknown>>): Record<string, ChoiceSetDeclaration> {
  const result: Record<string, ChoiceSetDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    if (!isValidChoiceSetType(v.type)) {
      throw new Error(choiceSetTypeError(name, v.type));
    }
    const cs: ChoiceSetDeclaration = {
      type: v.type as 'dynamicPicklist' | 'recordChoice',
    };
    if (v.object) cs.object = String(v.object);
    if (v.picklistObject) cs.picklistObject = String(v.picklistObject);
    if (v.collectionReference) cs.collectionReference = String(v.collectionReference);
    if (v.description) cs.description = String(v.description);
    if (v.outputAssignments) {
      cs.outputAssignments = (v.outputAssignments as Record<string, unknown>[]).map(assignment => ({
        assignToReference: String(assignment.assignToReference || ''),
        field: String(assignment.field || ''),
      }));
    }
    if (v.field) cs.field = String(v.field);
    if (v.displayField) cs.displayField = String(v.displayField);
    if (v.valueField) cs.valueField = String(v.valueField);
    if (v.dataType) cs.dataType = String(v.dataType);
    if (v.where) cs.where = readConditionList(v.where);
    if (v.sortField) cs.sortField = String(v.sortField);
    if (v.sortOrder) cs.sortOrder = String(v.sortOrder);
    if (v.limit) cs.limit = Number(v.limit);
    if (v.limitString) cs.limitString = String(v.limitString);
    if (v.limitXmlTag) cs.limitXmlTag = String(v.limitXmlTag);
    if (v.nilFields) cs.nilFields = (v.nilFields as unknown[]).map(String);
    if (choiceSetMissingObject(cs)) {
      throw new Error(choiceSetMissingObjectError(name));
    }
    result[name] = cs;
  }
  return result;
}

function readChoices(raw: Record<string, Record<string, unknown>>): Record<string, ChoiceDeclaration> {
  const result: Record<string, ChoiceDeclaration> = {};
  for (const [name, v] of Object.entries(raw)) {
    const declaration: ChoiceDeclaration = {
      dataType: String(v.dataType || 'String'),
      label: String(v.label || ''),
      value: v.value,
    };
    if (v.valueXmlTag) declaration.valueXmlTag = String(v.valueXmlTag);
    if (v.valueString !== undefined) declaration.valueString = String(v.valueString);
    result[name] = declaration;
  }
  return result;
}

// ============================================================
// Condition List
// ============================================================

function readConditionList(raw: unknown): ConditionList {
  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.logic && obj.conditions) {
      const conditions: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj.conditions as Record<string, unknown>)) {
        conditions[k] = String(v);
      }
      return { logic: String(obj.logic), conditions };
    }
  }
  return [];
}

// ============================================================
// Steps
// ============================================================

function readSteps(raw: unknown[]): FlowStep[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(readStep);
}

function readStep(raw: unknown): FlowStep {
  const s = raw as Record<string, unknown>;
  let step: FlowStep;

  if ('lookup' in s) step = readLookupStep(s);
  else if ('decision' in s) step = readDecisionStep(s);
  else if ('assignment' in s) step = readAssignmentStep(s);
  else if ('recordCreate' in s) step = readRecordCreateStep(s);
  else if ('recordUpdate' in s) step = readRecordUpdateStep(s);
  else if ('recordDelete' in s) step = readRecordDeleteStep(s);
  else if ('loop' in s) step = readLoopStep(s);
  else if ('filter' in s) step = readFilterStep(s);
  else if ('transform' in s) step = readTransformStep(s);
  else if ('action' in s) step = readActionStep(s);
  else if ('subflow' in s) step = readSubflowStep(s);
  else if ('screen' in s) step = readScreenStep(s);
  else if ('customError' in s) step = readCustomErrorStep(s);
  else if ('wait' in s) step = readWaitStep(s);
  else if ('recordLock' in s) step = readRecordLockStep(s);
  else if ('recordRollback' in s) step = readRecordRollbackStep(s);
  else if ('raw' in s) step = readRawStep(s);
  else throw new Error(`Unknown step type: ${JSON.stringify(Object.keys(s))}`);

  if (s._xmlOrder !== undefined) (step as any)._xmlOrder = Number(s._xmlOrder);
  if (s.locationX !== undefined) (step as any).locationX = Number(s.locationX);
  if (s.locationY !== undefined) (step as any).locationY = Number(s.locationY);
  if (s.isGoTo === true) (step as any).isGoTo = true;
  if (s.faultIsGoTo === true) (step as any).faultIsGoTo = true;
  if (s.processMetadataValues) {
    (step as any).processMetadataValues =
      s.processMetadataValues as ProcessMetadataValue[];
  }
  return step;
}

function readLookupStep(s: Record<string, unknown>): LookupStep {
  const step: LookupStep = {
    lookup: String(s.lookup),
    label: s.label ? String(s.label) : undefined,
    object: String(s.object || ''),
  };
  if (s.getFirst !== undefined) step.getFirst = s.getFirst === true;
  if (s.fields) step.fields = (s.fields as unknown[]).map(String);
  if (s.outputs) step.outputs = s.outputs as Record<string, string>;
  if (s.outputReference) step.outputReference = String(s.outputReference);
  if (s.assignNullValuesIfNoRecordsFound !== undefined) step.assignNullValuesIfNoRecordsFound = s.assignNullValuesIfNoRecordsFound === true;
  if (s.storeOutputAutomatically !== undefined) step.storeOutputAutomatically = s.storeOutputAutomatically === true;
  if (s.where) step.where = readConditionList(s.where);
  if (s.sortField) step.sortField = String(s.sortField);
  if (s.sortOrder) step.sortOrder = String(s.sortOrder);
  if (s.limit !== undefined) step.limit = Number(s.limit);
  if (s.limitString) step.limitString = String(s.limitString);
  if (s.limitXmlTag) step.limitXmlTag = String(s.limitXmlTag);
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  return step;
}

function readDecisionStep(s: Record<string, unknown>): DecisionStep {
  const rawRules = s.rules as Record<string, unknown>[];
  const rules: DecisionRule[] = rawRules.map(r => {
    const rule: DecisionRule = {
      name: String(r.name || ''),
      when: readDecisionWhen(r),
    };
    if (r.label) rule.label = String(r.label);
    if (r.conditionLogic) rule.conditionLogic = String(r.conditionLogic);
    if (r.next) rule.next = String(r.next);
    if (r.isGoTo === true) rule.isGoTo = true;
    if (r.doesRequireRecordChangedToMeetCriteria === true) {
      rule.doesRequireRecordChangedToMeetCriteria = true;
    }
    if (r.processMetadataValues) {
      rule.processMetadataValues = r.processMetadataValues as ProcessMetadataValue[];
    }
    if (r.conditionProcessMetadataValues) {
      rule.conditionProcessMetadataValues =
        r.conditionProcessMetadataValues as ProcessMetadataValue[][];
    }
    return rule;
  });

  const rawDefault = s.default as Record<string, unknown> || {};
  const def: DecisionDefault = {};
  if (rawDefault.label) def.label = String(rawDefault.label);
  if (rawDefault.next) def.next = String(rawDefault.next);
  if (rawDefault.isGoTo === true) def.isGoTo = true;

  const step: DecisionStep = {
    decision: String(s.decision),
    label: s.label ? String(s.label) : undefined,
    rules,
    default: def,
  };
  if (s.description) step.description = String(s.description);
  return step;
}

/**
 * Decision `when` can be:
 * - Array of strings (simple AND or OR conditions)
 * - Object with numbered keys (complex logic) — needs to be wrapped back into ComplexCondition
 */
function readDecisionWhen(r: Record<string, unknown>): ConditionList {
  const when = r.when;
  if (Array.isArray(when)) {
    return when.map(String);
  }
  if (typeof when === 'object' && when !== null) {
    // Numbered map: { 1: "...", 2: "..." } — wrap with conditionLogic
    const conditions: Record<string, string> = {};
    for (const [k, v] of Object.entries(when as Record<string, unknown>)) {
      conditions[k] = String(v);
    }
    const logic = r.conditionLogic ? String(r.conditionLogic) : 'and';
    return { logic, conditions };
  }
  return [];
}

function readAssignmentStep(s: Record<string, unknown>): AssignmentStep {
  const step: AssignmentStep = {
    assignment: String(s.assignment),
    label: s.label ? String(s.label) : undefined,
    operations: (s.operations as unknown[]).map(String),
  };
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  return step;
}

function readRecordCreateStep(s: Record<string, unknown>): RecordCreateStep {
  const step: RecordCreateStep = {
    recordCreate: String(s.recordCreate),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.inputReference) step.inputReference = String(s.inputReference);
  if (s.object) step.object = String(s.object);
  if (s.fields) step.fields = s.fields as Record<string, unknown>;
  if (s.inputXmlTags) step.inputXmlTags = s.inputXmlTags as Record<string, string>;
  if (s.inputComplexValueTypes) step.inputComplexValueTypes = s.inputComplexValueTypes as Record<string, string>;
  if (s.inputSetupReferenceTypes) step.inputSetupReferenceTypes = s.inputSetupReferenceTypes as Record<string, string>;
  if (s.inputProcessMetadataValues) {
    step.inputProcessMetadataValues =
      s.inputProcessMetadataValues as Record<string, ProcessMetadataValue[]>;
  }
  if (s.assignRecordIdToReference) step.assignRecordIdToReference = String(s.assignRecordIdToReference);
  if (s.doesUpsert !== undefined) step.doesUpsert = s.doesUpsert === true;
  if (s.upsertWhere) step.upsertWhere = readConditionList(s.upsertWhere);
  if (s.conditionProcessMetadataValues) {
    step.conditionProcessMetadataValues =
      s.conditionProcessMetadataValues as ProcessMetadataValue[][];
  }
  if (s.operationMultMatchingRecords) step.operationMultMatchingRecords = String(s.operationMultMatchingRecords);
  if (s.operationOneMatchingRecord) step.operationOneMatchingRecord = String(s.operationOneMatchingRecord);
  if (s.operationZeroMatchingRecords) step.operationZeroMatchingRecords = String(s.operationZeroMatchingRecords);
  if (s.storeOutputAutomatically !== undefined) step.storeOutputAutomatically = s.storeOutputAutomatically === true;
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readRecordUpdateStep(s: Record<string, unknown>): RecordUpdateStep {
  const step: RecordUpdateStep = {
    recordUpdate: String(s.recordUpdate),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.inputReference) step.inputReference = String(s.inputReference);
  if (s.object) step.object = String(s.object);
  if (s.fields) step.fields = s.fields as Record<string, unknown>;
  if (s.inputXmlTags) step.inputXmlTags = s.inputXmlTags as Record<string, string>;
  if (s.inputComplexValueTypes) step.inputComplexValueTypes = s.inputComplexValueTypes as Record<string, string>;
  if (s.inputSetupReferenceTypes) step.inputSetupReferenceTypes = s.inputSetupReferenceTypes as Record<string, string>;
  if (s.inputProcessMetadataValues) {
    step.inputProcessMetadataValues =
      s.inputProcessMetadataValues as Record<string, ProcessMetadataValue[]>;
  }
  if (s.where) step.where = readConditionList(s.where);
  if (s.conditionProcessMetadataValues) {
    step.conditionProcessMetadataValues =
      s.conditionProcessMetadataValues as ProcessMetadataValue[][];
  }
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readRecordDeleteStep(s: Record<string, unknown>): RecordDeleteStep {
  const step: RecordDeleteStep = {
    recordDelete: String(s.recordDelete),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.inputReference) step.inputReference = String(s.inputReference);
  if (s.object) step.object = String(s.object);
  if (s.where) step.where = readConditionList(s.where);
  if (s.conditionProcessMetadataValues) {
    step.conditionProcessMetadataValues =
      s.conditionProcessMetadataValues as ProcessMetadataValue[][];
  }
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readLoopStep(s: Record<string, unknown>): LoopStep {
  const step: LoopStep = {
    loop: String(s.loop),
    label: s.label ? String(s.label) : undefined,
    collection: String(s.collection || ''),
  };
  if (s.iterationOrder) step.iterationOrder = String(s.iterationOrder);
  if (s.description) step.description = String(s.description);
  if (s.iterationNext) step.iterationNext = String(s.iterationNext);
  if (s.afterLastNext) step.afterLastNext = String(s.afterLastNext);
  return step;
}

function readFilterStep(s: Record<string, unknown>): FilterStep {
  const step: FilterStep = {
    filter: String(s.filter),
    label: s.label ? String(s.label) : undefined,
    collection: String(s.collection || ''),
    where: readConditionList(s.where),
  };
  if (s.itemVariable) step.itemVariable = String(s.itemVariable);
  if (s.elementSubtype) step.elementSubtype = String(s.elementSubtype);
  if (s.conditionProcessMetadataValues) {
    step.conditionProcessMetadataValues =
      s.conditionProcessMetadataValues as ProcessMetadataValue[][];
  }
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readTransformStep(s: Record<string, unknown>): TransformStep {
  const step: TransformStep = {
    transform: String(s.transform),
    label: s.label ? String(s.label) : undefined,
    outputDataType: s.outputDataType !== undefined ? String(s.outputDataType) : 'String',
    transformType: String(s.transformType || 'map'),
    expression: String(s.expression || ''),
    collection: String(s.collection || ''),
  };
  if (s.isCollection === true) step.isCollection = true;
  if (s.elementSubtype) step.elementSubtype = String(s.elementSubtype);
  if (s.sortOptions) {
    step.sortOptions = (s.sortOptions as Record<string, unknown>[]).map(so => ({
      doesPutEmptyStringAndNullFirst: so.doesPutEmptyStringAndNullFirst === true,
      sortField: String(so.sortField),
      sortOrder: String(so.sortOrder),
    }));
  }
  if (s.limit !== undefined) step.limit = Number(s.limit);
  if (s.limitString) step.limitString = String(s.limitString);
  if (s.limitXmlTag) step.limitXmlTag = String(s.limitXmlTag);
  if (s.storeOutputAutomatically !== undefined) step.storeOutputAutomatically = s.storeOutputAutomatically === true;
  if (s.scale !== undefined) step.scale = Number(s.scale);
  if (s.sourceTag === 'transforms') step.sourceTag = 'transforms';
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.isGoTo === true) step.isGoTo = true;
  if (s.faultNext) step.faultNext = String(s.faultNext);
  return step;
}

function readActionStep(s: Record<string, unknown>): ActionStep {
  const step: ActionStep = {
    action: String(s.action),
    label: s.label ? String(s.label) : undefined,
    actionType: String(s.actionType || ''),
  };
  if (s.actionName) step.actionName = String(s.actionName);
  if (s.nameSegment) step.nameSegment = String(s.nameSegment);
  if (s.dataTypeMappings) {
    step.dataTypeMappings = (s.dataTypeMappings as Record<string, unknown>[]).map(mapping => ({
      typeName: String(mapping.typeName || ''),
      typeValue: String(mapping.typeValue || ''),
    }));
  }
  if (s.offset !== undefined) step.offset = Number(s.offset);
  if (s.flowTransactionModel) step.flowTransactionModel = String(s.flowTransactionModel);
  if (s.storeOutputAutomatically !== undefined) step.storeOutputAutomatically = s.storeOutputAutomatically === true;
  if (s.versionString) step.versionString = String(s.versionString);
  if (s.inputs) step.inputs = s.inputs as Record<string, unknown>;
  if (s.inputXmlTags) step.inputXmlTags = s.inputXmlTags as Record<string, string>;
  if (s.inputComplexValueTypes) step.inputComplexValueTypes = s.inputComplexValueTypes as Record<string, string>;
  if (s.inputSetupReferenceTypes) step.inputSetupReferenceTypes = s.inputSetupReferenceTypes as Record<string, string>;
  if (s.inputCollectionElementTypes) {
    step.inputCollectionElementTypes = s.inputCollectionElementTypes as Record<string, string[]>;
  }
  if (s.inputValueStrings) step.inputValueStrings = s.inputValueStrings as Record<string, string>;
  if (s.inputConfiguratorModes) step.inputConfiguratorModes = s.inputConfiguratorModes as Record<string, string>;
  if (s.outputs) step.outputs = s.outputs as Record<string, string>;
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readSubflowStep(s: Record<string, unknown>): SubflowStep {
  const step: SubflowStep = {
    subflow: String(s.subflow),
    label: s.label ? String(s.label) : undefined,
    flowName: String(s.flowName || ''),
  };
  if (s.flowTransactionModel) step.flowTransactionModel = String(s.flowTransactionModel);
  if (s.storeOutputAutomatically !== undefined) step.storeOutputAutomatically = s.storeOutputAutomatically === true;
  if (s.inputs) step.inputs = s.inputs as Record<string, unknown>;
  if (s.inputXmlTags) step.inputXmlTags = s.inputXmlTags as Record<string, string>;
  if (s.inputComplexValueTypes) step.inputComplexValueTypes = s.inputComplexValueTypes as Record<string, string>;
  if (s.inputSetupReferenceTypes) step.inputSetupReferenceTypes = s.inputSetupReferenceTypes as Record<string, string>;
  if (s.inputCollectionElementTypes) {
    step.inputCollectionElementTypes = s.inputCollectionElementTypes as Record<string, string[]>;
  }
  if (s.outputs) step.outputs = s.outputs as Record<string, string>;
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readScreenStep(s: Record<string, unknown>): ScreenStep {
  const step: ScreenStep = {
    screen: String(s.screen),
    label: s.label ? String(s.label) : undefined,
    fields: s.fields ? readScreenFields(s.fields as unknown[]) : [],
  };
  if (s.allowBack !== undefined) step.allowBack = s.allowBack === true;
  if (s.allowFinish !== undefined) step.allowFinish = s.allowFinish === true;
  if (s.allowPause !== undefined) step.allowPause = s.allowPause === true;
  if (s.showFooter !== undefined) step.showFooter = s.showFooter === true;
  if (s.showHeader !== undefined) step.showHeader = s.showHeader === true;
  if (s.description) step.description = String(s.description);
  if (s.backButtonLabel) step.backButtonLabel = String(s.backButtonLabel);
  if (s.helpText) step.helpText = String(s.helpText);
  if (s.nextOrFinishButtonLabel) step.nextOrFinishButtonLabel = String(s.nextOrFinishButtonLabel);
  if (s.pausedText) step.pausedText = String(s.pausedText);
  if (s.stageReference) step.stageReference = String(s.stageReference);
  if (s.stageReferenceXmlTag) step.stageReferenceXmlTag = String(s.stageReferenceXmlTag);
  if (s.next) step.next = String(s.next);
  return step;
}

function readScreenFields(raw: unknown[]): ScreenField[] {
  if (!raw) return [];
  return raw.map(readScreenField);
}

function readScreenField(raw: unknown): ScreenField {
  const f = raw as Record<string, unknown>;

  if ('section' in f) {
    const sec = f.section as Record<string, unknown>;
    const section: SectionScreenField = {
      section: {
        name: String(sec.name || ''),
        label: sec.label ? String(sec.label) : undefined,
        columns: (sec.columns as Record<string, unknown>[]).map(col => {
          const c: any = {
            name: col.name ? String(col.name) : undefined,
            width: Number(col.width || 0),
            fields: col.fields ? readScreenFields(col.fields as unknown[]) : undefined,
          };
          if (col.isRequired !== undefined) c.isRequired = Boolean(col.isRequired);
          if (col.booleanValueWrappers) c.booleanValueWrappers = (col.booleanValueWrappers as unknown[]).map(String);
          if (col.visibleWhen) c.visibleWhen = readConditionList(col.visibleWhen);
          if (col.styleProperties) c.styleProperties = col.styleProperties;
          return c;
        }),
      },
    };
    if (sec.isRequired !== undefined) section.section.isRequired = Boolean(sec.isRequired);
    if (sec.booleanValueWrappers) {
      section.section.booleanValueWrappers = (sec.booleanValueWrappers as unknown[]).map(String);
    }
    if (sec.labelSource) section.section.labelSource = String(sec.labelSource) as 'fieldText' | 'label';
    if (sec.visibleWhen) section.section.visibleWhen = readConditionList(sec.visibleWhen);
    if (sec.styleProperties) section.section.styleProperties = sec.styleProperties as Record<string, string>;
    return section;
  }
  if ('display' in f) {
    const disp: any = {
      display: String(f.display),
      value: String(f.value || ''),
      visibleWhen: f.visibleWhen ? readConditionList(f.visibleWhen) : undefined,
    };
    if (f.inputsOnNextNavToAssocScrn !== undefined) disp.inputsOnNextNavToAssocScrn = String(f.inputsOnNextNavToAssocScrn);
    if (f.helpText) disp.helpText = String(f.helpText);
    if (f.styleProperties) disp.styleProperties = f.styleProperties;
    return disp;
  }
  if ('component' in f) {
    const comp: any = {
      component: String(f.component),
      extensionName: String(f.extensionName || ''),
    };
    if (f.fieldType) comp.fieldType = String(f.fieldType);
    if (f.dataType) comp.dataType = String(f.dataType);
    if (f.label) comp.label = String(f.label);
    if (f.labelSource) comp.labelSource = 'fieldText';
    if (f.objectType) comp.objectType = String(f.objectType);
    if (f.required !== undefined) comp.required = f.required === true;
    if (f.inputs) comp.inputs = f.inputs;
    if (f.inputXmlTags) comp.inputXmlTags = f.inputXmlTags;
    if (f.inputComplexValueTypes) comp.inputComplexValueTypes = f.inputComplexValueTypes;
    if (f.inputSetupReferenceTypes) comp.inputSetupReferenceTypes = f.inputSetupReferenceTypes;
    if (f.inputCollectionElementTypes) {
      comp.inputCollectionElementTypes = f.inputCollectionElementTypes;
    }
    if (f.outputs) comp.outputs = f.outputs;
    if (f.choices) comp.choices = (f.choices as unknown[]).map(String);
    if (f.dataTypeMappings) comp.dataTypeMappings = f.dataTypeMappings;
    if (f.validation) {
      const v = f.validation as Record<string, unknown>;
      comp.validation = { formula: String(v.formula || ''), errorMessage: String(v.errorMessage || '') };
    }
    if (f.visibleWhen) comp.visibleWhen = readConditionList(f.visibleWhen);
    if (f.inputsOnNextNavToAssocScrn !== undefined) comp.inputsOnNextNavToAssocScrn = String(f.inputsOnNextNavToAssocScrn);
    if (f.helpText) comp.helpText = String(f.helpText);
    if (f.booleanValueWrappers) comp.booleanValueWrappers = (f.booleanValueWrappers as unknown[]).map(String);
    if (f.scale !== undefined) comp.scale = Number(f.scale);
    if (f.storeOutputAutomatically !== undefined) comp.storeOutputAutomatically = f.storeOutputAutomatically === true;
    if (f.styleProperties) comp.styleProperties = f.styleProperties;
    if (f.processMetadataValues) {
      comp.processMetadataValues =
        f.processMetadataValues as ProcessMetadataValue[];
    }
    return comp;
  }

  // Standard field types and the two standard-shaped fidelity extensions.
  const fieldTypes = [
    'input', 'password', 'dropdown', 'multiselect', 'multiselectCheckboxes',
    'radio', 'textarea', 'checkbox', 'toggle', 'repeater', 'objectProvided',
  ] as const;
  for (const ft of fieldTypes) {
    if (ft in f) {
      const field: any = { [ft]: String(f[ft]) };
      if (f.dataType) field.dataType = String(f.dataType);
      if (f.label) field.label = String(f.label);
      if (f.required !== undefined) field.required = f.required === true;
      if (f.isDisabled !== undefined) field.isDisabled = f.isDisabled === true;
      if (f.isReadOnly !== undefined) field.isReadOnly = f.isReadOnly === true;
      if (f.booleanValueWrappers) field.booleanValueWrappers = (f.booleanValueWrappers as unknown[]).map(String);
      if (f.defaultValue !== undefined) field.defaultValue = f.defaultValue;
      if (f.defaultValueXmlTag) field.defaultValueXmlTag = String(f.defaultValueXmlTag);
      if (f.defaultValueString !== undefined) field.defaultValueString = String(f.defaultValueString);
      if (f.validation) {
        const v = f.validation as Record<string, unknown>;
        field.validation = { formula: String(v.formula || ''), errorMessage: String(v.errorMessage || '') };
      }
      if (f.visibleWhen) field.visibleWhen = readConditionList(f.visibleWhen);
      if (f.choices) field.choices = (f.choices as unknown[]).map(String);
      if (f.labelSource) field.labelSource = String(f.labelSource);
      if (f.inputsOnNextNavToAssocScrn !== undefined) field.inputsOnNextNavToAssocScrn = String(f.inputsOnNextNavToAssocScrn);
      if (f.helpText) field.helpText = String(f.helpText);
      if (f.defaultSelectedChoiceReference) {
        field.defaultSelectedChoiceReference = String(f.defaultSelectedChoiceReference);
      }
      if (f.storeOutputAutomatically !== undefined) {
        field.storeOutputAutomatically = f.storeOutputAutomatically === true;
      }
      if (ft === 'repeater') field.fields = f.fields ? readScreenFields(f.fields as unknown[]) : [];
      if (ft === 'objectProvided' && f.objectFieldReference) {
        field.objectFieldReference = String(f.objectFieldReference);
      }
      if (f.scale !== undefined) field.scale = Number(f.scale);
      if (f.styleProperties) field.styleProperties = f.styleProperties;
      if (f.processMetadataValues) {
        field.processMetadataValues =
          f.processMetadataValues as ProcessMetadataValue[];
      }
      return field;
    }
  }

  throw new Error(`Unknown screen field type: ${JSON.stringify(Object.keys(f))}`);
}

function readCustomErrorStep(s: Record<string, unknown>): CustomErrorStep {
  const step: CustomErrorStep = {
    customError: String(s.customError),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.messages) {
    step.messages = (s.messages as Record<string, unknown>[]).map(m => ({
      errorMessage: String(m.errorMessage || ''),
      isFieldError: m.isFieldError === true,
      fieldSelection: m.fieldSelection ? String(m.fieldSelection) : undefined,
    }));
  }
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  return step;
}

function readWaitStep(s: Record<string, unknown>): WaitStep {
  const step: WaitStep = {
    wait: String(s.wait),
    label: s.label ? String(s.label) : undefined,
    events: [],
  };
  if (s.defaultNext) step.defaultNext = String(s.defaultNext);
  if (s.defaultLabel) step.defaultLabel = String(s.defaultLabel);
  if (s.events) {
    step.events = (s.events as Record<string, unknown>[]).map(e => {
      const event: WaitEvent = {
        name: String(e.name || ''),
        eventType: String(e.eventType || ''),
      };
      if (e.label) event.label = String(e.label);
      if (e.conditionLogic) event.conditionLogic = String(e.conditionLogic);
      if (e.conditions) event.conditions = readConditionList(e.conditions);
      if (e.inputs) event.inputs = e.inputs as Record<string, unknown>;
      if (e.inputXmlTags) event.inputXmlTags = e.inputXmlTags as Record<string, string>;
      if (e.inputComplexValueTypes) {
        event.inputComplexValueTypes = e.inputComplexValueTypes as Record<string, string>;
      }
      if (e.inputSetupReferenceTypes) {
        event.inputSetupReferenceTypes = e.inputSetupReferenceTypes as Record<string, string>;
      }
      if (e.inputCollectionElementTypes) {
        event.inputCollectionElementTypes =
          e.inputCollectionElementTypes as Record<string, string[]>;
      }
      if (e.outputs) event.outputs = e.outputs as Record<string, string>;
      if (e.next) event.next = String(e.next);
      return event;
    });
  }
  if (s.description) step.description = String(s.description);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readRecordLockStep(s: Record<string, unknown>): RecordLockStep {
  const step: RecordLockStep = {
    recordLock: String(s.recordLock),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.inputReference) step.inputReference = String(s.inputReference);
  if (s.lockOrUnlock) step.lockOrUnlock = String(s.lockOrUnlock);
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  if (s.faultIsGoTo === true) step.faultIsGoTo = true;
  return step;
}

function readRecordRollbackStep(s: Record<string, unknown>): RecordRollbackStep {
  const step: RecordRollbackStep = {
    recordRollback: String(s.recordRollback),
    label: s.label ? String(s.label) : undefined,
  };
  if (s.description) step.description = String(s.description);
  if (s.next) step.next = String(s.next);
  return step;
}

function readRawStep(s: Record<string, unknown>): RawStep {
  const step: RawStep = {
    raw: String(s.raw),
    elementType: String(s.elementType || ''),
    xml: String(s.xml || ''),
  };
  if (s.next) step.next = String(s.next);
  if (s.faultNext) step.faultNext = String(s.faultNext);
  return step;
}
