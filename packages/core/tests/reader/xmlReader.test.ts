import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readFlowXml } from '../../src/reader/xmlReader.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('xmlReader', () => {
  describe('simple record-triggered flow', () => {
    const xml = loadFixture('simple-record-triggered.xml');
    const doc = readFlowXml(xml);
    const compactDoc = readFlowXml(xml, { compact: true });

    it('reads flow header', () => {
      expect(doc.flow.name).toBe('Program_Enrollment_Returning_Participant_Flag');
      expect(doc.flow.label).toBe('Program Enrollment - Returning Participant Flag');
      expect(doc.flow.processType).toBe('AutoLaunchedFlow');
      expect(doc.flow.apiVersion).toBe('65.0');
      expect(doc.flow.status).toBe('Active');
      expect(doc.flow.description).toBe('Flags returning participant enrollments');
      expect(doc.flow.runInMode).toBe('SystemModeWithoutSharing');
    });

    it('default mode preserves full processMetadataValues in original order', () => {
      expect(doc.flow.rawProcessMetadata).toBeDefined();
      const names = doc.flow.rawProcessMetadata!.map(p => p.name);
      expect(names).toEqual(['CanvasMode', 'OriginBuilderId']);
    });

    it('compact mode excludes boilerplate processMetadata but preserves OriginBuilderId', () => {
      expect(compactDoc.flow.processMetadata).toBeDefined();
      expect(compactDoc.flow.processMetadata!['CanvasMode']).toBeUndefined();
      expect(compactDoc.flow.processMetadata!['BuilderType']).toBeUndefined();
      expect(compactDoc.flow.processMetadata!['OriginBuilderId']).toBe('some-builder-id');
    });

    it('reads trigger configuration', () => {
      expect(doc.trigger).toBeDefined();
      expect(doc.trigger!.type).toBe('RecordAfterSave');
      expect(doc.trigger!.object).toBe('ProgramEnrollment');
      expect(doc.trigger!.recordTriggerType).toBe('CreateAndUpdate');
      expect(doc.trigger!.requiresRecordChangedToMeetCriteria).toBe(true);
      expect(doc.trigger!.next).toBe('Get_Previous_Enrollments');
    });

    it('reads entry conditions', () => {
      expect(doc.trigger!.entryConditions).toBeDefined();
      const conditions = doc.trigger!.entryConditions as string[];
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toBe('ContactId isNotNull');
    });

    it('reads variables', () => {
      expect(doc.variables).toBeDefined();
      expect(doc.variables!.varBool_IsReturning).toBeDefined();
      expect(doc.variables!.varBool_IsReturning.dataType).toBe('Boolean');
      expect(doc.variables!.varBool_IsReturning.defaultValue).toBe(false);
    });

    it('reads record lookup step', () => {
      const lookup = doc.steps.find(s => 'lookup' in s);
      expect(lookup).toBeDefined();
      const l = lookup as any;
      expect(l.lookup).toBe('Get_Previous_Enrollments');
      expect(l.object).toBe('ProgramEnrollment');
      expect(l.getFirst).toBe(true);
      expect(l.fields).toEqual(['Id']);
      expect(l.assignNullValuesIfNoRecordsFound).toBe(true);
      expect(l.next).toBe('Previous_Enrollments_Found');
    });

    it('reads lookup where conditions', () => {
      const lookup = doc.steps.find(s => 'lookup' in s) as any;
      const where = lookup.where as string[];
      expect(where).toHaveLength(3);
      expect(where[0]).toBe('ContactId == $Record.ContactId');
      expect(where[1]).toBe('Status == "Completed"');
      expect(where[2]).toBe('Id != $Record.Id');
    });

    it('reads decision step', () => {
      const decision = doc.steps.find(s => 'decision' in s) as any;
      expect(decision).toBeDefined();
      expect(decision.decision).toBe('Previous_Enrollments_Found');
      expect(decision.rules).toHaveLength(1);
      expect(decision.rules[0].name).toBe('Yes');
      expect(decision.rules[0].next).toBe('Set_Returning_Participant');
      expect(decision.default.label).toBe('No');
      expect(decision.default.next).toBe('End_Flow');
    });

    it('reads assignment step', () => {
      const assignment = doc.steps.find(s => 'assignment' in s && (s as any).assignment === 'Set_Returning_Participant') as any;
      expect(assignment).toBeDefined();
      expect(assignment.operations).toEqual(['$Record.Returning_Participant__c = true']);
    });

    it('orders steps by execution flow', () => {
      const stepNames = doc.steps.map(s => {
        if ('lookup' in s) return (s as any).lookup;
        if ('decision' in s) return (s as any).decision;
        if ('assignment' in s) return (s as any).assignment;
        return 'unknown';
      });
      // Execution order: Get_Previous_Enrollments -> Previous_Enrollments_Found -> Set_Returning_Participant (Yes) -> End_Flow (No/default)
      expect(stepNames[0]).toBe('Get_Previous_Enrollments');
      expect(stepNames[1]).toBe('Previous_Enrollments_Found');
      expect(stepNames[2]).toBe('Set_Returning_Participant');
      expect(stepNames[3]).toBe('End_Flow');
    });

    it('has no start block (uses trigger)', () => {
      expect(doc.start).toBeUndefined();
    });
  });

  describe('simple screen flow', () => {
    const xml = loadFixture('simple-screen-flow.xml');
    const doc = readFlowXml(xml);

    it('reads flow header', () => {
      expect(doc.flow.processType).toBe('Flow');
      expect(doc.flow.status).toBe('Active');
    });

    it('reads start block (no trigger)', () => {
      expect(doc.start).toBeDefined();
      expect(doc.start!.next).toBe('Welcome_Screen');
      expect(doc.trigger).toBeUndefined();
    });

    it('reads screen step', () => {
      const screen = doc.steps.find(s => 'screen' in s) as any;
      expect(screen).toBeDefined();
      expect(screen.screen).toBe('Welcome_Screen');
      expect(screen.allowBack).toBe(true);
      expect(screen.allowFinish).toBe(true);
      expect(screen.next).toBe('Create_Record');
    });

    it('reads record create step', () => {
      const create = doc.steps.find(s => 'recordCreate' in s) as any;
      expect(create).toBeDefined();
      expect(create.recordCreate).toBe('Create_Record');
      expect(create.object).toBe('Task');
      expect(create.fields).toEqual({ Subject: 'Follow Up' });
    });

    it('orders screen before record create', () => {
      const stepNames = doc.steps.map(s => {
        if ('screen' in s) return (s as any).screen;
        if ('recordCreate' in s) return (s as any).recordCreate;
        return 'unknown';
      });
      expect(stepNames[0]).toBe('Welcome_Screen');
      expect(stepNames[1]).toBe('Create_Record');
    });
  });

  describe('loop with DML and fault', () => {
    const xml = loadFixture('loop-with-dml.xml');
    const doc = readFlowXml(xml);

    it('reads loop step', () => {
      const loop = doc.steps.find(s => 'loop' in s) as any;
      expect(loop).toBeDefined();
      expect(loop.loop).toBe('Loop_Cases');
      expect(loop.collection).toBe('Get_Cases');
      expect(loop.iterationOrder).toBe('Asc');
      expect(loop.iterationNext).toBe('Update_Case_Status');
      expect(loop.afterLastNext).toBe('Delete_Old_Records');
    });

    it('reads record delete with fault', () => {
      const del = doc.steps.find(s => 'recordDelete' in s) as any;
      expect(del).toBeDefined();
      expect(del.recordDelete).toBe('Delete_Old_Records');
      expect(del.object).toBe('Case');
      expect(del.faultNext).toBe('Handle_Error');
    });

    it('orders steps correctly through loop', () => {
      const stepNames = doc.steps.map(s => {
        for (const key of ['lookup', 'loop', 'assignment', 'recordDelete'] as const) {
          if (key in s) return (s as any)[key];
        }
        return 'unknown';
      });
      // Get_Cases -> Loop_Cases -> Update_Case_Status (iteration body) -> Delete_Old_Records (after loop) -> Handle_Error (fault)
      expect(stepNames[0]).toBe('Get_Cases');
      expect(stepNames[1]).toBe('Loop_Cases');
      expect(stepNames[2]).toBe('Update_Case_Status');
      expect(stepNames[3]).toBe('Delete_Old_Records');
      expect(stepNames[4]).toBe('Handle_Error');
    });
  });

  describe('fallbackName option (no <fullName> in XML)', () => {
    const xmlWithoutFullName = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <label>Account Campaign After Insert/Update</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Active</status>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </start>
</Flow>`;

    it('uses fallbackName when <fullName> is absent', () => {
      const doc = readFlowXml(xmlWithoutFullName, { fallbackName: 'Account_Campaign_After_Update' });
      expect(doc.flow.name).toBe('Account_Campaign_After_Update');
      expect(doc.flow.label).toBe('Account Campaign After Insert/Update');
    });

    it('preserves <fullName> when present even if fallbackName is supplied', () => {
      const xmlWithFullName = xmlWithoutFullName.replace(
        '<label>Account Campaign After Insert/Update</label>',
        '<fullName>Explicit_Full_Name</fullName>\n    <label>Account Campaign After Insert/Update</label>'
      );
      const doc = readFlowXml(xmlWithFullName, { fallbackName: 'Some_Other_Name' });
      expect(doc.flow.name).toBe('Explicit_Full_Name');
      expect(doc.flow.label).toBe('Account Campaign After Insert/Update');
    });

    it('falls back to label when neither <fullName> nor fallbackName is supplied (legacy behavior)', () => {
      const doc = readFlowXml(xmlWithoutFullName);
      expect(doc.flow.name).toBe('Account Campaign After Insert/Update');
    });
  });
});
