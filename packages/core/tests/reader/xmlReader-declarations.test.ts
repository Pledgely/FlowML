import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readFlowXml } from '../../src/reader/xmlReader.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('xmlReader - record update modes and declarations', () => {
  const xml = loadFixture('record-update-modes.xml');
  const doc = readFlowXml(xml);

  it('reads RecordBeforeSave trigger', () => {
    expect(doc.trigger!.type).toBe('RecordBeforeSave');
    expect(doc.trigger!.object).toBe('ProgramEnrollment');
    expect(doc.trigger!.recordTriggerType).toBe('Update');
  });

  it('reads update by reference with field overrides', () => {
    const step = doc.steps.find(s => 'recordUpdate' in s && (s as any).recordUpdate === 'Update_By_Reference') as any;
    expect(step.inputReference).toBe('$Record');
    expect(step.fields).toEqual({ Returning_Participant__c: true });
    expect(step.next).toBe('Update_By_Criteria');
  });

  it('reads update by criteria with where and fields', () => {
    const step = doc.steps.find(s => 'recordUpdate' in s && (s as any).recordUpdate === 'Update_By_Criteria') as any;
    expect(step.object).toBe('Case');
    expect(step.where).toEqual([
      'ContactId == $Record.ContactId',
      'Status == "Open"',
    ]);
    expect(step.fields).toEqual({ Status: 'Closed' });
  });

  it('reads update by reference only (no fields)', () => {
    const step = doc.steps.find(s => 'recordUpdate' in s && (s as any).recordUpdate === 'Update_Ref_Only') as any;
    expect(step.inputReference).toBe('varRec_Account');
    expect(step.fields).toBeUndefined();
  });

  it('reads formulas', () => {
    expect(doc.formulas).toBeDefined();
    expect(doc.formulas!.forTxt_FullName.dataType).toBe('String');
    expect(doc.formulas!.forTxt_FullName.expression).toContain('$Record.First_Name__c');
  });

  it('reads text templates', () => {
    expect(doc.textTemplates).toBeDefined();
    expect(doc.textTemplates!.txtTxt_Body.isViewedAsPlainText).toBe(true);
    expect(doc.textTemplates!.txtTxt_Body.text).toBe('Hello {!forTxt_FullName}');
  });

  it('reads constants', () => {
    expect(doc.constants).toBeDefined();
    expect(doc.constants!.conTxt_Status.dataType).toBe('String');
    expect(doc.constants!.conTxt_Status.value).toBe('In Progress');
  });

  it('orders steps correctly', () => {
    const names = doc.steps.map(s => (s as any).recordUpdate);
    expect(names[0]).toBe('Update_By_Reference');
    expect(names[1]).toBe('Update_By_Criteria');
    expect(names[2]).toBe('Update_Ref_Only');
  });
});
