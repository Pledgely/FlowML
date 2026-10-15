// ============================================================
// flowml syntax — Output FlowML syntax reference for LLMs
// ============================================================

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import {
  getSchemaPath,
  CONDITION_OPERATORS,
  ASSIGNMENT_OPERATORS,
  SCREEN_FIELD_TYPES,
} from 'flowml';

export const syntaxCommand = new Command('syntax')
  .description('Output a comprehensive FlowML syntax reference (for LLMs)')
  .option('--output <file>', 'Write to a file instead of stdout')
  .action(async (options) => {
    const schema = JSON.parse(readFileSync(getSchemaPath(), 'utf-8'));
    const md = generateSyntaxReference(schema);

    if (options.output) {
      writeFileSync(options.output, md, 'utf-8');
      console.log(`  OK  Syntax reference written to ${options.output}`);
    } else {
      process.stdout.write(md);
    }
  });

// ============================================================
// Markdown generation
// ============================================================

function generateSyntaxReference(schema: any): string {
  const lines: string[] = [];

  lines.push('# FlowML Syntax Reference');
  lines.push('');
  lines.push('FlowML is a YAML-based DSL that transpiles bidirectionally to Salesforce Flow XML.');
  lines.push('Files use the `.flowml` extension and are standard YAML documents.');
  lines.push('');

  // File structure
  lines.push('## File Structure');
  lines.push('');
  lines.push('A FlowML file has these top-level keys:');
  lines.push('');
  const topRequired = new Set(schema.required || []);
  for (const [key, def] of Object.entries(schema.properties as Record<string, any>)) {
    const req = topRequired.has(key) ? ' **(required)**' : '';
    const desc = def.description ? ` — ${def.description}` : '';
    lines.push(`- \`${key}\`${req}${desc}`);
  }
  lines.push('');

  // Section reference
  lines.push('---');
  lines.push('');
  lines.push('## Section Reference');
  lines.push('');

  const sectionKeys = ['flow', 'trigger', 'start', 'variables', 'formulas', 'textTemplates', 'constants', 'choiceSets', 'choices'];
  for (const key of sectionKeys) {
    const def = schema.properties[key];
    if (!def) continue;
    lines.push(`### ${key}`);
    lines.push('');
    if (def.description) {
      lines.push(def.description);
      lines.push('');
    }
    renderObjectProperties(lines, def, schema.definitions);

    // Expand trigger section with notes and scheduledPaths
    if (key === 'trigger') {
      lines.push('');
      lines.push('**Important:** The `next` property must point to the first step in the flow. Without it, the Start element has no outgoing connector and the flow cannot execute.');
      lines.push('');
      lines.push('**scheduledPaths** item structure:');
      lines.push('');
      lines.push('| Property | Type | Required |');
      lines.push('|---|---|---|');
      lines.push('| `name` | string | Yes |');
      lines.push('| `label` | string | Yes |');
      lines.push('| `timeSource` | string | Yes |');
      lines.push('| `timeField` | string |  |');
      lines.push('| `offsetNumber` | number | Yes |');
      lines.push('| `offsetUnit` | string | Yes |');
      lines.push('| `next` | string | Yes |');
      lines.push('');
      lines.push('Example with scheduled paths:');
      lines.push('```yaml');
      lines.push('trigger:');
      lines.push('  type: Scheduled');
      lines.push('  object: Account');
      lines.push('  next: First_Step');
      lines.push('  schedule:');
      lines.push('    frequency: Daily');
      lines.push('    startDate: "2024-01-01"');
      lines.push('    startTime: "08:00:00.000Z"');
      lines.push('  scheduledPaths:');
      lines.push('    - name: Run_After_24_Hours');
      lines.push('      label: Run After 24 Hours');
      lines.push('      timeSource: RecordField');
      lines.push('      timeField: CreatedDate');
      lines.push('      offsetNumber: 24');
      lines.push('      offsetUnit: Hours');
      lines.push('      next: Process_Record');
      lines.push('```');
    }

    // Expand choiceSets section with type semantics and examples
    if (key === 'choiceSets') {
      lines.push('');
      lines.push('Both types serialize to the same `<dynamicChoiceSets>` XML element — Salesforce infers the kind from which fields are set:');
      lines.push('');
      lines.push('- `dynamicPicklist` — choices from a picklist field. Set `picklistObject` and `field`.');
      lines.push('- `recordChoice` — choices from records matching `where` filters, or from a record collection via `collectionReference`. `object` is **required** in both cases (Salesforce rejects the deploy without it, with a misleading error that blames the collectionReference). `displayField` is the choice label, `valueField` the stored value.');
      lines.push('');
      lines.push('```yaml');
      lines.push('choiceSets:');
      lines.push('  Industry_Options:');
      lines.push('    type: dynamicPicklist');
      lines.push('    picklistObject: Account');
      lines.push('    field: Industry');
      lines.push('  Account_Options:');
      lines.push('    type: recordChoice');
      lines.push('    object: Account            # required for recordChoice');
      lines.push('    displayField: Name');
      lines.push('    valueField: Id');
      lines.push('    where:');
      lines.push('      - Industry == "Technology"');
      lines.push('  Collection_Options:');
      lines.push('    type: recordChoice');
      lines.push('    object: Account            # still required with collectionReference');
      lines.push('    collectionReference: Get_Accounts');
      lines.push('    displayField: Name');
      lines.push('    valueField: Id');
      lines.push('```');
    }

    lines.push('');
  }

  // customProperties section
  lines.push('### customProperties');
  lines.push('');
  lines.push('Custom flow properties as key-value string pairs (e.g., screen progress indicators).');
  lines.push('');
  lines.push('`Record<string, string>` — simple key-value map.');
  lines.push('');
  lines.push('```yaml');
  lines.push("customProperties:");
  lines.push("  ScreenProgressIndicator: '{\"location\":\"top\",\"type\":\"simple\"}'");
  lines.push('```');
  lines.push('');

  // Step reference
  lines.push('---');
  lines.push('');
  lines.push('## Step Reference');
  lines.push('');
  lines.push('Each step in the `steps` array is identified by its type key. The type key is also the step\'s API name.');
  lines.push('');

  const stepDefs = [
    'lookupStep', 'decisionStep', 'assignmentStep', 'recordCreateStep',
    'recordUpdateStep', 'recordDeleteStep', 'loopStep', 'filterStep',
    'transformStep', 'actionStep', 'subflowStep', 'screenStep',
    'customErrorStep', 'waitStep', 'recordLockStep', 'recordRollbackStep', 'rawStep',
  ];
  for (const defName of stepDefs) {
    const def = schema.definitions?.[defName];
    if (!def) continue;
    const stepKey = defName.replace('Step', '');
    lines.push(`### ${stepKey}`);
    lines.push('');
    if (def.description) {
      lines.push(def.description);
      lines.push('');
    }
    renderPropertyTable(lines, def, schema.definitions);
    lines.push('');
    renderStepExample(lines, stepKey, def);

    // Expand sortOption sub-type for transform step
    if (defName === 'transformStep') {
      lines.push('');
      lines.push('**sortOption** structure (used in `sortOptions` array):');
      lines.push('');
      lines.push('| Property | Type | Required |');
      lines.push('|---|---|---|');
      lines.push('| `sortField` | string | Yes |');
      lines.push('| `sortOrder` | string | Yes |');
      lines.push('| `doesPutEmptyStringAndNullFirst` | boolean | Yes |');
      lines.push('');
      lines.push('Sort example:');
      lines.push('```yaml');
      lines.push('- transform: Sort_Contacts');
      lines.push('  label: Sort Contacts by Name');
      lines.push('  outputDataType: SObject');
      lines.push('  isCollection: true');
      lines.push('  transformType: sort');
      lines.push('  expression: $item.LastName');
      lines.push('  collection: contactList');
      lines.push('  sortOptions:');
      lines.push('    - sortField: LastName');
      lines.push('      sortOrder: Asc');
      lines.push('      doesPutEmptyStringAndNullFirst: false');
      lines.push('```');
    }

    lines.push('');
  }

  // Screen field reference
  lines.push('---');
  lines.push('');
  lines.push('## Screen Field Reference');
  lines.push('');
  lines.push('Screen steps contain a `fields` array. Each field is identified by its type key.');
  lines.push('');

  const fieldDefs = [
    'inputField', 'dropdownField', 'multiselectField', 'radioField',
    'textareaField', 'checkboxField', 'toggleField', 'displayField',
    'componentField', 'sectionField',
  ];
  for (const defName of fieldDefs) {
    const def = schema.definitions?.[defName];
    if (!def) continue;
    const fieldKey = defName.replace('Field', '');
    lines.push(`### ${fieldKey}`);
    lines.push('');
    if (def.description) {
      lines.push(def.description);
      lines.push('');
    }
    renderPropertyTable(lines, def, schema.definitions);

    // Expand section field internal structure
    if (defName === 'sectionField') {
      lines.push('');
      lines.push('**section** internal structure:');
      lines.push('');
      lines.push('| Property | Type | Required |');
      lines.push('|---|---|---|');
      lines.push('| `name` | string | Yes |');
      lines.push('| `label` | string |  |');
      lines.push('| `labelSource` | string |  |');
      lines.push('| `isRequired` | boolean |  |');
      lines.push('| `visibleWhen` | ConditionList |  |');
      lines.push('| `styleProperties` | Record<string, string> |  |');
      lines.push('| `columns` | SectionColumn[] | Yes |');
      lines.push('');
      lines.push('**SectionColumn** structure:');
      lines.push('');
      lines.push('| Property | Type | Required |');
      lines.push('|---|---|---|');
      lines.push('| `name` | string |  |');
      lines.push('| `width` | number | Yes |');
      lines.push('| `isRequired` | boolean |  |');
      lines.push('| `visibleWhen` | ConditionList |  |');
      lines.push('| `styleProperties` | Record<string, string> |  |');
      lines.push('| `fields` | ScreenField[] |  |');
      lines.push('');
      lines.push('Columns contain nested `fields` arrays that accept any screen field type (input, dropdown, component, etc.).');
      lines.push('');
      lines.push('```yaml');
      lines.push('- section:');
      lines.push('    name: Personal_Info');
      lines.push('    label: Personal Information');
      lines.push('    columns:');
      lines.push('      - name: Column1');
      lines.push('        width: 6');
      lines.push('        fields:');
      lines.push('          - input: First_Name');
      lines.push('            dataType: String');
      lines.push('            label: First Name');
      lines.push('            required: true');
      lines.push('          - dropdown: Status');
      lines.push('            label: Status');
      lines.push('            choices: [Active, Inactive]');
      lines.push('      - name: Column2');
      lines.push('        width: 6');
      lines.push('        fields:');
      lines.push('          - input: Last_Name');
      lines.push('            dataType: String');
      lines.push('            label: Last Name');
      lines.push('            required: true');
      lines.push('```');
    }

    lines.push('');
  }

  // Validation type definition
  lines.push('### Validation');
  lines.push('');
  lines.push('Screen field validation (used on input, dropdown, multiselect, radio, textarea, checkbox, toggle, and component fields):');
  lines.push('');
  lines.push('| Property | Type | Required |');
  lines.push('|---|---|---|');
  lines.push('| `formula` | string | Yes |');
  lines.push('| `errorMessage` | string | Yes |');
  lines.push('');
  lines.push('The `formula` uses Flow formula syntax with `{!FieldName}` merge field references.');
  lines.push('');
  lines.push('```yaml');
  lines.push('- input: Email_Address');
  lines.push('  dataType: String');
  lines.push('  label: Email Address');
  lines.push('  required: true');
  lines.push('  validation:');
  lines.push('    formula: CONTAINS({!Email_Address}, "@")');
  lines.push('    errorMessage: <p>Please enter a valid email address</p>');
  lines.push('```');
  lines.push('');

  // DSL Expression Syntax
  lines.push('---');
  lines.push('');
  lines.push('## DSL Expression Syntax');
  lines.push('');

  // Condition operators
  lines.push('### Condition Operators');
  lines.push('');
  lines.push('Conditions are written as strings: `leftOperand operator rightValue`');
  lines.push('');
  lines.push('| FlowML Operator | Description |');
  lines.push('|---|---|');
  const opDescriptions: Record<string, string> = {
    '==': 'Equal to',
    '!=': 'Not equal to',
    '>=': 'Greater than or equal to',
    '>': 'Greater than',
    '<=': 'Less than or equal to',
    '<': 'Less than',
    'contains': 'String contains',
    'startsWith': 'String starts with',
    'endsWith': 'String ends with',
    'isNull': 'Is null (unary)',
    'isNotNull': 'Is not null (unary)',
    'isBlank': 'Is blank (unary)',
    'isNotBlank': 'Is not blank (unary)',
    'isEmpty': 'Collection is empty (unary)',
    'isNotEmpty': 'Collection is not empty (unary)',
    'isChanged': 'Field value changed (unary)',
    'isNotChanged': 'Field value not changed (unary)',
    'wasSet': 'Field was set (unary)',
    'wasNotSet': 'Field was not set (unary)',
    'wasSelected': 'Choice was selected (unary)',
    'wasNotSelected': 'Choice was not selected (unary)',
    'wasVisited': 'Screen was visited (unary)',
    'wasNotVisited': 'Screen was not visited (unary)',
    'in': 'Value in collection',
    'notIn': 'Value not in collection',
  };
  for (const op of Object.keys(CONDITION_OPERATORS)) {
    const desc = opDescriptions[op] || CONDITION_OPERATORS[op];
    lines.push(`| \`${op}\` | ${desc} |`);
  }
  lines.push('');

  // Assignment operators
  lines.push('### Assignment Operators');
  lines.push('');
  lines.push('Assignments are written as strings: `target operator value`');
  lines.push('');
  lines.push('| FlowML Operator | Description |');
  lines.push('|---|---|');
  const assignDescriptions: Record<string, string> = {
    '=': 'Assign value',
    '+=': 'Add — append item to a collection, add to a number/date, or append text to a string',
    '-=': 'Subtract from value or remove from collection',
    '#=': 'Assign collection count to number',
    '++=': 'Add item to a multipicklist (inserts the required semicolon separator). Multipicklist targets only — to append to a collection variable use `+=`',
    '^+=': 'Add item to start of collection',
    '-first=': 'Remove first occurrence from collection',
    '-all=': 'Remove all occurrences from collection',
    '-after=': 'Remove all after first occurrence',
    '-before=': 'Remove all before first occurrence',
    '-pos=': 'Remove item at position',
    '-uncommon=': 'Remove items not in other collection',
  };
  for (const op of Object.keys(ASSIGNMENT_OPERATORS)) {
    const desc = assignDescriptions[op] || ASSIGNMENT_OPERATORS[op];
    lines.push(`| \`${op}\` | ${desc} |`);
  }
  lines.push('');
  lines.push('**Appending to a collection is `+=` (Add), not `++=`.** `++=` maps to the AddItem operator, which Salesforce supports only when the assignment target is a multipicklist variable — deploying it against a record collection fails with "The \'Add item\' operator can\'t be used with the \'...\' variable". The other collection operators (`^+=`, `-first=`, `-all=`, `-after=`, `-before=`, `-pos=`, `-uncommon=`) require a collection variable (or `$Flow.ActiveStages`) as the target; `#=` is the reverse — a numeric target counting a collection (or `$Flow.ActiveStages`) value.');
  lines.push('');

  // Value types
  lines.push('### Value Types');
  lines.push('');
  lines.push('Values in condition and assignment strings are inferred by format:');
  lines.push('');
  lines.push('| Format | Type | Example |');
  lines.push('|---|---|---|');
  lines.push('| `"quoted"` | String | `"Active"` |');
  lines.push('| `true` / `false` | Boolean | `true` |');
  lines.push('| Numeric | Number | `100`, `3.14` |');
  lines.push('| Bare ISO date | Date | `2025-07-01` |');
  lines.push('| Bare ISO datetime | Date/time | `2025-07-01T12:30:00Z` |');
  lines.push('| Bare name | Reference | `$Record.Name`, `varName` |');
  lines.push('| `null` | Null/empty string | `null` |');
  lines.push('');
  lines.push('Bare ISO date and datetime tokens emit `dateValue` and `dateTimeValue`. Quote the same token (for example, `"2025-07-01"`) to emit a `stringValue` instead.');
  lines.push('');

  // Inputs / fields value inference
  lines.push('### Inputs & Fields Value Inference');
  lines.push('');
  lines.push('Values in `inputs:` (actions, subflows, screen components, wait events) and `fields:` (recordCreate, recordUpdate) are plain YAML values, inferred as:');
  lines.push('');
  lines.push('| Format | Emitted as | Example |');
  lines.push('|---|---|---|');
  lines.push('| `true` / `false` (YAML boolean) | `booleanValue` | `logEmailOnSend: true` |');
  lines.push('| YAML number | `numberValue` | `offsetHours: 24` |');
  lines.push('| String starting with `$` | `elementReference` | `$Record.Id`, `$Setup.My__c.Field__c` |');
  lines.push('| String containing `.` and no space | `elementReference` | `Get_Template.Id`, `varRecord.Name` |');
  lines.push('| Any other string | `stringValue` | `Lapsed`, `No Response` |');
  lines.push('| String wrapped in double quotes | `stringValue` (quotes stripped, forces literal) | `\'"v2.1 released"\'` |');
  lines.push('');
  lines.push('Two escape hatches cover the ambiguous cases:');
  lines.push('');
  lines.push('- **Literal string that contains a dot** — wrap the value in explicit double quotes inside the YAML string. The quotes are stripped and the value is always emitted as `stringValue`:');
  lines.push('```yaml');
  lines.push('inputs:');
  lines.push('  emailSubject: \'"Release v2.1 is live"\'   # stringValue, not a reference');
  lines.push('```');
  lines.push('- **Reference that has no dot** (a bare variable or formula name) — pin the wrapper tag with `inputXmlTags`:');
  lines.push('```yaml');
  lines.push('fields:');
  lines.push('  Due_Date__c: forDate_Deadline');
  lines.push('inputXmlTags:');
  lines.push('  Due_Date__c: elementReference   # otherwise emitted as stringValue');
  lines.push('```');
  lines.push('');
  lines.push('`inputXmlTags` always wins over inference and over the quoted-literal rule, so round-tripped files never change meaning.');
  lines.push('');
  lines.push('**Reactive screen components** depend on this rule. A component input is reactive only when it is emitted as `elementReference` pointing at another element on the same screen — and those names are usually bare, so they need `inputXmlTags`. Getting it wrong still deploys; the component just receives literal text and never updates:');
  lines.push('```yaml');
  lines.push('- component: Order_Summary');
  lines.push('  extensionName: c:orderSummary');
  lines.push('  inputs:');
  lines.push('    quantity: Quantity_Input       # bare name -> needs pinning');
  lines.push('    total: Get_Order.Amount        # dotted -> already a reference');
  lines.push('    heading: Order Summary         # literal text, correct as-is');
  lines.push('  inputXmlTags:');
  lines.push('    quantity: elementReference');
  lines.push('  inputsOnNextNavToAssocScrn: UseStoredValues   # keep values on re-entry');
  lines.push('```');
  lines.push('The `input-reference-emitted-as-literal` lint rule flags bare values that match an element name but would be emitted as `stringValue`.');
  lines.push('');
  lines.push('**Setup references** (`setupReference` FEROV form) reference setup entities by API name instead of record Id. Declare the entity type in `inputSetupReferenceTypes`; the value stays a plain string. This is how `emailSimple` takes an email template by name:');
  lines.push('```yaml');
  lines.push('- action: Send_Reminder');
  lines.push('  actionType: emailSimple');
  lines.push('  inputs:');
  lines.push('    emailTemplateName: MyFolder/My_Reminder_Template');
  lines.push('    recipientId: $Record.ContactId');
  lines.push('    useEmailTemplate: true');
  lines.push('  inputSetupReferenceTypes:');
  lines.push('    emailTemplateName: EmailTemplate');
  lines.push('```');
  lines.push('This emits `<value><setupReference>MyFolder/My_Reminder_Template</setupReference><setupReferenceType>EmailTemplate</setupReferenceType></value>` — no lookup on EmailTemplate is needed.');
  lines.push('');

  // ConditionList forms
  lines.push('### ConditionList');
  lines.push('');
  lines.push('Conditions appear in `where`, `entryConditions`, `when`, and `visibleWhen` properties. They have three forms:');
  lines.push('');
  lines.push('**Form 1: String array** (implicit AND logic) — most common:');
  lines.push('```yaml');
  lines.push('where:');
  lines.push('  - Status == "Active"');
  lines.push('  - Amount > 100');
  lines.push('```');
  lines.push('');
  lines.push('**Form 2: Numbered conditions with `conditionLogic`** (on decision rules, `conditionLogic` is a sibling of `when`):');
  lines.push('```yaml');
  lines.push('rules:');
  lines.push('  - name: Complex_Rule');
  lines.push('    conditionLogic: "1 AND (2 OR 3)"');
  lines.push('    when:');
  lines.push('      1: $Record.Status == "Active"');
  lines.push('      2: $Record.Type == "Premium"');
  lines.push('      3: $Record.Amount > 1000');
  lines.push('    next: Handle_Match');
  lines.push('```');
  lines.push('');
  lines.push('**Form 3: Object with `logic` + `conditions`** (standalone complex conditions, e.g. on `entryConditions`):');
  lines.push('```yaml');
  lines.push('entryConditions:');
  lines.push('  logic: "1 AND (2 OR 3)"');
  lines.push('  conditions:');
  lines.push('    1: Status == "Active"');
  lines.push('    2: Type == "Premium"');
  lines.push('    3: Amount > 1000');
  lines.push('```');
  lines.push('');

  // Condition examples
  lines.push('### Condition Examples');
  lines.push('');
  lines.push('**Filter contexts** (`where`, `entryConditions`) use **bare field names** — the object is implied by the step or trigger:');
  lines.push('```yaml');
  lines.push('# Lookup/update/delete where clauses — bare field names');
  lines.push('where:');
  lines.push('  - Status == "Active"');
  lines.push('  - Amount > 100');
  lines.push('');
  lines.push('# Entry conditions on triggers — bare field names');
  lines.push('entryConditions:');
  lines.push('  - Name isNotBlank');
  lines.push('  - Status == "Active"');
  lines.push('');
  lines.push('# Unary operators (no right-hand value)');
  lines.push('where:');
  lines.push('  - Name isNotBlank');
  lines.push('  - Email isNull');
  lines.push('```');
  lines.push('');
  lines.push('**Decision/reference contexts** (`when`) use **`$Record.` prefix** — full references:');
  lines.push('```yaml');
  lines.push('# Decision rule conditions — $Record prefix');
  lines.push('when:');
  lines.push('  - $Record.Status == "Active"');
  lines.push('  - $Record.Amount > 100');
  lines.push('```');
  lines.push('');

  // Assignment examples
  lines.push('### Assignment Examples');
  lines.push('');
  lines.push('```yaml');
  lines.push('operations:');
  lines.push('  - varName = "Hello"');
  lines.push('  - counter += 1');
  lines.push('  - total -= discountAmount');
  lines.push('  - $Record.Status = "Closed"');
  lines.push('```');
  lines.push('');

  // Filter vs Reference context
  lines.push('### Filter vs Reference Contexts');
  lines.push('');
  lines.push('FlowML has two contexts for field references — using the wrong form causes deployment errors:');
  lines.push('');
  lines.push('**Filter contexts** (bare field names — object is implied):');
  lines.push('- `entryConditions` on triggers');
  lines.push('- `where` on lookup, recordUpdate, recordDelete, and filter steps');
  lines.push('');
  lines.push('```yaml');
  lines.push('# CORRECT — bare field name');
  lines.push('entryConditions:');
  lines.push('  - Name == "test"');
  lines.push('where:');
  lines.push('  - Status == "Active"');
  lines.push('```');
  lines.push('');
  lines.push('**Reference contexts** (`$Record.FieldName` — full qualified reference):');
  lines.push('- `when` conditions on decision rules');
  lines.push('- `operations` targets and values on assignments');
  lines.push('- Value references in record create/update `fields`');
  lines.push('');
  lines.push('```yaml');
  lines.push('# CORRECT — $Record prefix');
  lines.push('when:');
  lines.push('  - $Record.Status == "Active"');
  lines.push('operations:');
  lines.push('  - $Record.Status = "Closed"');
  lines.push('fields:');
  lines.push('  AccountId: $Record.Id');
  lines.push('```');
  lines.push('');

  // Action types
  lines.push('### Action Type Format');
  lines.push('');
  lines.push('The `actionType` on action steps uses these prefixes:');
  lines.push('');
  lines.push('| actionType | Description |');
  lines.push('|---|---|');
  lines.push('| `apex` | Apex invocable action |');
  lines.push('| `emailAlert` | Email alert |');
  lines.push('| `quickAction` | Quick action |');
  lines.push('| `submit` | Submit for approval |');
  lines.push('| `flow` | Flow action |');
  lines.push('| `externalService` | External service |');
  lines.push('| `emailSimple` | Send email action |');
  lines.push('');

  // Screen field type mapping
  lines.push('### Screen Field Types');
  lines.push('');
  lines.push('| FlowML Key | Salesforce Field Type |');
  lines.push('|---|---|');
  for (const [key, xmlType] of Object.entries(SCREEN_FIELD_TYPES)) {
    lines.push(`| \`${key}\` | ${xmlType} |`);
  }
  lines.push('');

  // Complete example
  lines.push('---');
  lines.push('');
  lines.push('## Complete Example');
  lines.push('');
  lines.push('```yaml');
  lines.push('flow:');
  lines.push('  name: Update_Account_Status');
  lines.push('  label: Update Account Status');
  lines.push('  processType: AutoLaunchedFlow');
  lines.push('  apiVersion: "62.0"');
  lines.push('  status: Active');
  lines.push('trigger:');
  lines.push('  type: RecordAfterSave');
  lines.push('  object: Account');
  lines.push('  recordTriggerType: CreateAndUpdate');
  lines.push('  next: Check_Status');
  lines.push('  entryConditions:');
  lines.push('    - AnnualRevenue > 1000000');
  lines.push('variables:');
  lines.push('  statusMessage:');
  lines.push('    dataType: String');
  lines.push('    defaultValue: "Pending Review"');
  lines.push('steps:');
  lines.push('  - decision: Check_Status');
  lines.push('    label: Check Account Status');
  lines.push('    rules:');
  lines.push('      - name: Is_Active');
  lines.push('        label: Is Active');
  lines.push('        when:');
  lines.push('          - $Record.Status == "Active"');
  lines.push('        next: Update_Record');
  lines.push('    default:');
  lines.push('      label: Default');
  lines.push('      next: Set_Message');
  lines.push('  - assignment: Set_Message');
  lines.push('    label: Set Status Message');
  lines.push('    operations:');
  lines.push('      - statusMessage = "Account is not active"');
  lines.push('  - recordUpdate: Update_Record');
  lines.push('    label: Update Account');
  lines.push('    object: Account');
  lines.push('    where:');
  lines.push('      - Id == $Record.Id');
  lines.push('    fields:');
  lines.push('      Description: statusMessage');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// Property rendering helpers
// ============================================================

function renderObjectProperties(lines: string[], def: any, definitions: any): void {
  if (def.additionalProperties && !def.properties) {
    // Map type (variables, formulas, etc.)
    lines.push('Map of names to objects:');
    lines.push('');
    const itemDef = def.additionalProperties;
    if (itemDef.properties) {
      renderPropertyTable(lines, itemDef, definitions);
    }
    return;
  }
  if (def.properties) {
    renderPropertyTable(lines, def, definitions);
  }
}

function renderPropertyTable(lines: string[], def: any, definitions: any): void {
  const props = def.properties;
  if (!props) return;

  const required = new Set(def.required || []);
  lines.push('| Property | Type | Required |');
  lines.push('|---|---|---|');

  for (const [name, propDef] of Object.entries(props as Record<string, any>)) {
    const typeStr = resolveTypeString(propDef, definitions);
    const req = required.has(name) ? 'Yes' : '';
    lines.push(`| \`${name}\` | ${typeStr} | ${req} |`);
  }
}

function resolveTypeString(def: any, definitions: any): string {
  if (!def || Object.keys(def).length === 0) return 'any';
  // Show the allowed values for closed sets — guessing at them is how callers
  // end up with a value the transpiler cannot map.
  if (Array.isArray(def.enum) && def.enum.length > 0) {
    return def.enum.map((v: unknown) => `\`${String(v)}\``).join(' \\| ');
  }
  if (def.$ref) {
    const refName = def.$ref.replace('#/definitions/', '');
    const resolved = definitions?.[refName];
    if (refName === 'conditionList') return 'ConditionList';
    if (refName === 'screenField') return 'ScreenField';
    if (refName === 'sectionColumn') return 'SectionColumn';
    if (refName === 'screenFieldValidation') return 'Validation';
    if (refName === 'sortOption') return 'SortOption';
    return resolved?.description || refName;
  }
  if (def.oneOf) return 'oneOf (see description)';
  if (def.type === 'array') {
    if (def.items?.$ref) {
      const refName = def.items.$ref.replace('#/definitions/', '');
      return `${refName}[]`;
    }
    if (def.items?.type) return `${def.items.type}[]`;
    return 'array';
  }
  if (def.type === 'object') {
    if (def.additionalProperties?.type === 'string') return 'Record<string, string>';
    if (def.additionalProperties) return 'Record<string, any>';
    if (def.properties) return 'object';
    return 'object';
  }
  return def.type || 'any';
}

function renderStepExample(lines: string[], stepKey: string, def: any): void {
  const examples: Record<string, string> = {
    lookup: `- lookup: Get_Accounts
  label: Get Accounts
  object: Account
  getFirst: true
  fields: [Name, Status]
  where:
    - Status == "Active"`,
    decision: `- decision: Check_Type
  label: Check Record Type
  rules:
    - name: Is_Premium
      label: Is Premium
      when:
        - $Record.Type == "Premium"
      next: Handle_Premium
  default:
    label: Default
    next: Handle_Standard`,
    assignment: `- assignment: Set_Values
  label: Set Values
  operations:
    - varStatus = "Active"
    - varCount += 1`,
    recordCreate: `- recordCreate: Create_Task
  label: Create Follow-Up Task
  object: Task
  fields:
    Subject: "Follow Up"
    Priority: "High"
    WhatId: $Record.Id`,
    recordUpdate: `- recordUpdate: Update_Account
  label: Update Account
  object: Account
  where:
    - Id == $Record.AccountId
  fields:
    Status: "Reviewed"`,
    recordDelete: `- recordDelete: Delete_Old_Records
  label: Delete Old Records
  object: Task
  where:
    - Status == "Completed"`,
    loop: `- loop: Loop_Contacts
  label: Loop Over Contacts
  collection: contactList
  iterationNext: Process_Contact
  afterLastNext: Done_Looping`,
    filter: `- filter: Filter_Active
  label: Filter Active Records
  collection: allRecords
  where:
    - Status == "Active"`,
    transform: `- transform: Map_Names
  label: Map Contact Names
  outputDataType: String
  isCollection: true
  transformType: map
  expression: $item.Name
  collection: contactList`,
    action: `- action: Send_Email
  label: Send Notification Email
  actionType: emailAlert
  inputs:
    emailTemplateId: "00X..."
    targetObjectId: $Record.Id`,
    subflow: `- subflow: Run_Validation
  label: Run Validation Flow
  flowName: Validation_Flow
  inputs:
    recordId: $Record.Id`,
    screen: `- screen: Input_Screen
  label: Enter Details
  allowBack: true
  allowFinish: true
  fields:
    - input: firstName
      label: First Name
      dataType: String
      required: true
    - dropdown: status
      label: Status
      choices: [Active, Inactive]`,
    customError: `- customError: Block_Invalid_Record
  label: Block Invalid Record
  description: Prevent save when required fields are missing.
  messages:
    - errorMessage: "Status field is required."
      isFieldError: true
      fieldSelection: Status__c`,
    wait: `- wait: Wait_For_Approval
  label: Wait For Approval Response
  events:
    - name: Approved
      label: Approved
      eventType: AlarmEvent
      next: Process_Approved
  defaultNext: Handle_Timeout
  defaultLabel: Timed Out`,
    recordLock: `- recordLock: Lock_Record
  label: Lock Record for Processing
  inputReference: $Record.Id
  lockOrUnlock: Lock
  faultNext: Handle_Lock_Error`,
    recordRollback: `- recordRollback: Rollback_Changes
  label: Rollback Pending Changes`,
    raw: `- raw: Custom_Element
  elementType: customElements
  xml: "<customElements>...</customElements>"`,
  };

  const example = examples[stepKey];
  if (example) {
    lines.push('```yaml');
    lines.push(example);
    lines.push('```');
  }
}
