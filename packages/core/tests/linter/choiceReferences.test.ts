import { describe, it, expect } from 'vitest';
import { lintFlow } from '../../src/linter/linter.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { writeXml } from '../../src/writer/xmlWriter.js';
import type { FlowMLDocument, ScreenField } from '../../src/types.js';

function makeScreenDoc(fields: ScreenField[], extra: Partial<FlowMLDocument> = {}): FlowMLDocument {
  return {
    flow: {
      name: 'Screen_Pick_Sender',
      label: 'Pick Sender',
      processType: 'Flow',
      apiVersion: '64.0',
      status: 'Draft',
      description: 'Collects the outbound sender address from the running user.',
    },
    steps: [
      { screen: 'Pick_Sender', label: 'Pick Sender', fields },
    ] as FlowMLDocument['steps'],
    ...extra,
  };
}

function findChoiceResults(doc: FlowMLDocument) {
  return lintFlow(doc)
    .categories.flatMap(c => c.results)
    .filter(r => r.ruleId === 'undeclared-choice-reference');
}

const YAML_HEADER = `flow:
  name: Repro_Bad_Type
  label: Repro Bad Type
  processType: Flow
  apiVersion: "64.0"
  status: Draft
`;

describe('choiceSet type validation', () => {
  it('rejects the Salesforce term "recordChoiceSet" instead of silently dropping it', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Verified_Org_Wide_Addresses:
    type: recordChoiceSet
    object: OrgWideEmailAddress

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).toThrow(/unrecognized type "recordChoiceSet"/);
    expect(() => readYaml(yamlText)).toThrow(/Did you mean "recordChoice"\?/);
  });

  it('lists the valid values in the error', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Some_Choices:
    type: totallyMadeUp

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).toThrow(/dynamicPicklist, recordChoice/);
  });

  it('rejects a missing type', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Some_Choices:
    object: OrgWideEmailAddress

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).toThrow(/unrecognized type \(missing\)/);
  });

  it('still accepts both valid types', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Dyn:
    type: dynamicPicklist
    picklistObject: Account
    field: Industry
  Rec:
    type: recordChoice
    object: OrgWideEmailAddress
    displayField: DisplayName
    valueField: Id

steps:
  - screen: S1
    fields: []
`;
    const doc = readYaml(yamlText);
    expect(doc.choiceSets?.Dyn.type).toBe('dynamicPicklist');
    expect(doc.choiceSets?.Rec.type).toBe('recordChoice');
  });

  it('fails the XML writer rather than dropping an unknown type from the output', () => {
    const doc = makeScreenDoc([], {
      choiceSets: {
        Verified_Org_Wide_Addresses: {
          type: 'recordChoiceSet' as never,
          object: 'OrgWideEmailAddress',
        },
      },
    });
    expect(() => writeXml(doc)).toThrow(/unrecognized type "recordChoiceSet"/);
  });

  it('emits both valid choice set types as <dynamicChoiceSets> — <recordChoiceSets> does not exist in the Flow schema', () => {
    const doc = makeScreenDoc([], {
      choiceSets: {
        Dyn: { type: 'dynamicPicklist', picklistObject: 'Account', field: 'Industry' },
        Rec: { type: 'recordChoice', object: 'OrgWideEmailAddress', displayField: 'DisplayName', valueField: 'Id' },
      },
    });
    const xml = writeXml(doc);
    expect(xml).toContain('<dynamicChoiceSets>');
    expect(xml).not.toContain('<recordChoiceSets>');
    expect(xml).toContain('<object>OrgWideEmailAddress</object>');
    expect(xml).toContain('<picklistObject>Account</picklistObject>');
  });
});

describe('record choice set object requirement', () => {
  it('rejects a recordChoice without object in the YAML reader', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Product_Options:
    type: recordChoice
    collectionReference: Get_Products
    displayField: Name
    valueField: Id

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).toThrow(/Choice set "Product_Options" requires "object"/);
  });

  it('rejects a collection choice set whose stray picklist fields would be silently dropped', () => {
    // The writer suppresses picklistField/picklistObject whenever a
    // collectionReference is present, so these must not exempt the set from
    // the object requirement — the emitted XML would be the exact invalid
    // no-object collection choice this check exists to prevent.
    for (const strayLine of ['    field: Industry', '    picklistObject: Account']) {
      const yamlText = `${YAML_HEADER}
choiceSets:
  Product_Options:
    type: recordChoice
    collectionReference: Get_Products
${strayLine}
    displayField: Name
    valueField: Id

steps:
  - screen: S1
    fields: []
`;
      expect(() => readYaml(yamlText)).toThrow(/requires "object"/);
    }
  });

  it('rejects a collection-backed dynamicPicklist without object — shape decides, not the type label', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Product_Options:
    type: dynamicPicklist
    collectionReference: Get_Products
    displayField: Name
    valueField: Id

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).toThrow(/requires "object"/);
  });

  it('accepts picklist choice sets without object', () => {
    const yamlText = `${YAML_HEADER}
choiceSets:
  Industries:
    type: dynamicPicklist
    picklistObject: Account
    field: Industry

steps:
  - screen: S1
    fields: []
`;
    expect(() => readYaml(yamlText)).not.toThrow();
  });

  it('fails the XML writer rather than emitting a choice set the org rejects', () => {
    const doc = makeScreenDoc([], {
      choiceSets: {
        Product_Options: {
          type: 'recordChoice',
          collectionReference: 'Get_Products',
          displayField: 'Name',
          valueField: 'Id',
        },
      },
    });
    expect(() => writeXml(doc)).toThrow(/requires "object"/);
  });
});

describe('choice set classification from Flow XML', () => {
  const XML_SHELL = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <apiVersion>65.0</apiVersion>
${body}
    <label>Classify</label>
    <processType>Flow</processType>
    <status>Draft</status>
</Flow>
`;

  it('classifies picklist-shaped dynamicChoiceSets as dynamicPicklist', () => {
    const doc = readFlowXml(XML_SHELL(`    <dynamicChoiceSets>
        <name>Industries</name>
        <dataType>Picklist</dataType>
        <displayField xsi:nil="true"/>
        <object xsi:nil="true"/>
        <picklistField>Industry</picklistField>
        <picklistObject>Account</picklistObject>
    </dynamicChoiceSets>`), { fallbackName: 'Classify' });
    expect(doc.choiceSets?.Industries.type).toBe('dynamicPicklist');
  });

  it('classifies record-shaped dynamicChoiceSets as recordChoice', () => {
    const doc = readFlowXml(XML_SHELL(`    <dynamicChoiceSets>
        <name>Accounts</name>
        <dataType>String</dataType>
        <displayField>Name</displayField>
        <object>Account</object>
        <valueField>Id</valueField>
    </dynamicChoiceSets>`), { fallbackName: 'Classify' });
    expect(doc.choiceSets?.Accounts.type).toBe('recordChoice');
  });

  it('heals legacy <recordChoiceSets> XML written by older FlowML versions', () => {
    const doc = readFlowXml(XML_SHELL(`    <recordChoiceSets>
        <name>Accounts</name>
        <dataType>String</dataType>
        <displayField>Name</displayField>
        <object>Account</object>
        <valueField>Id</valueField>
    </recordChoiceSets>`), { fallbackName: 'Classify' });
    expect(doc.choiceSets?.Accounts.type).toBe('recordChoice');
    const xml = writeXml(doc);
    expect(xml).toContain('<dynamicChoiceSets>');
    expect(xml).not.toContain('<recordChoiceSets>');
  });
});

describe('undeclared-choice-reference rule', () => {
  it('flags a screen field pointing at a choice that does not exist', () => {
    const doc = makeScreenDoc([
      { dropdown: 'Sender', label: 'Sender', dataType: 'String', choices: ['Verified_Org_Wide_Addresses'] },
    ] as ScreenField[]);

    const results = findChoiceResults(doc);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('critical');
    expect(results[0].stepName).toBe('Pick_Sender');
    expect(results[0].message).toContain('Verified_Org_Wide_Addresses');
    expect(results[0].message).toContain('No element with name Verified_Org_Wide_Addresses found');
  });

  it('stays silent when the choice set is declared', () => {
    const doc = makeScreenDoc(
      [{ dropdown: 'Sender', label: 'Sender', dataType: 'String', choices: ['Verified_Org_Wide_Addresses'] }] as ScreenField[],
      {
        choiceSets: {
          Verified_Org_Wide_Addresses: {
            type: 'recordChoice',
            object: 'OrgWideEmailAddress',
            displayField: 'DisplayName',
            valueField: 'Id',
          },
        },
      },
    );
    expect(findChoiceResults(doc)).toHaveLength(0);
  });

  it('stays silent when the reference resolves to a static choice', () => {
    const doc = makeScreenDoc(
      [{ radio: 'Answer', label: 'Answer', dataType: 'String', choices: ['Yes_Choice'] }] as ScreenField[],
      { choices: { Yes_Choice: { dataType: 'String', label: 'Yes', value: 'Yes' } } },
    );
    expect(findChoiceResults(doc)).toHaveLength(0);
  });

  it('flags a dangling defaultSelectedChoiceReference', () => {
    const doc = makeScreenDoc(
      [{
        dropdown: 'Sender',
        label: 'Sender',
        dataType: 'String',
        choices: ['Yes_Choice'],
        defaultSelectedChoiceReference: 'Missing_Default',
      }] as ScreenField[],
      { choices: { Yes_Choice: { dataType: 'String', label: 'Yes', value: 'Yes' } } },
    );
    const results = findChoiceResults(doc);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Missing_Default');
  });

  it('does not flag a defaultSelectedChoiceReference that points at a variable', () => {
    const doc = makeScreenDoc(
      [{
        dropdown: 'Sender',
        label: 'Sender',
        dataType: 'String',
        choices: ['Yes_Choice'],
        defaultSelectedChoiceReference: 'varDefaultChoice',
      }] as ScreenField[],
      {
        choices: { Yes_Choice: { dataType: 'String', label: 'Yes', value: 'Yes' } },
        variables: { varDefaultChoice: { dataType: 'String' } },
      },
    );
    expect(findChoiceResults(doc)).toHaveLength(0);
  });

  it('descends into section columns and repeaters', () => {
    const doc = makeScreenDoc([
      {
        section: {
          name: 'Row1',
          columns: [{
            width: 12,
            fields: [{ dropdown: 'InColumn', dataType: 'String', choices: ['Ghost_A'] }],
          }],
        },
      },
      {
        repeater: 'Rows',
        fields: [{ radio: 'InRepeater', dataType: 'String', choices: ['Ghost_B'] }],
      },
    ] as unknown as ScreenField[]);

    const results = findChoiceResults(doc);
    expect(results.map(r => r.message).join(' ')).toContain('Ghost_A');
    expect(results.map(r => r.message).join(' ')).toContain('Ghost_B');
    expect(results).toHaveLength(2);
  });

  it('ignores merge-field style references', () => {
    const doc = makeScreenDoc([
      { dropdown: 'Sender', dataType: 'String', choices: ['$Record.Industry'] },
    ] as unknown as ScreenField[]);
    expect(findChoiceResults(doc)).toHaveLength(0);
  });

  it('drives the report verdict away from approval', () => {
    const doc = makeScreenDoc([
      { dropdown: 'Sender', label: 'Sender', dataType: 'String', choices: ['Verified_Org_Wide_Addresses'] },
    ] as ScreenField[]);
    const report = lintFlow(doc);
    expect(report.criticalCount).toBeGreaterThan(0);
    expect(report.rating).toBe('Unsafe for deployment');
  });

  it('reports zero criticals on a clean flow', () => {
    const doc = makeScreenDoc(
      [{ radio: 'Answer', label: 'Answer', dataType: 'String', choices: ['Yes_Choice'] }] as ScreenField[],
      { choices: { Yes_Choice: { dataType: 'String', label: 'Yes', value: 'Yes' } } },
    );
    expect(lintFlow(doc).criticalCount).toBe(0);
  });
});
