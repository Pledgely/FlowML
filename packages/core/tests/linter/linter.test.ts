import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { lintFlow } from '../../src/linter/linter.js';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import type { FlowMLDocument } from '../../src/types.js';

function makeDoc(overrides: Partial<FlowMLDocument> = {}): FlowMLDocument {
  return {
    flow: {
      name: 'Account_AfterSave_UpdateContacts',
      label: 'Update Related Contacts',
      processType: 'AutoLaunchedFlow',
      apiVersion: '62.0',
      status: 'Draft',
      description: 'When an Account is updated, synchronize key fields to all related Contact records.',
    },
    trigger: {
      type: 'RecordAfterSave',
      object: 'Account',
      next: 'Get_Contacts',
      entryConditions: ['Status__c isChanged'],
    },
    steps: [
      { lookup: 'Get_Contacts', object: 'Contact', where: ['AccountId == $Record.Id'], getFirst: false, next: 'Check_Contacts' },
      {
        decision: 'Check_Contacts',
        rules: [{ name: 'Has_Contacts', when: ['Get_Contacts isNotNull'], next: 'Loop_Contacts' }],
        default: { label: 'No Contacts' },
      },
      { loop: 'Loop_Contacts', collection: 'Get_Contacts', iterationNext: 'Set_Fields', afterLastNext: 'Bulk_Update' },
      { assignment: 'Set_Fields', operations: ['Loop_Contacts.Status__c = $Record.Status__c', 'varCol_ToUpdate += Loop_Contacts'], next: 'Loop_Contacts' },
      { recordUpdate: 'Bulk_Update', inputReference: 'varCol_ToUpdate', faultNext: 'Log_Error' },
      { subflow: 'Log_Error', flowName: 'Sub_LogError', inputs: { message: '$Flow.FaultMessage' } },
    ] as any,
    variables: {
      varCol_ToUpdate: { dataType: 'SObject', objectType: 'Contact', isCollection: true },
    },
    ...overrides,
  };
}

describe('lintFlow scoring', () => {
  it('returns maxScore of 110', () => {
    const report = lintFlow(makeDoc());
    expect(report.maxScore).toBe(110);
  });

  it('well-structured flow gets high score', () => {
    const report = lintFlow(makeDoc());
    expect(report.totalScore).toBeGreaterThanOrEqual(85);
    expect(report.rating).toBe('Production-ready');
  });

  it('bad flow gets low score', () => {
    const badDoc = makeDoc({
      flow: {
        name: 'badflow',
        label: 'bad',
        processType: 'AutoLaunchedFlow',
        apiVersion: '55.0',
        status: 'Draft',
      },
      trigger: { type: 'RecordAfterSave', object: 'Account', next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'DmlInLoop', afterLastNext: 'End' },
        { recordUpdate: 'DmlInLoop', object: 'Account', fields: { Name: 'x' }, next: 'MyLoop' },
        { assignment: 'End', operations: ['x = 1'] },
      ] as any,
      variables: undefined,
    });
    const report = lintFlow(badDoc);
    expect(report.totalScore).toBeLessThan(70);
  });

  it('rating thresholds are correct', () => {
    // Well-structured: >= 80%
    const good = lintFlow(makeDoc());
    expect(good.percentage).toBeGreaterThanOrEqual(80);
    expect(good.rating).toBe('Production-ready');
  });

  it('categories sum to total', () => {
    const report = lintFlow(makeDoc());
    const catSum = report.categories.reduce((s, c) => s + c.score, 0);
    expect(catSum).toBe(report.totalScore);
  });

  it('6 categories are present', () => {
    const report = lintFlow(makeDoc());
    expect(report.categories).toHaveLength(6);
    const cats = report.categories.map(c => c.category);
    expect(cats).toContain('design');
    expect(cats).toContain('logic');
    expect(cats).toContain('architecture');
    expect(cats).toContain('performance');
    expect(cats).toContain('errorHandling');
    expect(cats).toContain('security');
  });
});

describe('lintFlow on fixture flows', () => {
  const fixturesDir = resolve(__dirname, '../fixtures');

  const fixtures = [
    'simple-record-triggered.xml',
  ];

  for (const fixture of fixtures) {
    it(`produces reasonable score for ${fixture}`, () => {
      const xml = readFileSync(resolve(fixturesDir, fixture), 'utf-8');
      const doc = readFlowXml(xml);
      const report = lintFlow(doc);

      // Scores should be between 0 and 110
      expect(report.totalScore).toBeGreaterThanOrEqual(0);
      expect(report.totalScore).toBeLessThanOrEqual(110);
      // Should not be 0 (would indicate a bug)
      expect(report.totalScore).toBeGreaterThan(0);
      // Percentage should be consistent
      expect(report.percentage).toBe(Math.round((report.totalScore / report.maxScore) * 100));
    });
  }
});
