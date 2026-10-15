import { describe, it, expect } from 'vitest';
import {
  formatValue,
  inferValueType,
  parseConditionString,
  parseAssignmentString,
  xmlConditionToString,
  xmlAssignmentToString,
} from '../../src/parsers.js';

describe('inferValueType', () => {
  it('detects quoted strings', () => {
    expect(inferValueType('"Active"')).toEqual({ type: 'string', value: 'Active' });
  });

  it('detects booleans', () => {
    expect(inferValueType('true')).toEqual({ type: 'boolean', value: true });
    expect(inferValueType('false')).toEqual({ type: 'boolean', value: false });
  });

  it('detects numbers', () => {
    expect(inferValueType('42')).toEqual({ type: 'number', value: 42, originalString: '42' });
    expect(inferValueType('3.14')).toEqual({ type: 'number', value: 3.14, originalString: '3.14' });
  });

  it('detects references', () => {
    expect(inferValueType('$Record.ContactId')).toEqual({ type: 'reference', value: '$Record.ContactId' });
    expect(inferValueType('varName')).toEqual({ type: 'reference', value: 'varName' });
  });

  it('detects bare ISO dates and datetimes while quoted ISO remains a string', () => {
    expect(inferValueType('2025-07-01')).toEqual({
      type: 'string',
      value: '2025-07-01',
      originalXmlTag: 'dateValue',
    });
    expect(inferValueType('2025-07-01T12:30:45.000Z')).toEqual({
      type: 'string',
      value: '2025-07-01T12:30:45.000Z',
      originalXmlTag: 'dateTimeValue',
    });
    expect(inferValueType('2025-07-01T12:30:45-07:00')).toEqual({
      type: 'string',
      value: '2025-07-01T12:30:45-07:00',
      originalXmlTag: 'dateTimeValue',
    });
    expect(inferValueType('"2025-07-01"')).toEqual({
      type: 'string',
      value: '2025-07-01',
    });
  });

  it('formats date wrappers as bare literals', () => {
    expect(formatValue({
      type: 'string',
      value: '2025-07-01',
      originalXmlTag: 'dateValue',
    })).toBe('2025-07-01');
    expect(formatValue({
      type: 'string',
      value: '2025-07-01T12:30:45Z',
      originalXmlTag: 'dateTimeValue',
    })).toBe('2025-07-01T12:30:45Z');
  });

  it('normalizes $GlobalConstant.True to boolean true', () => {
    expect(inferValueType('$GlobalConstant.True')).toEqual({ type: 'boolean', value: true });
  });

  it('normalizes $GlobalConstant.False to boolean false', () => {
    expect(inferValueType('$GlobalConstant.False')).toEqual({ type: 'boolean', value: false });
  });

  it('normalizes $GlobalConstant.EmptyString to empty string', () => {
    expect(inferValueType('$GlobalConstant.EmptyString')).toEqual({ type: 'string', value: '' });
  });
});

describe('xmlConditionToString', () => {
  it('converts EqualTo with string', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Status',
      operator: 'EqualTo',
      rightValue: { stringValue: 'Active' },
    })).toBe('Status == "Active"');
  });

  it('converts EqualTo with reference', () => {
    expect(xmlConditionToString({
      leftValueReference: 'ContactId',
      operator: 'EqualTo',
      rightValue: { elementReference: '$Record.ContactId' },
    })).toBe('ContactId == $Record.ContactId');
  });

  it('converts IsNull false to isNotNull', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Get_Records',
      operator: 'IsNull',
      rightValue: { booleanValue: 'false' },
    })).toBe('Get_Records isNotNull');
  });

  it('converts IsNull true to isNull', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Get_Records',
      operator: 'IsNull',
      rightValue: { booleanValue: 'true' },
    })).toBe('Get_Records isNull');
  });

  it('converts IsEmpty false to isNotEmpty', () => {
    expect(xmlConditionToString({
      leftValueReference: 'varCol',
      operator: 'IsEmpty',
      rightValue: { booleanValue: 'false' },
    })).toBe('varCol isNotEmpty');
  });

  it('converts GreaterThanOrEqualTo with number', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Amount',
      operator: 'GreaterThanOrEqualTo',
      rightValue: { numberValue: '100' },
    })).toBe('Amount >= 100');
  });

  it('converts Contains', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Name',
      operator: 'Contains',
      rightValue: { stringValue: 'Smith' },
    })).toBe('Name contains "Smith"');
  });

  it('converts IsBlank true to isBlank', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Field__c',
      operator: 'IsBlank',
      rightValue: { booleanValue: 'true' },
    })).toBe('Field__c isBlank');
  });

  it('converts IsBlank false to isNotBlank', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Field__c',
      operator: 'IsBlank',
      rightValue: { booleanValue: 'false' },
    })).toBe('Field__c isNotBlank');
  });

  it('converts IsChanged true to isChanged', () => {
    expect(xmlConditionToString({
      leftValueReference: 'AnnualRevenue',
      operator: 'IsChanged',
      rightValue: { booleanValue: 'true' },
    })).toBe('AnnualRevenue isChanged');
  });

  it('converts IsChanged false to isNotChanged', () => {
    expect(xmlConditionToString({
      leftValueReference: 'AnnualRevenue',
      operator: 'IsChanged',
      rightValue: { booleanValue: 'false' },
    })).toBe('AnnualRevenue isNotChanged');
  });

  it('converts IsChanged boolean true to isChanged', () => {
    expect(xmlConditionToString({
      leftValueReference: 'Status__c',
      operator: 'IsChanged',
      rightValue: { booleanValue: true },
    })).toBe('Status__c isChanged');
  });

  it.each([
    ['WasSet', true, 'wasSet'],
    ['WasSet', false, 'wasNotSet'],
    ['WasSelected', true, 'wasSelected'],
    ['WasSelected', false, 'wasNotSelected'],
    ['WasVisited', true, 'wasVisited'],
    ['WasVisited', false, 'wasNotVisited'],
  ])('round-trips %s with polarity %s', (operator, value, flowmlOperator) => {
    const condition = {
      leftValueReference: 'Target',
      operator,
      rightValue: { booleanValue: value },
    };
    const serialized = xmlConditionToString(condition);
    expect(serialized).toBe(`Target ${flowmlOperator}`);
    expect(parseConditionString(serialized)).toEqual({
      leftOperand: 'Target',
      operator,
      rightValue: { type: 'boolean', value },
    });
  });

  it.each([
    {
      name: 'binary',
      condition: {
        leftValueReference: 'Target',
        operator: 'SomeFutureOperator',
        rightValue: { stringValue: 'value' },
      },
      expectedRightValue: { type: 'string', value: 'value' },
    },
    {
      name: 'unary-shaped boolean',
      condition: {
        leftValueReference: 'Target',
        operator: 'SomeFutureOperator',
        rightValue: { booleanValue: true },
      },
      expectedRightValue: { type: 'boolean', value: true },
    },
    {
      name: 'no-right-value',
      condition: {
        leftValueReference: 'Target',
        operator: 'SomeFutureOperator',
      },
      expectedRightValue: { type: 'string', value: '', originalXmlTag: '__null__' },
    },
  ])('passes through an unknown $name operator without a sentinel', ({
    condition,
    expectedRightValue,
  }) => {
    const serialized = xmlConditionToString(condition);
    expect(serialized).not.toContain('???');
    const parsed = parseConditionString(serialized);
    expect(parsed.leftOperand).toBe(condition.leftValueReference);
    expect(parsed.operator).toBe(condition.operator);
    expect(parsed.rightValue).toEqual(expectedRightValue);
  });
});

describe('xmlAssignmentToString', () => {
  it('converts Assign with boolean', () => {
    expect(xmlAssignmentToString({
      assignToReference: '$Record.IsActive__c',
      operator: 'Assign',
      value: { booleanValue: 'true' },
    })).toBe('$Record.IsActive__c = true');
  });

  it('converts Add with reference', () => {
    expect(xmlAssignmentToString({
      assignToReference: 'varNum_Total',
      operator: 'Add',
      value: { elementReference: 'Loop_Item.Amount__c' },
    })).toBe('varNum_Total += Loop_Item.Amount__c');
  });

  it('converts Subtract with number', () => {
    expect(xmlAssignmentToString({
      assignToReference: 'varNum_Count',
      operator: 'Subtract',
      value: { numberValue: '1' },
    })).toBe('varNum_Count -= 1');
  });

  it('preserves date and datetime wrappers as bare literals', () => {
    expect(xmlConditionToString({
      leftValueReference: 'StartDate',
      operator: 'EqualTo',
      rightValue: { dateValue: '2025-07-01' },
    })).toBe('StartDate == 2025-07-01');
    expect(xmlAssignmentToString({
      assignToReference: 'StartAt',
      operator: 'Assign',
      value: { dateTimeValue: '2025-07-01T12:30:45Z' },
    })).toBe('StartAt = 2025-07-01T12:30:45Z');
  });
});

describe('parseConditionString', () => {
  it('parses == with string', () => {
    const result = parseConditionString('Status == "Active"');
    expect(result.leftOperand).toBe('Status');
    expect(result.operator).toBe('EqualTo');
    expect(result.rightValue).toEqual({ type: 'string', value: 'Active' });
  });

  it('parses isNotNull', () => {
    const result = parseConditionString('ContactId isNotNull');
    expect(result.leftOperand).toBe('ContactId');
    expect(result.operator).toBe('IsNull');
    expect(result.rightValue).toEqual({ type: 'boolean', value: false });
  });

  it('parses isNull', () => {
    const result = parseConditionString('Get_Records isNull');
    expect(result.leftOperand).toBe('Get_Records');
    expect(result.operator).toBe('IsNull');
    expect(result.rightValue).toEqual({ type: 'boolean', value: true });
  });

  it('parses isNotEmpty', () => {
    const result = parseConditionString('varCol isNotEmpty');
    expect(result.leftOperand).toBe('varCol');
    expect(result.operator).toBe('IsEmpty');
    expect(result.rightValue).toEqual({ type: 'boolean', value: false });
  });

  it('parses isBlank', () => {
    const result = parseConditionString('Field__c isBlank');
    expect(result.leftOperand).toBe('Field__c');
    expect(result.operator).toBe('IsBlank');
    expect(result.rightValue).toEqual({ type: 'boolean', value: true });
  });

  it('parses isNotBlank', () => {
    const result = parseConditionString('Field__c isNotBlank');
    expect(result.leftOperand).toBe('Field__c');
    expect(result.operator).toBe('IsBlank');
    expect(result.rightValue).toEqual({ type: 'boolean', value: false });
  });

  it('parses >= with reference', () => {
    const result = parseConditionString('Score >= varNum_MinScore');
    expect(result.leftOperand).toBe('Score');
    expect(result.operator).toBe('GreaterThanOrEqualTo');
    expect(result.rightValue).toEqual({ type: 'reference', value: 'varNum_MinScore' });
  });

  it('parses contains', () => {
    const result = parseConditionString('Name contains "Smith"');
    expect(result.leftOperand).toBe('Name');
    expect(result.operator).toBe('Contains');
    expect(result.rightValue).toEqual({ type: 'string', value: 'Smith' });
  });

  it('parses isChanged', () => {
    const result = parseConditionString('AnnualRevenue isChanged');
    expect(result.leftOperand).toBe('AnnualRevenue');
    expect(result.operator).toBe('IsChanged');
    expect(result.rightValue).toEqual({ type: 'boolean', value: true });
  });

  it('parses isNotChanged', () => {
    const result = parseConditionString('Status__c isNotChanged');
    expect(result.leftOperand).toBe('Status__c');
    expect(result.operator).toBe('IsChanged');
    expect(result.rightValue).toEqual({ type: 'boolean', value: false });
  });

  it('normalizes $GlobalConstant.True in condition to boolean', () => {
    const result = parseConditionString('$Setup.Settings__c.IsEnabled__c == $GlobalConstant.True');
    expect(result.leftOperand).toBe('$Setup.Settings__c.IsEnabled__c');
    expect(result.operator).toBe('EqualTo');
    expect(result.rightValue).toEqual({ type: 'boolean', value: true });
  });

  it('normalizes $GlobalConstant.False in condition to boolean', () => {
    const result = parseConditionString('varBool_Flag == $GlobalConstant.False');
    expect(result.leftOperand).toBe('varBool_Flag');
    expect(result.operator).toBe('EqualTo');
    expect(result.rightValue).toEqual({ type: 'boolean', value: false });
  });

  it.each([
    ['wasSet', 'WasSet', true],
    ['wasNotSet', 'WasSet', false],
    ['wasSelected', 'WasSelected', true],
    ['wasNotSelected', 'WasSelected', false],
    ['wasVisited', 'WasVisited', true],
    ['wasNotVisited', 'WasVisited', false],
  ])('parses %s as %s with polarity %s', (flowmlOperator, xmlOperator, value) => {
    expect(parseConditionString(`Target ${flowmlOperator}`)).toEqual({
      leftOperand: 'Target',
      operator: xmlOperator,
      rightValue: { type: 'boolean', value },
    });
  });
});

describe('parseAssignmentString', () => {
  it('parses = with string', () => {
    const result = parseAssignmentString('varTxt_Name = "Default"');
    expect(result.target).toBe('varTxt_Name');
    expect(result.operator).toBe('Assign');
    expect(result.value).toEqual({ type: 'string', value: 'Default' });
  });

  it('parses += with reference', () => {
    const result = parseAssignmentString('varNum_Total += Loop_Item.Amount__c');
    expect(result.target).toBe('varNum_Total');
    expect(result.operator).toBe('Add');
    expect(result.value).toEqual({ type: 'reference', value: 'Loop_Item.Amount__c' });
  });

  it('parses -= with number', () => {
    const result = parseAssignmentString('varNum_Count -= 1');
    expect(result.target).toBe('varNum_Count');
    expect(result.operator).toBe('Subtract');
    expect(result.value).toEqual({ type: 'number', value: 1, originalString: '1' });
  });
});
