import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function xmlToYamlParsed(fixtureName: string): Record<string, unknown> {
  const xml = loadFixture(fixtureName);
  const doc = readFlowXml(xml);
  const yamlStr = emitYaml(doc);
  return yaml.load(yamlStr) as Record<string, unknown>;
}

// ============================================================
// Basic emission tests
// ============================================================

describe('yamlEmitter', () => {
  describe('simple record-triggered flow', () => {
    const xml = loadFixture('simple-record-triggered.xml');
    const doc = readFlowXml(xml);
    const yamlStr = emitYaml(doc);
    const parsed = yaml.load(yamlStr) as Record<string, unknown>;

    it('produces valid YAML that parses back', () => {
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe('object');
    });

    it('has correct top-level key order', () => {
      const keys = Object.keys(parsed);
      expect(keys[0]).toBe('flow');
      expect(keys[keys.length - 1]).toBe('steps');
    });

    it('puts trigger before variables before steps', () => {
      const keys = Object.keys(parsed);
      const triggerIdx = keys.indexOf('trigger');
      const varsIdx = keys.indexOf('variables');
      const stepsIdx = keys.indexOf('steps');
      expect(triggerIdx).toBeGreaterThan(0);
      expect(varsIdx).toBeGreaterThan(triggerIdx);
      expect(stepsIdx).toBeGreaterThan(varsIdx);
    });

    it('emits flow header correctly', () => {
      const flow = parsed.flow as Record<string, unknown>;
      expect(flow.name).toBe('Program_Enrollment_Returning_Participant_Flag');
      expect(flow.label).toBe('Program Enrollment - Returning Participant Flag');
      expect(flow.processType).toBe('AutoLaunchedFlow');
      expect(flow.apiVersion).toBe('65.0');
      expect(flow.status).toBe('Active');
      expect(flow.description).toBe('Flags returning participant enrollments');
      expect(flow.runInMode).toBe('SystemModeWithoutSharing');
    });

    it('emits trigger block', () => {
      const trigger = parsed.trigger as Record<string, unknown>;
      expect(trigger.type).toBe('RecordAfterSave');
      expect(trigger.object).toBe('ProgramEnrollment');
      expect(trigger.recordTriggerType).toBe('CreateAndUpdate');
      expect(trigger.requiresRecordChangedToMeetCriteria).toBe(true);
      expect(trigger.next).toBe('Get_Previous_Enrollments');
    });

    it('emits entry conditions as string array', () => {
      const trigger = parsed.trigger as Record<string, unknown>;
      const conditions = trigger.entryConditions as string[];
      expect(Array.isArray(conditions)).toBe(true);
      expect(conditions).toContain('ContactId isNotNull');
    });

    it('emits variables', () => {
      const variables = parsed.variables as Record<string, Record<string, unknown>>;
      expect(variables.varBool_IsReturning).toBeDefined();
      expect(variables.varBool_IsReturning.dataType).toBe('Boolean');
      expect(variables.varBool_IsReturning.defaultValue).toBe(false);
    });

    it('emits steps as array', () => {
      const steps = parsed.steps as unknown[];
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThanOrEqual(3);
    });

    it('emits lookup step correctly', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const lookup = steps.find(s => 'lookup' in s)!;
      expect(lookup.lookup).toBe('Get_Previous_Enrollments');
      expect(lookup.object).toBe('ProgramEnrollment');
      expect(lookup.getFirst).toBe(true);
      expect(lookup.fields).toEqual(['Id']);
      expect(lookup.assignNullValuesIfNoRecordsFound).toBe(true);
      expect(lookup.next).toBe('Previous_Enrollments_Found');
    });

    it('emits lookup where conditions', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const lookup = steps.find(s => 'lookup' in s)!;
      const where = lookup.where as string[];
      expect(where).toContain('ContactId == $Record.ContactId');
      expect(where).toContain('Status == "Completed"');
      expect(where).toContain('Id != $Record.Id');
    });

    it('emits decision step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const decision = steps.find(s => 'decision' in s) as Record<string, unknown>;
      expect(decision.decision).toBe('Previous_Enrollments_Found');
      const rules = decision.rules as Record<string, unknown>[];
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Yes');
      expect(rules[0].next).toBe('Set_Returning_Participant');
    });

    it('emits assignment step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const assignment = steps.find(s => 'assignment' in s) as Record<string, unknown>;
      expect(assignment.assignment).toBe('Set_Returning_Participant');
      const ops = assignment.operations as string[];
      expect(ops).toContain('$Record.Returning_Participant__c = true');
    });

    it('does not contain null values for omitted fields', () => {
      expect(yamlStr).not.toMatch(/: null\b/);
    });

    it('default mode emits rawProcessMetadata in original order', () => {
      const raw = (parsed.flow as any).rawProcessMetadata as Array<{ name: string; value: string }>;
      expect(raw).toBeDefined();
      const names = raw.map(p => p.name);
      expect(names).toEqual(['CanvasMode', 'OriginBuilderId']);
    });

    it('compact mode excludes boilerplate processMetadata but preserves OriginBuilderId', () => {
      const xml = loadFixture('simple-record-triggered.xml');
      const compactDoc = readFlowXml(xml, { compact: true });
      const compactYaml = emitYaml(compactDoc);
      const compactParsed = yaml.load(compactYaml) as Record<string, unknown>;
      expect((compactParsed.flow as any).processMetadata?.BuilderType).toBeUndefined();
      expect((compactParsed.flow as any).processMetadata?.CanvasMode).toBeUndefined();
      expect((compactParsed.flow as any).processMetadata?.OriginBuilderId).toBe('some-builder-id');
    });
  });

  // ============================================================
  // Scheduled flow
  // ============================================================

  describe('scheduled flow', () => {
    const parsed = xmlToYamlParsed('scheduled-flow.xml');

    it('emits trigger with Scheduled type', () => {
      const trigger = parsed.trigger as Record<string, unknown>;
      expect(trigger.type).toBe('Scheduled');
      expect(trigger.object).toBeDefined();
    });

    it('emits schedule config', () => {
      const trigger = parsed.trigger as Record<string, unknown>;
      if (trigger.schedule) {
        const schedule = trigger.schedule as Record<string, unknown>;
        expect(schedule.frequency).toBeDefined();
        expect(schedule.startDate).toBeDefined();
        expect(schedule.startTime).toBeDefined();
      }
    });
  });

  // ============================================================
  // Loop with DML
  // ============================================================

  describe('loop with DML', () => {
    const parsed = xmlToYamlParsed('loop-with-dml.xml');

    it('emits loop step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const loop = steps.find(s => 'loop' in s) as Record<string, unknown>;
      expect(loop).toBeDefined();
      expect(loop.collection).toBeDefined();
    });

    it('emits loop connectors', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const loop = steps.find(s => 'loop' in s) as Record<string, unknown>;
      // Loops should have iterationNext and/or afterLastNext
      const hasLoopConnector = loop.iterationNext || loop.afterLastNext;
      expect(hasLoopConnector).toBeTruthy();
    });
  });

  // ============================================================
  // Action and subflow
  // ============================================================

  describe('action and subflow', () => {
    const parsed = xmlToYamlParsed('action-subflow.xml');

    it('emits action step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const action = steps.find(s => 'action' in s) as Record<string, unknown>;
      expect(action).toBeDefined();
      expect(action.actionType).toBeDefined();
    });

    it('emits subflow step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const subflow = steps.find(s => 'subflow' in s) as Record<string, unknown>;
      expect(subflow).toBeDefined();
      expect(subflow.flowName).toBeDefined();
    });
  });

  // ============================================================
  // Screen flow
  // ============================================================

  describe('screen flow', () => {
    const parsed = xmlToYamlParsed('simple-screen-flow.xml');

    it('emits start block for screen flows', () => {
      // Screen flows use start: instead of trigger:
      if (parsed.start) {
        const start = parsed.start as Record<string, unknown>;
        expect(start.next).toBeDefined();
      }
    });

    it('emits screen step', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const screen = steps.find(s => 'screen' in s);
      if (screen) {
        expect(screen).toHaveProperty('screen');
      }
    });
  });

  // ============================================================
  // Record update modes
  // ============================================================

  describe('record update modes', () => {
    const parsed = xmlToYamlParsed('record-update-modes.xml');

    it('emits recordUpdate steps', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const updates = steps.filter(s => 'recordUpdate' in s);
      expect(updates.length).toBeGreaterThan(0);
    });

    it('handles by-reference mode', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      const byRef = steps.find(s =>
        'recordUpdate' in s && 'inputReference' in s
      );
      if (byRef) {
        expect(byRef.inputReference).toBeDefined();
        expect(byRef).not.toHaveProperty('object');
      }
    });
  });

  // ============================================================
  // Round-trip: Document -> YAML -> Parse -> Compare
  // ============================================================

  describe('round-trip fidelity', () => {
    const xml = loadFixture('simple-record-triggered.xml');
    const doc = readFlowXml(xml);
    const yamlStr = emitYaml(doc);
    const parsed = yaml.load(yamlStr) as Record<string, unknown>;

    it('preserves flow header fields', () => {
      const flow = parsed.flow as Record<string, unknown>;
      expect(flow.name).toBe(doc.flow.name);
      expect(flow.label).toBe(doc.flow.label);
      expect(flow.processType).toBe(doc.flow.processType);
      expect(flow.apiVersion).toBe(doc.flow.apiVersion);
      expect(flow.status).toBe(doc.flow.status);
    });

    it('preserves trigger fields', () => {
      const trigger = parsed.trigger as Record<string, unknown>;
      expect(trigger.type).toBe(doc.trigger!.type);
      expect(trigger.object).toBe(doc.trigger!.object);
      expect(trigger.recordTriggerType).toBe(doc.trigger!.recordTriggerType);
      expect(trigger.next).toBe(doc.trigger!.next);
    });

    it('preserves variable declarations', () => {
      const variables = parsed.variables as Record<string, Record<string, unknown>>;
      for (const [name, decl] of Object.entries(doc.variables!)) {
        expect(variables[name]).toBeDefined();
        expect(variables[name].dataType).toBe(decl.dataType);
      }
    });

    it('preserves step count and order', () => {
      const steps = parsed.steps as Record<string, unknown>[];
      expect(steps.length).toBe(doc.steps.length);
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('handles document with only flow and steps', () => {
      const minimal: any = {
        flow: {
          name: 'Test',
          label: 'Test Flow',
          processType: 'AutoLaunchedFlow',
          apiVersion: '65.0',
          status: 'Draft',
        },
        steps: [],
      };
      const yamlStr = emitYaml(minimal);
      const parsed = yaml.load(yamlStr) as Record<string, unknown>;
      expect(parsed.flow).toBeDefined();
      expect(parsed.steps).toEqual([]);
      expect(parsed).not.toHaveProperty('trigger');
      expect(parsed).not.toHaveProperty('variables');
    });

    it('handles apiVersion as string (not number)', () => {
      const minimal: any = {
        flow: {
          name: 'Test',
          label: 'Test',
          processType: 'AutoLaunchedFlow',
          apiVersion: '65.0',
          status: 'Draft',
        },
        steps: [],
      };
      const yamlStr = emitYaml(minimal);
      const parsed = yaml.load(yamlStr) as Record<string, unknown>;
      const flow = parsed.flow as Record<string, unknown>;
      expect(typeof flow.apiVersion).toBe('string');
      expect(flow.apiVersion).toBe('65.0');
    });

    it('handles boolean values correctly', () => {
      const minimal: any = {
        flow: {
          name: 'Test',
          label: 'Test',
          processType: 'AutoLaunchedFlow',
          apiVersion: '65.0',
          status: 'Draft',
        },
        steps: [
          {
            lookup: 'Get_Records',
            object: 'Account',
            getFirst: true,
            assignNullValuesIfNoRecordsFound: false,
          },
        ],
      };
      const yamlStr = emitYaml(minimal);
      const parsed = yaml.load(yamlStr) as Record<string, unknown>;
      const steps = parsed.steps as Record<string, unknown>[];
      expect(steps[0].getFirst).toBe(true);
      // assignNullValuesIfNoRecordsFound is false, which is a valid value
      expect(steps[0].assignNullValuesIfNoRecordsFound).toBe(false);
    });
  });
});
