import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readFlowXml } from '../../src/reader/xmlReader.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('xmlReader - scheduled flow', () => {
  const xml = loadFixture('scheduled-flow.xml');
  const doc = readFlowXml(xml);

  it('reads scheduled trigger', () => {
    expect(doc.trigger).toBeDefined();
    expect(doc.trigger!.type).toBe('Scheduled');
    expect(doc.trigger!.object).toBe('Case');
    expect(doc.trigger!.schedule).toBeDefined();
    expect(doc.trigger!.schedule!.frequency).toBe('Daily');
    expect(doc.trigger!.schedule!.startDate).toBe('2024-01-01');
    expect(doc.trigger!.schedule!.startTime).toBe('02:00:00.000Z');
  });

  it('reads entry conditions', () => {
    const conditions = doc.trigger!.entryConditions as string[];
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toBe('Status == "Open"');
  });

  it('reads the step', () => {
    expect(doc.steps).toHaveLength(1);
    const step = doc.steps[0] as any;
    expect(step.assignment).toBe('Close_Case');
    expect(step.operations[0]).toBe('$Record.Status = "Closed"');
  });
});

describe('xmlReader - action and subflow', () => {
  const xml = loadFixture('action-subflow.xml');
  const doc = readFlowXml(xml);

  it('reads variables with isInput/isOutput/isCollection', () => {
    expect(doc.variables!.varId_ContactId.isInput).toBe(true);
    expect(doc.variables!.varId_Result.isOutput).toBe(true);
    expect(doc.variables!.varCol_UserIds.isCollection).toBe(true);
  });

  it('reads action call step', () => {
    const action = doc.steps.find(s => 'action' in s) as any;
    expect(action).toBeDefined();
    expect(action.action).toBe('Send_Notification');
    expect(action.actionType).toBe('customNotificationAction');
    expect(action.inputs.title).toBe('New Record Assigned');
    expect(action.inputs.recipientIds).toBe('varCol_UserIds');
    expect(action.next).toBe('Create_Person_Account');
    expect(action.faultNext).toBe('Log_Error');
  });

  it('reads subflow step', () => {
    const subflow = doc.steps.find(s => 'subflow' in s) as any;
    expect(subflow).toBeDefined();
    expect(subflow.subflow).toBe('Create_Person_Account');
    expect(subflow.flowName).toBe('Subflow_Create_Person_Account');
    expect(subflow.inputs.contactId).toBe('varId_ContactId');
    expect(subflow.outputs.createdContactId).toBe('varId_Result');
  });

  it('orders: action -> subflow (main), log_error (fault)', () => {
    const stepNames = doc.steps.map(s => {
      for (const key of ['action', 'subflow', 'assignment'] as const) {
        if (key in s) return (s as any)[key];
      }
      return 'unknown';
    });
    expect(stepNames[0]).toBe('Send_Notification');
    expect(stepNames[1]).toBe('Create_Person_Account');
    expect(stepNames[2]).toBe('Log_Error');
  });
});
