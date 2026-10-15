import { describe, it, expect } from 'vitest';
import { lintFlow } from '../../src/linter/linter.js';
import type { FlowMLDocument } from '../../src/types.js';

function makeDoc(overrides: Partial<FlowMLDocument> = {}): FlowMLDocument {
  return {
    flow: {
      name: 'Test_AfterSave_UpdateContacts',
      label: 'Test Flow',
      processType: 'AutoLaunchedFlow',
      apiVersion: '62.0',
      status: 'Draft',
      description: 'A test flow that does something useful for testing purposes.',
    },
    steps: [],
    ...overrides,
  };
}

function findResult(report: ReturnType<typeof lintFlow>, ruleId: string) {
  for (const cat of report.categories) {
    const found = cat.results.find(r => r.ruleId === ruleId);
    if (found) return found;
  }
  return undefined;
}

describe('Design & Naming rules', () => {
  it('flags missing description', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, description: undefined } });
    const report = lintFlow(doc);
    expect(findResult(report, 'description-present')).toBeDefined();
  });

  it('passes with adequate description', () => {
    const doc = makeDoc();
    const report = lintFlow(doc);
    expect(findResult(report, 'description-present')).toBeUndefined();
  });

  it('flags single-segment flow name', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, name: 'MyFlow' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'flow-naming-convention')).toBeDefined();
  });

  it('flags Copy_of_ element names', () => {
    const doc = makeDoc({
      steps: [{ assignment: 'Copy_of_Assignment', operations: ['x = 1'] }] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-copy-of-names')).toBeDefined();
  });

  it('flags default Flow Builder names', () => {
    const doc = makeDoc({
      steps: [{ decision: 'Decision_1', rules: [{ name: 'r1', when: ['x == 1'] }], default: {} }] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-default-names')).toBeDefined();
  });

  it('flags non-conforming variable names', () => {
    const doc = makeDoc({
      variables: { myVar: { dataType: 'String' }, badName: { dataType: 'Number' } },
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'variable-naming')).toBeDefined();
  });

  it('flags duplicate step names', () => {
    const doc = makeDoc({
      steps: [
        { assignment: 'Set_Values', operations: ['x = 1'] },
        { assignment: 'Set_Values', operations: ['y = 2'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeDefined();
  });

  it('flags duplicate decision rule names within the same decision', () => {
    const doc = makeDoc({
      steps: [
        {
          decision: 'Route_Case',
          rules: [
            { name: 'Match', label: 'High', when: ['$Record.Priority == "High"'] },
            { name: 'Match', label: 'Critical', when: ['$Record.Priority == "Critical"'] },
          ],
          default: { label: 'Other' },
        },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'unique-element-names');
    expect(result).toBeDefined();
    expect(result!.message).toContain('Route_Case');
    expect(result!.message).toContain('Match');
  });

  it('allows the same rule name in different decisions', () => {
    const doc = makeDoc({
      steps: [
        {
          decision: 'First_Decision',
          rules: [{ name: 'Match', when: ['x == 1'] }],
          default: {},
        },
        {
          decision: 'Second_Decision',
          rules: [{ name: 'Match', when: ['y == 2'] }],
          default: {},
        },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeUndefined();
  });

  it('flags step name colliding with a variable name', () => {
    const doc = makeDoc({
      variables: { Get_Account: { dataType: 'SObject', objectType: 'Account' } },
      steps: [
        { lookup: 'Get_Account', object: 'Account', where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeDefined();
  });

  it('flags duplicate wait event names within the same wait', () => {
    const doc = makeDoc({
      steps: [
        {
          wait: 'Wait_For_Event',
          events: [
            { name: 'Timer', eventType: 'AlarmEvent' },
            { name: 'Timer', eventType: 'AlarmEvent' },
          ],
        },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeDefined();
  });

  it('flags duplicate scheduled path names', () => {
    const doc = makeDoc({
      trigger: {
        type: 'RecordAfterSave',
        object: 'Account',
        scheduledPaths: [
          { name: 'Follow_Up', offsetNumber: 1, offsetUnit: 'Days' },
          { name: 'Follow_Up', offsetNumber: 3, offsetUnit: 'Days' },
        ],
      } as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeDefined();
  });

  it('passes when all element names are unique', () => {
    const doc = makeDoc({
      variables: { varTxt_Status: { dataType: 'String' } },
      steps: [
        { assignment: 'Set_Status', operations: ['varTxt_Status = "Active"'] },
        { assignment: 'Log_Result', operations: ['varTxt_Status = "Done"'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'unique-element-names')).toBeUndefined();
  });

  it('flags flow name with spaces', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, name: 'Account Campaign After Insert/Update' } });
    const report = lintFlow(doc);
    const result = findResult(report, 'flow-name-invalid-chars');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('critical');
  });

  it('flags flow name starting with a digit', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, name: '1st_Flow' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'flow-name-invalid-chars')).toBeDefined();
  });

  it('flags empty flow name', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, name: '' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'flow-name-invalid-chars')).toBeDefined();
  });

  it('passes for a valid flow name', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, name: 'Account_AfterSave_UpdateContacts' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'flow-name-invalid-chars')).toBeUndefined();
  });
});

describe('Logic & Structure rules', () => {
  it('detects DML inside a loop', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'UpdateRecord', afterLastNext: 'Done' },
        { recordUpdate: 'UpdateRecord', object: 'Account', fields: { Name: 'x' }, next: 'MyLoop' },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-dml-in-loop')).toBeDefined();
  });

  it('does NOT flag DML after loop exit', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'Assign', afterLastNext: 'BulkUpdate' },
        { assignment: 'Assign', operations: ['x = 1'], next: 'MyLoop' },
        { recordUpdate: 'BulkUpdate', object: 'Account', fields: { Name: 'x' } },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-dml-in-loop')).toBeUndefined();
  });

  it('detects SOQL inside a loop', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'QueryRecord', afterLastNext: 'Done' },
        { lookup: 'QueryRecord', object: 'Contact', where: ['AccountId == x'], next: 'MyLoop' },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-soql-in-loop')).toBeDefined();
  });

  it('emits a sendEmail-cap message for emailSimple in a loop', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'SendOne', afterLastNext: 'Done' },
        { action: 'SendOne', actionType: 'emailSimple', inputs: { recipientId: 'x' }, next: 'MyLoop' },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'no-action-in-loop');
    expect(result).toBeDefined();
    expect(result!.message).toContain('sendEmail');
    expect(result!.message).toContain('10-per-transaction');
    expect(result!.deduction).toBe(3);
  });

  it('uses the generic callout-limit message for non-email actions in a loop', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'CallApex', afterLastNext: 'Done' },
        { action: 'CallApex', actionType: 'apex', inputs: {}, next: 'MyLoop' },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'no-action-in-loop');
    expect(result).toBeDefined();
    expect(result!.message).toContain('callout limit risk');
    expect(result!.deduction).toBe(5);
  });

  it('flags high decision complexity', () => {
    const decisions = Array.from({ length: 6 }, (_, i) => ({
      decision: `Dec_${i}`, rules: [{ name: 'r', when: ['x == 1'] }], default: {},
    }));
    const doc = makeDoc({ steps: decisions as any });
    const report = lintFlow(doc);
    expect(findResult(report, 'decision-complexity')).toBeDefined();
  });

  it('flags filter whose source collection type cannot be inferred', () => {
    const doc = makeDoc({
      steps: [
        { filter: 'Filter_Orphan', collection: 'undeclared_col', where: ['Status__c == "Active"'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'filter-source-type-unknown')).toBeDefined();
  });

  it('passes filter-source-type-unknown when source is an inferable lookup', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Contacts', object: 'Contact', where: ['AccountId != null'] },
        { filter: 'Filter_Active', collection: 'Get_Contacts', where: ['Status__c == "Active"'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'filter-source-type-unknown')).toBeUndefined();
  });

  it('passes filter-source-type-unknown when itemVariable is declared explicitly', () => {
    const doc = makeDoc({
      variables: {
        my_item: { dataType: 'SObject', objectType: 'Contact', isCollection: false },
      },
      steps: [
        { filter: 'Filter_X', collection: 'mystery_col', itemVariable: 'my_item', where: ['my_item.Status__c == "Active"'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'filter-source-type-unknown')).toBeUndefined();
  });

  it('flags downstream Lookup.Field reference when lookup uses explicit fields', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Party_Role', object: 'PartyRoleRelation', fields: ['Id', 'RelatedInverseRecordId'], where: ['Id == $Record.PartyRoleRelationId'] },
        {
          decision: 'Has_Inverse',
          rules: [
            { name: 'Yes', when: ['Get_Party_Role.RelatedInverseRecordId isNotNull'], next: 'Done' },
          ],
          default: { label: 'No' },
        },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'lookup-fields-blocks-dotref');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('critical');
    expect(result!.message).toContain('Get_Party_Role.RelatedInverseRecordId');
    expect(result!.message).toContain('storeOutputAutomatically');
    expect(result!.message).toContain('outputs');
    expect(result!.stepName).toBe('Has_Inverse');
  });

  it('passes lookup-fields-blocks-dotref when lookup uses storeOutputAutomatically', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_X', object: 'Contact', storeOutputAutomatically: true, where: ['Id == x'] },
        {
          decision: 'Has_X',
          rules: [
            { name: 'Yes', when: ['Get_X.Email isNotNull'], next: 'Done' },
          ],
          default: { label: 'No' },
        },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-fields-blocks-dotref')).toBeUndefined();
  });

  it('passes lookup-fields-blocks-dotref when downstream uses outputs-mapped variable', () => {
    const doc = makeDoc({
      variables: {
        varTxt_InverseRecordId: { dataType: 'String' },
      },
      steps: [
        {
          lookup: 'Get_Party_Role',
          object: 'PartyRoleRelation',
          fields: ['Id', 'RelatedInverseRecordId'],
          outputs: { RelatedInverseRecordId: 'varTxt_InverseRecordId' },
          where: ['Id == $Record.PartyRoleRelationId'],
        },
        {
          decision: 'Has_Inverse',
          rules: [
            { name: 'Yes', when: ['varTxt_InverseRecordId isNotNull'], next: 'Done' },
          ],
          default: { label: 'No' },
        },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-fields-blocks-dotref')).toBeUndefined();
  });

  it('does NOT flag whole-record null check on a fields-restricted lookup', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_X', object: 'Contact', fields: ['Id', 'Email'], where: ['Id == x'] },
        {
          decision: 'Found_It',
          rules: [
            { name: 'Yes', when: ['Get_X isNotNull'], next: 'Done' },
          ],
          default: { label: 'No' },
        },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-fields-blocks-dotref')).toBeUndefined();
  });

  it('only flags the offending lookup when multiple lookups exist', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Bad', object: 'Account', fields: ['Id', 'Name'], where: ['Id == x'] },
        { lookup: 'Get_Good', object: 'Contact', storeOutputAutomatically: true, where: ['Id == y'] },
        {
          decision: 'Both',
          rules: [
            { name: 'Yes', when: ['Get_Bad.Name isNotNull', 'Get_Good.Email isNotNull'], next: 'Done' },
          ],
          default: { label: 'No' },
        },
        { assignment: 'Done', operations: ['x = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'lookup-fields-blocks-dotref');
    expect(result).toBeDefined();
    expect(result!.message).toContain('Get_Bad.Name');
    expect(result!.message).not.toContain('Get_Good');
  });

  it('flags Lookup.Field references in recordCreate field values', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Bad', object: 'Account', fields: ['Id', 'OwnerId'], where: ['Id == x'] },
        {
          recordCreate: 'Make_Task',
          object: 'Task',
          fields: { OwnerId: 'Get_Bad.OwnerId', Subject: 'Hi' },
        },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'lookup-fields-blocks-dotref');
    expect(result).toBeDefined();
    expect(result!.stepName).toBe('Make_Task');
    expect(result!.message).toContain('Get_Bad.OwnerId');
  });
});

describe('Architecture rules', () => {
  it('detects orphaned elements', () => {
    const doc = makeDoc({
      start: { next: 'Reachable' },
      steps: [
        { assignment: 'Reachable', operations: ['x = 1'] },
        { assignment: 'Orphan', operations: ['y = 2'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'orphaned-elements')).toBeDefined();
  });

  it('flags autolaunched flow without IO variables', () => {
    const doc = makeDoc({
      flow: { ...makeDoc().flow, processType: 'AutoLaunchedFlow' },
      variables: { myVar: { dataType: 'String' } },
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'autolaunched-without-io')).toBeDefined();
  });

  it('flags multiple loops over the same collection', () => {
    const doc = makeDoc({
      start: { next: 'Loop_A' },
      steps: [
        { loop: 'Loop_A', collection: 'varCol_Contacts', iterationNext: 'A_Body', afterLastNext: 'Loop_B' },
        { assignment: 'A_Body', operations: ['x = 1'], next: 'Loop_A' },
        { loop: 'Loop_B', collection: 'varCol_Contacts', iterationNext: 'B_Body', afterLastNext: 'Done' },
        { assignment: 'B_Body', operations: ['y = 1'], next: 'Loop_B' },
        { assignment: 'Done', operations: ['z = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'multi-loop-same-collection');
    expect(result).toBeDefined();
    expect(result!.message).toContain('varCol_Contacts');
    expect(result!.message).toContain('Loop_A');
    expect(result!.message).toContain('Loop_B');
  });

  it('does not flag a single loop over a collection', () => {
    const doc = makeDoc({
      start: { next: 'Loop_A' },
      steps: [
        { loop: 'Loop_A', collection: 'varCol_Contacts', iterationNext: 'A_Body', afterLastNext: 'Done' },
        { assignment: 'A_Body', operations: ['x = 1'], next: 'Loop_A' },
        { assignment: 'Done', operations: ['z = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'multi-loop-same-collection')).toBeUndefined();
  });

  it('does not flag loops over different collections', () => {
    const doc = makeDoc({
      start: { next: 'Loop_A' },
      steps: [
        { loop: 'Loop_A', collection: 'varCol_Contacts', iterationNext: 'A_Body', afterLastNext: 'Loop_B' },
        { assignment: 'A_Body', operations: ['x = 1'], next: 'Loop_A' },
        { loop: 'Loop_B', collection: 'varCol_Accounts', iterationNext: 'B_Body', afterLastNext: 'Done' },
        { assignment: 'B_Body', operations: ['y = 1'], next: 'Loop_B' },
        { assignment: 'Done', operations: ['z = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'multi-loop-same-collection')).toBeUndefined();
  });
});

describe('Performance rules', () => {
  it('flags storeOutputAutomatically on lookups', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Data', object: 'Account', storeOutputAutomatically: true, where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'store-output-auto');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('warning');
    expect(result!.deduction).toBe(3);
  });

  it('downgrades storeOutputAutomatically to info when a description documents the reason', () => {
    const doc = makeDoc({
      steps: [
        {
          lookup: 'Get_Account_Contact_Relations',
          object: 'AccountContactRelation',
          storeOutputAutomatically: true,
          description: 'Required to read Contact.Email via relationship path — dotted paths cannot be expressed in flat fields.',
          where: ['AccountId == $Record.AccountId'],
        },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'store-output-auto');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('info');
    expect(result!.deduction).toBe(0);
  });

  it('does not downgrade when description is empty whitespace', () => {
    const doc = makeDoc({
      steps: [
        {
          lookup: 'Get_X',
          object: 'Account',
          storeOutputAutomatically: true,
          description: '   ',
          where: ['Id == x'],
        },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'store-output-auto');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('warning');
  });

  it('flags same-object query in triggered flow', () => {
    const doc = makeDoc({
      trigger: { type: 'RecordAfterSave', object: 'Account', next: 'Query' },
      steps: [
        { lookup: 'Query', object: 'Account', where: ['Id == $Record.Id'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'same-object-query')).toBeDefined();
  });

  it('flags lookups without filters', () => {
    const doc = makeDoc({
      steps: [{ lookup: 'Get_All', object: 'Account' }] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'missing-filters')).toBeDefined();
  });

  it('detects hardcoded Salesforce IDs', () => {
    const doc = makeDoc({
      steps: [
        { assignment: 'Set_Owner', operations: ['$Record.OwnerId = "005000000000001"'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'hardcoded-ids')).toBeDefined();
  });

  it('flags dotted relationship paths in lookup fields', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Relation', object: 'Contact__c', fields: ['Id', 'ContactId', 'Contact.Email'], where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'lookup-fields-flat-only');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('critical');
    expect(result!.message).toContain('Contact.Email');
  });

  it('passes for flat lookup fields', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_Contacts', object: 'Contact', fields: ['Id', 'Email', 'FirstName'], where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-fields-flat-only')).toBeUndefined();
  });

  it('notes storeOutputAutomatically combined with explicit fields as advisory, not critical', () => {
    // Salesforce emits this combination itself on org-retrieved flows — it
    // deploys fine, so it must not read as a deploy blocker.
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_X', object: 'Contact', storeOutputAutomatically: true, fields: ['Id', 'Name'], where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'lookup-store-auto-and-fields');
    expect(result).toBeDefined();
    expect(result!.severity).toBe('info');
    expect(result!.deduction).toBe(0);
    expect(report.criticalCount).toBe(0);
  });

  it('passes with only storeOutputAutomatically (no fields)', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_X', object: 'Contact', storeOutputAutomatically: true, where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-store-auto-and-fields')).toBeUndefined();
  });

  it('passes with only fields (no storeOutputAutomatically)', () => {
    const doc = makeDoc({
      steps: [
        { lookup: 'Get_X', object: 'Contact', fields: ['Id', 'Name'], where: ['Id == x'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'lookup-store-auto-and-fields')).toBeUndefined();
  });
});

describe('Error Handling rules', () => {
  it('detects recursive after-update without entry conditions', () => {
    const doc = makeDoc({
      trigger: { type: 'RecordAfterSave', object: 'Account', next: 'Update' },
      steps: [
        { recordUpdate: 'Update', object: 'Account', fields: { Name: 'x' } },
      ] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'recursive-after-update');
    expect(result).toBeDefined();
    expect(result?.severity).toBe('critical');
  });

  it('does NOT flag recursive update when entry conditions exist', () => {
    const doc = makeDoc({
      trigger: {
        type: 'RecordAfterSave', object: 'Account', next: 'Update',
        entryConditions: ['Status__c isChanged'],
      },
      steps: [
        { recordUpdate: 'Update', object: 'Account', fields: { Name: 'x' } },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'recursive-after-update')).toBeUndefined();
  });

  it('flags missing fault paths on DML', () => {
    const doc = makeDoc({
      steps: [
        { recordCreate: 'Create_Record', object: 'Account', fields: { Name: 'x' } },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'missing-fault-paths')).toBeDefined();
  });

  it('passes when DML has fault path', () => {
    const doc = makeDoc({
      steps: [
        { recordCreate: 'Create_Record', object: 'Account', fields: { Name: 'x' }, faultNext: 'HandleError' },
        { assignment: 'HandleError', operations: ['err = 1'] },
      ] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'missing-fault-paths')).toBeUndefined();
  });
});

describe('no-global-constants rule', () => {
  it('flags $GlobalConstant.True in a condition', () => {
    const doc = makeDoc({
      steps: [{
        decision: 'Check_Bool',
        rules: [{
          name: 'Is_True',
          when: ['$Setup.Settings__c.IsEnabled__c == $GlobalConstant.True'],
          next: 'DoStuff',
        }],
        default: {},
      }] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'no-global-constants');
    expect(result).toBeDefined();
    expect(result?.message).toContain('use true instead');
  });

  it('flags $GlobalConstant.False in an assignment', () => {
    const doc = makeDoc({
      steps: [{
        assignment: 'Set_Flag',
        operations: ['varBool_Flag = $GlobalConstant.False'],
      }] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'no-global-constants');
    expect(result).toBeDefined();
    expect(result?.message).toContain('use false instead');
  });

  it('flags $GlobalConstant.EmptyString', () => {
    const doc = makeDoc({
      steps: [{
        assignment: 'Clear_Name',
        operations: ['varTxt_Name = $GlobalConstant.EmptyString'],
      }] as any,
    });
    const report = lintFlow(doc);
    const result = findResult(report, 'no-global-constants');
    expect(result).toBeDefined();
    expect(result?.message).toContain('use "" instead');
  });

  it('does not flag normal boolean conditions', () => {
    const doc = makeDoc({
      steps: [{
        decision: 'Check_Bool',
        rules: [{
          name: 'Is_True',
          when: ['varBool_Flag == true'],
          next: 'DoStuff',
        }],
        default: {},
      }] as any,
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'no-global-constants')).toBeUndefined();
  });
});

describe('Security rules', () => {
  it('flags outdated API version', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, apiVersion: '58.0' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'api-version-outdated')).toBeDefined();
  });

  it('passes current API version', () => {
    const doc = makeDoc({ flow: { ...makeDoc().flow, apiVersion: '62.0' } });
    const report = lintFlow(doc);
    expect(findResult(report, 'api-version-outdated')).toBeUndefined();
  });

  it('flags undocumented system mode', () => {
    const doc = makeDoc({
      flow: { ...makeDoc().flow, runInMode: 'SystemModeWithoutSharing' },
    });
    const report = lintFlow(doc);
    expect(findResult(report, 'system-mode-undocumented')).toBeDefined();
  });
});
