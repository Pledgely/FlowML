import { XMLParser } from 'fast-xml-parser';

export type FlowXmlDiffOutcome =
  | 'exact'
  | 'format-diff'
  | 'reordered'
  | 'semantic-diff'
  | 'crashed';

export interface FlowXmlDiffResult {
  outcome: FlowXmlDiffOutcome;
  differences: string[];
}

const parser = new XMLParser({
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  ignoreAttributes: false,
});

/**
 * Treat CRLF and LF as equivalent everywhere that FlowML decides whether XML
 * changed. This deliberately leaves every other character untouched.
 */
export function normalizeNewlines(xml: string): string {
  return xml.replace(/\r\n?/g, '\n');
}

/**
 * Compare Flow XML without hiding significant leaf whitespace or sibling
 * ordering changes.
 *
 * Reordering is a failure for the corpus because every corpus flow was
 * retrieved from Salesforce and is already canonically ordered. Hand-authored
 * non-canonical XML could legitimately produce this outcome, but that input is
 * outside the corpus gate.
 */
export function compareFlowXml(originalXml: string, generatedXml: string): FlowXmlDiffResult {
  if (normalizeNewlines(originalXml) === normalizeNewlines(generatedXml)) {
    return { outcome: 'exact', differences: [] };
  }

  try {
    const original = normalizeParsed(parser.parse(originalXml));
    const generated = normalizeParsed(parser.parse(generatedXml));

    if (stableStringify(original) === stableStringify(generated)) {
      return { outcome: 'format-diff', differences: ['XML formatting differs'] };
    }

    const originalUnordered = sortSiblingElements(original);
    const generatedUnordered = sortSiblingElements(generated);
    if (stableStringify(originalUnordered) === stableStringify(generatedUnordered)) {
      return {
        outcome: 'reordered',
        differences: describeOrderDifferences(original, generated),
      };
    }

    return {
      outcome: 'semantic-diff',
      differences: describeSemanticDifferences(original, generated),
    };
  } catch (error) {
    return {
      outcome: 'crashed',
      differences: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function normalizeParsed(value: unknown): unknown {
  if (Array.isArray(value)) {
    const hasElementChild = value.some(isElementNode);
    return value
      .filter(item => !(hasElementChild && isWhitespaceTextNode(item)))
      .map(normalizeParsed);
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = normalizeParsed((value as Record<string, unknown>)[key]);
    }
    return result;
  }

  return value;
}

function isElementNode(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>)
    .some(key => key !== '#text' && key !== ':@');
}

function isWhitespaceTextNode(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1
    && typeof record['#text'] === 'string'
    && /^\s*$/.test(record['#text']);
}

function sortSiblingElements(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(sortSiblingElements);
    if (!normalized.some(isElementNode)) return normalized;
    return [...normalized].sort((left, right) => {
      const leftKey = stableStringify(left);
      const rightKey = stableStringify(right);
      return leftKey.localeCompare(rightKey);
    });
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sortSiblingElements(child);
    }
    return result;
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function describeOrderDifferences(original: unknown, generated: unknown): string[] {
  const originalPaths = collectOrderedElementPaths(original);
  const generatedPaths = collectOrderedElementPaths(generated);
  const differences: string[] = [];
  const length = Math.max(originalPaths.length, generatedPaths.length);

  for (let index = 0; index < length && differences.length < 20; index++) {
    if (originalPaths[index] !== generatedPaths[index]) {
      differences.push(
        `order[${index}]: ${JSON.stringify(originalPaths[index] ?? '<missing>')} -> `
        + JSON.stringify(generatedPaths[index] ?? '<missing>')
      );
    }
  }

  return differences.length ? differences : ['Sibling element order differs'];
}

function collectOrderedElementPaths(value: unknown, path = ''): string[] {
  const paths: string[] = [];
  if (Array.isArray(value)) {
    for (const child of value) paths.push(...collectOrderedElementPaths(child, path));
    return paths;
  }
  if (!value || typeof value !== 'object') return paths;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === ':@' || key === '#text') continue;
    const childPath = `${path}/${key}`;
    paths.push(childPath);
    paths.push(...collectOrderedElementPaths(child, childPath));
  }
  return paths;
}

function describeSemanticDifferences(original: unknown, generated: unknown): string[] {
  const originalInventory = collectInventory(original);
  const generatedInventory = collectInventory(generated);
  const paths = [...new Set([...originalInventory.keys(), ...generatedInventory.keys()])].sort();
  const differences: string[] = [];

  for (const path of paths) {
    const left = originalInventory.get(path) ?? [];
    const right = generatedInventory.get(path) ?? [];
    if (multisetEqual(left, right)) continue;

    if (left.length !== right.length) {
      differences.push(`${path}: count ${left.length} -> ${right.length}`);
    } else {
      differences.push(`${path}: ${JSON.stringify(left[0])} -> ${JSON.stringify(right[0])}`);
    }
    if (differences.length === 20) break;
  }

  return differences.length ? differences : ['Parsed XML content differs'];
}

function collectInventory(value: unknown): Map<string, string[]> {
  const inventory = new Map<string, string[]>();

  const add = (path: string, item: unknown): void => {
    const values = inventory.get(path) ?? [];
    values.push(String(item));
    inventory.set(path, values);
  };

  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child, path);
      return;
    }
    if (!current || typeof current !== 'object') {
      add(path, current);
      return;
    }

    const record = current as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (key === '#text') {
        add(`${path}/#text`, child);
      } else if (key === ':@' && child && typeof child === 'object') {
        for (const [attribute, attributeValue] of Object.entries(child as Record<string, unknown>)) {
          add(`${path}/@${attribute}`, attributeValue);
        }
      } else {
        const childPath = `${path}/${key}`;
        add(`${childPath}/#element`, '<element>');
        visit(child, childPath);
      }
    }
  };

  visit(value, '');
  return inventory;
}

function multisetEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
