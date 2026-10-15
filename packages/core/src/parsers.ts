// ============================================================
// Condition & Assignment String Parsers
// ============================================================

import type { ParsedCondition, ParsedValue, ParsedAssignment } from './types.js';
import { CONDITION_OPERATORS, CONDITION_OPERATOR_PARSE_ORDER, CONDITION_OPERATORS_REVERSE, ASSIGNMENT_OPERATORS, ASSIGNMENT_OPERATORS_REVERSE } from './mappings.js';

/**
 * Infer value type from a string token.
 * - "quoted" -> string
 * - true/false -> boolean
 * - numeric -> number
 * - bare ISO date/datetime -> dateValue/dateTimeValue
 * - bare names -> reference
 */
export function inferValueType(token: string): ParsedValue {
  if (token.startsWith('"') && token.endsWith('"')) {
    return { type: 'string', value: token.slice(1, -1) };
  }
  if (token === 'true' || token === '$GlobalConstant.True') return { type: 'boolean', value: true };
  if (token === 'false' || token === '$GlobalConstant.False') return { type: 'boolean', value: false };
  if (token === '$GlobalConstant.EmptyString') return { type: 'string', value: '' };
  if (token === 'null') return { type: 'string', value: '', originalXmlTag: '__null__' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    return { type: 'string', value: token, originalXmlTag: 'dateValue' };
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(token)) {
    return { type: 'string', value: token, originalXmlTag: 'dateTimeValue' };
  }
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return { type: 'number', value: Number(token), originalString: token };
  }
  return { type: 'reference', value: token };
}

/**
 * Format a value for FlowML condition/assignment string output.
 */
export function formatValue(v: ParsedValue): string {
  if (v.originalXmlTag === 'dateValue' || v.originalXmlTag === 'dateTimeValue') {
    return String(v.value);
  }
  if (v.type === 'string') return `"${v.value}"`;
  if (v.originalString) return v.originalString;
  return String(v.value);
}

/**
 * Extract the XML value wrapper type for a ParsedValue.
 */
export function getXmlValueTag(v: ParsedValue): string {
  switch (v.type) {
    case 'string': return 'stringValue';
    case 'boolean': return 'booleanValue';
    case 'number': return 'numberValue';
    case 'reference': return 'elementReference';
  }
}

/**
 * Infer an XML value wrapper from a scalar declaration or field value.
 */
export function inferParsedValue(val: unknown): ParsedValue {
  if (Array.isArray(val)) {
    return { type: 'reference', value: val.map(String) };
  }
  if (val === true || val === false) return { type: 'boolean', value: val };
  if (typeof val === 'number') {
    const numStr = Number.isInteger(val) ? `${val}.0` : String(val);
    return { type: 'number', value: val, originalString: numStr };
  }
  if (typeof val === 'string') {
    if (val === '$GlobalConstant.True') return { type: 'boolean', value: true };
    if (val === '$GlobalConstant.False') return { type: 'boolean', value: false };
    if (val === '$GlobalConstant.EmptyString') return { type: 'string', value: '' };
    if (val.startsWith('{!')) return { type: 'string', value: val };
    if (val.startsWith('$') || (val.includes('.') && !val.includes(' '))) {
      return { type: 'reference', value: val };
    }
    return { type: 'string', value: val };
  }
  return { type: 'string', value: String(val ?? '') };
}

/**
 * True when a YAML-authored input/field value is an explicit quoted literal:
 * the string is wrapped in double quotes to force a stringValue where bare
 * inference would produce an elementReference (e.g. dotted tokens).
 */
export function isQuotedLiteral(val: unknown): val is string {
  return typeof val === 'string' && val.length >= 2 && val.startsWith('"') && val.endsWith('"');
}

/**
 * Whether an extracted XML value needs its wrapper tag pinned in inputXmlTags
 * to survive a YAML round-trip. True when re-inference from the raw value would
 * pick a different tag, or when the string itself looks like an explicit quoted
 * literal (which the writer would otherwise unwrap).
 */
export function needsXmlTagPreservation(extracted: ParsedValue): boolean {
  if (!extracted.originalXmlTag) return false;
  if (extracted.originalXmlTag !== getXmlValueTag(inferParsedValue(extracted.value))) return true;
  return isQuotedLiteral(extracted.value);
}

/**
 * Extract a ParsedValue from an XML value element (which has one of stringValue, booleanValue, etc.)
 */
export function extractXmlValue(valueObj: Record<string, unknown>): ParsedValue | undefined {
  if (valueObj.setupReference !== undefined) {
    return {
      type: 'reference',
      value: String(valueObj.setupReference),
      originalXmlTag: 'setupReference',
      setupReferenceType: valueObj.setupReferenceType !== undefined
        ? String(valueObj.setupReferenceType)
        : undefined,
    };
  }
  if (valueObj.complexValue !== undefined) {
    return {
      type: 'string',
      value: String(valueObj.complexValue),
      originalXmlTag: 'complexValue',
      complexValueType: valueObj.complexValueType !== undefined
        ? String(valueObj.complexValueType)
        : undefined,
    };
  }
  if (valueObj.elementReference !== undefined) {
    return { type: 'reference', value: String(valueObj.elementReference), originalXmlTag: 'elementReference' };
  }
  if (valueObj.stringValue !== undefined) {
    return { type: 'string', value: String(valueObj.stringValue), originalXmlTag: 'stringValue' };
  }
  if (valueObj.booleanValue !== undefined) {
    const bv = valueObj.booleanValue;
    return { type: 'boolean', value: bv === true || bv === 'true', originalXmlTag: 'booleanValue' };
  }
  if (valueObj.numberValue !== undefined) {
    return { type: 'number', value: Number(valueObj.numberValue), originalXmlTag: 'numberValue', originalString: String(valueObj.numberValue) };
  }
  // dateValue/dateTimeValue normalize to string
  if (valueObj.dateValue !== undefined) {
    return { type: 'string', value: String(valueObj.dateValue), originalXmlTag: 'dateValue' };
  }
  if (valueObj.dateTimeValue !== undefined) {
    return { type: 'string', value: String(valueObj.dateTimeValue), originalXmlTag: 'dateTimeValue' };
  }
  // collectionElements wraps one or more elementReferences
  if (valueObj.collectionElements !== undefined) {
    const elements = Array.isArray(valueObj.collectionElements)
      ? valueObj.collectionElements
      : [valueObj.collectionElements];
    const values: string[] = [];
    const elementTypes: string[] = [];
    for (const rawElement of elements) {
      if (!rawElement || typeof rawElement !== 'object') continue;
      const element = rawElement as Record<string, unknown>;
      for (const tag of [
        'elementReference',
        'stringValue',
        'booleanValue',
        'numberValue',
        'dateValue',
        'dateTimeValue',
      ]) {
        if (element[tag] !== undefined) {
          values.push(String(element[tag]));
          elementTypes.push(tag);
          break;
        }
      }
    }
    if (values.length) {
      return {
        type: 'reference',
        value: values,
        originalXmlTag: 'collectionElements',
        collectionElementTypes: elementTypes,
      };
    }
  }
  return undefined;
}

/**
 * Convert an XML condition object to a FlowML condition string.
 */
export function xmlConditionToString(cond: {
  leftValueReference?: string;
  operator: string;
  rightValue?: Record<string, unknown>;
}): string {
  const left = cond.leftValueReference ?? '';
  const xmlOp = cond.operator;

  // IsNull special handling
  if (xmlOp === 'IsNull') {
    const rv = cond.rightValue ? extractXmlValue(cond.rightValue) : undefined;
    const isTrue = rv?.value === true || rv?.value === 'true';
    return isTrue ? `${left} isNull` : `${left} isNotNull`;
  }

  // IsBlank special handling (separate from IsNull — IsBlank checks null OR empty string)
  if (xmlOp === 'IsBlank') {
    const rv = cond.rightValue ? extractXmlValue(cond.rightValue) : undefined;
    const isTrue = rv?.value === true || rv?.value === 'true';
    return isTrue ? `${left} isBlank` : `${left} isNotBlank`;
  }

  // Boolean-backed unary operators use true for the positive form and false
  // for the negated form.
  const booleanUnaryOperators: Record<string, [string, string]> = {
    IsChanged: ['isChanged', 'isNotChanged'],
    WasSet: ['wasSet', 'wasNotSet'],
    WasSelected: ['wasSelected', 'wasNotSelected'],
    WasVisited: ['wasVisited', 'wasNotVisited'],
  };
  const booleanUnaryForms = booleanUnaryOperators[xmlOp];
  if (booleanUnaryForms) {
    const rv = cond.rightValue ? extractXmlValue(cond.rightValue) : undefined;
    const isTrue = rv?.value === true || rv?.value === 'true';
    return `${left} ${isTrue ? booleanUnaryForms[0] : booleanUnaryForms[1]}`;
  }

  // IsEmpty special handling
  if (xmlOp === 'IsEmpty') {
    const rv = cond.rightValue ? extractXmlValue(cond.rightValue) : undefined;
    const isTrue = rv?.value === true || rv?.value === 'true';
    return isTrue ? `${left} isEmpty` : `${left} isNotEmpty`;
  }

  // NotEqualTo with no rightValue = unary "has a value" check
  if (xmlOp === 'NotEqualTo' && !cond.rightValue) return `${left} hasValue`;

  const flowmlOp = CONDITION_OPERATORS_REVERSE[xmlOp];
  if (!flowmlOp) {
    if (!cond.rightValue) return `${left} ${xmlOp} null`;
    const rawValue = extractXmlValue(cond.rightValue);
    return `${left} ${xmlOp} ${rawValue ? formatValue(rawValue) : 'null'}`;
  }

  if (!cond.rightValue) return `${left} ${flowmlOp} null`;

  const rv = extractXmlValue(cond.rightValue);
  if (!rv) return `${left} ${flowmlOp} null`;

  return `${left} ${flowmlOp} ${formatValue(rv)}`;
}

/**
 * Convert an XML assignment item to a FlowML assignment string.
 */
export function xmlAssignmentToString(item: {
  assignToReference: string;
  operator: string;
  value?: Record<string, unknown>;
}): string {
  const target = item.assignToReference;
  const flowmlOp = ASSIGNMENT_OPERATORS_REVERSE[item.operator] ?? '=';

  if (!item.value) return `${target} ${flowmlOp} null`;

  const rv = extractXmlValue(item.value);
  if (!rv) return `${target} ${flowmlOp} null`;

  return `${target} ${flowmlOp} ${formatValue(rv)}`;
}

/**
 * Parse a FlowML condition string back to structured form.
 */
export function parseConditionString(str: string): ParsedCondition {
  const trimmed = str.trim();

  // Try each operator in longest-match-first order
  for (const op of CONDITION_OPERATOR_PARSE_ORDER) {
    if (op === '!=') {
      // != handled above for null, now handle general !=
      const regex = new RegExp(`^(\\S+)\\s+!=\\s+(.+)$`);
      const m = trimmed.match(regex);
      if (m) {
        return {
          leftOperand: m[1],
          operator: 'NotEqualTo',
          rightValue: inferValueType(m[2].trim()),
        };
      }
      continue;
    }

    // Unary operators
    if (op === 'hasValue') {
      const regex = new RegExp(`^(\\S+)\\s+hasValue$`);
      const m = trimmed.match(regex);
      if (m) {
        return { leftOperand: m[1], operator: 'NotEqualTo' };
      }
      continue;
    }
    if (
      op === 'isChanged' || op === 'isNotChanged'
      || op === 'wasSet' || op === 'wasNotSet'
      || op === 'wasSelected' || op === 'wasNotSelected'
      || op === 'wasVisited' || op === 'wasNotVisited'
      || op === 'isNotNull' || op === 'isNull' || op === 'isBlank'
      || op === 'isEmpty' || op === 'isNotEmpty' || op === 'isNotBlank'
    ) {
      const regex = new RegExp(`^(\\S+)\\s+${op}$`);
      const m = trimmed.match(regex);
      if (m) {
        if (op === 'isChanged') {
          return { leftOperand: m[1], operator: 'IsChanged', rightValue: { type: 'boolean', value: true } };
        }
        if (op === 'isNotChanged') {
          return { leftOperand: m[1], operator: 'IsChanged', rightValue: { type: 'boolean', value: false } };
        }
        const wasOperators: Record<string, string> = {
          wasSet: 'WasSet',
          wasNotSet: 'WasSet',
          wasSelected: 'WasSelected',
          wasNotSelected: 'WasSelected',
          wasVisited: 'WasVisited',
          wasNotVisited: 'WasVisited',
        };
        const wasOperator = wasOperators[op];
        if (wasOperator) {
          return {
            leftOperand: m[1],
            operator: wasOperator,
            rightValue: { type: 'boolean', value: !op.startsWith('wasNot') },
          };
        }
        if (op === 'isNotNull') {
          return { leftOperand: m[1], operator: 'IsNull', rightValue: { type: 'boolean', value: false } };
        }
        if (op === 'isNull') {
          return { leftOperand: m[1], operator: 'IsNull', rightValue: { type: 'boolean', value: true } };
        }
        if (op === 'isBlank') {
          return { leftOperand: m[1], operator: 'IsBlank', rightValue: { type: 'boolean', value: true } };
        }
        if (op === 'isEmpty') {
          return { leftOperand: m[1], operator: 'IsEmpty', rightValue: { type: 'boolean', value: true } };
        }
        if (op === 'isNotBlank') {
          return { leftOperand: m[1], operator: 'IsBlank', rightValue: { type: 'boolean', value: false } };
        }
        // isNotEmpty
        return { leftOperand: m[1], operator: 'IsEmpty', rightValue: { type: 'boolean', value: false } };
      }
      continue;
    }

    // Binary operators - match with word boundary for text operators
    const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^(\\S+)\\s+${escapedOp}\\s+(.+)$`);
    const m = trimmed.match(regex);
    if (m) {
      const rightStr = m[2].trim();

      // in/notIn: bracket list stays as raw string, bare reference uses inferValueType
      if (op === 'in' || op === 'notIn') {
        const rightValue = rightStr.startsWith('[')
          ? { type: 'string' as const, value: rightStr }
          : inferValueType(rightStr);
        return {
          leftOperand: m[1],
          operator: op === 'in' ? 'In' : 'NotIn',
          rightValue,
        };
      }

      return {
        leftOperand: m[1],
        operator: reverseMap(op),
        rightValue: inferValueType(rightStr),
      };
    }
  }

  // Preserve Salesforce operators introduced after this FlowML release. Known
  // FlowML words are lowercase/symbolic; raw Salesforce operators are
  // PascalCase, which makes the middle token safe to distinguish here.
  const rawOperatorMatch = trimmed.match(/^(\S+)\s+([A-Z]\w*)\s+(.+)$/);
  if (rawOperatorMatch) {
    return {
      leftOperand: rawOperatorMatch[1],
      operator: rawOperatorMatch[2],
      rightValue: inferValueType(rawOperatorMatch[3].trim()),
    };
  }

  // Fallback: treat entire string as a reference
  return { leftOperand: trimmed, operator: 'EqualTo' };
}

function reverseMap(flowmlOp: string): string {
  return CONDITION_OPERATORS[flowmlOp] ?? flowmlOp;
}

/**
 * Parse a FlowML assignment string back to structured form.
 */
export function parseAssignmentString(str: string): ParsedAssignment {
  const trimmed = str.trim();

  // Sort operators longest-first to avoid prefix conflicts
  const sortedOps = Object.entries(ASSIGNMENT_OPERATORS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [flowmlOp, xmlOp] of sortedOps) {
    const idx = trimmed.indexOf(` ${flowmlOp} `);
    if (idx !== -1) {
      const target = trimmed.substring(0, idx).trim();
      const valueStr = trimmed.substring(idx + flowmlOp.length + 2).trim();
      return {
        target,
        operator: xmlOp,
        value: inferValueType(valueStr),
      };
    }
  }

  // Fallback
  return {
    target: trimmed,
    operator: 'Assign',
    value: { type: 'string', value: '' },
  };
}
