// ============================================================
// Bidirectional Operator & Type Mappings
// ============================================================

/** Condition operators: FlowML string -> Flow XML operator */
export const CONDITION_OPERATORS: Record<string, string> = {
  '==': 'EqualTo',
  '!=': 'NotEqualTo',
  '>=': 'GreaterThanOrEqualTo',
  '>': 'GreaterThan',
  '<=': 'LessThanOrEqualTo',
  '<': 'LessThan',
  'contains': 'Contains',
  'startsWith': 'StartsWith',
  'endsWith': 'EndsWith',
  'isNull': 'IsNull',
  'isNotNull': 'IsNull',
  'isBlank': 'IsBlank',
  'isNotBlank': 'IsBlank',
  'isEmpty': 'IsEmpty',
  'isNotEmpty': 'IsEmpty',
  'isChanged': 'IsChanged',
  'isNotChanged': 'IsChanged',
  'wasSet': 'WasSet',
  'wasNotSet': 'WasSet',
  'wasSelected': 'WasSelected',
  'wasNotSelected': 'WasSelected',
  'wasVisited': 'WasVisited',
  'wasNotVisited': 'WasVisited',
  'in': 'In',
  'notIn': 'NotIn',
};

/** Flow XML operator -> FlowML string */
export const CONDITION_OPERATORS_REVERSE: Record<string, string> = {
  'EqualTo': '==',
  'NotEqualTo': '!=',
  'GreaterThan': '>',
  'GreaterThanOrEqualTo': '>=',
  'LessThan': '<',
  'LessThanOrEqualTo': '<=',
  'Contains': 'contains',
  'StartsWith': 'startsWith',
  'EndsWith': 'endsWith',
  'IsNull': 'isNull',
  'IsBlank': 'isBlank',
  'IsEmpty': 'isEmpty',
  'IsChanged': 'isChanged',
  'WasSet': 'wasSet',
  'WasSelected': 'wasSelected',
  'WasVisited': 'wasVisited',
  'In': 'in',
  'NotIn': 'notIn',
};

/** Assignment operators: FlowML string -> Flow XML operator */
export const ASSIGNMENT_OPERATORS: Record<string, string> = {
  '=': 'Assign',
  '+=': 'Add',
  '-=': 'Subtract',
  '#=': 'AssignCount',
  '++=': 'AddItem',
  '^+=': 'AddAtStart',
  '-first=': 'RemoveFirst',
  '-all=': 'RemoveAll',
  '-after=': 'RemoveAfterFirst',
  '-before=': 'RemoveBeforeFirst',
  '-pos=': 'RemovePosition',
  '-uncommon=': 'RemoveUncommon',
};

/** Flow XML assignment operator -> FlowML string */
export const ASSIGNMENT_OPERATORS_REVERSE: Record<string, string> = {
  'Assign': '=',
  'Add': '+=',
  'Subtract': '-=',
  'AssignCount': '#=',
  'AddItem': '++=',
  'AddAtStart': '^+=',
  'RemoveFirst': '-first=',
  'RemoveAll': '-all=',
  'RemoveAfterFirst': '-after=',
  'RemoveBeforeFirst': '-before=',
  'RemovePosition': '-pos=',
  'RemoveUncommon': '-uncommon=',
};

/** Screen field type: YAML keyword -> Flow XML fieldType */
export const SCREEN_FIELD_TYPES: Record<string, string> = {
  'input': 'InputField',
  'password': 'PasswordField',
  'dropdown': 'DropdownBox',
  'multiselect': 'MultiSelectPicklist',
  'multiselectCheckboxes': 'MultiSelectCheckboxes',
  'radio': 'RadioButtons',
  'textarea': 'LargeTextArea',
  'checkbox': 'CheckboxField',
  'toggle': 'Toggle',
  'display': 'DisplayText',
  'component': 'ComponentInstance',
  'repeater': 'Repeater',
  'objectProvided': 'ObjectProvided',
  'section': 'RegionContainer',
};

/** Flow XML fieldType -> YAML keyword */
export const SCREEN_FIELD_TYPES_REVERSE: Record<string, string> = {
  'InputField': 'input',
  'PasswordField': 'password',
  'DropdownBox': 'dropdown',
  'MultiSelectPicklist': 'multiselect',
  'MultiSelectCheckboxes': 'multiselectCheckboxes',
  'RadioButtons': 'radio',
  'LargeTextArea': 'textarea',
  'CheckboxField': 'checkbox',
  'Toggle': 'toggle',
  'DisplayText': 'display',
  'ComponentInstance': 'component',
  'ComponentChoice': 'component',
  'ComponentInput': 'component',
  'Repeater': 'repeater',
  'ObjectProvided': 'objectProvided',
  'RegionContainer': 'section',
};

/** Trigger type: FlowML -> XML triggerType */
export const TRIGGER_TYPES: Record<string, string> = {
  'RecordAfterSave': 'RecordAfterSave',
  'RecordBeforeSave': 'RecordBeforeSave',
  'RecordBeforeDelete': 'RecordBeforeDelete',
  'Scheduled': 'Scheduled',
  'PlatformEvent': 'PlatformEvent',
};

/** Boilerplate processMetadataValues keys that get regenerated */
export const BOILERPLATE_PROCESS_METADATA = new Set([
  'CanvasMode',
  'BuilderType',
]);

/** Operators ordered by longest-match-first for parsing */
export const CONDITION_OPERATOR_PARSE_ORDER = [
  '!=',
  '>=',
  '<=',
  '==',
  '>',
  '<',
  'notIn',
  'hasValue',
  'isNotEmpty',
  'isNotBlank',
  'isNotChanged',
  'wasNotSelected',
  'wasNotVisited',
  'wasNotSet',
  'wasSelected',
  'wasVisited',
  'wasSet',
  'isNotNull',
  'isChanged',
  'isNull',
  'isBlank',
  'isEmpty',
  'startsWith',
  'endsWith',
  'contains',
  'in',
];

/** Flow XML element type -> FlowML step key */
export const ELEMENT_TYPE_TO_STEP_KEY: Record<string, string> = {
  'recordLookups': 'lookup',
  'decisions': 'decision',
  'assignments': 'assignment',
  'recordCreates': 'recordCreate',
  'recordUpdates': 'recordUpdate',
  'recordDeletes': 'recordDelete',
  'loops': 'loop',
  'collectionProcessors': 'filter',
  'actionCalls': 'action',
  'subflows': 'subflow',
  'screens': 'screen',
  'customErrors': 'customError',
  'waits': 'wait',
  'recordLocks': 'recordLock',
  'recordRollbacks': 'recordRollback',
};

/** FlowML step key -> Flow XML element type */
export const STEP_KEY_TO_ELEMENT_TYPE: Record<string, string> = {
  'lookup': 'recordLookups',
  'decision': 'decisions',
  'assignment': 'assignments',
  'recordCreate': 'recordCreates',
  'recordUpdate': 'recordUpdates',
  'recordDelete': 'recordDeletes',
  'loop': 'loops',
  'filter': 'collectionProcessors',
  'transform': 'collectionProcessors',
  'action': 'actionCalls',
  'subflow': 'subflows',
  'screen': 'screens',
  'customError': 'customErrors',
  'wait': 'waits',
  'recordLock': 'recordLocks',
  'recordRollback': 'recordRollbacks',
};

/** Valid FlowML choiceSet discriminators. Anything else is a hard error — an
 *  unrecognized type matches no XML writer branch and would silently vanish. */
export const CHOICE_SET_TYPES = ['dynamicPicklist', 'recordChoice'] as const;

/** Lowercased near-misses -> the FlowML type they were probably meant to be.
 *  Keys are Salesforce XML tag names and other plausible guesses. */
const CHOICE_SET_TYPE_HINTS: Record<string, string> = {
  'recordchoiceset': 'recordChoice',
  'recordchoicesets': 'recordChoice',
  'recordchoices': 'recordChoice',
  'record': 'recordChoice',
  'dynamicchoiceset': 'dynamicPicklist',
  'dynamicchoicesets': 'dynamicPicklist',
  'dynamicchoice': 'dynamicPicklist',
  'picklistchoiceset': 'dynamicPicklist',
  'picklist': 'dynamicPicklist',
  'dynamic': 'dynamicPicklist',
};

/**
 * Build the error message for a choice set whose `type` is not recognized.
 * Shared by the YAML reader and the XML writer so both fail identically.
 */
export function choiceSetTypeError(name: string, rawType: unknown): string {
  const shown = typeof rawType === 'string' && rawType.length > 0
    ? `"${rawType}"`
    : rawType === undefined || rawType === null || rawType === ''
      ? '(missing)'
      : `"${String(rawType)}"`;
  const hint = typeof rawType === 'string'
    ? CHOICE_SET_TYPE_HINTS[rawType.trim().toLowerCase()]
    : undefined;
  return `Choice set "${name}" has unrecognized type ${shown}. `
    + `Valid values are: ${CHOICE_SET_TYPES.join(', ')}.`
    + (hint ? ` Did you mean "${hint}"?` : '');
}

/** True when `type` is a choiceSet discriminator the XML writer can emit. */
export function isValidChoiceSetType(type: unknown): boolean {
  return typeof type === 'string' && (CHOICE_SET_TYPES as readonly string[]).includes(type);
}

/**
 * Salesforce classifies a dynamicChoiceSets element without picklistField/
 * picklistObject as a record choice (Metadata API: FlowDynamicChoiceSet), and
 * record and collection choice sets require `object`. A collectionReference
 * always makes the set record-shaped — the XML writer suppresses picklist
 * fields whenever one is present, so stray picklist properties must not
 * exempt it. True when this choice set is missing its required object.
 */
export function choiceSetMissingObject(cs: { field?: string; picklistObject?: string; object?: string; collectionReference?: string }): boolean {
  if (cs.object) return false;
  if (cs.collectionReference) return true;
  return !cs.field && !cs.picklistObject;
}

/**
 * Build the error for a record/collection choice set with no `object`.
 * Shared by the YAML reader and the XML writer so both fail identically.
 * Without this check the deploy fails with a misleading org error that blames
 * the collectionReference instead of the missing object.
 */
export function choiceSetMissingObjectError(name: string): string {
  return `Choice set "${name}" requires "object". A choice set with a `
    + `collectionReference, or without picklistObject/field, is a record choice — `
    + `Salesforce rejects record and collection choice sets that have no object. `
    + `Add e.g. object: Account.`;
}
