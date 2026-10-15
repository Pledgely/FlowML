import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { XMLParser } from 'fast-xml-parser';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';
import { writeXml } from '../../src/writer/xmlWriter.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
});

/** Parse XML string to object for comparison */
function parseXml(xml: string): Record<string, unknown> {
  return xmlParser.parse(xml);
}

/** Full round-trip: XML -> FlowML doc -> XML -> re-parse */
function roundTrip(fixtureName: string): { original: Record<string, unknown>; generated: Record<string, unknown>; generatedXml: string } {
  const xml = loadFixture(fixtureName);
  const doc = readFlowXml(xml);
  const generatedXml = writeXml(doc);
  const original = parseXml(xml);
  const generated = parseXml(generatedXml);
  return { original, generated, generatedXml };
}

function getFlow(parsed: Record<string, unknown>): Record<string, unknown> {
  return parsed.Flow as Record<string, unknown>;
}

// ============================================================
// Basic XML generation
// ============================================================

describe('xmlWriter', () => {
  describe('simple-record-triggered round-trip', () => {
    const { original, generated, generatedXml } = roundTrip('simple-record-triggered.xml');

    it('generates valid XML', () => {
      expect(generatedXml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(generatedXml).toContain('<Flow xmlns="http://soap.sforce.com/2006/04/metadata">');
      expect(generatedXml).toContain('</Flow>');
    });

    it('preserves apiVersion', () => {
      expect(getFlow(generated).apiVersion).toBe(getFlow(original).apiVersion);
    });

    it('preserves processType', () => {
      expect(getFlow(generated).processType).toBe(getFlow(original).processType);
    });

    it('preserves status', () => {
      expect(getFlow(generated).status).toBe(getFlow(original).status);
    });

    it('preserves label', () => {
      expect(getFlow(generated).label).toBe(getFlow(original).label);
    });

    it('preserves fullName', () => {
      expect(getFlow(generated).fullName).toBe(getFlow(original).fullName);
    });

    it('preserves description', () => {
      expect(getFlow(generated).description).toBe(getFlow(original).description);
    });

    it('preserves runInMode', () => {
      expect(getFlow(generated).runInMode).toBe(getFlow(original).runInMode);
    });

    it('generates processMetadataValues with CanvasMode', () => {
      expect(generatedXml).toContain('AUTO_LAYOUT_CANVAS');
    });

    it('has start element with trigger info', () => {
      const start = getFlow(generated).start as Record<string, unknown>;
      expect(start).toBeDefined();
      expect(start.triggerType).toBe('RecordAfterSave');
      expect(start.object).toBe('ProgramEnrollment');
      expect(start.recordTriggerType).toBe('CreateAndUpdate');
    });

    it('preserves record lookup', () => {
      const gen = getFlow(generated);
      expect(gen.recordLookups).toBeDefined();
      const lookup = (Array.isArray(gen.recordLookups) ? gen.recordLookups[0] : gen.recordLookups) as Record<string, unknown>;
      expect(lookup.name).toBe('Get_Previous_Enrollments');
      expect(lookup.object).toBe('ProgramEnrollment');
      expect(lookup.getFirstRecordOnly).toBe('true');
    });

    it('preserves decisions', () => {
      const gen = getFlow(generated);
      expect(gen.decisions).toBeDefined();
      const decision = (Array.isArray(gen.decisions) ? gen.decisions[0] : gen.decisions) as Record<string, unknown>;
      expect(decision.name).toBe('Previous_Enrollments_Found');
    });

    it('preserves assignments', () => {
      const gen = getFlow(generated);
      expect(gen.assignments).toBeDefined();
    });

    it('preserves variables', () => {
      const gen = getFlow(generated);
      expect(gen.variables).toBeDefined();
      const v = (Array.isArray(gen.variables) ? gen.variables[0] : gen.variables) as Record<string, unknown>;
      expect(v.name).toBe('varBool_IsReturning');
      expect(v.dataType).toBe('Boolean');
    });

    it('falls back to locationX/Y=0 when absent on doc', () => {
      // Writer-fallback contract: when coords are absent on the input doc,
      // the writer fills 0 — independent of any fixture's actual coords.
      const syntheticDoc = {
        flow: {
          name: 'NoCoordTest',
          label: 'NoCoordTest',
          processType: 'AutoLaunchedFlow',
          apiVersion: '65.0',
          status: 'Draft',
        },
        start: { next: 'A1' },
        steps: [
          { label: 'A1', assignment: 'A1', operations: ['varX = "hello"'] },
        ],
      } as any;
      const syntheticXml = writeXml(syntheticDoc);
      expect(syntheticXml).toContain('<locationX>0</locationX>');
      expect(syntheticXml).toContain('<locationY>0</locationY>');
    });
  });

  // ============================================================
  // Loop with DML
  // ============================================================

  describe('loop-with-dml round-trip', () => {
    const { generated } = roundTrip('loop-with-dml.xml');

    it('preserves loops', () => {
      const gen = getFlow(generated);
      expect(gen.loops).toBeDefined();
      const loop = (Array.isArray(gen.loops) ? gen.loops[0] : gen.loops) as Record<string, unknown>;
      expect(loop.collectionReference).toBeDefined();
    });

    it('preserves loop connectors', () => {
      const gen = getFlow(generated);
      const loop = (Array.isArray(gen.loops) ? gen.loops[0] : gen.loops) as Record<string, unknown>;
      // Should have nextValueConnector or noMoreValuesConnector
      const hasConnector = loop.nextValueConnector || loop.noMoreValuesConnector;
      expect(hasConnector).toBeTruthy();
    });
  });

  // ============================================================
  // Action and subflow
  // ============================================================

  describe('action-subflow round-trip', () => {
    const { generated } = roundTrip('action-subflow.xml');

    it('preserves action calls', () => {
      const gen = getFlow(generated);
      expect(gen.actionCalls).toBeDefined();
    });

    it('preserves subflows', () => {
      const gen = getFlow(generated);
      expect(gen.subflows).toBeDefined();
    });
  });

  // ============================================================
  // Scheduled flow
  // ============================================================

  describe('scheduled-flow round-trip', () => {
    const { generated } = roundTrip('scheduled-flow.xml');

    it('preserves start element with schedule info', () => {
      const start = getFlow(generated).start as Record<string, unknown>;
      expect(start).toBeDefined();
    });
  });

  // ============================================================
  // Record update modes
  // ============================================================

  describe('record-update-modes round-trip', () => {
    const { generated } = roundTrip('record-update-modes.xml');

    it('preserves recordUpdates', () => {
      const gen = getFlow(generated);
      expect(gen.recordUpdates).toBeDefined();
    });
  });

  // ============================================================
  // New element types
  // ============================================================

  describe('customErrors round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <customErrors>
        <name>Prevent_Update</name>
        <label>Cannot Update</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <customErrorMessages>
            <errorMessage>You do not have permission</errorMessage>
            <isFieldError>false</isFieldError>
        </customErrorMessages>
    </customErrors>
    <label>Test Custom Errors</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Prevent_Update</targetReference>
        </connector>
        <object>Account</object>
        <recordTriggerType>Update</recordTriggerType>
        <triggerType>RecordBeforeSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);
    const generated = parseXml(generatedXml);

    it('reads customError step', () => {
      const step = doc.steps.find(s => 'customError' in s) as any;
      expect(step).toBeDefined();
      expect(step.customError).toBe('Prevent_Update');
      expect(step.messages).toHaveLength(1);
      expect(step.messages[0].errorMessage).toBe('You do not have permission');
      expect(step.messages[0].isFieldError).toBe(false);
    });

    it('writes customErrors element', () => {
      expect(generatedXml).toContain('<customErrors>');
      expect(generatedXml).toContain('<name>Prevent_Update</name>');
      expect(generatedXml).toContain('<customErrorMessages>');
      expect(generatedXml).toContain('<errorMessage>You do not have permission</errorMessage>');
    });

    it('preserves customErrors through parse', () => {
      const gen = getFlow(generated);
      expect(gen.customErrors).toBeDefined();
    });
  });

  describe('waits round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <label>Test Waits</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Wait_24_Hours</targetReference>
        </connector>
    </start>
    <status>Active</status>
    <waits>
        <name>Wait_24_Hours</name>
        <label>Wait 24 Hours</label>
        <locationX>200</locationX>
        <locationY>300</locationY>
        <defaultConnector>
            <targetReference>Fallback</targetReference>
        </defaultConnector>
        <defaultConnectorLabel>Default</defaultConnectorLabel>
        <waitEvents>
            <connector>
                <targetReference>Send_Followup</targetReference>
            </connector>
            <eventType>DateRefAlarmEvent</eventType>
            <inputParameters>
                <name>TimeOffset</name>
                <value>
                    <numberValue>24.0</numberValue>
                </value>
            </inputParameters>
            <label>24 Hours</label>
            <name>Twenty_Four_Hours</name>
        </waitEvents>
    </waits>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);
    const generated = parseXml(generatedXml);

    it('reads wait step', () => {
      const step = doc.steps.find(s => 'wait' in s) as any;
      expect(step).toBeDefined();
      expect(step.wait).toBe('Wait_24_Hours');
      expect(step.defaultNext).toBe('Fallback');
      expect(step.defaultLabel).toBe('Default');
      expect(step.events).toHaveLength(1);
      expect(step.events[0].name).toBe('Twenty_Four_Hours');
      expect(step.events[0].eventType).toBe('DateRefAlarmEvent');
      expect(step.events[0].next).toBe('Send_Followup');
    });

    it('writes waits element', () => {
      expect(generatedXml).toContain('<waits>');
      expect(generatedXml).toContain('<name>Wait_24_Hours</name>');
      expect(generatedXml).toContain('<waitEvents>');
      expect(generatedXml).toContain('<eventType>DateRefAlarmEvent</eventType>');
      expect(generatedXml).toContain('<defaultConnectorLabel>Default</defaultConnectorLabel>');
    });

    it('preserves waits through parse', () => {
      const gen = getFlow(generated);
      expect(gen.waits).toBeDefined();
    });
  });

  describe('recordLocks round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <label>Test Record Locks</label>
    <processType>AutoLaunchedFlow</processType>
    <recordLocks>
        <name>Lock_Record</name>
        <label>Lock Record</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <connector>
            <targetReference>Next_Step</targetReference>
        </connector>
        <faultConnector>
            <targetReference>Handle_Error</targetReference>
        </faultConnector>
        <inputReference>$Record</inputReference>
        <lockOrUnlock>Lock</lockOrUnlock>
    </recordLocks>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Lock_Record</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);
    const generated = parseXml(generatedXml);

    it('reads recordLock step', () => {
      const step = doc.steps.find(s => 'recordLock' in s) as any;
      expect(step).toBeDefined();
      expect(step.recordLock).toBe('Lock_Record');
      expect(step.inputReference).toBe('$Record');
      expect(step.lockOrUnlock).toBe('Lock');
      expect(step.next).toBe('Next_Step');
      expect(step.faultNext).toBe('Handle_Error');
    });

    it('writes recordLocks element', () => {
      expect(generatedXml).toContain('<recordLocks>');
      expect(generatedXml).toContain('<name>Lock_Record</name>');
      expect(generatedXml).toContain('<inputReference>$Record</inputReference>');
      expect(generatedXml).toContain('<lockOrUnlock>Lock</lockOrUnlock>');
    });

    it('preserves recordLocks through parse', () => {
      const gen = getFlow(generated);
      expect(gen.recordLocks).toBeDefined();
    });
  });

  describe('recordRollbacks round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <label>Test Record Rollbacks</label>
    <processType>Flow</processType>
    <recordRollbacks>
        <name>Undo_Changes</name>
        <label>Roll Back Records</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <connector>
            <targetReference>Show_Error_Screen</targetReference>
        </connector>
    </recordRollbacks>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Undo_Changes</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);
    const generated = parseXml(generatedXml);

    it('reads recordRollback step', () => {
      const step = doc.steps.find(s => 'recordRollback' in s) as any;
      expect(step).toBeDefined();
      expect(step.recordRollback).toBe('Undo_Changes');
      expect(step.next).toBe('Show_Error_Screen');
    });

    it('writes recordRollbacks element', () => {
      expect(generatedXml).toContain('<recordRollbacks>');
      expect(generatedXml).toContain('<name>Undo_Changes</name>');
      expect(generatedXml).toContain('<label>Roll Back Records</label>');
    });

    it('preserves recordRollbacks through parse', () => {
      const gen = getFlow(generated);
      expect(gen.recordRollbacks).toBeDefined();
    });
  });

  // ============================================================
  // BUG-22: numberValue decimal preservation
  // ============================================================

  describe('numberValue decimal preservation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <actionCalls>
        <name>Test_Action</name>
        <label>Test Action</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <inputParameters>
            <name>minRows</name>
            <value>
                <numberValue>0.0</numberValue>
            </value>
        </inputParameters>
    </actionCalls>
    <label>Test NumberValue</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Test_Action</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);

    it('preserves 0.0 format in numberValue', () => {
      expect(generatedXml).toContain('<numberValue>0.0</numberValue>');
      expect(generatedXml).not.toContain('<numberValue>0</numberValue>');
    });
  });

  // ============================================================
  // BUG-24: scheduledPaths ordering
  // ============================================================

  describe('scheduledPaths ordering', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <label>Test Scheduled Paths</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <object>Account</object>
        <recordTriggerType>Update</recordTriggerType>
        <scheduledPaths>
            <name>Scheduled_Path</name>
            <connector>
                <targetReference>Next_Step</targetReference>
            </connector>
            <label>My Path</label>
            <offsetNumber>1</offsetNumber>
            <offsetUnit>Minutes</offsetUnit>
            <timeSource>RecordTriggerEvent</timeSource>
        </scheduledPaths>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`;

    const generatedXml = writeXml(readFlowXml(xml));

    it('emits name before connector in scheduledPaths', () => {
      const nameIdx = generatedXml.indexOf('<name>Scheduled_Path</name>');
      const connIdx = generatedXml.indexOf('<targetReference>Next_Step</targetReference>');
      expect(nameIdx).toBeLessThan(connIdx);
    });

    it('emits label after connector', () => {
      const connIdx = generatedXml.indexOf('<targetReference>Next_Step</targetReference>');
      const labelIdx = generatedXml.indexOf('<label>My Path</label>');
      expect(connIdx).toBeLessThan(labelIdx);
    });
  });

  // ============================================================
  // inputConfiguratorMode ordering
  // ============================================================

  describe('inputConfiguratorMode ordering', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <actionCalls>
        <name>Send_Email</name>
        <label>Send Email</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <inputParameters>
            <name>senderType</name>
            <value>
                <inputConfiguratorMode>Custom</inputConfiguratorMode>
                <stringValue>OrgWideEmailAddress</stringValue>
            </value>
        </inputParameters>
        <inputParameters>
            <name>emailTemplateId</name>
            <value>
                <elementReference>Get_Template.Id</elementReference>
                <inputConfiguratorMode>Resource</inputConfiguratorMode>
            </value>
        </inputParameters>
    </actionCalls>
    <label>Test ICM</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Send_Email</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);

    it('puts inputConfiguratorMode before stringValue', () => {
      const modeIdx = generatedXml.indexOf('<inputConfiguratorMode>Custom</inputConfiguratorMode>');
      const valIdx = generatedXml.indexOf('<stringValue>OrgWideEmailAddress</stringValue>');
      expect(modeIdx).toBeGreaterThan(-1);
      expect(valIdx).toBeGreaterThan(-1);
      expect(modeIdx).toBeLessThan(valIdx);
    });

    it('puts elementReference before inputConfiguratorMode', () => {
      const refIdx = generatedXml.indexOf('<elementReference>Get_Template.Id</elementReference>');
      const modeIdx = generatedXml.indexOf('<inputConfiguratorMode>Resource</inputConfiguratorMode>');
      expect(refIdx).toBeGreaterThan(-1);
      expect(modeIdx).toBeGreaterThan(-1);
      expect(refIdx).toBeLessThan(modeIdx);
    });
  });

  // ============================================================
  // Null-clear semantics
  // ============================================================

  describe('null-clear semantics', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <assignments>
        <name>Clear_Fields</name>
        <label>Clear Fields</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <assignmentItems>
            <assignToReference>varRec.Field__c</assignToReference>
            <operator>Assign</operator>
        </assignmentItems>
    </assignments>
    <label>Test Null Clear</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Clear_Fields</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);

    it('does not emit value tag for null-clear assignments', () => {
      expect(generatedXml).toContain('<assignToReference>varRec.Field__c</assignToReference>');
      expect(generatedXml).toContain('<operator>Assign</operator>');
      // Should NOT have a <value> or <stringValue> in the assignment
      const assignBlock = generatedXml.substring(
        generatedXml.indexOf('<assignmentItems>'),
        generatedXml.indexOf('</assignmentItems>') + '</assignmentItems>'.length
      );
      expect(assignBlock).not.toContain('<value>');
      expect(assignBlock).not.toContain('<stringValue>');
    });
  });

  // ============================================================
  // faultIsGoTo preservation
  // ============================================================

  describe('faultIsGoTo preservation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <actionCalls>
        <name>My_Action</name>
        <label>My Action</label>
        <locationX>100</locationX>
        <locationY>200</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <faultConnector>
            <isGoTo>true</isGoTo>
            <targetReference>Error_Handler</targetReference>
        </faultConnector>
    </actionCalls>
    <label>Test FaultIsGoTo</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>My_Action</targetReference>
        </connector>
    </start>
    <status>Active</status>
</Flow>`;

    const doc = readFlowXml(xml);
    const generatedXml = writeXml(doc);

    it('preserves isGoTo on faultConnector', () => {
      const faultBlock = generatedXml.substring(
        generatedXml.indexOf('<faultConnector>'),
        generatedXml.indexOf('</faultConnector>') + '</faultConnector>'.length
      );
      expect(faultBlock).toContain('<isGoTo>true</isGoTo>');
      expect(faultBlock).toContain('<targetReference>Error_Handler</targetReference>');
    });
  });
});

// ============================================================
// Filter auto-synthesis (Item 4 fix)
// ============================================================

describe('filter auto-synthesis', () => {
  function baseDoc(overrides: Record<string, unknown> = {}) {
    return {
      flow: {
        name: 'Test_Filter_Flow',
        label: 'Test Filter Flow',
        processType: 'AutoLaunchedFlow',
        apiVersion: '65.0',
        status: 'Draft',
      },
      steps: [],
      ...overrides,
    } as any;
  }

  it('auto-synthesizes itemVariable, variable declaration, and qualifies bare where-clauses when source is a prior lookup', () => {
    const doc = baseDoc({
      steps: [
        { lookup: 'Get_Contacts', object: 'Contact', where: ['AccountId != null'] },
        {
          filter: 'Filter_Active',
          collection: 'Get_Contacts',
          where: ['Status__c == "Active"'],
        },
      ],
    });

    const xml = writeXml(doc);

    expect(xml).toContain('<assignNextValueToReference>Filter_Active_CurrentItem</assignNextValueToReference>');
    expect(xml).toContain('<leftValueReference>Filter_Active_CurrentItem.Status__c</leftValueReference>');
    expect(xml).toMatch(/<variables>[\s\S]*?<name>Filter_Active_CurrentItem<\/name>[\s\S]*?<objectType>Contact<\/objectType>/);
  });

  it('honors an explicit itemVariable and does not re-qualify already-qualified fields', () => {
    const doc = baseDoc({
      variables: {
        my_item: { dataType: 'SObject', objectType: 'Account', isCollection: false },
      },
      steps: [
        { lookup: 'Get_Accounts', object: 'Account', where: ['Id != null'] },
        {
          filter: 'Filter_Big',
          collection: 'Get_Accounts',
          itemVariable: 'my_item',
          where: ['my_item.AnnualRevenue > 1000000'],
        },
      ],
    });

    const xml = writeXml(doc);

    expect(xml).toContain('<assignNextValueToReference>my_item</assignNextValueToReference>');
    expect(xml).toContain('<leftValueReference>my_item.AnnualRevenue</leftValueReference>');
    expect(xml).not.toContain('my_item.my_item');
  });

  it('leaves $Record and cross-step dotted refs unqualified', () => {
    const doc = baseDoc({
      trigger: { type: 'RecordAfterSave', object: 'Contact', next: 'Get_Cases' },
      steps: [
        { lookup: 'Get_Cases', object: 'Case', where: ['Id != null'] },
        {
          filter: 'Filter_Mine',
          collection: 'Get_Cases',
          where: ['OwnerId == $Record.Id'],
        },
      ],
    });

    const xml = writeXml(doc);

    expect(xml).toContain('<leftValueReference>Filter_Mine_CurrentItem.OwnerId</leftValueReference>');
    expect(xml).toContain('<elementReference>$Record.Id</elementReference>');
  });

  it('infers object type from a declared SObject collection variable', () => {
    const doc = baseDoc({
      variables: {
        varCol_Contacts: { dataType: 'SObject', objectType: 'Contact', isCollection: true },
      },
      steps: [
        {
          filter: 'Filter_By_Name',
          collection: 'varCol_Contacts',
          where: ['LastName != null'],
        },
      ],
    });

    const xml = writeXml(doc);

    expect(xml).toContain('<assignNextValueToReference>Filter_By_Name_CurrentItem</assignNextValueToReference>');
    expect(xml).toMatch(/<name>Filter_By_Name_CurrentItem<\/name>[\s\S]*?<objectType>Contact<\/objectType>/);
  });

  it('throws a clear error when the collection type cannot be inferred', () => {
    const doc = baseDoc({
      steps: [
        {
          filter: 'Filter_Orphan',
          collection: 'undeclared_collection',
          where: ['Status__c == "Active"'],
        },
      ],
    });

    expect(() => writeXml(doc)).toThrow(/cannot be inferred/);
  });

  it('does not mutate the caller document', () => {
    const doc = baseDoc({
      steps: [
        { lookup: 'Get_Contacts', object: 'Contact', where: ['Id != null'] },
        {
          filter: 'Filter_Active',
          collection: 'Get_Contacts',
          where: ['Status__c == "Active"'],
        },
      ],
    });

    writeXml(doc);

    const filter = doc.steps.find((s: any) => 'filter' in s) as any;
    expect(filter.itemVariable).toBeUndefined();
    expect(filter.where).toEqual(['Status__c == "Active"']);
    expect(doc.variables).toBeUndefined();
  });
});

describe('value-type fidelity', () => {
  function pipelineRoundTrip(body: string): string {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
${body}
    <apiVersion>65.0</apiVersion>
    <fullName>Value_Type_Fidelity</fullName>
    <label>Value Type Fidelity</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Draft</status>
</Flow>
`;
    const document = readFlowXml(xml, { fallbackName: 'Value_Type_Fidelity' });
    return writeXml(readYaml(emitYaml(document), { validate: true }));
  }

  it('preserves declaration value wrappers through validated YAML', () => {
    const generated = pipelineRoundTrip(`    <constants>
        <name>Email_Address</name>
        <dataType>String</dataType>
        <value>
            <stringValue>noreply@example.org</stringValue>
        </value>
    </constants>
    <variables>
        <name>Email_Subject</name>
        <dataType>String</dataType>
        <isCollection>false</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
        <value>
            <elementReference>Subject_Source</elementReference>
        </value>
    </variables>`);

    expect(generated).toMatch(
      /<constants>[\s\S]*?<stringValue>noreply@example\.org<\/stringValue>[\s\S]*?<\/constants>/
    );
    expect(generated).toMatch(
      /<variables>[\s\S]*?<elementReference>Subject_Source<\/elementReference>[\s\S]*?<\/variables>/
    );
  });

  it('preserves a screen-field elementReference default through validated YAML', () => {
    const generated = pipelineRoundTrip(`    <screens>
        <allowBack>true</allowBack>
        <allowFinish>true</allowFinish>
        <allowPause>false</allowPause>
        <fields>
            <name>Email_Default</name>
            <dataType>String</dataType>
            <defaultValue>
                <elementReference>Email_Subject</elementReference>
            </defaultValue>
            <fieldText>Email</fieldText>
            <fieldType>InputField</fieldType>
            <isRequired>false</isRequired>
        </fields>
        <name>Screen_One</name>
        <showFooter>true</showFooter>
        <showHeader>true</showHeader>
    </screens>`);

    expect(generated).toMatch(
      /<defaultValue>\s*<elementReference>Email_Subject<\/elementReference>\s*<\/defaultValue>/
    );
  });

  it('preserves date and datetime wrappers in filters and assignments', () => {
    const generated = pipelineRoundTrip(`    <assignments>
        <name>Set_Date</name>
        <assignmentItems>
            <assignToReference>Target_Date</assignToReference>
            <operator>Assign</operator>
            <value>
                <dateValue>2025-07-01</dateValue>
            </value>
        </assignmentItems>
    </assignments>
    <recordLookups>
        <name>Find_Records</name>
        <filters>
            <field>CreatedDate</field>
            <operator>GreaterThan</operator>
            <value>
                <dateTimeValue>2025-07-01T12:30:45Z</dateTimeValue>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>Contact</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>`);

    expect(generated).toContain('<dateValue>2025-07-01</dateValue>');
    expect(generated).toContain('<dateTimeValue>2025-07-01T12:30:45Z</dateTimeValue>');
  });

  it('preserves processMetadataValues boolean wrappers through validated YAML', () => {
    const generated = pipelineRoundTrip(`    <processMetadataValues>
        <name>IsExampleEnabled</name>
        <value>
            <booleanValue>true</booleanValue>
        </value>
    </processMetadataValues>`);

    expect(generated).toMatch(
      /<processMetadataValues>[\s\S]*?<booleanValue>true<\/booleanValue>[\s\S]*?<\/processMetadataValues>/
    );
  });
});

describe('round-trip fidelity phases 3, 4, and 6', () => {
  function pipelineRoundTrip(body: string): string {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
${body}
    <apiVersion>65.0</apiVersion>
    <fullName>Roundtrip_Fidelity</fullName>
    <label>Roundtrip Fidelity</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Draft</status>
</Flow>
`;
    const document = readFlowXml(xml, { fallbackName: 'Roundtrip_Fidelity' });
    return writeXml(readYaml(emitYaml(document), { validate: true }));
  }

  it('preserves non-Apex actionName and action dataTypeMappings', () => {
    const generated = pipelineRoundTrip(`    <actionCalls>
        <name>Birthday_Alert</name>
        <label>Birthday Alert</label>
        <locationX>10</locationX>
        <locationY>20</locationY>
        <actionName>Contact.Happy_Birthday_Email</actionName>
        <actionType>emailAlert</actionType>
        <dataTypeMappings>
            <typeName>T__Input</typeName>
            <typeValue>Account</typeValue>
        </dataTypeMappings>
        <dataTypeMappings>
            <typeName>U__Output</typeName>
            <typeValue>Contact</typeValue>
        </dataTypeMappings>
        <nameSegment>Happy_Birthday_Email</nameSegment>
    </actionCalls>`);

    expect(generated).toContain('<actionName>Contact.Happy_Birthday_Email</actionName>');
    expect(generated.match(/<dataTypeMappings>/g)).toHaveLength(2);
    expect(generated).toContain('<typeName>T__Input</typeName>');
    expect(generated).toContain('<typeValue>Contact</typeValue>');
  });

  it('preserves legacy string-valued inputXmlTags and complex values together', () => {
    const yaml = `flow:
  name: Roundtrip_Fidelity
  label: Roundtrip Fidelity
  apiVersion: "65.0"
  processType: AutoLaunchedFlow
  status: Draft
steps:
  - action: Configure_Table
    actionType: component
    inputs:
      ordinary: PlainReference
      keyField: '{"dataType":"SObject","fieldReferences":["Id"]}'
    inputXmlTags:
      ordinary: elementReference
    inputComplexValueTypes:
      keyField: ComplexObjectFieldDetails
`;
    const generated = writeXml(readYaml(yaml, { validate: true }));
    expect(generated).toContain('<elementReference>PlainReference</elementReference>');
    expect(generated).toContain(
      '<complexValue>{&quot;dataType&quot;:&quot;SObject&quot;,&quot;fieldReferences&quot;:[&quot;Id&quot;]}</complexValue>'
    );
    expect(generated).toContain('<complexValueType>ComplexObjectFieldDetails</complexValueType>');
  });

  it('preserves collection-backed dynamic choice sets and output assignments', () => {
    const generated = pipelineRoundTrip(`    <dynamicChoiceSets>
        <name>Product_Options</name>
        <collectionReference>Get_Products</collectionReference>
        <dataType>String</dataType>
        <description>Available products</description>
        <displayField>Name</displayField>
        <object>Product2</object>
        <outputAssignments>
            <assignToReference>SelectedId</assignToReference>
            <field>Id</field>
        </outputAssignments>
        <valueField>Id</valueField>
    </dynamicChoiceSets>`);

    expect(generated).toContain('<collectionReference>Get_Products</collectionReference>');
    expect(generated).toContain('<object>Product2</object>');
    expect(generated).not.toContain('<picklistObject>');
    expect(generated).toContain('<assignToReference>SelectedId</assignToReference>');
    expect(generated).toContain('<field>Id</field>');
    expect(generated).toContain('<description>Available products</description>');
  });

  it('keeps picklist-backed dynamic choice sets as picklists', () => {
    const generated = pipelineRoundTrip(`    <dynamicChoiceSets>
        <name>Account_Statuses</name>
        <dataType>Picklist</dataType>
        <picklistField>Status__c</picklistField>
        <picklistObject>Account</picklistObject>
    </dynamicChoiceSets>`);

    expect(generated).toContain('<picklistField>Status__c</picklistField>');
    expect(generated).toContain('<picklistObject>Account</picklistObject>');
    expect(generated).not.toContain('<collectionReference>');
  });

  it('does not coerce object-backed dynamic choice sets into picklists', () => {
    const generated = pipelineRoundTrip(`    <dynamicChoiceSets>
        <name>Accounts</name>
        <dataType>String</dataType>
        <displayField>Name</displayField>
        <object>Account</object>
        <valueField>Id</valueField>
    </dynamicChoiceSets>`);

    expect(generated).toContain('<object>Account</object>');
    expect(generated).not.toContain('<picklistObject>');
  });
});

describe('round-trip fidelity phases 7 and 8', () => {
  function pipeline(xml: string, fallbackName = 'Phase_Seven_Eight'): string {
    const document = readFlowXml(xml, { fallbackName });
    return writeXml(readYaml(emitYaml(document), { validate: true }));
  }

  it('preserves zero-valued schedule fields and maxBatchSize', () => {
    const generated = pipeline(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Phase_Seven_Eight</fullName>
    <label>Phase Seven Eight</label>
    <processType>ScheduledFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <schedule>
            <dayOfMonthToRun>0</dayOfMonthToRun>
            <frequency>Monthly</frequency>
            <frequencyNumber>0</frequencyNumber>
            <startDate>2026-01-01</startDate>
            <startTime>00:00:00.000Z</startTime>
        </schedule>
        <scheduledPaths>
            <name>Later</name>
            <maxBatchSize>0</maxBatchSize>
        </scheduledPaths>
        <triggerType>Scheduled</triggerType>
    </start>
    <status>Draft</status>
</Flow>
`);

    expect(generated).toContain('<dayOfMonthToRun>0</dayOfMonthToRun>');
    expect(generated).toContain('<frequencyNumber>0</frequencyNumber>');
    expect(generated).toContain('<maxBatchSize>0</maxBatchSize>');
  });

  it('does not invent absent header or start elements', () => {
    const generated = pipeline(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Phase_Seven_Eight</fullName>
    <label>Phase Seven Eight</label>
    <processType>AutoLaunchedFlow</processType>
    <startElementReference>First_Step</startElementReference>
</Flow>
`);

    expect(generated).not.toContain('<apiVersion>');
    expect(generated).not.toContain('<environments>');
    expect(generated).not.toContain('<start>');
    expect(generated).not.toContain('<status>');
  });

  it('keeps defaults for hand-authored FlowML and preserves a self-closing start', () => {
    const handAuthored = writeXml(readYaml(`flow:
  name: Hand_Authored
  label: Hand Authored
  processType: AutoLaunchedFlow
  apiVersion: "65.0"
  status: Draft
steps: []
`, { validate: true }));
    expect(handAuthored).toContain('<apiVersion>65.0</apiVersion>');
    expect(handAuthored).toContain('<environments>Default</environments>');
    expect(handAuthored).toContain('<status>Draft</status>');

    const selfClosing = pipeline(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Phase_Seven_Eight</fullName>
    <label>Phase Seven Eight</label>
    <processType>AutoLaunchedFlow</processType>
    <start/>
    <status>Draft</status>
</Flow>
`);
    expect(selfClosing).toContain('<start>');
  });

  it('preserves stages, declarations, decision properties, and action number spelling', () => {
    const generated = pipeline(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>Run_Action</name>
        <label>Run Action</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>Example</actionName>
        <actionType>apex</actionType>
        <inputParameters>
            <name>amount</name>
            <value>
                <numberValue>1.0E8</numberValue>
            </value>
        </inputParameters>
        <nameSegment>Example</nameSegment>
    </actionCalls>
    <apiVersion>65.0</apiVersion>
    <decisions>
        <name>Choose</name>
        <label>Choose</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <rules>
            <name>Yes</name>
            <conditionLogic>and</conditionLogic>
            <doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria>
            <label>Yes</label>
        </rules>
    </decisions>
    <fullName>Phase_Seven_Eight</fullName>
    <label>Phase Seven Eight</label>
    <processType>AutoLaunchedFlow</processType>
    <stages>
        <description>First stage</description>
        <name>First</name>
        <isActive>true</isActive>
        <label>First</label>
        <stageOrder>1</stageOrder>
    </stages>
    <status>Draft</status>
    <textTemplates>
        <description>Template description</description>
        <name>Body</name>
        <text>Hello</text>
    </textTemplates>
    <variables>
        <name>Request</name>
        <apexClass>ExampleRequest</apexClass>
        <dataType>Apex</dataType>
        <isCollection>false</isCollection>
        <isInput>false</isInput>
        <isOutput>false</isOutput>
    </variables>
</Flow>
`);

    expect(generated).toContain('<numberValue>1.0E8</numberValue>');
    expect(generated).toContain('<doesRequireRecordChangedToMeetCriteria>true</doesRequireRecordChangedToMeetCriteria>');
    expect(generated).toContain('<description>First stage</description>');
    expect(generated).toContain('<apexClass>ExampleRequest</apexClass>');
    expect(generated).toContain('<description>Template description</description>');
  });

  it('preserves raw fault isGoTo and nested process metadata through YAML', () => {
    const generated = pipeline(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Phase_Seven_Eight</fullName>
    <label>Phase Seven Eight</label>
    <processType>AutoLaunchedFlow</processType>
    <recordUpdates>
        <processMetadataValues>
            <name>evaluationType</name>
            <value>
                <stringValue>always</stringValue>
            </value>
        </processMetadataValues>
        <name>Update_One</name>
        <label>Update One</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <filterLogic>and</filterLogic>
        <filters>
            <processMetadataValues>
                <name>implicit</name>
                <value>
                    <booleanValue>true</booleanValue>
                </value>
            </processMetadataValues>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>recordId</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <processMetadataValues>
                <name>dataType</name>
                <value>
                    <stringValue>String</stringValue>
                </value>
            </processMetadataValues>
            <field>Name</field>
            <value>
                <stringValue>Updated</stringValue>
            </value>
        </inputAssignments>
        <object>Account</object>
    </recordUpdates>
    <status>Draft</status>
    <futureElements>
        <name>Raw_One</name>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <faultConnector>
            <isGoTo>true</isGoTo>
            <targetReference>Failure</targetReference>
        </faultConnector>
    </futureElements>
</Flow>
`);

    expect(generated.match(/<processMetadataValues>/g)?.length).toBe(3);
    expect(generated).toMatch(
      /<faultConnector>\s*<isGoTo>true<\/isGoTo>\s*<targetReference>Failure<\/targetReference>/
    );
  });
});
