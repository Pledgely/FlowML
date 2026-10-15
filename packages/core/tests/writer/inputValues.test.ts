// ============================================================
// Input/field value handling: setupReference, quoted literals,
// and the lookup fields+outputs lint conflict
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import { writeXml } from '../../src/writer/xmlWriter.js';
import { lintFlow } from '../../src/linter/linter.js';
import type { FlowMLDocument, ActionStep } from '../../src/types.js';

function fullPipeline(xml: string): string {
  const doc = readFlowXml(xml, { fallbackName: 'Input_Values_Test' });
  return writeXml(readYaml(emitYaml(doc), { validate: true }));
}

describe('setupReference / setupReferenceType', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>Send_Reminder</name>
        <label>Send Reminder</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <inputParameters>
            <name>emailTemplateName</name>
            <value>
                <setupReference>MyFolder/My_Template</setupReference>
                <setupReferenceType>EmailTemplate</setupReferenceType>
            </value>
        </inputParameters>
        <inputParameters>
            <name>useEmailTemplate</name>
            <value>
                <booleanValue>true</booleanValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
    </actionCalls>
    <apiVersion>64.0</apiVersion>
    <label>Setup Ref</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Send_Reminder</targetReference>
        </connector>
    </start>
    <status>Draft</status>
</Flow>
`;

  it('reads setupReference into inputs + inputSetupReferenceTypes', () => {
    const doc = readFlowXml(xml, { fallbackName: 'Setup_Ref' });
    const action = doc.steps.find(s => 'action' in s) as ActionStep;
    expect(action.inputs?.emailTemplateName).toBe('MyFolder/My_Template');
    expect(action.inputSetupReferenceTypes?.emailTemplateName).toBe('EmailTemplate');
  });

  it('round-trips setupReference XML byte-identically through YAML', () => {
    expect(fullPipeline(xml)).toBe(xml);
  });

  it('emits setupReference form from hand-authored YAML', () => {
    const yaml = `
flow:
  name: Setup_Ref_Authored
  label: Setup Ref Authored
  processType: AutoLaunchedFlow
  apiVersion: "64.0"
  status: Draft
start:
  next: Send_Reminder
steps:
  - action: Send_Reminder
    label: Send Reminder
    actionType: emailSimple
    nameSegment: emailSimple
    inputs:
      emailTemplateName: MyFolder/My_Template
      useEmailTemplate: true
    inputSetupReferenceTypes:
      emailTemplateName: EmailTemplate
`;
    const out = writeXml(readYaml(yaml, { validate: true }));
    expect(out).toContain('<setupReference>MyFolder/My_Template</setupReference>');
    expect(out).toContain('<setupReferenceType>EmailTemplate</setupReferenceType>');
    expect(out).not.toContain('<stringValue>MyFolder/My_Template</stringValue>');
  });

  it('emits setupReference in recordUpdate fields via inputSetupReferenceTypes', () => {
    const yaml = `
flow:
  name: Setup_Ref_Fields
  label: Setup Ref Fields
  processType: AutoLaunchedFlow
  apiVersion: "64.0"
  status: Draft
start:
  next: Update_Record
steps:
  - recordUpdate: Update_Record
    label: Update Record
    object: Account
    where:
      - Id == "001000000000001"
    fields:
      Template__c: MyFolder/My_Template
    inputSetupReferenceTypes:
      Template__c: EmailTemplate
`;
    const out = writeXml(readYaml(yaml, { validate: true }));
    expect(out).toContain('<setupReference>MyFolder/My_Template</setupReference>');
    expect(out).toContain('<setupReferenceType>EmailTemplate</setupReferenceType>');
  });
});

describe('explicit quoted literals in inputs/fields', () => {
  function actionYaml(inputsBlock: string): string {
    return `
flow:
  name: Quoted_Literals
  label: Quoted Literals
  processType: AutoLaunchedFlow
  apiVersion: "64.0"
  status: Draft
start:
  next: Send_Email
steps:
  - action: Send_Email
    label: Send Email
    actionType: emailSimple
    nameSegment: emailSimple
${inputsBlock}
`;
  }

  it('emits a quoted dotted input as stringValue with quotes stripped', () => {
    const out = writeXml(readYaml(actionYaml(
      '    inputs:\n      emailSubject: \'"Release v2.1 is live"\''
    ), { validate: true }));
    expect(out).toContain('<stringValue>Release v2.1 is live</stringValue>');
    expect(out).not.toContain('elementReference');
  });

  it('still infers unquoted dotted inputs as elementReference', () => {
    const out = writeXml(readYaml(actionYaml(
      '    inputs:\n      emailTemplateId: Get_Template.Id'
    ), { validate: true }));
    expect(out).toContain('<elementReference>Get_Template.Id</elementReference>');
  });

  it('emits quoted dotted recordUpdate field values as stringValue', () => {
    const yaml = `
flow:
  name: Quoted_Fields
  label: Quoted Fields
  processType: AutoLaunchedFlow
  apiVersion: "64.0"
  status: Draft
start:
  next: Update_Record
steps:
  - recordUpdate: Update_Record
    label: Update Record
    object: Account
    where:
      - Id == "001000000000001"
    fields:
      Version__c: '"v2.1.0"'
`;
    const out = writeXml(readYaml(yaml, { validate: true }));
    expect(out).toContain('<stringValue>v2.1.0</stringValue>');
    expect(out).not.toContain('<elementReference>');
  });

  it('does not strip quotes when an explicit inputXmlTags entry pins the value', () => {
    const out = writeXml(readYaml(actionYaml(
      '    inputs:\n      emailSubject: \'"a.b"\'\n    inputXmlTags:\n      emailSubject: stringValue'
    ), { validate: true }));
    expect(out).toContain('<stringValue>&quot;a.b&quot;</stringValue>');
  });

  it('round-trips an XML stringValue that itself starts and ends with quotes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>Send_Email</name>
        <label>Send Email</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <actionName>emailSimple</actionName>
        <actionType>emailSimple</actionType>
        <inputParameters>
            <name>emailSubject</name>
            <value>
                <stringValue>&quot;quoted subject&quot;</stringValue>
            </value>
        </inputParameters>
        <nameSegment>emailSimple</nameSegment>
    </actionCalls>
    <apiVersion>64.0</apiVersion>
    <label>Quote Fidelity</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Send_Email</targetReference>
        </connector>
    </start>
    <status>Draft</status>
</Flow>
`;
    expect(fullPipeline(xml)).toBe(xml);
  });
});

describe('lookup-fields-outputs-conflict lint rule', () => {
  function makeDoc(lookupOverrides: Record<string, unknown>): FlowMLDocument {
    return {
      flow: {
        name: 'Test_Lookup_Conflict',
        label: 'Test Lookup Conflict',
        processType: 'AutoLaunchedFlow',
        apiVersion: '64.0',
        status: 'Draft',
        description: 'A test flow exercising the lookup fields/outputs conflict rule.',
      },
      steps: [{
        lookup: 'Get_Record',
        label: 'Get Record',
        object: 'Account',
        getFirst: true,
        ...lookupOverrides,
      } as any],
    };
  }

  function findResult(report: ReturnType<typeof lintFlow>, ruleId: string) {
    for (const cat of report.categories) {
      const found = cat.results.find(r => r.ruleId === ruleId);
      if (found) return found;
    }
    return undefined;
  }

  it('flags a lookup with both fields: and outputs:', () => {
    const report = lintFlow(makeDoc({
      fields: ['Name'],
      outputs: { Name: 'varTxt_Name' },
    }));
    const result = findResult(report, 'lookup-fields-outputs-conflict');
    expect(result).toBeDefined();
    expect(result?.severity).toBe('critical');
  });

  it('does not flag fields: with outputReference', () => {
    const report = lintFlow(makeDoc({
      fields: ['Name'],
      outputReference: 'varRec_Account',
    }));
    expect(findResult(report, 'lookup-fields-outputs-conflict')).toBeUndefined();
  });

  it('does not flag fields: with storeOutputAutomatically', () => {
    const report = lintFlow(makeDoc({
      fields: ['Name'],
      storeOutputAutomatically: true,
    }));
    expect(findResult(report, 'lookup-fields-outputs-conflict')).toBeUndefined();
  });

  it('does not flag outputs: alone', () => {
    const report = lintFlow(makeDoc({
      outputs: { Name: 'varTxt_Name' },
    }));
    expect(findResult(report, 'lookup-fields-outputs-conflict')).toBeUndefined();
  });
});
