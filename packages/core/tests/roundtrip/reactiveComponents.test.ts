import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { emitYaml, readFlowXml, readYaml, writeXml } from '../../src/index.js';
import type { ComponentScreenField, ScreenStep } from '../../src/types.js';

const FIXTURE = resolve(__dirname, '../regression/reactive-components.flow-meta.xml');

function pipeline() {
  const original = readFileSync(FIXTURE, 'utf-8');
  const doc = readFlowXml(original, { fallbackName: 'reactive_components' });
  const yaml = emitYaml(doc);
  const restored = readYaml(yaml, { validate: true });
  return { original, doc, yaml, generated: writeXml(restored) };
}

function componentField(doc: ReturnType<typeof pipeline>['doc'], name: string): ComponentScreenField {
  const screen = doc.steps.find(s => 'screen' in s) as ScreenStep;
  const field = screen.fields.find(
    f => 'component' in f && (f as ComponentScreenField).component === name
  );
  if (!field) throw new Error(`Component "${name}" not found in fixture`);
  return field as ComponentScreenField;
}

describe('reactive screen components', () => {
  it('round-trips the whole flow byte-identically', () => {
    const { original, generated } = pipeline();
    expect(generated).toBe(original);
  });

  it('keeps component inputs that reference other screen fields as elementReference', () => {
    const { generated } = pipeline();

    // Reactivity lives or dies on this wrapper tag — a stringValue here would
    // deploy clean and silently never update.
    expect(generated).toContain('<elementReference>Quantity_Input</elementReference>');
    expect(generated).toContain('<elementReference>Price_Input</elementReference>');
    expect(generated).toContain('<elementReference>Total_Formula</elementReference>');
    expect(generated).toContain('<elementReference>Discount_Reason</elementReference>');
  });

  it('records the elementReference provenance in the FlowML document', () => {
    const { doc } = pipeline();
    const summary = componentField(doc, 'Order_Summary_LWC');

    expect(summary.inputs).toEqual({
      quantity: 'Quantity_Input',
      unitPrice: 'Price_Input',
      total: 'Total_Formula',
    });
    expect(summary.inputXmlTags).toEqual({
      quantity: 'elementReference',
      unitPrice: 'elementReference',
      total: 'elementReference',
    });
  });

  it('preserves inputsOnNextNavToAssocScrn, which controls reactive refresh', () => {
    const { doc, generated } = pipeline();

    expect(componentField(doc, 'Order_Summary_LWC').inputsOnNextNavToAssocScrn).toBe('UseStoredValues');
    expect(componentField(doc, 'Reactive_Datatable').inputsOnNextNavToAssocScrn).toBe('ResetValues');
    expect(generated).toContain('<inputsOnNextNavToAssocScrn>UseStoredValues</inputsOnNextNavToAssocScrn>');
    expect(generated).toContain('<inputsOnNextNavToAssocScrn>ResetValues</inputsOnNextNavToAssocScrn>');
  });

  it('preserves dataTypeMappings on generic reactive components', () => {
    const { doc } = pipeline();

    expect(componentField(doc, 'Reactive_Datatable').dataTypeMappings).toEqual([
      { typeName: 'T', typeValue: 'Account' },
    ]);
  });

  it('preserves visibility rules driven by another field on the same screen', () => {
    const { doc, generated } = pipeline();
    const screen = doc.steps.find(s => 'screen' in s) as ScreenStep;
    const discount = screen.fields.find(f => 'input' in f && f.input === 'Discount_Reason');

    expect((discount as { visibleWhen?: string[] }).visibleWhen).toEqual(['Quantity_Input > 10.0']);
    expect(generated).toContain('<leftValueReference>Quantity_Input</leftValueReference>');
  });

  it('preserves visibility rules driven by a component automatic output', () => {
    const { doc, generated } = pipeline();
    const screen = doc.steps.find(s => 'screen' in s) as ScreenStep;
    const count = screen.fields.find(f => 'display' in f && f.display === 'Selected_Count');

    expect((count as { visibleWhen?: string[] }).visibleWhen).toEqual([
      'Order_Summary_LWC.isValid == true',
    ]);
    expect(generated).toContain('<leftValueReference>Order_Summary_LWC.isValid</leftValueReference>');
  });

  it('preserves merge fields that read a component output in display text', () => {
    const { generated } = pipeline();

    expect(generated).toContain('{!Reactive_Datatable.selectedRows}');
    expect(generated).toContain('{!Total_Formula}');
  });
});
