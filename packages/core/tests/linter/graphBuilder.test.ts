import { describe, it, expect } from 'vitest';
import { buildGraphFromDocument, getStepInfo } from '../../src/linter/graphBuilder.js';
import type { FlowMLDocument } from '../../src/types.js';

function makeDoc(overrides: Partial<FlowMLDocument> = {}): FlowMLDocument {
  return {
    flow: { name: 'Test_Flow', label: 'Test Flow', processType: 'AutoLaunchedFlow', apiVersion: '62.0', status: 'Draft' },
    steps: [],
    ...overrides,
  };
}

describe('getStepInfo', () => {
  it('extracts lookup step info', () => {
    const info = getStepInfo({ lookup: 'Get_Account', object: 'Account', where: ['Id == $Record.AccountId'] } as any);
    expect(info).toEqual({ name: 'Get_Account', key: 'lookup', elementType: 'recordLookups' });
  });

  it('extracts decision step info', () => {
    const info = getStepInfo({ decision: 'Check_Status', rules: [], default: {} } as any);
    expect(info).toEqual({ name: 'Check_Status', key: 'decision', elementType: 'decisions' });
  });

  it('extracts loop step info', () => {
    const info = getStepInfo({ loop: 'Loop_Items', collection: 'col_Items' } as any);
    expect(info).toEqual({ name: 'Loop_Items', key: 'loop', elementType: 'loops' });
  });

  it('extracts recordCreate step info', () => {
    const info = getStepInfo({ recordCreate: 'Create_Contact', object: 'Contact' } as any);
    expect(info).toEqual({ name: 'Create_Contact', key: 'recordCreate', elementType: 'recordCreates' });
  });
});

describe('buildGraphFromDocument', () => {
  it('builds empty graph from doc with no steps', () => {
    const doc = makeDoc();
    const graph = buildGraphFromDocument(doc);
    expect(graph.nodes.size).toBe(0);
    expect(graph.startName).toBeUndefined();
  });

  it('builds graph with standard connectors', () => {
    const doc = makeDoc({
      start: { next: 'Step_A' },
      steps: [
        { assignment: 'Step_A', operations: ['x = 1'], next: 'Step_B' },
        { recordCreate: 'Step_B', object: 'Account', fields: { Name: 'Test' } },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    expect(graph.nodes.size).toBe(2);
    expect(graph.startName).toBe('Step_A');

    const nodeA = graph.nodes.get('Step_A');
    expect(nodeA?.edges).toContain('Step_B');
  });

  it('builds graph with decision branches', () => {
    const doc = makeDoc({
      start: { next: 'Check' },
      steps: [
        {
          decision: 'Check', rules: [
            { name: 'Yes', when: ['x == 1'], next: 'A' },
            { name: 'No', when: ['x == 2'], next: 'B' },
          ], default: { next: 'C' },
        },
        { assignment: 'A', operations: ['y = 1'] },
        { assignment: 'B', operations: ['y = 2'] },
        { assignment: 'C', operations: ['y = 3'] },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    const checkNode = graph.nodes.get('Check');
    expect(checkNode?.ruleBranches).toEqual(['A', 'B']);
    expect(checkNode?.defaultBranch).toBe('C');
  });

  it('builds graph with loop connectors', () => {
    const doc = makeDoc({
      start: { next: 'MyLoop' },
      steps: [
        { loop: 'MyLoop', collection: 'col', iterationNext: 'DoStuff', afterLastNext: 'Done' },
        { assignment: 'DoStuff', operations: ['x = 1'], next: 'MyLoop' },
        { assignment: 'Done', operations: ['y = 1'] },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    const loopNode = graph.nodes.get('MyLoop');
    expect(loopNode?.iterationNext).toBe('DoStuff');
    expect(loopNode?.afterLastNext).toBe('Done');
  });

  it('builds graph with trigger start', () => {
    const doc = makeDoc({
      trigger: { type: 'RecordAfterSave', object: 'Account', next: 'FirstStep' },
      steps: [
        { assignment: 'FirstStep', operations: ['x = 1'] },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    expect(graph.startName).toBe('FirstStep');
  });

  it('builds graph with scheduled paths', () => {
    const doc = makeDoc({
      trigger: {
        type: 'RecordAfterSave', object: 'Account', next: 'MainStep',
        scheduledPaths: [{ name: 'path1', next: 'ScheduledStep' }],
      },
      steps: [
        { assignment: 'MainStep', operations: ['x = 1'] },
        { assignment: 'ScheduledStep', operations: ['y = 1'] },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    expect(graph.scheduledPathStarts).toEqual(['ScheduledStep']);
  });

  it('includes fault targets in graph', () => {
    const doc = makeDoc({
      start: { next: 'Create' },
      steps: [
        { recordCreate: 'Create', object: 'Account', fields: { Name: 'Test' }, next: 'Success', faultNext: 'ErrorHandler' },
        { assignment: 'Success', operations: ['x = 1'] },
        { assignment: 'ErrorHandler', operations: ['err = 1'] },
      ] as any,
    });
    const graph = buildGraphFromDocument(doc);
    const createNode = graph.nodes.get('Create');
    expect(createNode?.edges).toContain('Success');
    expect(createNode?.edges).toContain('ErrorHandler');
  });
});
