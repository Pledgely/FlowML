import assert from 'node:assert/strict';
import { compareFlowXml } from 'flowml';

const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
const wrap = body => `${declaration}\n<Flow>${body}</Flow>\n`;

const cases = [
  {
    name: 'leaf trailing whitespace',
    original: wrap('\n    <value>text </value>\n'),
    generated: wrap('\n    <value>text</value>\n'),
    outcome: 'semantic-diff',
  },
  {
    name: 'reordered siblings',
    original: wrap('\n    <alpha>1</alpha>\n    <beta>2</beta>\n'),
    generated: wrap('\n    <beta>2</beta>\n    <alpha>1</alpha>\n'),
    outcome: 'reordered',
  },
  {
    name: 'changed value',
    original: wrap('\n    <value>one</value>\n'),
    generated: wrap('\n    <value>two</value>\n'),
    outcome: 'semantic-diff',
  },
  {
    name: 'dropped element',
    original: wrap('\n    <alpha>1</alpha>\n    <beta>2</beta>\n'),
    generated: wrap('\n    <alpha>1</alpha>\n'),
    outcome: 'semantic-diff',
  },
  {
    name: 'changed attribute',
    original: wrap('\n    <value kind="one">text</value>\n'),
    generated: wrap('\n    <value kind="two">text</value>\n'),
    outcome: 'semantic-diff',
  },
  {
    name: 'indentation only',
    original: wrap('\n    <alpha>1</alpha>\n'),
    generated: wrap('\n  <alpha>1</alpha>\n'),
    outcome: 'format-diff',
  },
  {
    name: 'reordering outranks indentation',
    original: wrap('\n    <alpha>1</alpha>\n    <beta>2</beta>\n'),
    generated: wrap('\n  <beta>2</beta>\n  <alpha>1</alpha>\n'),
    outcome: 'reordered',
  },
  {
    name: 'CRLF and LF',
    original: wrap('\n    <alpha>1</alpha>\n').replace(/\n/g, '\r\n'),
    generated: wrap('\n    <alpha>1</alpha>\n'),
    outcome: 'exact',
  },
];

for (const testCase of cases) {
  const result = compareFlowXml(testCase.original, testCase.generated);
  assert.equal(result.outcome, testCase.outcome, `${testCase.name}: ${result.differences.join('; ')}`);
}

console.log(`Comparator self-test passed (${cases.length} cases).`);
