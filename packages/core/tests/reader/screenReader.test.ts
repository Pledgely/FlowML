import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';
import { writeXml } from '../../src/writer/xmlWriter.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import yaml from 'js-yaml';
import type { ScreenStep, DisplayScreenField, ComponentScreenField } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('screenReader', () => {
  // ============================================================
  // Simple screen flow fixture
  // ============================================================

  describe('simple-screen-flow', () => {
    const xml = loadFixture('simple-screen-flow.xml');
    const doc = readFlowXml(xml);

    it('reads screen steps', () => {
      const screens = doc.steps.filter(s => 'screen' in s) as ScreenStep[];
      expect(screens.length).toBeGreaterThan(0);
    });

    it('emits to YAML and back', () => {
      const yamlStr = emitYaml(doc);
      const parsed = yaml.load(yamlStr) as Record<string, unknown>;
      expect(parsed).toBeDefined();
      expect(parsed.steps).toBeDefined();
    });
  });

  // ============================================================
  // Component-instance validationRule (cross-field validation
  // on flowruntime:email, flowruntime:phone, etc.)
  // ============================================================

  describe('component validation', () => {
    const componentXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Component_Validation_Flow</fullName>
    <label>Component Validation Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
    <screens>
        <name>Email_Screen</name>
        <label>Email Screen</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <allowBack>true</allowBack>
        <allowFinish>true</allowFinish>
        <allowPause>false</allowPause>
        <fields>
            <name>Test_Email_Component</name>
            <extensionName>flowruntime:email</extensionName>
            <fieldType>ComponentInstance</fieldType>
            <isRequired>true</isRequired>
            <validationRule>
                <errorMessage>&lt;p&gt;Email cannot match X&lt;/p&gt;</errorMessage>
                <formulaExpression>{!Test_Email_Component.value} != {!Other_Email}</formulaExpression>
            </validationRule>
        </fields>
        <showFooter>true</showFooter>
        <showHeader>true</showHeader>
    </screens>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Email_Screen</targetReference>
        </connector>
    </start>
</Flow>`;

    it('reads <validationRule> on a ComponentInstance into ComponentScreenField.validation', () => {
      const doc = readFlowXml(componentXml);
      const screens = doc.steps.filter(s => 'screen' in s) as ScreenStep[];
      expect(screens.length).toBe(1);
      const field = screens[0].fields[0] as ComponentScreenField;
      expect(field.component).toBe('Test_Email_Component');
      expect(field.extensionName).toBe('flowruntime:email');
      expect(field.validation).toBeDefined();
      expect(field.validation!.formula).toBe('{!Test_Email_Component.value} != {!Other_Email}');
      expect(field.validation!.errorMessage).toBe('<p>Email cannot match X</p>');
    });

    it('writes <validationRule> back inside the ComponentInstance <fields> block', () => {
      const doc = readFlowXml(componentXml);
      const generatedXml = writeXml(doc);
      // Validation rule must be present
      expect(generatedXml).toContain('<validationRule>');
      expect(generatedXml).toContain('<formulaExpression>{!Test_Email_Component.value} != {!Other_Email}</formulaExpression>');
      expect(generatedXml).toContain('<errorMessage>&lt;p&gt;Email cannot match X&lt;/p&gt;</errorMessage>');
      // And it must sit inside the ComponentInstance fields block
      const componentBlock = generatedXml.match(/<fields>[\s\S]*?<fieldType>ComponentInstance<\/fieldType>[\s\S]*?<\/fields>/);
      expect(componentBlock).not.toBeNull();
      expect(componentBlock![0]).toContain('<validationRule>');
    });

    it('round-trips ComponentInstance validationRule via FlowML doc', () => {
      const original = readFlowXml(componentXml);
      const reparsed = readFlowXml(writeXml(original));
      const screens = reparsed.steps.filter(s => 'screen' in s) as ScreenStep[];
      const field = screens[0].fields[0] as ComponentScreenField;
      expect(field.validation).toBeDefined();
      expect(field.validation!.formula).toBe('{!Test_Email_Component.value} != {!Other_Email}');
      expect(field.validation!.errorMessage).toBe('<p>Email cannot match X</p>');
    });

    it('preserves validation through YAML emitter -> YAML reader -> XML writer (full toxml path)', () => {
      const xmlDoc = readFlowXml(componentXml);
      const yamlStr = emitYaml(xmlDoc);
      const yamlDoc = readYaml(yamlStr, { validate: false });
      const screens = yamlDoc.steps.filter(s => 'screen' in s) as ScreenStep[];
      const field = screens[0].fields[0] as ComponentScreenField;
      expect(field.validation).toBeDefined();
      expect(field.validation!.formula).toBe('{!Test_Email_Component.value} != {!Other_Email}');
      expect(field.validation!.errorMessage).toBe('<p>Email cannot match X</p>');

      // Final XML must still contain the validationRule
      const finalXml = writeXml(yamlDoc);
      expect(finalXml).toContain('<validationRule>');
      expect(finalXml).toContain('{!Test_Email_Component.value} != {!Other_Email}');
    });
  });
});

describe('screen field fidelity', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Screen_Field_Fidelity</fullName>
    <label>Screen Field Fidelity</label>
    <processType>Flow</processType>
    <screens>
        <name>Fidelity_Screen</name>
        <label>Fidelity Screen</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <allowBack>true</allowBack>
        <allowFinish>true</allowFinish>
        <allowPause>false</allowPause>
        <backButtonLabel>Previous</backButtonLabel>
        <fields>
            <name>Preferences</name>
            <choiceReferences>Choice_A</choiceReferences>
            <dataType>String</dataType>
            <defaultSelectedChoiceReference>Choice_A</defaultSelectedChoiceReference>
            <fieldType>MultiSelectCheckboxes</fieldType>
            <isDisabled><booleanValue>true</booleanValue></isDisabled>
            <isReadOnly><booleanValue>true</booleanValue></isReadOnly>
            <isRequired><booleanValue>false</booleanValue></isRequired>
            <storeOutputAutomatically>true</storeOutputAutomatically>
        </fields>
        <fields>
            <name>Secret</name>
            <dataType>String</dataType>
            <fieldType>PasswordField</fieldType>
        </fields>
        <fields>
            <name>Items</name>
            <fieldType>Repeater</fieldType>
            <fields>
                <name>First_Name</name>
                <dataType>String</dataType>
                <fieldType>InputField</fieldType>
                <validationRule>
                    <errorMessage>Required</errorMessage>
                    <formulaExpression>NOT(ISBLANK({!First_Name}))</formulaExpression>
                </validationRule>
            </fields>
            <fields>
                <name>Last_Name</name>
                <dataType>String</dataType>
                <fieldType>InputField</fieldType>
            </fields>
        </fields>
        <fields>
            <name>Provided_Field</name>
            <fieldType>ObjectProvided</fieldType>
            <objectFieldReference>Account.Name</objectFieldReference>
        </fields>
        <fields>
            <name>Component_Input</name>
            <fieldType>ComponentInput</fieldType>
        </fields>
        <fields>
            <name>Future_Field</name>
            <extensionName>future:field</extensionName>
            <fieldType>FutureFieldType</fieldType>
        </fields>
        <fields>
            <name>Table</name>
            <extensionName>flowruntime:datatable</extensionName>
            <fieldType>ComponentInstance</fieldType>
            <inputParameters>
                <name>keyField</name>
                <value>
                    <complexValue>{"dataType":"SObject","fieldReferences":["Id"]}</complexValue>
                    <complexValueType>ComplexObjectFieldDetails</complexValueType>
                </value>
            </inputParameters>
            <inputParameters>
                <name>columnReferences</name>
                <value>
                    <complexValue>{"fieldReferences":["Name","Status__c"]}</complexValue>
                    <complexValueType>ComplexObjectFieldDetails</complexValueType>
                </value>
            </inputParameters>
        </fields>
        <fields>
            <name>Instructions</name>
            <fieldText>Choose carefully</fieldText>
            <fieldType>DisplayText</fieldType>
            <helpText>Visible guidance</helpText>
        </fields>
        <helpText>Screen guidance</helpText>
        <showFooter>true</showFooter>
        <showHeader>true</showHeader>
        <stageReference>
            <elementReference>Current_Stage</elementReference>
        </stageReference>
    </screens>
    <status>Draft</status>
</Flow>`;

  const original = readFlowXml(xml, { fallbackName: 'Screen_Field_Fidelity' });
  const yaml = emitYaml(original);
  const restored = readYaml(yaml, { validate: true });
  const screen = restored.steps.find(step => 'screen' in step) as ScreenStep;
  const generated = writeXml(restored);

  it('preserves added standard field types and wrapped booleans', () => {
    const multiselect = screen.fields.find(field => 'multiselectCheckboxes' in field) as any;
    expect(multiselect.booleanValueWrappers).toEqual(['isRequired', 'isDisabled', 'isReadOnly']);
    expect(multiselect.defaultSelectedChoiceReference).toBe('Choice_A');
    expect(multiselect.storeOutputAutomatically).toBe(true);
    expect(screen.fields.some(field => 'password' in field)).toBe(true);
    expect(generated).toContain('<fieldType>MultiSelectCheckboxes</fieldType>');
    expect(generated).toContain('<fieldType>PasswordField</fieldType>');
    expect(generated).toMatch(/<isReadOnly>\s*<booleanValue>true<\/booleanValue>\s*<\/isReadOnly>/);
  });

  it('preserves repeater children and their validation', () => {
    const repeater = screen.fields.find(field => 'repeater' in field) as any;
    expect(repeater.fields).toHaveLength(2);
    expect(repeater.fields[0].validation.errorMessage).toBe('Required');
    expect(generated.match(/<fieldType>InputField<\/fieldType>/g)).toHaveLength(2);
  });

  it('preserves ObjectProvided, ComponentInput, and unknown field types', () => {
    const provided = screen.fields.find(field => 'objectProvided' in field) as any;
    expect(provided.objectFieldReference).toBe('Account.Name');
    expect(generated).toContain('<fieldType>ObjectProvided</fieldType>');
    expect(generated).toContain('<fieldType>ComponentInput</fieldType>');
    expect(generated).toContain('<fieldType>FutureFieldType</fieldType>');
  });

  it('preserves complex datatable inputs through validated YAML', () => {
    const table = screen.fields.find(field => 'component' in field && field.component === 'Table') as ComponentScreenField;
    expect(table.inputComplexValueTypes).toEqual({
      keyField: 'ComplexObjectFieldDetails',
      columnReferences: 'ComplexObjectFieldDetails',
    });
    expect(generated.match(/<complexValueType>ComplexObjectFieldDetails<\/complexValueType>/g)).toHaveLength(2);
  });

  it('preserves screen and display-text properties', () => {
    const display = screen.fields.find(field => 'display' in field) as DisplayScreenField;
    expect(screen.backButtonLabel).toBe('Previous');
    expect(screen.helpText).toBe('Screen guidance');
    expect(screen.stageReference).toBe('Current_Stage');
    expect(display.helpText).toBe('Visible guidance');
    expect(generated).toContain('<backButtonLabel>Previous</backButtonLabel>');
    expect(generated).toMatch(
      /<stageReference>\s*<elementReference>Current_Stage<\/elementReference>\s*<\/stageReference>/
    );
  });
});
