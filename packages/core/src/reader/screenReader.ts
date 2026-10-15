// ============================================================
// Screen Reader: Parse XML screen fields to FlowML screen fields
// ============================================================

import type {
  ScreenField, InputScreenField, DropdownScreenField,
  MultiselectScreenField, RadioScreenField, TextareaScreenField,
  CheckboxScreenField, ToggleScreenField, DisplayScreenField,
  ComponentScreenField, SectionScreenField, SectionColumn,
  RepeaterScreenField, ObjectProvidedScreenField,
  ConditionList, ScreenFieldValidation, ProcessMetadataValue,
} from '../types.js';
import { SCREEN_FIELD_TYPES_REVERSE } from '../mappings.js';
import {
  xmlConditionToString,
  extractXmlValue,
  getXmlValueTag,
  inferParsedValue,
  needsXmlTagPreservation,
} from '../parsers.js';

/**
 * Parse XML screen fields array into FlowML ScreenField array.
 */
export function readScreenFields(fields: unknown[]): ScreenField[] {
  if (!fields || !Array.isArray(fields)) return [];
  return fields.map(f => {
    const raw = f as Record<string, unknown>;
    const parsed = readScreenField(raw);
    if (!parsed) return null;
    const entries = ensureArray(raw.processMetadataValues as unknown[])
      .map(readProcessMetadataEntry);
    if (entries.length) {
      (parsed as { processMetadataValues?: ProcessMetadataValue[] })
        .processMetadataValues = entries;
    }
    return parsed;
  }).filter(Boolean) as ScreenField[];
}

function readProcessMetadataEntry(entry: unknown): ProcessMetadataValue {
  const er = entry as Record<string, unknown>;
  const value = er.value as Record<string, unknown> | undefined;
  const extracted = value ? extractXmlValue(value) : undefined;
  const result: ProcessMetadataValue = {
    name: str(er.name),
    value: extracted?.originalString ?? String(extracted?.value ?? ''),
    xmlTag: extracted?.originalXmlTag ?? '__empty__',
  };
  return result;
}

function readScreenField(field: Record<string, unknown>): ScreenField | null {
  const fieldType = str(field.fieldType);
  const yamlType = SCREEN_FIELD_TYPES_REVERSE[fieldType];

  if (fieldType === 'RegionContainer') {
    return readSection(field);
  }

  if (fieldType === 'Region') {
    // Regions are handled by section reader, should not appear at top level
    return null;
  }

  if (fieldType === 'DisplayText') {
    return readDisplayText(field);
  }

  if (fieldType === 'ComponentInstance' || fieldType === 'ComponentChoice' || fieldType === 'ComponentInput') {
    return readComponent(field, fieldType);
  }

  if (fieldType === 'Repeater') {
    return readRepeater(field);
  }

  if (fieldType === 'ObjectProvided') {
    return readObjectProvided(field);
  }

  // Standard field types
  if (yamlType && [
    'input', 'password', 'dropdown', 'multiselect', 'multiselectCheckboxes',
    'radio', 'textarea', 'checkbox', 'toggle',
  ].includes(yamlType)) {
    return readStandardField(field, yamlType);
  }

  // Preserve unknown field types verbatim through the component-shaped raw form.
  if (fieldType) {
    return readComponent(field, fieldType);
  }

  return null;
}

// ============================================================
// Section (RegionContainer)
// ============================================================

function readSection(field: Record<string, unknown>): SectionScreenField {
  const nestedFields = ensureArray(field.fields as unknown[]);
  const columns: SectionColumn[] = [];

  for (const region of nestedFields) {
    const r = region as Record<string, unknown>;
    if (str(r.fieldType) !== 'Region') continue;

    // Get width from inputParameters
    let width = 12;
    const inputParams = ensureArray(r.inputParameters as unknown[]);
    for (const ip of inputParams) {
      const ipr = ip as Record<string, unknown>;
      if (str(ipr.name) === 'width') {
        const val = ipr.value as Record<string, unknown> | undefined;
        if (val) {
          const extracted = extractXmlValue(val);
          if (extracted) width = Number(extracted.value) || 12;
        }
      }
    }

    // Parse nested fields within the region
    const regionFields = ensureArray(r.fields as unknown[]);
    const parsedFields = regionFields
      .map(f => readScreenField(f as Record<string, unknown>))
      .filter(Boolean) as ScreenField[];

    const regionName = str(r.name) || undefined;
    const col: SectionColumn = {
      name: regionName,
      width,
      fields: parsedFields.length > 0 ? parsedFields : undefined,
    };
    const regionRequired = readBooleanProperty(r, 'isRequired');
    if (regionRequired) {
      col.isRequired = regionRequired.value;
      if (regionRequired.wrapped) col.booleanValueWrappers = ['isRequired'];
    }
    const regionVisibility = readVisibilityRule(r as Record<string, unknown>);
    if (regionVisibility) col.visibleWhen = regionVisibility;
    const regionSp = readStyleProperties(r as Record<string, unknown>);
    if (regionSp) col.styleProperties = regionSp;
    columns.push(col);
  }

  const result: SectionScreenField = {
    section: {
      name: str(field.name),
      columns,
    },
  };

  // isRequired on container
  const containerRequired = readBooleanProperty(field, 'isRequired');
  if (containerRequired) {
    result.section.isRequired = containerRequired.value;
    if (containerRequired.wrapped) result.section.booleanValueWrappers = ['isRequired'];
  }

  // styleProperties on container
  const containerSp = readStyleProperties(field);
  if (containerSp) result.section.styleProperties = containerSp;

  // visibilityRule on container
  const containerVisibility = readVisibilityRule(field as Record<string, unknown>);
  if (containerVisibility) result.section.visibleWhen = containerVisibility;

  // Label from regionContainerType — check both label and fieldText sources
  const containerType = str(field.regionContainerType);
  if (containerType === 'SectionWithHeader') {
    const label = str(field.label);
    const fieldTextLabel = str(field.fieldText);
    if (fieldTextLabel) {
      result.section.label = fieldTextLabel;
      result.section.labelSource = 'fieldText';
    } else if (label) {
      result.section.label = label;
      result.section.labelSource = 'label';
    }
  }

  return result;
}

// ============================================================
// Display Text
// ============================================================

function readDisplayText(field: Record<string, unknown>): DisplayScreenField {
  const result: DisplayScreenField = {
    display: str(field.name),
    value: str(field.fieldText) || '',
  };
  if (field.helpText) result.helpText = str(field.helpText);

  const visibilityRule = readVisibilityRule(field);
  if (visibilityRule) result.visibleWhen = visibilityRule;

  // Additional properties for round-trip fidelity
  if (field.inputsOnNextNavToAssocScrn !== undefined) result.inputsOnNextNavToAssocScrn = str(field.inputsOnNextNavToAssocScrn);
  const sp = readStyleProperties(field);
  if (sp) result.styleProperties = sp;

  return result;
}

// ============================================================
// Component Instance
// ============================================================

function readComponent(field: Record<string, unknown>, fieldType?: string): ComponentScreenField {
  const result: ComponentScreenField = {
    component: str(field.name),
    extensionName: str(field.extensionName) || '',
  };

  if (fieldType && fieldType !== 'ComponentInstance') result.fieldType = fieldType;

  if (field.dataType) result.dataType = str(field.dataType);
  if (field.fieldText) {
    result.label = str(field.fieldText);
    result.labelSource = 'fieldText';
  }
  if (field.objectType) result.objectType = str(field.objectType);
  const required = readBooleanProperty(field, 'isRequired');
  if (required) {
    result.required = required.value;
    if (required.wrapped) result.booleanValueWrappers = ['isRequired'];
  }

  // Input parameters
  const inputParams = ensureArray(field.inputParameters as unknown[]);
  if (inputParams.length) {
    result.inputs = {};
    for (const ip of inputParams) {
      const ipr = ip as Record<string, unknown>;
      const paramName = str(ipr.name);
      const val = ipr.value as Record<string, unknown> | undefined;
      if (val) {
        const extracted = extractXmlValue(val);
        if (extracted) {
          result.inputs[paramName] = extracted.value;
          if (extracted.complexValueType) {
            if (!result.inputComplexValueTypes) result.inputComplexValueTypes = {};
            result.inputComplexValueTypes[paramName] = extracted.complexValueType;
          }
          if (extracted.setupReferenceType) {
            if (!result.inputSetupReferenceTypes) result.inputSetupReferenceTypes = {};
            result.inputSetupReferenceTypes[paramName] = extracted.setupReferenceType;
          }
          if (extracted.collectionElementTypes) {
            if (!result.inputCollectionElementTypes) result.inputCollectionElementTypes = {};
            result.inputCollectionElementTypes[paramName] = extracted.collectionElementTypes;
          }
          if (needsXmlTagPreservation(extracted)) {
            if (!result.inputXmlTags) result.inputXmlTags = {};
            result.inputXmlTags[paramName] = extracted.originalXmlTag!;
          }
        }
      }
    }
  }

  // Output parameters
  const outputParams = ensureArray(field.outputParameters as unknown[]);
  if (outputParams.length) {
    result.outputs = {};
    for (const op of outputParams) {
      const opr = op as Record<string, unknown>;
      result.outputs[str(opr.name)] = str(opr.assignToReference);
    }
  }

  // Choice references (for ComponentChoice)
  const choiceRefs = ensureArray(field.choiceReferences as unknown[]);
  if (choiceRefs.length) {
    result.choices = choiceRefs.map(cr => str(cr as string));
  }

  // Data type mappings (for datatable components)
  const dtMappings = ensureArray(field.dataTypeMappings as unknown[]);
  if (dtMappings.length) {
    result.dataTypeMappings = dtMappings.map(m => {
      const mr = m as Record<string, unknown>;
      return { typeName: str(mr.typeName), typeValue: str(mr.typeValue) };
    });
  }

  const validation = readValidationRule(field);
  if (validation) result.validation = validation;

  const visibilityRule = readVisibilityRule(field);
  if (visibilityRule) result.visibleWhen = visibilityRule;

  // Additional properties for round-trip fidelity
  if (field.inputsOnNextNavToAssocScrn !== undefined) result.inputsOnNextNavToAssocScrn = str(field.inputsOnNextNavToAssocScrn);
  if (field.helpText) result.helpText = str(field.helpText);
  if (field.scale !== undefined) result.scale = Number(str(field.scale));
  if (field.storeOutputAutomatically === 'true' || field.storeOutputAutomatically === true) result.storeOutputAutomatically = true;
  const sp = readStyleProperties(field);
  if (sp) result.styleProperties = sp;

  return result;
}

// ============================================================
// Standard Field Types
// ============================================================

function readStandardField(field: Record<string, unknown>, yamlType: string): ScreenField {
  const name = str(field.name);
  const result: any = { [yamlType]: name };

  if (field.dataType) result.dataType = str(field.dataType);

  // Label from fieldText or inputParameters — track source for round-trip fidelity
  const fieldTextLabel = str(field.fieldText);
  const inputParamLabel = getInputParamValue(field, 'label');
  if (fieldTextLabel) {
    result.label = fieldTextLabel;
    result.labelSource = 'fieldText';
  } else if (inputParamLabel) {
    result.label = inputParamLabel;
    result.labelSource = 'inputParameter';
  }

  const required = readBooleanProperty(field, 'isRequired');
  const disabled = readBooleanProperty(field, 'isDisabled');
  const readOnly = readBooleanProperty(field, 'isReadOnly');
  for (const [xmlName, parsed, propertyName] of [
    ['isRequired', required, 'required'],
    ['isDisabled', disabled, 'isDisabled'],
    ['isReadOnly', readOnly, 'isReadOnly'],
  ] as const) {
    if (!parsed) continue;
    result[propertyName] = parsed.value;
    if (parsed.wrapped) {
      if (!result.booleanValueWrappers) result.booleanValueWrappers = [];
      result.booleanValueWrappers.push(xmlName);
    }
  }

  // Default value
  if (field.defaultValue) {
    const dv = field.defaultValue as Record<string, unknown>;
    const extracted = extractXmlValue(dv);
    if (extracted) {
      result.defaultValue = extracted.value;
      if (extracted.originalString !== undefined) {
        result.defaultValueString = extracted.originalString;
      }
      if (
        extracted.originalXmlTag
        && extracted.originalXmlTag !== getXmlValueTag(inferParsedValue(extracted.value))
      ) {
        result.defaultValueXmlTag = extracted.originalXmlTag;
      }
    }
  }

  // Choice references
  const choiceRefs = ensureArray(field.choiceReferences as unknown[]);
  if (choiceRefs.length) {
    result.choices = choiceRefs.map(cr => str(cr as string));
  }

  // Validation rule
  const validation = readValidationRule(field);
  if (validation) result.validation = validation;

  // Visibility rule
  const visibilityRule = readVisibilityRule(field);
  if (visibilityRule) result.visibleWhen = visibilityRule;

  // Additional properties for round-trip fidelity
  if (field.inputsOnNextNavToAssocScrn !== undefined) result.inputsOnNextNavToAssocScrn = str(field.inputsOnNextNavToAssocScrn);
  if (field.helpText) result.helpText = str(field.helpText);
  if (field.defaultSelectedChoiceReference) {
    result.defaultSelectedChoiceReference = str(field.defaultSelectedChoiceReference);
  }
  if (field.storeOutputAutomatically !== undefined) {
    result.storeOutputAutomatically = readBooleanProperty(field, 'storeOutputAutomatically')?.value;
  }
  if (field.scale !== undefined) result.scale = Number(str(field.scale));
  const sp = readStyleProperties(field);
  if (sp) result.styleProperties = sp;

  return result as ScreenField;
}

function readRepeater(field: Record<string, unknown>): RepeaterScreenField {
  const result = readStandardField(field, 'repeater') as RepeaterScreenField;
  result.fields = readScreenFields(ensureArray(field.fields as unknown[]));
  return result;
}

function readObjectProvided(field: Record<string, unknown>): ObjectProvidedScreenField {
  const result = readStandardField(field, 'objectProvided') as ObjectProvidedScreenField;
  if (field.objectFieldReference) {
    result.objectFieldReference = str(field.objectFieldReference);
  }
  return result;
}

// ============================================================
// Visibility & Validation Rules
// ============================================================

function readVisibilityRule(field: Record<string, unknown>): ConditionList | undefined {
  const rules = ensureArray(field.visibilityRule as unknown[]);
  if (!rules.length) return undefined;

  // visibilityRule is an object with conditionLogic and conditions
  const rule = rules[0] as Record<string, unknown>;
  const conditionLogic = str(rule.conditionLogic);
  const conditions = ensureArray(rule.conditions as unknown[]);

  if (!conditions.length) return undefined;

  const condStrings = conditions.map(c => {
    const cr = c as Record<string, unknown>;
    return xmlConditionToString({
      leftValueReference: str(cr.leftValueReference),
      operator: str(cr.operator),
      rightValue: cr.rightValue as Record<string, unknown> | undefined,
    });
  });

  if (!conditionLogic || conditionLogic === 'and' || conditionLogic === 'AND') {
    return condStrings;
  }

  if (conditionLogic === 'or' || conditionLogic === 'OR') {
    const numbered: Record<string, string> = {};
    for (let i = 0; i < condStrings.length; i++) {
      numbered[String(i + 1)] = condStrings[i];
    }
    return { logic: 'or', conditions: numbered };
  }

  // Complex logic
  const numbered: Record<string, string> = {};
  for (let i = 0; i < condStrings.length; i++) {
    numbered[String(i + 1)] = condStrings[i];
  }
  return { logic: conditionLogic, conditions: numbered };
}

function readValidationRule(field: Record<string, unknown>): ScreenFieldValidation | undefined {
  const vr = field.validationRule as Record<string, unknown> | undefined;
  if (!vr) return undefined;

  return {
    formula: str(vr.formulaExpression) || '',
    errorMessage: str(vr.errorMessage) || '',
  };
}

function readBooleanProperty(
  source: Record<string, unknown>,
  key: string
): { value: boolean; wrapped: boolean } | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (typeof raw === 'object' && raw !== null && 'booleanValue' in raw) {
    const value = (raw as Record<string, unknown>).booleanValue;
    return { value: value === true || value === 'true', wrapped: true };
  }
  return { value: raw === true || raw === 'true', wrapped: false };
}

// ============================================================
// Utilities
// ============================================================

function readStyleProperties(field: Record<string, unknown>): Record<string, string> | undefined {
  const sp = field.styleProperties as Record<string, unknown> | undefined;
  if (!sp) return undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith('@_') || key.startsWith('#')) continue;
    if (typeof val === 'object' && val !== null) {
      const extracted = extractXmlValue(val as Record<string, unknown>);
      if (extracted) result[key] = String(extracted.value);
    } else if (val !== undefined) {
      result[key] = str(val);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function getInputParamValue(field: Record<string, unknown>, paramName: string): string {
  const inputParams = ensureArray(field.inputParameters as unknown[]);
  for (const ip of inputParams) {
    const ipr = ip as Record<string, unknown>;
    if (str(ipr.name) === paramName) {
      const val = ipr.value as Record<string, unknown> | undefined;
      if (val) {
        const extracted = extractXmlValue(val);
        if (extracted) return String(extracted.value);
      }
    }
  }
  return '';
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
