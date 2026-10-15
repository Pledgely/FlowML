import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { lintFlow } from '../../src/linter/linter.js';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import type {
  ComponentScreenField, FlowMLDocument, FlowStep, ScreenField,
} from '../../src/types.js';

const RULE_ID = 'input-reference-emitted-as-literal';

function baseDoc(steps: FlowStep[], extra: Partial<FlowMLDocument> = {}): FlowMLDocument {
  return {
    flow: {
      name: 'Reactive_Order',
      label: 'Reactive Order',
      processType: 'Flow',
      apiVersion: '64.0',
      status: 'Draft',
      description: 'Captures an order and previews the total with a reactive component.',
    },
    steps,
    ...extra,
  };
}

function findings(doc: FlowMLDocument) {
  return lintFlow(doc)
    .categories.flatMap(c => c.results)
    .filter(r => r.ruleId === RULE_ID);
}

/** A screen holding a number input plus one LWC whose inputs are supplied by the caller. */
function screenWith(
  componentInputs: Record<string, unknown>,
  extraComponentProps: Partial<ComponentScreenField> = {}
): FlowStep[] {
  const fields: ScreenField[] = [
    { input: 'Quantity_Input', dataType: 'Number', label: 'Quantity' },
    {
      component: 'Order_Summary',
      extensionName: 'c:orderSummary',
      inputs: componentInputs,
      ...extraComponentProps,
    },
  ] as ScreenField[];
  return [{ screen: 'Order_Screen', label: 'Order Screen', fields }] as FlowStep[];
}

describe('input-reference-emitted-as-literal', () => {
  it('flags a screen component input that names a screen field but emits as stringValue', () => {
    const results = findings(baseDoc(screenWith({ quantity: 'Quantity_Input' })));

    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].stepName).toBe('Order_Screen');
    expect(results[0].message).toContain('Screen component "Order_Summary"');
    expect(results[0].message).toContain('<stringValue>');
    expect(results[0].message).toContain('never reacts to changes in "Quantity_Input"');
    expect(results[0].message).toContain('inputXmlTags: { quantity: elementReference }');
  });

  it('costs the flow points instead of reporting a clean 110/110', () => {
    const report = lintFlow(baseDoc(screenWith({ quantity: 'Quantity_Input' })));

    expect(report.totalScore).toBeLessThan(report.maxScore);
    const logic = report.categories.find(c => c.category === 'logic');
    expect(logic?.score).toBe(15);
  });

  it('stays silent once the reference is pinned with inputXmlTags', () => {
    const results = findings(
      baseDoc(
        screenWith(
          { quantity: 'Quantity_Input' },
          { inputXmlTags: { quantity: 'elementReference' } }
        )
      )
    );

    expect(results).toHaveLength(0);
  });

  it('stays silent when the value is an explicit quoted literal', () => {
    const results = findings(baseDoc(screenWith({ quantity: '"Quantity_Input"' })));

    expect(results).toHaveLength(0);
  });

  it('stays silent for values that already infer as elementReference', () => {
    const results = findings(
      baseDoc(screenWith({ recordId: '$Record.Id', owner: 'Order_Summary.selectedRows' }))
    );

    expect(results).toHaveLength(0);
  });

  it('stays silent for literals that match no element in the flow', () => {
    const results = findings(baseDoc(screenWith({ heading: 'Order Summary', variant: 'brand' })));

    expect(results).toHaveLength(0);
  });

  it('ignores non-string values', () => {
    const results = findings(baseDoc(screenWith({ showFooter: true, columns: 3 })));

    expect(results).toHaveLength(0);
  });

  it('flags subflow inputs with subflow-specific wording', () => {
    const doc = baseDoc(
      [
        { subflow: 'Run_Pricing', flowName: 'Pricing_Engine', inputs: { orderId: 'varOrderId' } },
      ] as FlowStep[],
      { variables: { varOrderId: { dataType: 'String' } } }
    );

    const results = findings(doc);

    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Subflow "Run_Pricing"');
    expect(results[0].message).toContain('the subflow receives the literal text "varOrderId"');
  });

  it('flags action inputs', () => {
    const doc = baseDoc(
      [
        {
          action: 'Send_Email',
          actionType: 'emailSimple',
          inputs: { recipientId: 'varContactId' },
        },
      ] as FlowStep[],
      { variables: { varContactId: { dataType: 'String' } } }
    );

    const results = findings(doc);

    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Action "Send_Email"');
  });

  it('flags recordUpdate field values and names the fields: key in the hint', () => {
    const doc = baseDoc(
      [
        {
          recordUpdate: 'Update_Order',
          object: 'Order',
          fields: { Status__c: 'varStatus' },
        },
      ] as FlowStep[],
      { variables: { varStatus: { dataType: 'String' } } }
    );

    const results = findings(doc);

    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('fields: { Status__c: varStatus }');
    expect(results[0].message).toContain('inputXmlTags: { Status__c: elementReference }');
  });

  it('leaves the reactive regression fixture clean', () => {
    const xml = readFileSync(
      resolve(__dirname, '../regression/reactive-components.flow-meta.xml'),
      'utf-8'
    );
    const doc = readFlowXml(xml, { fallbackName: 'reactive_components' });

    expect(findings(doc)).toHaveLength(0);
  });
});
