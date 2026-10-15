// ============================================================
// XML Writer: FlowML Document -> Salesforce Flow XML
// ============================================================

import type {
  FlowMLDocument, FlowStep, FlowHeader, TriggerBlock, StartBlock,
  VariableDeclaration, FormulaDeclaration, TextTemplateDeclaration,
  ConstantDeclaration, ChoiceSetDeclaration, ChoiceDeclaration,
  LookupStep, DecisionStep, AssignmentStep,
  RecordCreateStep, RecordUpdateStep, RecordDeleteStep,
  LoopStep, FilterStep, TransformStep, ActionStep,
  SubflowStep, ScreenStep, RawStep, ConditionList, ComplexCondition,
  CustomErrorStep, WaitStep, RecordLockStep, RecordRollbackStep,
} from '../types.js';
import {
  CONDITION_OPERATORS, choiceSetTypeError, isValidChoiceSetType,
  choiceSetMissingObject, choiceSetMissingObjectError,
} from '../mappings.js';
import {
  parseConditionString,
  parseAssignmentString,
  getXmlValueTag,
  inferParsedValue,
  isQuotedLiteral,
} from '../parsers.js';
import type { ParsedValue } from '../types.js';
import { inferCollectionObjectType } from './collectionTypes.js';

/**
 * Convert a FlowML document to Salesforce Flow XML string.
 *
 * Top-level Flow children are emitted in strict alphabetical order by XML tag
 * name, matching the canonical form Salesforce returns on retrieval. Each
 * section is accumulated in its own buffer so the final sort is by tag only;
 * within a section the existing _xmlOrder-based ordering is preserved.
 */
export function writeXml(doc: FlowMLDocument): string {
  // Clone shallowly so synthesis passes don't mutate the caller's document
  // (injected itemVariables and variable declarations stay local to this emit).
  doc = cloneForEmit(doc);
  synthesizeFilterItemVariables(doc);
  assertChoiceSets(doc);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  // Conditionally add xsi namespace when nil fields are present
  const hasNilFields = Object.values(doc.choiceSets ?? {}).some(cs => cs.nilFields?.length);
  const xmlns = hasNilFields
    ? '<Flow xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    : '<Flow xmlns="http://soap.sforce.com/2006/04/metadata">';
  lines.push(xmlns);

  const steps = doc.steps;
  const sections: { tag: string; lines: string[] }[] = [];
  const addSection = (sectionTag: string, fill: (buf: string[]) => void): void => {
    const buf: string[] = [];
    fill(buf);
    if (buf.length > 0) {
      sections.push({ tag: sectionTag, lines: buf });
    }
  };

  addSection('actionCalls', b => writeElementsByType(b, steps, 'action', writeActionCallXml));
  if (doc.flow.hasApiVersion !== false) {
    addSection('apiVersion', b => b.push(tag('apiVersion', doc.flow.apiVersion, 1)));
  }

  // Each extraProperties key becomes its own section so it slots into the
  // correct alphabetical position based on its tag name.
  if (doc.flow.extraProperties) {
    for (const key of Object.keys(doc.flow.extraProperties)) {
      const val = doc.flow.extraProperties[key];
      addSection(key, b => b.push(tag(key, val, 1)));
    }
  }

  addSection('assignments', b => writeElementsByType(b, steps, 'assignment', writeAssignmentXml));

  addSection('choices', b => {
    if (doc.choices) {
      for (const [name, c] of Object.entries(doc.choices)) {
        writeChoiceXml(b, name, c);
      }
    }
  });

  // Salesforce emits <filter> and collection-processor transforms as siblings
  // under a single <collectionProcessors> tag group, so they share one section.
  addSection('collectionProcessors', b => {
    const filters = steps.filter(s => 'filter' in s) as FilterStep[];
    const cpTransforms = steps.filter(s => 'transform' in s && (s as TransformStep).sourceTag !== 'transforms') as TransformStep[];
    const collectionProcessors = [
      ...filters.map(step => ({ step, kind: 'filter' as const })),
      ...cpTransforms.map(step => ({ step, kind: 'transform' as const })),
    ].sort(
      (left, right) =>
        ((left.step as any)._xmlOrder ?? Infinity) - ((right.step as any)._xmlOrder ?? Infinity)
    );
    for (const item of collectionProcessors) {
      if (item.kind === 'filter') writeCollectionProcessorXml(b, item.step);
      else writeCollectionProcessorTransformXml(b, item.step);
    }
  });

  addSection('constants', b => {
    if (doc.constants) {
      for (const [name, c] of Object.entries(doc.constants)) {
        writeConstantXml(b, name, c);
      }
    }
  });

  addSection('customErrors', b => writeElementsByType(b, steps, 'customError', writeCustomErrorXml));

  addSection('customProperties', b => {
    if (doc.customProperties) {
      for (const [name, val] of Object.entries(doc.customProperties)) {
        b.push('    <customProperties>');
        b.push(tag('name', name, 2));
        b.push('        <value>');
        b.push(tag('stringValue', escapeXml(val), 3));
        b.push('        </value>');
        b.push('    </customProperties>');
      }
    }
  });

  addSection('decisions', b => writeElementsByType(b, steps, 'decision', writeDecisionXml));

  if (doc.flow.description) {
    addSection('description', b => b.push(tag('description', escapeXml(doc.flow.description!), 1)));
  }

  // Both FlowML choice set types serialize to <dynamicChoiceSets> — the Flow
  // metadata schema has no <recordChoiceSets> element; Salesforce infers the
  // kind (picklist vs record choice) from which child fields are set.
  addSection('dynamicChoiceSets', b => {
    if (doc.choiceSets) {
      for (const [name, cs] of Object.entries(doc.choiceSets)) {
        writeDynamicChoiceSetXml(b, name, cs);
      }
    }
  });

  if (doc.flow.hasEnvironments !== false) {
    addSection('environments', b => b.push(
      tag('environments', doc.flow.environments ?? 'Default', 1)
    ));
  }

  addSection('formulas', b => {
    if (doc.formulas) {
      for (const [name, f] of Object.entries(doc.formulas)) {
        writeFormulaXml(b, name, f);
      }
    }
  });

  if (doc.flow.hasFullName === true) {
    addSection('fullName', b => b.push(tag('fullName', escapeXml(doc.flow.name), 1)));
  }

  if (doc.flow.interviewLabel) {
    addSection('interviewLabel', b => b.push(tag('interviewLabel', escapeXml(doc.flow.interviewLabel!), 1)));
  }

  if (doc.flow.isAdditionalPermissionRequiredToRun !== undefined) {
    addSection('isAdditionalPermissionRequiredToRun', b => b.push(tag('isAdditionalPermissionRequiredToRun', String(doc.flow.isAdditionalPermissionRequiredToRun), 1)));
  }

  addSection('label', b => b.push(tag('label', escapeXml(doc.flow.label), 1)));

  addSection('loops', b => writeElementsByType(b, steps, 'loop', writeLoopXml));

  addSection('processMetadataValues', b => writeProcessMetadata(b, doc.flow));

  addSection('processType', b => b.push(tag('processType', doc.flow.processType, 1)));

  addSection('recordCreates', b => writeElementsByType(b, steps, 'recordCreate', writeRecordCreateXml));
  addSection('recordDeletes', b => writeElementsByType(b, steps, 'recordDelete', writeRecordDeleteXml));
  addSection('recordLocks', b => writeElementsByType(b, steps, 'recordLock', writeRecordLockXml));
  addSection('recordLookups', b => writeElementsByType(b, steps, 'lookup', writeRecordLookupXml));
  addSection('recordRollbacks', b => writeElementsByType(b, steps, 'recordRollback', writeRecordRollbackXml));
  addSection('recordUpdates', b => writeElementsByType(b, steps, 'recordUpdate', writeRecordUpdateXml));

  if (doc.flow.runInMode) {
    addSection('runInMode', b => b.push(tag('runInMode', doc.flow.runInMode!, 1)));
  }

  addSection('screens', b => writeElementsByType(b, steps, 'screen', writeScreenXml));

  if (doc.trigger || doc.start) {
    addSection('start', b => writeStartElement(b, doc));
  }

  if (doc.flow.hasStatus !== false) {
    addSection('status', b => b.push(tag('status', doc.flow.status, 1)));
  }

  addSection('stages', b => {
    for (const stage of doc.stages ?? []) {
      b.push('    <stages>');
      if (stage.description !== undefined) {
        b.push(tag('description', escapeXml(stage.description), 2));
      }
      b.push(tag('name', stage.name, 2));
      if (stage.isActive !== undefined) {
        b.push(tag('isActive', String(stage.isActive), 2));
      }
      if (stage.label !== undefined) b.push(tag('label', escapeXml(stage.label), 2));
      if (stage.stageOrder !== undefined) {
        b.push(tag('stageOrder', String(stage.stageOrder), 2));
      }
      b.push('    </stages>');
    }
  });

  addSection('subflows', b => writeElementsByType(b, steps, 'subflow', writeSubflowXml));

  addSection('textTemplates', b => {
    if (doc.textTemplates) {
      for (const [name, tt] of Object.entries(doc.textTemplates)) {
        writeTextTemplateXml(b, name, tt);
      }
    }
  });

  addSection('transforms', b => {
    const standaloneTransforms = steps.filter(s => 'transform' in s && (s as TransformStep).sourceTag === 'transforms') as TransformStep[];
    standaloneTransforms.sort((a, b2) => ((a as any)._xmlOrder ?? Infinity) - ((b2 as any)._xmlOrder ?? Infinity));
    for (const step of standaloneTransforms) {
      writeStandaloneTransformXml(b, step);
    }
  });

  addSection('variables', b => {
    if (doc.variables) {
      for (const [name, v] of Object.entries(doc.variables)) {
        writeVariableXml(b, name, v);
      }
    }
  });

  addSection('waits', b => writeElementsByType(b, steps, 'wait', writeWaitXml));

  // Raw elements: unknown XML preserved verbatim. Group by elementType so
  // siblings with the same tag land together, then slot each group into the
  // alphabetical sort by its tag name.
  const rawSteps = steps.filter(s => 'raw' in s) as RawStep[];
  const rawByType = new Map<string, RawStep[]>();
  for (const step of rawSteps) {
    const bucket = rawByType.get(step.elementType) ?? [];
    bucket.push(step);
    rawByType.set(step.elementType, bucket);
  }
  for (const [elementType, bucket] of rawByType) {
    bucket.sort((a, b) => ((a as any)._xmlOrder ?? Infinity) - ((b as any)._xmlOrder ?? Infinity));
    addSection(elementType, b => {
      for (const step of bucket) {
        writeRawXml(b, step);
      }
    });
  }

  sections.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  for (const section of sections) {
    lines.push(...section.lines);
  }

  lines.push('</Flow>');
  return lines.join('\n') + '\n';
}

// ============================================================
// Helper to write elements by step type
// ============================================================

function writeElementsByType<T extends FlowStep>(
  lines: string[],
  steps: FlowStep[],
  stepKey: string,
  writer: (lines: string[], step: T) => void
): void {
  const matching = steps.filter(s => stepKey in s);
  matching.sort((a, b) => ((a as any)._xmlOrder ?? Infinity) - ((b as any)._xmlOrder ?? Infinity));
  for (const step of matching) {
    writer(lines, step as T);
  }
}

// ============================================================
// Start Element
// ============================================================

function writeStartElement(lines: string[], doc: FlowMLDocument): void {
  lines.push('    <start>');
  const startLoc = doc.trigger || doc.start;
  lines.push(tag('locationX', String(startLoc?.locationX ?? 0), 2));
  lines.push(tag('locationY', String(startLoc?.locationY ?? 0), 2));

  if (doc.trigger) {
    const t = doc.trigger;

    // Main connector
    if (t.next) {
      writeConnector(lines, t.next, 2);
    }

    // doesRequireRecordChangedToMeetCriteria
    if (t.requiresRecordChangedToMeetCriteria) {
      lines.push(tag('doesRequireRecordChangedToMeetCriteria', 'true', 2));
    }

    // Entry conditions -> filters
    if (t.entryConditions) {
      writeFilters(lines, t.entryConditions, 2);
    }

    // Formula-based entry criteria
    if (t.filterFormula) {
      lines.push(tag('filterFormula', escapeXml(t.filterFormula), 2));
    }

    // Object
    if (t.object) {
      lines.push(tag('object', t.object, 2));
    }

    // Record trigger type
    if (t.recordTriggerType) {
      lines.push(tag('recordTriggerType', t.recordTriggerType, 2));
    }

    // Schedule
    if (t.schedule) {
      lines.push('        <schedule>');
      if (t.schedule.dayOfMonthToRun !== undefined) {
        lines.push(tag('dayOfMonthToRun', t.schedule.dayOfMonthToRun, 3));
      }
      lines.push(tag('frequency', t.schedule.frequency, 3));
      if (t.schedule.frequencyNumber !== undefined) {
        lines.push(tag('frequencyNumber', String(t.schedule.frequencyNumber), 3));
      }
      lines.push(tag('startDate', t.schedule.startDate, 3));
      lines.push(tag('startTime', t.schedule.startTime, 3));
      lines.push('        </schedule>');
    }

    // Scheduled paths
    if (t.scheduledPaths) {
      for (const sp of t.scheduledPaths) {
        lines.push('        <scheduledPaths>');
        if (sp.name) lines.push(tag('name', sp.name, 3));
        if (sp.next) writeConnector(lines, sp.next, 3);
        if (sp.label) lines.push(tag('label', escapeXml(sp.label), 3));
        if (sp.maxBatchSize !== undefined) {
          lines.push(tag('maxBatchSize', String(sp.maxBatchSize), 3));
        }
        if (sp.offsetNumber !== undefined) lines.push(tag('offsetNumber', String(sp.offsetNumber), 3));
        if (sp.offsetUnit) lines.push(tag('offsetUnit', sp.offsetUnit, 3));
        if (sp.pathType) lines.push(tag('pathType', sp.pathType, 3));
        if (sp.timeField) lines.push(tag('recordField', sp.timeField, 3));
        if (sp.timeSource) lines.push(tag('timeSource', sp.timeSource, 3));
        lines.push('        </scheduledPaths>');
      }
    }

    // Trigger type
    lines.push(tag('triggerType', t.type, 2));
  } else if (doc.start) {
    if (doc.start.next) {
      writeConnector(lines, doc.start.next, 2);
    }
  }

  lines.push('    </start>');
}

// ============================================================
// Element Writers
// ============================================================

function writeRecordLookupXml(lines: string[], step: LookupStep): void {
  lines.push('    <recordLookups>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.lookup, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.assignNullValuesIfNoRecordsFound !== undefined) {
    lines.push(tag('assignNullValuesIfNoRecordsFound', String(step.assignNullValuesIfNoRecordsFound), 2));
  }
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  if (step.where) {
    writeFilters(lines, step.where, 2, step.conditionProcessMetadataValues);
  }
  if (step.getFirst !== undefined) lines.push(tag('getFirstRecordOnly', String(step.getFirst), 2));
  if (step.limit !== undefined) {
    if (step.limitXmlTag === '__scalar__') {
      lines.push(tag('limit', step.limitString ?? String(step.limit), 2));
    } else {
      lines.push('        <limit>');
      lines.push(tag('numberValue', step.limitString ?? String(step.limit), 3));
      lines.push('        </limit>');
    }
  }
  lines.push(tag('object', step.object, 2));
  if (step.outputs) {
    for (const [field, ref] of Object.entries(step.outputs)) {
      lines.push('        <outputAssignments>');
      lines.push(tag('assignToReference', ref, 3));
      lines.push(tag('field', field, 3));
      lines.push('        </outputAssignments>');
    }
  }
  if (step.outputReference) lines.push(tag('outputReference', step.outputReference, 2));
  if (step.fields) {
    for (const f of step.fields) {
      lines.push(tag('queriedFields', f, 2));
    }
  }
  if (step.sortField) lines.push(tag('sortField', step.sortField, 2));
  if (step.sortOrder) lines.push(tag('sortOrder', step.sortOrder, 2));
  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  lines.push('    </recordLookups>');
}

function writeDecisionXml(lines: string[], step: DecisionStep): void {
  lines.push('    <decisions>');
  writeProcessMetadataEntries(lines, step.processMetadataValues, 2);
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.decision, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.default?.next) {
    lines.push('        <defaultConnector>');
    if (step.default.isGoTo) lines.push(tag('isGoTo', 'true', 3));
    lines.push(tag('targetReference', step.default.next, 3));
    lines.push('        </defaultConnector>');
  }
  if (step.default?.label) {
    lines.push(tag('defaultConnectorLabel', escapeXml(step.default.label), 2));
  }

  // Rules
  for (const rule of step.rules) {
    lines.push('        <rules>');
    writeProcessMetadataEntries(lines, rule.processMetadataValues, 3);
    lines.push(tag('name', rule.name, 3));

    // Condition logic
    const condLogic = getConditionLogic(rule.when, rule.conditionLogic);
    lines.push(tag('conditionLogic', condLogic, 3));

    // Conditions
    writeConditions(lines, rule.when, 3, 'conditions', rule.conditionProcessMetadataValues);

    // Connector
    if (rule.next) writeConnector(lines, rule.next, 3, rule.isGoTo);
    if (rule.doesRequireRecordChangedToMeetCriteria) {
      lines.push(tag('doesRequireRecordChangedToMeetCriteria', 'true', 3));
    }
    if (rule.label) lines.push(tag('label', escapeXml(rule.label), 3));
    lines.push('        </rules>');
  }

  lines.push('    </decisions>');
}

function writeAssignmentXml(lines: string[], step: AssignmentStep): void {
  lines.push('    <assignments>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.assignment, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  for (const opStr of step.operations) {
    const parsed = parseAssignmentString(opStr);
    lines.push('        <assignmentItems>');
    lines.push(tag('assignToReference', parsed.target, 3));
    lines.push(tag('operator', parsed.operator, 3));
    // Null sentinel: no <value> tag for null-clear assignments
    if (parsed.value.originalXmlTag !== '__null__') {
      writeValueTag(lines, parsed.value, 3);
    }
    lines.push('        </assignmentItems>');
  }
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  lines.push('    </assignments>');
}

function writeRecordCreateXml(lines: string[], step: RecordCreateStep): void {
  lines.push('    <recordCreates>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.recordCreate, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.assignRecordIdToReference) {
    lines.push(tag('assignRecordIdToReference', step.assignRecordIdToReference, 2));
  }
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.doesUpsert !== undefined) lines.push(tag('doesUpsert', String(step.doesUpsert), 2));
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  // Upsert filters
  if (step.upsertWhere) {
    writeFilters(lines, step.upsertWhere, 2, step.conditionProcessMetadataValues);
  }
  if (step.inputReference) {
    if (step.object) {
      if (step.fields) writeInputAssignments(
        lines, step.fields, 2, step.inputXmlTags, step.inputComplexValueTypes,
        step.inputProcessMetadataValues, step.inputSetupReferenceTypes
      );
      lines.push(tag('object', step.object, 2));
    } else {
      lines.push(tag('inputReference', step.inputReference, 2));
    }
  } else if (step.object) {
    if (step.fields) writeInputAssignments(
      lines, step.fields, 2, step.inputXmlTags, step.inputComplexValueTypes,
      step.inputProcessMetadataValues, step.inputSetupReferenceTypes
    );
    lines.push(tag('object', step.object, 2));
  }
  if (step.operationMultMatchingRecords) lines.push(tag('operationMultMatchingRecords', step.operationMultMatchingRecords, 2));
  if (step.operationOneMatchingRecord) lines.push(tag('operationOneMatchingRecord', step.operationOneMatchingRecord, 2));
  if (step.operationZeroMatchingRecords) lines.push(tag('operationZeroMatchingRecords', step.operationZeroMatchingRecords, 2));
  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  lines.push('    </recordCreates>');
}

function writeRecordUpdateXml(lines: string[], step: RecordUpdateStep): void {
  lines.push('    <recordUpdates>');
  writeProcessMetadataEntries(lines, step.processMetadataValues, 2);
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.recordUpdate, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  if (step.inputReference) {
    if (step.where) {
      writeFilters(lines, step.where, 2, step.conditionProcessMetadataValues);
    }
    if (step.fields) writeInputAssignments(
      lines, step.fields, 2, step.inputXmlTags, step.inputComplexValueTypes,
      step.inputProcessMetadataValues, step.inputSetupReferenceTypes
    );
    lines.push(tag('inputReference', step.inputReference, 2));
  } else if (step.object) {
    if (step.where) {
      writeFilters(lines, step.where, 2, step.conditionProcessMetadataValues);
    }
    if (step.fields) writeInputAssignments(
      lines, step.fields, 2, step.inputXmlTags, step.inputComplexValueTypes,
      step.inputProcessMetadataValues, step.inputSetupReferenceTypes
    );
    lines.push(tag('object', step.object, 2));
  }
  lines.push('    </recordUpdates>');
}

function writeRecordDeleteXml(lines: string[], step: RecordDeleteStep): void {
  lines.push('    <recordDeletes>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.recordDelete, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  if (step.inputReference) {
    lines.push(tag('inputReference', step.inputReference, 2));
  } else if (step.object) {
    if (step.where) {
      writeFilters(lines, step.where, 2, step.conditionProcessMetadataValues);
    }
    lines.push(tag('object', step.object, 2));
  }
  lines.push('    </recordDeletes>');
}

function writeLoopXml(lines: string[], step: LoopStep): void {
  lines.push('    <loops>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.loop, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  lines.push(tag('collectionReference', step.collection, 2));
  if (step.iterationOrder) lines.push(tag('iterationOrder', step.iterationOrder, 2));
  if (step.iterationNext) {
    lines.push('        <nextValueConnector>');
    lines.push(tag('targetReference', step.iterationNext, 3));
    lines.push('        </nextValueConnector>');
  }
  if (step.afterLastNext) {
    lines.push('        <noMoreValuesConnector>');
    lines.push(tag('targetReference', step.afterLastNext, 3));
    lines.push('        </noMoreValuesConnector>');
  }
  lines.push('    </loops>');
}

function writeCollectionProcessorXml(lines: string[], step: FilterStep): void {
  lines.push('    <collectionProcessors>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.filter, 2));
  if (step.elementSubtype) lines.push(tag('elementSubtype', step.elementSubtype, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.itemVariable) lines.push(tag('assignNextValueToReference', step.itemVariable, 2));
  lines.push(tag('collectionProcessorType', 'FilterCollectionProcessor', 2));
  lines.push(tag('collectionReference', step.collection, 2));
  if (step.where) {
    const logic = getConditionLogicFromList(step.where);
    lines.push(tag('conditionLogic', logic, 2));
    writeConditions(
      lines, step.where, 2, 'conditions', step.conditionProcessMetadataValues
    );
  }
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  lines.push('    </collectionProcessors>');
}

function writeCollectionProcessorTransformXml(lines: string[], step: TransformStep): void {
  lines.push('    <collectionProcessors>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.transform, 2));
  // elementSubtype comes right after name in Salesforce XML
  if (step.elementSubtype) lines.push(tag('elementSubtype', step.elementSubtype, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  const cpType = step.transformType === 'sort' ? 'SortCollectionProcessor' : 'MapCollectionProcessor';
  lines.push(tag('collectionProcessorType', cpType, 2));
  lines.push(tag('collectionReference', step.collection, 2));
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.expression) lines.push(tag('formula', step.expression, 2));
  if (step.isCollection) lines.push(tag('isCollection', 'true', 2));
  if (step.outputDataType) lines.push(tag('outputSObjectType', step.outputDataType, 2));
  if (step.limit !== undefined) {
    if (step.limitXmlTag === '__scalar__') {
      lines.push(tag('limit', step.limitString ?? String(step.limit), 2));
    } else {
      lines.push('        <limit>');
      lines.push(tag('numberValue', step.limitString ?? String(step.limit), 3));
      lines.push('        </limit>');
    }
  }
  if (step.sortOptions) {
    for (const so of step.sortOptions) {
      lines.push('        <sortOptions>');
      lines.push(tag('doesPutEmptyStringAndNullFirst', String(so.doesPutEmptyStringAndNullFirst), 3));
      lines.push(tag('sortField', so.sortField, 3));
      lines.push(tag('sortOrder', so.sortOrder, 3));
      lines.push('        </sortOptions>');
    }
  }
  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  lines.push('    </collectionProcessors>');
}

function writeStandaloneTransformXml(lines: string[], step: TransformStep): void {
  lines.push('    <transforms>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.transform, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  lines.push(tag('dataType', step.outputDataType, 2));
  if (step.isCollection) lines.push(tag('isCollection', 'true', 2));
  if (step.scale !== undefined) lines.push(tag('scale', String(step.scale), 2));
  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  // transformValues with nested transformValueActions
  if (step.expression || step.transformType) {
    lines.push('        <transformValues>');
    lines.push('            <transformValueActions>');
    if (step.transformType) lines.push(tag('transformType', step.transformType, 4));
    if (step.expression) {
      lines.push('                <value>');
      lines.push(tag('elementReference', step.expression, 5));
      lines.push('                </value>');
    }
    lines.push('            </transformValueActions>');
    lines.push('        </transformValues>');
  }
  lines.push('    </transforms>');
}

function writeActionCallXml(lines: string[], step: ActionStep): void {
  lines.push('    <actionCalls>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.action, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);

  // Split apex:ClassName back to actionType + actionName
  let actionType = step.actionType;
  let actionName = '';
  if (step.actionType.startsWith('apex:')) {
    actionType = 'apex';
    actionName = step.actionType.substring(5);
  }

  lines.push(tag('actionName', actionName || step.actionName || step.nameSegment || actionType, 2));
  lines.push(tag('actionType', actionType, 2));
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.dataTypeMappings) {
    for (const mapping of step.dataTypeMappings) {
      lines.push('        <dataTypeMappings>');
      lines.push(tag('typeName', mapping.typeName, 3));
      lines.push(tag('typeValue', mapping.typeValue, 3));
      lines.push('        </dataTypeMappings>');
    }
  }
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  if (step.flowTransactionModel) lines.push(tag('flowTransactionModel', step.flowTransactionModel, 2));

  // Input parameters
  if (step.inputs) {
    for (const [paramName, val] of Object.entries(step.inputs)) {
      lines.push('        <inputParameters>');
      lines.push(tag('name', paramName, 3));
      if (val === null) {
        if (step.inputXmlTags?.[paramName] === '__empty__') {
          lines.push('            <value/>');
        }
      } else {
        const pv = inferInputValue(val, step.inputXmlTags?.[paramName]);
        applyValueProvenance(
          pv,
          paramName,
          step.inputXmlTags,
          step.inputComplexValueTypes,
          step.inputCollectionElementTypes,
          step.inputSetupReferenceTypes
        );
        if (step.inputValueStrings?.[paramName] !== undefined) {
          pv.originalString = step.inputValueStrings[paramName];
        }
        // Write value with optional inputConfiguratorMode
        const mode = step.inputConfiguratorModes?.[paramName];
        if (mode) {
          const xmlTag = pv.originalXmlTag ?? getXmlValueTag(pv);
          const displayValue = pv.originalString ?? String(pv.value);
          lines.push('            <value>');
          // Alphabetical ordering of sibling elements inside <value>
          if (xmlTag < 'inputConfiguratorMode') {
            lines.push(`                <${xmlTag}>${escapeXml(displayValue)}</${xmlTag}>`);
            lines.push(tag('inputConfiguratorMode', mode, 4));
          } else {
            lines.push(tag('inputConfiguratorMode', mode, 4));
            lines.push(`                <${xmlTag}>${escapeXml(displayValue)}</${xmlTag}>`);
            if (xmlTag === 'setupReference' && pv.setupReferenceType) {
              lines.push(tag('setupReferenceType', pv.setupReferenceType, 4));
            }
          }
          lines.push('            </value>');
        } else {
          writeValueTag(lines, pv, 3);
        }
      }
      lines.push('        </inputParameters>');
    }
  }

  if (step.nameSegment) lines.push(tag('nameSegment', step.nameSegment, 2));
  if (step.offset !== undefined) lines.push(tag('offset', String(step.offset), 2));

  // Output parameters
  if (step.outputs) {
    for (const [paramName, ref] of Object.entries(step.outputs)) {
      lines.push('        <outputParameters>');
      lines.push(tag('assignToReference', ref, 3));
      lines.push(tag('name', paramName, 3));
      lines.push('        </outputParameters>');
    }
  }

  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  if (step.versionString) lines.push(tag('versionString', step.versionString, 2));
  lines.push('    </actionCalls>');
}

function writeSubflowXml(lines: string[], step: SubflowStep): void {
  lines.push('    <subflows>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.subflow, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  lines.push(tag('flowName', step.flowName, 2));
  if (step.flowTransactionModel) lines.push(tag('flowTransactionModel', step.flowTransactionModel, 2));
  if (step.inputs) {
    for (const [paramName, val] of Object.entries(step.inputs)) {
      lines.push('        <inputAssignments>');
      lines.push(tag('name', paramName, 3));
      if (val === null) {
        // Null-clear: no <value> tag
      } else {
        const pv = inferInputValue(val, step.inputXmlTags?.[paramName]);
        applyValueProvenance(
          pv,
          paramName,
          step.inputXmlTags,
          step.inputComplexValueTypes,
          step.inputCollectionElementTypes,
          step.inputSetupReferenceTypes
        );
        writeValueTag(lines, pv, 3);
      }
      lines.push('        </inputAssignments>');
    }
  }
  if (step.outputs) {
    for (const [paramName, ref] of Object.entries(step.outputs)) {
      lines.push('        <outputAssignments>');
      lines.push(tag('assignToReference', ref, 3));
      lines.push(tag('name', paramName, 3));
      lines.push('        </outputAssignments>');
    }
  }
  if (step.storeOutputAutomatically !== undefined) {
    lines.push(tag('storeOutputAutomatically', String(step.storeOutputAutomatically), 2));
  }
  lines.push('    </subflows>');
}

function writeScreenXml(lines: string[], step: ScreenStep): void {
  lines.push('    <screens>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.screen, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.allowBack !== undefined) lines.push(tag('allowBack', String(step.allowBack), 2));
  if (step.allowFinish !== undefined) lines.push(tag('allowFinish', String(step.allowFinish), 2));
  if (step.allowPause !== undefined) lines.push(tag('allowPause', String(step.allowPause), 2));
  if (step.backButtonLabel) lines.push(tag('backButtonLabel', escapeXml(step.backButtonLabel), 2));
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.fields) {
    for (const field of step.fields) {
      writeScreenFieldXml(lines, field, 2);
    }
  }
  if (step.helpText) lines.push(tag('helpText', escapeXml(step.helpText), 2));
  if (step.nextOrFinishButtonLabel) lines.push(tag('nextOrFinishButtonLabel', escapeXml(step.nextOrFinishButtonLabel), 2));
  if (step.pausedText) lines.push(tag('pausedText', escapeXml(step.pausedText), 2));
  if (step.showFooter !== undefined) lines.push(tag('showFooter', String(step.showFooter), 2));
  if (step.showHeader !== undefined) lines.push(tag('showHeader', String(step.showHeader), 2));
  if (step.stageReference) {
    if (step.stageReferenceXmlTag) {
      lines.push('        <stageReference>');
      lines.push(tag(step.stageReferenceXmlTag, step.stageReference, 3));
      lines.push('        </stageReference>');
    } else {
      lines.push(tag('stageReference', step.stageReference, 2));
    }
  }
  lines.push('    </screens>');
}

function writeScreenFieldXml(lines: string[], field: any, indent: number): void {
  // Placeholder — Phase 6 will implement full screen field writing
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<fields>`);
  writeProcessMetadataEntries(lines, field.processMetadataValues, indent + 1);

  if ('section' in field) {
    const sec = field.section;
    // Salesforce canonical order: name, fieldText/label, fieldType, fields (columns), isRequired, regionContainerType, styleProperties
    lines.push(tag('name', sec.name, indent + 1));
    if (sec.label) {
      if (sec.labelSource === 'label') {
        lines.push(tag('label', escapeXml(sec.label), indent + 1));
      } else {
        lines.push(tag('fieldText', escapeXml(sec.label), indent + 1));
      }
    }
    lines.push(tag('fieldType', 'RegionContainer', indent + 1));
    // Columns as regions
    if (sec.columns) {
      for (let i = 0; i < sec.columns.length; i++) {
        const col = sec.columns[i];
        lines.push(`${'    '.repeat(indent + 1)}<fields>`);
        // Region canonical order: name, fieldType, nested fields, inputParameters, isRequired, styleProperties
        lines.push(tag('name', col.name || `${sec.name}_Column${i + 1}`, indent + 2));
        lines.push(tag('fieldType', 'Region', indent + 2));
        // Nested fields
        if (col.fields) {
          for (const f of col.fields) {
            writeScreenFieldXml(lines, f, indent + 2);
          }
        }
        // inputParameters for width
        lines.push(`${'    '.repeat(indent + 2)}<inputParameters>`);
        lines.push(tag('name', 'width', indent + 3));
        lines.push(`${'    '.repeat(indent + 3)}<value>`);
        lines.push(tag('stringValue', String(col.width), indent + 4));
        lines.push(`${'    '.repeat(indent + 3)}</value>`);
        lines.push(`${'    '.repeat(indent + 2)}</inputParameters>`);
        if (col.isRequired !== undefined) {
          writeBooleanField(lines, 'isRequired', col.isRequired, indent + 2, col.booleanValueWrappers);
        }
        if (col.styleProperties) writeStyleProperties(lines, col.styleProperties, indent + 2);
        if (col.visibleWhen) writeVisibilityRule(lines, col.visibleWhen, indent + 2);
        lines.push(`${'    '.repeat(indent + 1)}</fields>`);
      }
    }
    if (sec.isRequired !== undefined) {
      writeBooleanField(lines, 'isRequired', sec.isRequired, indent + 1, sec.booleanValueWrappers);
    }
    if (sec.label) {
      lines.push(tag('regionContainerType', 'SectionWithHeader', indent + 1));
    } else {
      lines.push(tag('regionContainerType', 'SectionWithoutHeader', indent + 1));
    }
    if (sec.styleProperties) writeStyleProperties(lines, sec.styleProperties, indent + 1);
    if (sec.visibleWhen) writeVisibilityRule(lines, sec.visibleWhen, indent + 1);
  } else if ('display' in field) {
    lines.push(tag('name', field.display, indent + 1));
    lines.push(tag('fieldText', escapeXml(field.value || ''), indent + 1));
    lines.push(tag('fieldType', 'DisplayText', indent + 1));
    if (field.helpText) lines.push(tag('helpText', escapeXml(field.helpText), indent + 1));
    if (field.inputsOnNextNavToAssocScrn !== undefined) {
      lines.push(tag('inputsOnNextNavToAssocScrn', field.inputsOnNextNavToAssocScrn, indent + 1));
    }
    if (field.styleProperties) {
      writeStyleProperties(lines, field.styleProperties, indent + 1);
    }
    if (field.visibleWhen) {
      writeVisibilityRule(lines, field.visibleWhen, indent + 1);
    }
  } else if ('component' in field) {
    // Salesforce canonical order: name, extensionName, fieldType, helpText, inputParameters,
    // inputsOnNextNavToAssocScrn, isRequired, objectType, outputParameters,
    // storeOutputAutomatically, styleProperties, validationRule, visibilityRule
    lines.push(tag('name', field.component, indent + 1));
    if (field.choices) {
      for (const ch of field.choices) {
        lines.push(tag('choiceReferences', ch, indent + 1));
      }
    }
    if (field.dataType) lines.push(tag('dataType', field.dataType, indent + 1));
    if (field.dataTypeMappings) {
      for (const dtm of field.dataTypeMappings) {
        lines.push(`${'    '.repeat(indent + 1)}<dataTypeMappings>`);
        lines.push(tag('typeName', dtm.typeName, indent + 2));
        lines.push(tag('typeValue', dtm.typeValue, indent + 2));
        lines.push(`${'    '.repeat(indent + 1)}</dataTypeMappings>`);
      }
    }
    if (field.extensionName) lines.push(tag('extensionName', field.extensionName, indent + 1));
    if (field.label) lines.push(tag('fieldText', escapeXml(field.label), indent + 1));
    lines.push(tag('fieldType', field.fieldType || 'ComponentInstance', indent + 1));
    if (field.helpText) lines.push(tag('helpText', escapeXml(field.helpText), indent + 1));
    if (field.inputs) {
      for (const [pName, pVal] of Object.entries(field.inputs)) {
        lines.push(`${'    '.repeat(indent + 1)}<inputParameters>`);
        lines.push(tag('name', pName, indent + 2));
        const pv = inferInputValue(pVal, field.inputXmlTags?.[pName]);
        // Override XML tag if the original had a different type (e.g. elementReference for bare variable names)
        applyValueProvenance(
          pv,
          pName,
          field.inputXmlTags,
          field.inputComplexValueTypes,
          field.inputCollectionElementTypes,
          field.inputSetupReferenceTypes
        );
        writeValueTag(lines, pv, indent + 2);
        lines.push(`${'    '.repeat(indent + 1)}</inputParameters>`);
      }
    }
    if (field.inputsOnNextNavToAssocScrn !== undefined) {
      lines.push(tag('inputsOnNextNavToAssocScrn', field.inputsOnNextNavToAssocScrn, indent + 1));
    }
    if (field.required !== undefined) {
      writeBooleanField(lines, 'isRequired', field.required, indent + 1, field.booleanValueWrappers);
    }
    if (field.objectType) lines.push(tag('objectType', field.objectType, indent + 1));
    if (field.outputs) {
      for (const [pName, ref] of Object.entries(field.outputs)) {
        lines.push(`${'    '.repeat(indent + 1)}<outputParameters>`);
        lines.push(tag('assignToReference', ref as string, indent + 2));
        lines.push(tag('name', pName, indent + 2));
        lines.push(`${'    '.repeat(indent + 1)}</outputParameters>`);
      }
    }
    if (field.scale !== undefined) lines.push(tag('scale', String(field.scale), indent + 1));
    if (field.storeOutputAutomatically !== undefined) {
      lines.push(tag('storeOutputAutomatically', String(field.storeOutputAutomatically), indent + 1));
    }
    if (field.styleProperties) {
      writeStyleProperties(lines, field.styleProperties, indent + 1);
    }
    if (field.validation) {
      lines.push(`${'    '.repeat(indent + 1)}<validationRule>`);
      lines.push(tag('errorMessage', escapeXml(field.validation.errorMessage), indent + 2));
      lines.push(tag('formulaExpression', escapeXml(field.validation.formula), indent + 2));
      lines.push(`${'    '.repeat(indent + 1)}</validationRule>`);
    }
    if (field.visibleWhen) {
      writeVisibilityRule(lines, field.visibleWhen, indent + 1);
    }
  } else {
    // Standard field types
    const typeMap: Record<string, string> = {
      input: 'InputField', password: 'PasswordField', dropdown: 'DropdownBox',
      multiselect: 'MultiSelectPicklist', multiselectCheckboxes: 'MultiSelectCheckboxes',
      radio: 'RadioButtons', textarea: 'LargeTextArea', checkbox: 'CheckboxField', toggle: 'Toggle',
      repeater: 'Repeater', objectProvided: 'ObjectProvided',
    };
    const fieldType = Object.keys(typeMap).find(k => k in field);
    if (fieldType) {
      if (field[fieldType] || fieldType !== 'objectProvided') {
        lines.push(tag('name', field[fieldType], indent + 1));
      }
      if (field.choices) {
        for (const ch of field.choices) {
          lines.push(tag('choiceReferences', ch, indent + 1));
        }
      }
      if (field.dataType) lines.push(tag('dataType', field.dataType, indent + 1));
      if (field.defaultSelectedChoiceReference) {
        lines.push(tag('defaultSelectedChoiceReference', field.defaultSelectedChoiceReference, indent + 1));
      }
      if (field.defaultValue !== undefined) {
        const pv = inferParsedValue(field.defaultValue);
        const xmlTag = field.defaultValueXmlTag ?? getXmlValueTag(pv);
        const displayValue = field.defaultValueString ?? String(pv.value);
        const pad = '    '.repeat(indent + 1);
        lines.push(`${pad}<defaultValue>`);
        lines.push(`${pad}    <${xmlTag}>${escapeXml(displayValue)}</${xmlTag}>`);
        lines.push(`${pad}</defaultValue>`);
      }
      // Label as fieldText (default for standard fields) or inputParameter
      if (field.label) {
        if (!field.labelSource || field.labelSource === 'fieldText') {
          lines.push(tag('fieldText', escapeXml(field.label), indent + 1));
        } else {
          lines.push(`${'    '.repeat(indent + 1)}<inputParameters>`);
          lines.push(tag('name', 'label', indent + 2));
          lines.push(`${'    '.repeat(indent + 2)}<value>`);
          lines.push(tag('stringValue', escapeXml(field.label), indent + 3));
          lines.push(`${'    '.repeat(indent + 2)}</value>`);
          lines.push(`${'    '.repeat(indent + 1)}</inputParameters>`);
        }
      }
      lines.push(tag('fieldType', typeMap[fieldType], indent + 1));
      if (fieldType === 'repeater' && field.fields) {
        for (const nestedField of field.fields) {
          writeScreenFieldXml(lines, nestedField, indent + 1);
        }
      }
      if (field.helpText) lines.push(tag('helpText', escapeXml(field.helpText), indent + 1));
      if (field.inputsOnNextNavToAssocScrn !== undefined) {
        lines.push(tag('inputsOnNextNavToAssocScrn', field.inputsOnNextNavToAssocScrn, indent + 1));
      }
      if (field.isDisabled !== undefined) {
        writeBooleanField(lines, 'isDisabled', field.isDisabled, indent + 1, field.booleanValueWrappers);
      }
      if (field.isReadOnly !== undefined) {
        writeBooleanField(lines, 'isReadOnly', field.isReadOnly, indent + 1, field.booleanValueWrappers);
      }
      if (field.required !== undefined) {
        writeBooleanField(lines, 'isRequired', field.required, indent + 1, field.booleanValueWrappers);
      }
      if (field.objectFieldReference) {
        lines.push(tag('objectFieldReference', field.objectFieldReference, indent + 1));
      }
      if (field.scale !== undefined) lines.push(tag('scale', String(field.scale), indent + 1));
      if (field.storeOutputAutomatically !== undefined) {
        lines.push(tag('storeOutputAutomatically', String(field.storeOutputAutomatically), indent + 1));
      }
      if (field.styleProperties) {
        writeStyleProperties(lines, field.styleProperties, indent + 1);
      }
      if (field.validation) {
        lines.push(`${'    '.repeat(indent + 1)}<validationRule>`);
        lines.push(tag('errorMessage', escapeXml(field.validation.errorMessage), indent + 2));
        lines.push(tag('formulaExpression', escapeXml(field.validation.formula), indent + 2));
        lines.push(`${'    '.repeat(indent + 1)}</validationRule>`);
      }
      if (field.visibleWhen) {
        writeVisibilityRule(lines, field.visibleWhen, indent + 1);
      }
    }
  }

  lines.push(`${pad}</fields>`);
}

function writeRawXml(lines: string[], step: RawStep): void {
  // Raw XML is emitted directly, wrapped in the element type tag
  // Re-inject connectors into the XML
  const xmlContent = step.xml;
  lines.push(`    <${step.elementType}>`);

  // If the raw XML is a placeholder comment, just emit name + connectors
  if (xmlContent.startsWith('<!--')) {
    lines.push(tag('name', step.raw, 2));
    writeLocationXY(lines);
    if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
    if (step.faultNext) {
      writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
    }
  } else {
    // Emit the raw XML content (should be inner XML without the wrapping tag)
    for (const line of xmlContent.split('\n')) {
      lines.push(`        ${line}`);
    }
    // Re-add connectors
    if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
    if (step.faultNext) {
      writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
    }
  }

  lines.push(`    </${step.elementType}>`);
}

// ============================================================
// Declaration Writers
// ============================================================

function writeVariableXml(lines: string[], name: string, v: VariableDeclaration): void {
  lines.push('    <variables>');
  if (v.description) lines.push(tag('description', escapeXml(v.description), 2));
  lines.push(tag('name', name, 2));
  if (v.apexClass) lines.push(tag('apexClass', v.apexClass, 2));
  lines.push(tag('dataType', v.dataType, 2));
  lines.push(tag('isCollection', String(v.isCollection ?? false), 2));
  lines.push(tag('isInput', String(v.isInput ?? false), 2));
  lines.push(tag('isOutput', String(v.isOutput ?? false), 2));
  if (v.objectType) lines.push(tag('objectType', v.objectType, 2));
  if (v.scale !== undefined) lines.push(tag('scale', String(v.scale), 2));
  if (v.defaultValue !== undefined) {
    const pv = inferParsedValue(v.defaultValue);
    const dvDisplay = v.defaultValueString ?? pv.originalString ?? String(pv.value);
    lines.push('        <value>');
    const xmlTag = v.valueXmlTag ?? getXmlValueTag(pv);
    lines.push(`            <${xmlTag}>${escapeXml(dvDisplay)}</${xmlTag}>`);
    lines.push('        </value>');
  }
  lines.push('    </variables>');
}

function writeFormulaXml(lines: string[], name: string, f: FormulaDeclaration): void {
  lines.push('    <formulas>');
  writeProcessMetadataEntries(lines, f.processMetadataValues, 2);
  if (f.description) lines.push(tag('description', escapeXml(f.description), 2));
  lines.push(tag('name', name, 2));
  lines.push(tag('dataType', f.dataType, 2));
  lines.push(tag('expression', escapeXml(f.expression), 2));
  if (f.scale !== undefined) lines.push(tag('scale', String(f.scale), 2));
  lines.push('    </formulas>');
}

function writeConstantXml(lines: string[], name: string, c: ConstantDeclaration): void {
  lines.push('    <constants>');
  lines.push(tag('name', name, 2));
  lines.push(tag('dataType', c.dataType, 2));
  const pv = inferParsedValue(c.value);
  lines.push('        <value>');
  const xmlTag = c.valueXmlTag ?? getXmlValueTag(pv);
  lines.push(`            <${xmlTag}>${escapeXml(String(pv.value))}</${xmlTag}>`);
  lines.push('        </value>');
  lines.push('    </constants>');
}

function writeTextTemplateXml(lines: string[], name: string, tt: TextTemplateDeclaration): void {
  lines.push('    <textTemplates>');
  if (tt.description !== undefined) {
    lines.push(tag('description', escapeXml(tt.description), 2));
  }
  lines.push(tag('name', name, 2));
  if (tt.isViewedAsPlainText !== undefined) lines.push(tag('isViewedAsPlainText', String(tt.isViewedAsPlainText), 2));
  lines.push(tag('text', escapeXml(tt.text), 2));
  lines.push('    </textTemplates>');
}

/**
 * Fail the conversion on choice sets the org would reject: an unrecognized
 * type would be dropped from the output without a word (leaving screen fields
 * pointing at a choice that no longer exists), and a record/collection choice
 * set without `object` deploys into a misleading org error that blames the
 * collectionReference.
 */
function assertChoiceSets(doc: FlowMLDocument): void {
  if (!doc.choiceSets) return;
  for (const [name, cs] of Object.entries(doc.choiceSets)) {
    if (!isValidChoiceSetType(cs.type)) {
      throw new Error(choiceSetTypeError(name, cs.type));
    }
    if (choiceSetMissingObject(cs)) {
      throw new Error(choiceSetMissingObjectError(name));
    }
  }
}

function writeDynamicChoiceSetXml(lines: string[], name: string, cs: ChoiceSetDeclaration): void {
  lines.push('    <dynamicChoiceSets>');
  if (cs.description) lines.push(tag('description', escapeXml(cs.description), 2));
  lines.push(tag('name', name, 2));
  if (cs.collectionReference) lines.push(tag('collectionReference', cs.collectionReference, 2));
  if (cs.dataType) lines.push(tag('dataType', cs.dataType, 2));
  if (cs.nilFields?.includes('displayField')) {
    lines.push('        <displayField xsi:nil="true"/>');
  } else if (cs.displayField) {
    lines.push(tag('displayField', cs.displayField, 2));
  }
  if (cs.where) writeFilters(lines, cs.where, 2);
  if (cs.limit !== undefined) {
    if (cs.limitXmlTag === '__scalar__') {
      lines.push(tag('limit', cs.limitString ?? String(cs.limit), 2));
    } else {
      lines.push('        <limit>');
      lines.push(tag('numberValue', cs.limitString ?? String(cs.limit), 3));
      lines.push('        </limit>');
    }
  }
  if (cs.nilFields?.includes('object')) {
    lines.push('        <object xsi:nil="true"/>');
  } else if (cs.object) {
    lines.push(tag('object', cs.object, 2));
  }
  if (cs.outputAssignments) {
    for (const assignment of cs.outputAssignments) {
      lines.push('        <outputAssignments>');
      lines.push(tag('assignToReference', assignment.assignToReference, 3));
      lines.push(tag('field', assignment.field, 3));
      lines.push('        </outputAssignments>');
    }
  }
  if (!cs.collectionReference) {
    if (cs.field) lines.push(tag('picklistField', cs.field, 2));
    const picklistObject = cs.picklistObject ?? (cs.field ? cs.object : undefined);
    if (picklistObject) lines.push(tag('picklistObject', picklistObject, 2));
  }
  if (cs.sortField) lines.push(tag('sortField', cs.sortField, 2));
  if (cs.sortOrder) lines.push(tag('sortOrder', cs.sortOrder, 2));
  if (cs.valueField) lines.push(tag('valueField', cs.valueField, 2));
  lines.push('    </dynamicChoiceSets>');
}

function writeChoiceXml(lines: string[], name: string, c: ChoiceDeclaration): void {
  lines.push('    <choices>');
  lines.push(tag('name', name, 2));
  lines.push(tag('choiceText', escapeXml(c.label), 2));
  lines.push(tag('dataType', c.dataType, 2));
  if (c.valueXmlTag !== '__empty__') {
    const pv = inferParsedValue(c.value);
    const xmlTag = c.valueXmlTag ?? getXmlValueTag(pv);
    const displayValue = c.valueString ?? String(pv.value);
    lines.push('        <value>');
    lines.push(`            <${xmlTag}>${escapeXml(displayValue)}</${xmlTag}>`);
    lines.push('        </value>');
  }
  lines.push('    </choices>');
}

// ============================================================
// Process Metadata
// ============================================================

function writeProcessMetadata(lines: string[], flow: FlowHeader): void {
  // Default mode: rawProcessMetadata is set (possibly empty) and represents the exact
  // PMV list to emit. Empty array correctly produces no <processMetadataValues> output.
  if (flow.rawProcessMetadata !== undefined) {
    for (const entry of flow.rawProcessMetadata) {
      lines.push('    <processMetadataValues>');
      lines.push(tag('name', entry.name, 2));
      if (entry.xmlTag !== '__empty__') {
        lines.push('        <value>');
        lines.push(tag(entry.xmlTag ?? 'stringValue', escapeXml(entry.value), 3));
        lines.push('        </value>');
      }
      lines.push('    </processMetadataValues>');
    }
    return;
  }

  // Compact mode (or hand-authored doc): regenerate defensive BuilderType/CanvasMode
  // boilerplate so output XML deploys cleanly, then append any preserved custom entries.
  lines.push('    <processMetadataValues>');
  lines.push(tag('name', 'BuilderType', 2));
  lines.push('        <value>');
  lines.push(tag('stringValue', 'LightningFlowBuilder', 3));
  lines.push('        </value>');
  lines.push('    </processMetadataValues>');

  lines.push('    <processMetadataValues>');
  lines.push(tag('name', 'CanvasMode', 2));
  lines.push('        <value>');
  lines.push(tag('stringValue', 'AUTO_LAYOUT_CANVAS', 3));
  lines.push('        </value>');
  lines.push('    </processMetadataValues>');

  if (flow.processMetadata) {
    for (const [key, val] of Object.entries(flow.processMetadata)) {
      lines.push('    <processMetadataValues>');
      lines.push(tag('name', key, 2));
      lines.push('        <value>');
      lines.push(tag('stringValue', escapeXml(val), 3));
      lines.push('        </value>');
      lines.push('    </processMetadataValues>');
    }
  }
}

function writeProcessMetadataEntries(
  lines: string[],
  entries: Array<{ name: string; value: string; xmlTag?: string }> | undefined,
  indent: number
): void {
  if (!entries?.length) return;
  const pad = '    '.repeat(indent);
  for (const entry of entries) {
    lines.push(`${pad}<processMetadataValues>`);
    lines.push(tag('name', entry.name, indent + 1));
    if (entry.xmlTag !== '__empty__') {
      lines.push(`${pad}    <value>`);
      lines.push(tag(entry.xmlTag ?? 'stringValue', escapeXml(entry.value), indent + 2));
      lines.push(`${pad}    </value>`);
    }
    lines.push(`${pad}</processMetadataValues>`);
  }
}

// ============================================================
// Condition/Filter Writers
// ============================================================

function writeFilters(
  lines: string[],
  conditions: ConditionList,
  indent: number,
  processMetadataValues?: Array<Array<{ name: string; value: string; xmlTag?: string }>>
): void {
  let index = 0;
  if (Array.isArray(conditions)) {
    if (conditions.length > 0) {
      lines.push(tag('filterLogic', 'and', indent));
    }
    for (const condStr of conditions) {
      writeFilterFromString(lines, condStr, indent, processMetadataValues?.[index++]);
    }
  } else {
    // Complex condition
    const complex = conditions as ComplexCondition;
    lines.push(tag('filterLogic', complex.logic, indent));
    for (const [, condStr] of Object.entries(complex.conditions)) {
      writeFilterFromString(lines, condStr, indent, processMetadataValues?.[index++]);
    }
  }
}

function writeFilterFromString(
  lines: string[],
  condStr: string,
  indent: number,
  processMetadataValues?: Array<{ name: string; value: string; xmlTag?: string }>
): void {
  const parsed = parseConditionString(condStr);
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<filters>`);
  writeProcessMetadataEntries(lines, processMetadataValues, indent + 1);
  lines.push(tag('field', parsed.leftOperand, indent + 1));
  lines.push(tag('operator', parsed.operator, indent + 1));
  if (parsed.rightValue && parsed.rightValue.originalXmlTag !== '__null__') {
    writeValueTag(lines, parsed.rightValue, indent + 1);
  }
  lines.push(`${pad}</filters>`);
}

function writeConditions(
  lines: string[],
  when: ConditionList,
  indent: number,
  tagName = 'conditions',
  processMetadataValues?: Array<Array<{ name: string; value: string; xmlTag?: string }>>
): void {
  let index = 0;
  if (Array.isArray(when)) {
    for (const condStr of when) {
      writeConditionFromString(
        lines, condStr, indent, tagName, processMetadataValues?.[index++]
      );
    }
  } else {
    const complex = when as ComplexCondition;
    for (const [, condStr] of Object.entries(complex.conditions)) {
      writeConditionFromString(
        lines, condStr, indent, tagName, processMetadataValues?.[index++]
      );
    }
  }
}

function writeConditionFromString(
  lines: string[],
  condStr: string,
  indent: number,
  tagName: string,
  processMetadataValues?: Array<{ name: string; value: string; xmlTag?: string }>
): void {
  const parsed = parseConditionString(condStr);
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<${tagName}>`);
  writeProcessMetadataEntries(lines, processMetadataValues, indent + 1);
  lines.push(tag('leftValueReference', parsed.leftOperand, indent + 1));
  lines.push(tag('operator', parsed.operator, indent + 1));
  if (parsed.rightValue && parsed.rightValue.originalXmlTag !== '__null__') {
    lines.push(`${'    '.repeat(indent + 1)}<rightValue>`);
    const rvDisplay = parsed.rightValue.originalString ?? String(parsed.rightValue.value);
    const xmlTag = parsed.rightValue.originalXmlTag ?? getXmlValueTag(parsed.rightValue);
    lines.push(`${'    '.repeat(indent + 2)}<${xmlTag}>${escapeXml(rvDisplay)}</${xmlTag}>`);
    lines.push(`${'    '.repeat(indent + 1)}</rightValue>`);
  }
  lines.push(`${pad}</${tagName}>`);
}

function getConditionLogic(when: ConditionList, conditionLogic?: string): string {
  if (conditionLogic) return conditionLogic;
  if (!Array.isArray(when)) return (when as ComplexCondition).logic;
  return 'and';
}

function getConditionLogicFromList(conditions: ConditionList): string {
  if (!Array.isArray(conditions)) return (conditions as ComplexCondition).logic;
  return 'and';
}

function writeVisibilityRule(lines: string[], conditions: ConditionList, indent: number): void {
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<visibilityRule>`);
  if (Array.isArray(conditions)) {
    lines.push(tag('conditionLogic', 'and', indent + 1));
    for (const condStr of conditions) {
      writeConditionFromString(lines, condStr, indent + 1, 'conditions');
    }
  } else {
    const complex = conditions as ComplexCondition;
    lines.push(tag('conditionLogic', complex.logic, indent + 1));
    for (const [, condStr] of Object.entries(complex.conditions)) {
      writeConditionFromString(lines, condStr, indent + 1, 'conditions');
    }
  }
  lines.push(`${pad}</visibilityRule>`);
}

// ============================================================
// Input Assignments (fields -> inputAssignments)
// ============================================================

function writeInputAssignments(
  lines: string[],
  fields: Record<string, unknown>,
  indent: number,
  xmlTags?: Record<string, string>,
  complexValueTypes?: Record<string, string>,
  processMetadataValues?: Record<string, Array<{ name: string; value: string; xmlTag?: string }>>,
  setupReferenceTypes?: Record<string, string>
): void {
  const pad = '    '.repeat(indent);
  for (const [fieldName, val] of Object.entries(fields)) {
    lines.push(`${pad}<inputAssignments>`);
    writeProcessMetadataEntries(lines, processMetadataValues?.[fieldName], indent + 1);
    lines.push(tag('field', fieldName, indent + 1));
    if (val === null) {
      // Null-clear: field with no value
    } else {
      const pv = inferInputValue(val, xmlTags?.[fieldName]);
      applyValueProvenance(pv, fieldName, xmlTags, complexValueTypes, undefined, setupReferenceTypes);
      writeValueTag(lines, pv, indent + 1);
    }
    lines.push(`${pad}</inputAssignments>`);
  }
}

// ============================================================
// Utility Functions
// ============================================================

function tag(name: string, value: string, indent: number): string {
  const pad = '    '.repeat(indent);
  return `${pad}<${name}>${value}</${name}>`;
}

function writeBooleanField(
  lines: string[],
  name: string,
  value: boolean,
  indent: number,
  wrappers?: string[]
): void {
  if (!wrappers?.includes(name)) {
    lines.push(tag(name, String(value), indent));
    return;
  }
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<${name}>`);
  lines.push(tag('booleanValue', String(value), indent + 1));
  lines.push(`${pad}</${name}>`);
}

function writeLocationXY(lines: string[], step?: { locationX?: number; locationY?: number }): void {
  lines.push(tag('locationX', String(step?.locationX ?? 0), 2));
  lines.push(tag('locationY', String(step?.locationY ?? 0), 2));
}

function writeConnector(lines: string[], target: string, indent: number, isGoTo?: boolean): void {
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<connector>`);
  if (isGoTo) lines.push(tag('isGoTo', 'true', indent + 1));
  lines.push(tag('targetReference', target, indent + 1));
  lines.push(`${pad}</connector>`);
}

function writeFaultConnector(lines: string[], target: string, indent: number, isGoTo?: boolean): void {
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<faultConnector>`);
  if (isGoTo) lines.push(tag('isGoTo', 'true', indent + 1));
  lines.push(tag('targetReference', target, indent + 1));
  lines.push(`${pad}</faultConnector>`);
}

/**
 * Infer a ParsedValue for an inputs:/fields: value. When no explicit XML tag
 * pins the value, a string wrapped in double quotes is an explicit literal:
 * the quotes are stripped and the value is always a stringValue. This lets
 * authors write literals that contain dots (which bare inference would treat
 * as element references), e.g. `emailSubject: '"v2.1 released"'`.
 */
function inferInputValue(val: unknown, explicitTag: string | undefined): ParsedValue {
  if (explicitTag === undefined && isQuotedLiteral(val)) {
    return { type: 'string', value: val.slice(1, -1) };
  }
  return inferParsedValue(val);
}

function writeValueTag(lines: string[], pv: ParsedValue, indent: number): void {
  const pad = '    '.repeat(indent);
  if (pv.originalXmlTag === 'setupReference') {
    lines.push(`${pad}<value>`);
    lines.push(`${pad}    <setupReference>${escapeXml(String(pv.value))}</setupReference>`);
    if (pv.setupReferenceType) {
      lines.push(`${pad}    <setupReferenceType>${escapeXml(pv.setupReferenceType)}</setupReferenceType>`);
    }
    lines.push(`${pad}</value>`);
    return;
  }
  if (pv.originalXmlTag === 'complexValue') {
    lines.push(`${pad}<value>`);
    lines.push(`${pad}    <complexValue>${escapeXml(String(pv.value))}</complexValue>`);
    if (pv.complexValueType) {
      lines.push(`${pad}    <complexValueType>${escapeXml(pv.complexValueType)}</complexValueType>`);
    }
    lines.push(`${pad}</value>`);
    return;
  }
  // Special case: collectionElements nesting
  if (pv.originalXmlTag === 'collectionElements') {
    lines.push(`${pad}<value>`);
    const values = Array.isArray(pv.value) ? pv.value : [String(pv.value)];
    for (let index = 0; index < values.length; index++) {
      const elementType = pv.collectionElementTypes?.[index] ?? 'elementReference';
      lines.push(`${pad}    <collectionElements>`);
      lines.push(
        `${pad}        <${elementType}>${escapeXml(String(values[index]))}</${elementType}>`
      );
      lines.push(`${pad}    </collectionElements>`);
    }
    lines.push(`${pad}</value>`);
    return;
  }
  const xmlTag = pv.originalXmlTag ?? getXmlValueTag(pv);
  const displayValue = pv.originalString ?? String(pv.value);
  lines.push(`${pad}<value>`);
  lines.push(`${pad}    <${xmlTag}>${escapeXml(displayValue)}</${xmlTag}>`);
  lines.push(`${pad}</value>`);
}

function applyValueProvenance(
  value: ParsedValue,
  name: string,
  xmlTags?: Record<string, string>,
  complexValueTypes?: Record<string, string>,
  collectionElementTypes?: Record<string, string[]>,
  setupReferenceTypes?: Record<string, string>
): void {
  if (xmlTags?.[name]) value.originalXmlTag = xmlTags[name];
  if (complexValueTypes?.[name]) {
    value.originalXmlTag = 'complexValue';
    value.complexValueType = complexValueTypes[name];
  }
  if (collectionElementTypes?.[name]) {
    value.originalXmlTag = 'collectionElements';
    value.collectionElementTypes = collectionElementTypes[name];
  }
  if (setupReferenceTypes?.[name]) {
    value.originalXmlTag = 'setupReference';
    value.setupReferenceType = setupReferenceTypes[name];
  }
}

function writeStyleProperties(lines: string[], props: Record<string, string>, indent: number): void {
  const pad = '    '.repeat(indent);
  lines.push(`${pad}<styleProperties>`);
  for (const [key, val] of Object.entries(props)) {
    lines.push(`${'    '.repeat(indent + 1)}<${key}>`);
    lines.push(tag('stringValue', escapeXml(val), indent + 2));
    lines.push(`${'    '.repeat(indent + 1)}</${key}>`);
  }
  lines.push(`${pad}</styleProperties>`);
}

// ============================================================
// New Element Writers
// ============================================================

function writeCustomErrorXml(lines: string[], step: CustomErrorStep): void {
  lines.push('    <customErrors>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.customError, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.messages) {
    for (const msg of step.messages) {
      lines.push('        <customErrorMessages>');
      lines.push(tag('errorMessage', escapeXml(msg.errorMessage), 3));
      if (msg.fieldSelection) lines.push(tag('fieldSelection', msg.fieldSelection, 3));
      lines.push(tag('isFieldError', String(msg.isFieldError), 3));
      lines.push('        </customErrorMessages>');
    }
  }
  lines.push('    </customErrors>');
}

function writeWaitXml(lines: string[], step: WaitStep): void {
  lines.push('    <waits>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.wait, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.defaultNext) {
    lines.push('        <defaultConnector>');
    lines.push(tag('targetReference', step.defaultNext, 3));
    lines.push('        </defaultConnector>');
  }
  if (step.defaultLabel) lines.push(tag('defaultConnectorLabel', escapeXml(step.defaultLabel), 2));
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  for (const event of step.events) {
    lines.push('        <waitEvents>');
    if (event.conditionLogic) lines.push(tag('conditionLogic', event.conditionLogic, 3));
    if (event.conditions) {
      writeConditions(lines, event.conditions, 3, 'conditions');
    }
    if (event.next) writeConnector(lines, event.next, 3);
    lines.push(tag('eventType', event.eventType, 3));
    if (event.inputs) {
      for (const [paramName, val] of Object.entries(event.inputs)) {
        lines.push('            <inputParameters>');
        lines.push(tag('name', paramName, 4));
        const pv = inferInputValue(val, event.inputXmlTags?.[paramName]);
        applyValueProvenance(
          pv,
          paramName,
          event.inputXmlTags,
          event.inputComplexValueTypes,
          event.inputCollectionElementTypes,
          event.inputSetupReferenceTypes
        );
        writeValueTag(lines, pv, 4);
        lines.push('            </inputParameters>');
      }
    }
    if (event.label) lines.push(tag('label', escapeXml(event.label), 3));
    lines.push(tag('name', event.name, 3));
    if (event.outputs) {
      for (const [paramName, ref] of Object.entries(event.outputs)) {
        lines.push('            <outputParameters>');
        lines.push(tag('assignToReference', ref, 4));
        lines.push(tag('name', paramName, 4));
        lines.push('            </outputParameters>');
      }
    }
    lines.push('        </waitEvents>');
  }
  lines.push('    </waits>');
}

function writeRecordLockXml(lines: string[], step: RecordLockStep): void {
  lines.push('    <recordLocks>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.recordLock, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  if (step.faultNext) writeFaultConnector(lines, step.faultNext, 2, step.faultIsGoTo);
  if (step.inputReference) lines.push(tag('inputReference', step.inputReference, 2));
  if (step.lockOrUnlock) lines.push(tag('lockOrUnlock', step.lockOrUnlock, 2));
  lines.push('    </recordLocks>');
}

function writeRecordRollbackXml(lines: string[], step: RecordRollbackStep): void {
  lines.push('    <recordRollbacks>');
  if (step.description) lines.push(tag('description', escapeXml(step.description), 2));
  lines.push(tag('name', step.recordRollback, 2));
  if (step.label) lines.push(tag('label', escapeXml(step.label), 2));
  writeLocationXY(lines, step);
  if (step.next) writeConnector(lines, step.next, 2, step.isGoTo);
  lines.push('    </recordRollbacks>');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


// ============================================================
// Filter auto-synthesis (activation-valid XML)
// ============================================================
//
// Salesforce's Flow Filter element requires three things the YAML DSL doesn't
// force the user to write explicitly:
//   1. <assignNextValueToReference> (the per-item variable)
//   2. A matching <variables> entry with dataType: SObject + objectType
//   3. Qualified field refs in each <conditions> (e.g. Filter_X_CurrentItem.Field)
//
// If any of these is missing, the flow deploys but fails activation with
// "currentCollectionValue can't be null". We fill in the gaps at emit time so
// terse FlowML still produces activation-valid XML.

function cloneForEmit(doc: FlowMLDocument): FlowMLDocument {
  return {
    ...doc,
    steps: doc.steps.map(s => ({ ...s })),
    variables: doc.variables ? { ...doc.variables } : undefined,
  } as FlowMLDocument;
}

function synthesizeFilterItemVariables(doc: FlowMLDocument): void {
  for (const step of doc.steps) {
    if (!('filter' in step)) continue;
    const filter = step as FilterStep;

    const wasImplicit = !filter.itemVariable;
    if (wasImplicit) {
      filter.itemVariable = `${filter.filter}_CurrentItem`;
    }
    const itemVar = filter.itemVariable!;

    const existing = doc.variables?.[itemVar];
    if (!existing) {
      const objectType = inferCollectionObjectType(doc, filter.collection);
      if (!objectType) {
        const hint = wasImplicit
          ? `Declare an itemVariable explicitly and add it to variables: (dataType: SObject, objectType: <YourObject>, isCollection: false)`
          : `Add a variables: entry for "${itemVar}" with dataType: SObject and objectType: <YourObject>`;
        throw new Error(
          `Filter "${filter.filter}" references collection "${filter.collection}" whose SObject type cannot be inferred. ${hint}.`
        );
      }
      if (!doc.variables) doc.variables = {};
      doc.variables[itemVar] = {
        dataType: 'SObject',
        objectType,
        isCollection: false,
      };
    }

    if (filter.where) {
      filter.where = qualifyWhereClause(filter.where, itemVar);
    }
  }
}

function qualifyWhereClause(where: ConditionList, itemVar: string): ConditionList {
  if (Array.isArray(where)) {
    return where.map(c => qualifyCondition(c, itemVar));
  }
  const complex = where as ComplexCondition;
  const newConds: Record<string, string> = {};
  for (const [k, v] of Object.entries(complex.conditions)) {
    newConds[k] = qualifyCondition(v, itemVar);
  }
  return { ...complex, conditions: newConds };
}

function qualifyCondition(condStr: string, itemVar: string): string {
  const trimmed = condStr.trim();
  const m = trimmed.match(/^(\S+)(.*)$/);
  if (!m) return condStr;
  const leftOp = m[1];
  const rest = m[2];
  if (leftOp === itemVar) return condStr;
  if (!isBareFieldRef(leftOp)) return condStr;
  return `${itemVar}.${leftOp}${rest}`;
}

function isBareFieldRef(token: string): boolean {
  if (!token) return false;
  if (token.includes('.')) return false;
  if (token.startsWith('$')) return false;
  if (token.startsWith('{')) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(token);
}
