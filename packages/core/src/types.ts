// ============================================================
// FlowML YAML TypeScript Types
// ============================================================

/** Top-level FlowML document */
export interface FlowMLDocument {
  flow: FlowHeader;
  trigger?: TriggerBlock;
  start?: StartBlock;
  stages?: FlowStage[];
  variables?: Record<string, VariableDeclaration>;
  formulas?: Record<string, FormulaDeclaration>;
  textTemplates?: Record<string, TextTemplateDeclaration>;
  constants?: Record<string, ConstantDeclaration>;
  choiceSets?: Record<string, ChoiceSetDeclaration>;
  choices?: Record<string, ChoiceDeclaration>;
  customProperties?: Record<string, string>;
  steps: FlowStep[];
}

// --- Flow Header ---

export interface FlowHeader {
  name: string;
  label: string;
  processType: string;
  apiVersion: string;
  status: string;
  description?: string;
  interviewLabel?: string;
  runInMode?: string;
  processMetadata?: Record<string, string>;
  rawProcessMetadata?: Array<{ name: string; value: string; xmlTag?: string }>;
  hasFullName?: boolean;
  /**
   * Unlike hasFullName, these provenance flags use explicit false to mean the
   * source XML omitted the element. Undefined keeps defaults for hand-authored
   * FlowML documents.
   */
  hasStatus?: boolean;
  hasApiVersion?: boolean;
  hasEnvironments?: boolean;
  environments?: string;
  isAdditionalPermissionRequiredToRun?: boolean;
  extraProperties?: Record<string, string>;
}

// --- Trigger / Start ---

export interface TriggerBlock {
  type: string;
  object: string;
  locationX?: number;
  locationY?: number;
  recordTriggerType?: string;
  requiresRecordChangedToMeetCriteria?: boolean;
  entryConditions?: ConditionList;
  filterFormula?: string;
  schedule?: ScheduleConfig;
  next?: string;
  scheduledPaths?: ScheduledPath[];
}

export interface ScheduleConfig {
  frequency: string;
  startDate: string;
  startTime: string;
  dayOfMonthToRun?: string;
  frequencyNumber?: number;
}

export interface ScheduledPath {
  name: string;
  label?: string;
  pathType?: string;
  timeSource?: string;
  timeField?: string;
  offsetNumber?: number;
  offsetUnit?: string;
  maxBatchSize?: number;
  next?: string;
}

export interface FlowStage {
  name: string;
  label?: string;
  description?: string;
  isActive?: boolean;
  stageOrder?: number;
}

export interface ProcessMetadataValue {
  name: string;
  value: string;
  xmlTag?: string;
}

export interface StartBlock {
  next: string;
  locationX?: number;
  locationY?: number;
}

// --- Conditions ---

/** Simple list of AND conditions or complex numbered logic */
export type ConditionList = string[] | ComplexCondition;

export interface ComplexCondition {
  logic: string;
  conditions: Record<string | number, string>;
}

// --- Declarations ---

export interface VariableDeclaration {
  dataType: string;
  apexClass?: string;
  objectType?: string;
  isCollection?: boolean;
  isInput?: boolean;
  isOutput?: boolean;
  defaultValue?: unknown;
  defaultValueString?: string;
  valueXmlTag?: string;
  description?: string;
  scale?: number;
}

export interface FormulaDeclaration {
  dataType: string;
  expression: string;
  scale?: number;
  description?: string;
  processMetadataValues?: ProcessMetadataValue[];
}

export interface TextTemplateDeclaration {
  isViewedAsPlainText?: boolean;
  text: string;
  description?: string;
}

export interface ConstantDeclaration {
  dataType: string;
  value: unknown;
  valueXmlTag?: string;
}

export interface ChoiceSetDeclaration {
  type: 'dynamicPicklist' | 'recordChoice';
  object?: string;
  picklistObject?: string;
  collectionReference?: string;
  outputAssignments?: Array<{ assignToReference: string; field: string }>;
  description?: string;
  field?: string;
  displayField?: string;
  valueField?: string;
  dataType?: string;
  where?: ConditionList;
  sortField?: string;
  sortOrder?: string;
  limit?: number;
  limitString?: string;
  limitXmlTag?: string;
  nilFields?: string[];
}

export interface ChoiceDeclaration {
  dataType: string;
  label: string;
  value: unknown;
  valueXmlTag?: string;
  valueString?: string;
}

// --- Steps ---

export type FlowStep =
  | LookupStep
  | DecisionStep
  | AssignmentStep
  | RecordCreateStep
  | RecordUpdateStep
  | RecordDeleteStep
  | LoopStep
  | FilterStep
  | TransformStep
  | ActionStep
  | SubflowStep
  | ScreenStep
  | CustomErrorStep
  | WaitStep
  | RecordLockStep
  | RecordRollbackStep
  | RawStep;

// Base for steps with common fields
interface StepBase {
  label?: string;
  description?: string;
  next?: string;
  isGoTo?: boolean;
  faultNext?: string;
  faultIsGoTo?: boolean;
  _xmlOrder?: number;
  locationX?: number;
  locationY?: number;
  processMetadataValues?: ProcessMetadataValue[];
}

export interface ReadOptions {
  /**
   * Compact mode: strip canvas coordinates (locationX/locationY) and filter
   * boilerplate processMetadataValues (CanvasMode, BuilderType) to minimize
   * token count. Round-trip is lossy in this mode — coordinates are written
   * back as 0 and stripped boilerplate metadata is not regenerated.
   * Default (omitted/false) preserves coordinates and full processMetadataValues
   * for byte-for-byte round-trip fidelity.
   */
  compact?: boolean;
  fallbackName?: string;
}

export interface LookupStep extends StepBase {
  lookup: string;
  object: string;
  getFirst?: boolean;
  fields?: string[];
  outputs?: Record<string, string>;
  outputReference?: string;
  assignNullValuesIfNoRecordsFound?: boolean;
  storeOutputAutomatically?: boolean;
  where?: ConditionList;
  sortField?: string;
  sortOrder?: string;
  limit?: number;
  limitString?: string;
  limitXmlTag?: string;
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
}

export interface DecisionStep extends StepBase {
  decision: string;
  rules: DecisionRule[];
  default: DecisionDefault;
}

export interface DecisionRule {
  name: string;
  label?: string;
  conditionLogic?: string;
  when: ConditionList;
  next?: string;
  isGoTo?: boolean;
  doesRequireRecordChangedToMeetCriteria?: boolean;
  processMetadataValues?: ProcessMetadataValue[];
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
}

export interface DecisionDefault {
  label?: string;
  next?: string;
  isGoTo?: boolean;
}

export interface AssignmentStep extends StepBase {
  assignment: string;
  operations: string[];
}

export interface RecordCreateStep extends StepBase {
  recordCreate: string;
  inputReference?: string;
  object?: string;
  fields?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputProcessMetadataValues?: Record<string, ProcessMetadataValue[]>;
  assignRecordIdToReference?: string;
  doesUpsert?: boolean;
  storeOutputAutomatically?: boolean;
  upsertWhere?: ConditionList;
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
  operationMultMatchingRecords?: string;
  operationOneMatchingRecord?: string;
  operationZeroMatchingRecords?: string;
}

export interface RecordUpdateStep extends StepBase {
  recordUpdate: string;
  inputReference?: string;
  object?: string;
  fields?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputProcessMetadataValues?: Record<string, ProcessMetadataValue[]>;
  where?: ConditionList;
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
}

export interface RecordDeleteStep extends StepBase {
  recordDelete: string;
  inputReference?: string;
  object?: string;
  where?: ConditionList;
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
}

export interface LoopStep {
  loop: string;
  label?: string;
  description?: string;
  collection: string;
  iterationOrder?: string;
  iterationNext?: string;
  afterLastNext?: string;
  _xmlOrder?: number;
  locationX?: number;
  locationY?: number;
}

export interface FilterStep extends StepBase {
  filter: string;
  collection: string;
  itemVariable?: string;
  elementSubtype?: string;
  where: ConditionList;
  conditionProcessMetadataValues?: ProcessMetadataValue[][];
}

export interface SortOption {
  doesPutEmptyStringAndNullFirst: boolean;
  sortField: string;
  sortOrder: string;
}

export interface TransformStep extends StepBase {
  transform: string;
  outputDataType: string;
  isCollection?: boolean;
  transformType: string;
  expression: string;
  collection: string;
  elementSubtype?: string;
  sortOptions?: SortOption[];
  storeOutputAutomatically?: boolean;
  scale?: number;
  limit?: number;
  limitString?: string;
  limitXmlTag?: string;
  sourceTag?: 'collectionProcessors' | 'transforms';
}

export interface ActionStep extends StepBase {
  action: string;
  actionType: string;
  actionName?: string;
  nameSegment?: string;
  dataTypeMappings?: Array<{ typeName: string; typeValue: string }>;
  offset?: number;
  flowTransactionModel?: string;
  storeOutputAutomatically?: boolean;
  versionString?: string;
  inputs?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputCollectionElementTypes?: Record<string, string[]>;
  inputValueStrings?: Record<string, string>;
  inputConfiguratorModes?: Record<string, string>;
  outputs?: Record<string, string>;
}

export interface SubflowStep extends StepBase {
  subflow: string;
  flowName: string;
  flowTransactionModel?: string;
  storeOutputAutomatically?: boolean;
  inputs?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputCollectionElementTypes?: Record<string, string[]>;
  outputs?: Record<string, string>;
}

export interface ScreenStep {
  screen: string;
  label?: string;
  description?: string;
  allowBack?: boolean;
  allowFinish?: boolean;
  allowPause?: boolean;
  showFooter?: boolean;
  showHeader?: boolean;
  nextOrFinishButtonLabel?: string;
  backButtonLabel?: string;
  helpText?: string;
  pausedText?: string;
  stageReference?: string;
  stageReferenceXmlTag?: string;
  next?: string;
  isGoTo?: boolean;
  fields: ScreenField[];
  _xmlOrder?: number;
  locationX?: number;
  locationY?: number;
}

export type ScreenField =
  | InputScreenField
  | PasswordScreenField
  | DropdownScreenField
  | MultiselectScreenField
  | MultiselectCheckboxesScreenField
  | RadioScreenField
  | TextareaScreenField
  | CheckboxScreenField
  | ToggleScreenField
  | DisplayScreenField
  | ComponentScreenField
  | RepeaterScreenField
  | ObjectProvidedScreenField
  | SectionScreenField;

interface ScreenFieldBase {
  processMetadataValues?: ProcessMetadataValue[];
  dataType?: string;
  label?: string;
  labelSource?: 'fieldText' | 'inputParameter';
  required?: boolean;
  defaultValue?: unknown;
  defaultValueXmlTag?: string;
  defaultValueString?: string;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  booleanValueWrappers?: string[];
  defaultSelectedChoiceReference?: string;
  storeOutputAutomatically?: boolean;
  validation?: ScreenFieldValidation;
  visibleWhen?: ConditionList;
  inputsOnNextNavToAssocScrn?: string;
  helpText?: string;
  scale?: number;
  styleProperties?: Record<string, string>;
}

export interface InputScreenField extends ScreenFieldBase {
  input: string;
}

export interface PasswordScreenField extends ScreenFieldBase {
  password: string;
}

export interface DropdownScreenField extends ScreenFieldBase {
  dropdown: string;
  choices?: string[];
}

export interface MultiselectScreenField extends ScreenFieldBase {
  multiselect: string;
  choices?: string[];
}

export interface MultiselectCheckboxesScreenField extends ScreenFieldBase {
  multiselectCheckboxes: string;
  choices?: string[];
}

export interface RadioScreenField extends ScreenFieldBase {
  radio: string;
  choices?: string[];
}

export interface TextareaScreenField extends ScreenFieldBase {
  textarea: string;
}

export interface CheckboxScreenField extends ScreenFieldBase {
  checkbox: string;
}

export interface ToggleScreenField extends ScreenFieldBase {
  toggle: string;
}

export interface DisplayScreenField {
  display: string;
  value: string;
  helpText?: string;
  visibleWhen?: ConditionList;
  inputsOnNextNavToAssocScrn?: string;
  styleProperties?: Record<string, string>;
}

export interface ComponentScreenField {
  component: string;
  extensionName: string;
  fieldType?: string;
  dataType?: string;
  label?: string;
  labelSource?: 'fieldText';
  objectType?: string;
  required?: boolean;
  inputs?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputCollectionElementTypes?: Record<string, string[]>;
  outputs?: Record<string, string>;
  choices?: string[];
  dataTypeMappings?: Array<{ typeName: string; typeValue: string }>;
  validation?: ScreenFieldValidation;
  visibleWhen?: ConditionList;
  inputsOnNextNavToAssocScrn?: string;
  helpText?: string;
  booleanValueWrappers?: string[];
  scale?: number;
  storeOutputAutomatically?: boolean;
  styleProperties?: Record<string, string>;
  processMetadataValues?: ProcessMetadataValue[];
}

export interface RepeaterScreenField extends ScreenFieldBase {
  repeater: string;
  fields: ScreenField[];
}

export interface ObjectProvidedScreenField extends ScreenFieldBase {
  objectProvided: string;
  objectFieldReference?: string;
}

export interface SectionScreenField {
  section: {
    name: string;
    label?: string;
    labelSource?: 'fieldText' | 'label';
    isRequired?: boolean;
    booleanValueWrappers?: string[];
    visibleWhen?: ConditionList;
    styleProperties?: Record<string, string>;
    columns: SectionColumn[];
  };
}

export interface SectionColumn {
  name?: string;
  width: number;
  isRequired?: boolean;
  booleanValueWrappers?: string[];
  visibleWhen?: ConditionList;
  styleProperties?: Record<string, string>;
  fields?: ScreenField[];
}

export interface ScreenFieldValidation {
  formula: string;
  errorMessage: string;
}

export interface CustomErrorStep extends StepBase {
  customError: string;
  messages?: Array<{
    errorMessage: string;
    isFieldError: boolean;
    fieldSelection?: string;
  }>;
}

export interface WaitEvent {
  name: string;
  label?: string;
  eventType: string;
  conditionLogic?: string;
  conditions?: ConditionList;
  inputs?: Record<string, unknown>;
  inputXmlTags?: Record<string, string>;
  inputComplexValueTypes?: Record<string, string>;
  inputSetupReferenceTypes?: Record<string, string>;
  inputCollectionElementTypes?: Record<string, string[]>;
  outputs?: Record<string, string>;
  next?: string;
}

export interface WaitStep extends StepBase {
  wait: string;
  defaultNext?: string;
  defaultLabel?: string;
  events: WaitEvent[];
}

export interface RecordLockStep extends StepBase {
  recordLock: string;
  inputReference?: string;
  lockOrUnlock?: string;
}

export interface RecordRollbackStep extends StepBase {
  recordRollback: string;
}

export interface RawStep {
  raw: string;
  elementType: string;
  _xmlOrder?: number;
  locationX?: number;
  locationY?: number;
  next?: string;
  isGoTo?: boolean;
  faultNext?: string;
  faultIsGoTo?: boolean;
  xml: string;
}

// --- Internal types for parsing ---

/** Parsed condition for internal use */
export interface ParsedCondition {
  leftOperand: string;
  operator: string;
  rightValue?: ParsedValue;
}

/** Parsed value with type info */
export interface ParsedValue {
  type: 'string' | 'boolean' | 'number' | 'reference';
  value: string | boolean | number | string[];
  originalXmlTag?: string;
  complexValueType?: string;
  setupReferenceType?: string;
  collectionElementTypes?: string[];
  originalString?: string;
}

/** Parsed assignment operation for internal use */
export interface ParsedAssignment {
  target: string;
  operator: string;
  value: ParsedValue;
}
