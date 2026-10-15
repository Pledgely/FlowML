import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import type { FlowMLDocument } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

/** XML -> FlowML doc -> YAML string -> FlowML doc (round-trip through YAML) */
function roundTripViaYaml(fixtureName: string): { original: FlowMLDocument; restored: FlowMLDocument } {
  const xml = loadFixture(fixtureName);
  const fallbackName = fixtureName.replace('.flow-meta.xml', '').replace('.xml', '');
  const original = readFlowXml(xml, { fallbackName });
  const yamlStr = emitYaml(original);
  const restored = readYaml(yamlStr);
  return { original, restored };
}

// ============================================================
// Basic parsing
// ============================================================

describe('yamlReader', () => {
  describe('basic parsing', () => {
    it('parses minimal FlowML YAML', () => {
      const yaml = `
flow:
  name: Test_Flow
  label: "Test Flow"
  processType: AutoLaunchedFlow
  apiVersion: "65.0"
  status: Draft
steps: []
`;
      const doc = readYaml(yaml);
      expect(doc.flow.name).toBe('Test_Flow');
      expect(doc.flow.label).toBe('Test Flow');
      expect(doc.flow.processType).toBe('AutoLaunchedFlow');
      expect(doc.flow.apiVersion).toBe('65.0');
      expect(doc.flow.status).toBe('Draft');
      expect(doc.steps).toEqual([]);
    });

    it('rejects invalid YAML', () => {
      expect(() => readYaml('not: [valid: yaml: stuff')).toThrow();
    });

    it('rejects non-object YAML', () => {
      expect(() => readYaml('just a string')).toThrow('Invalid FlowML YAML');
    });
  });

  // ============================================================
  // Round-trip through YAML: XML -> doc -> YAML -> doc
  // ============================================================

  describe('round-trip: simple-record-triggered', () => {
    const { original, restored } = roundTripViaYaml('simple-record-triggered.xml');

    it('preserves flow header', () => {
      expect(restored.flow.name).toBe(original.flow.name);
      expect(restored.flow.label).toBe(original.flow.label);
      expect(restored.flow.processType).toBe(original.flow.processType);
      expect(restored.flow.apiVersion).toBe(original.flow.apiVersion);
      expect(restored.flow.status).toBe(original.flow.status);
    });

    it('preserves trigger block', () => {
      expect(restored.trigger).toBeDefined();
      expect(restored.trigger!.type).toBe(original.trigger!.type);
      expect(restored.trigger!.object).toBe(original.trigger!.object);
      expect(restored.trigger!.recordTriggerType).toBe(original.trigger!.recordTriggerType);
      expect(restored.trigger!.next).toBe(original.trigger!.next);
    });

    it('preserves variables', () => {
      expect(restored.variables).toBeDefined();
      for (const [name, decl] of Object.entries(original.variables!)) {
        expect(restored.variables![name]).toBeDefined();
        expect(restored.variables![name].dataType).toBe(decl.dataType);
      }
    });

    it('preserves step count', () => {
      expect(restored.steps.length).toBe(original.steps.length);
    });

    it('preserves lookup step', () => {
      const origLookup = original.steps.find(s => 'lookup' in s) as any;
      const restoredLookup = restored.steps.find(s => 'lookup' in s) as any;
      expect(restoredLookup.lookup).toBe(origLookup.lookup);
      expect(restoredLookup.object).toBe(origLookup.object);
      expect(restoredLookup.getFirst).toBe(origLookup.getFirst);
    });

    it('preserves decision step', () => {
      const origDecision = original.steps.find(s => 'decision' in s) as any;
      const restoredDecision = restored.steps.find(s => 'decision' in s) as any;
      expect(restoredDecision.decision).toBe(origDecision.decision);
      expect(restoredDecision.rules.length).toBe(origDecision.rules.length);
    });

    it('preserves assignment step', () => {
      const origAssign = original.steps.find(s => 'assignment' in s) as any;
      const restoredAssign = restored.steps.find(s => 'assignment' in s) as any;
      expect(restoredAssign.assignment).toBe(origAssign.assignment);
      expect(restoredAssign.operations).toEqual(origAssign.operations);
    });
  });

  describe('round-trip: loop-with-dml', () => {
    const { original, restored } = roundTripViaYaml('loop-with-dml.xml');

    it('preserves loop step', () => {
      const origLoop = original.steps.find(s => 'loop' in s) as any;
      const restoredLoop = restored.steps.find(s => 'loop' in s) as any;
      expect(restoredLoop).toBeDefined();
      expect(restoredLoop.loop).toBe(origLoop.loop);
      expect(restoredLoop.collection).toBe(origLoop.collection);
    });

    it('preserves step count', () => {
      expect(restored.steps.length).toBe(original.steps.length);
    });
  });

  describe('round-trip: action-subflow', () => {
    const { original, restored } = roundTripViaYaml('action-subflow.xml');

    it('preserves action step', () => {
      const origAction = original.steps.find(s => 'action' in s) as any;
      const restoredAction = restored.steps.find(s => 'action' in s) as any;
      expect(restoredAction.action).toBe(origAction.action);
      expect(restoredAction.actionType).toBe(origAction.actionType);
    });

    it('preserves subflow step', () => {
      const origSubflow = original.steps.find(s => 'subflow' in s) as any;
      const restoredSubflow = restored.steps.find(s => 'subflow' in s) as any;
      expect(restoredSubflow.subflow).toBe(origSubflow.subflow);
      expect(restoredSubflow.flowName).toBe(origSubflow.flowName);
    });
  });

  // ============================================================
  // Schema validation
  // ============================================================

  describe('schema validation', () => {
    it('rejects document missing required fields', () => {
      const invalid = `
flow:
  name: Test
steps: []
`;
      expect(() => readYaml(invalid)).toThrow('schema validation failed');
    });

    it('allows skipping validation', () => {
      const invalid = `
flow:
  name: Test
steps: []
`;
      // Should not throw when validation is disabled
      const doc = readYaml(invalid, { validate: false });
      expect(doc.flow.name).toBe('Test');
    });
  });
});
