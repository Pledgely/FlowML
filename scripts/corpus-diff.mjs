import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  compareFlowXml,
  emitYaml,
  readFlowXml,
  readYaml,
  writeXml,
} from 'flowml';

const args = process.argv.slice(2);
let compact = false;
let jsonFile;
let corpusDirectory;

for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--compact') {
    compact = true;
  } else if (arg === '--json') {
    jsonFile = args[++index];
    if (!jsonFile) throw new Error('--json requires an output file');
  } else if (!corpusDirectory) {
    corpusDirectory = arg;
  } else {
    throw new Error(`Unexpected argument: ${arg}`);
  }
}

if (!corpusDirectory) {
  console.error('Usage: npm run corpus-diff -- <corpus-dir> [--compact] [--json <file>]');
  process.exit(2);
}

const root = resolve(corpusDirectory);
const files = findFlowFiles(root);
const outcomes = ['exact', 'format-diff', 'reordered', 'semantic-diff', 'crashed'];
const counts = Object.fromEntries(outcomes.map(outcome => [outcome, 0]));
const results = [];

for (const file of files) {
  const flowName = basename(file, '.flow-meta.xml');
  let result;
  try {
    const originalXml = readFileSync(file, 'utf8');
    const document = readFlowXml(originalXml, { compact, fallbackName: flowName });
    const yaml = emitYaml(document);
    const reparsed = readYaml(yaml, { validate: true });
    const generatedXml = writeXml(reparsed);
    result = compareFlowXml(originalXml, generatedXml);
  } catch (error) {
    result = {
      outcome: 'crashed',
      differences: [error instanceof Error ? error.message : String(error)],
    };
  }

  counts[result.outcome]++;
  results.push({ file, ...result });
  if (result.outcome !== 'exact') {
    console.log(`${result.outcome.padEnd(13)} ${file}`);
    for (const difference of result.differences.slice(0, 5)) {
      console.log(`  ${difference}`);
    }
  }
}

const summary = `Total ${files.length} | ${outcomes.map(outcome => `${outcome} ${counts[outcome]}`).join(' | ')}`;
console.log(summary);

if (jsonFile) {
  writeFileSync(resolve(jsonFile), `${JSON.stringify({
    root,
    compact,
    total: files.length,
    counts,
    results,
  }, null, 2)}\n`, 'utf8');
}

if (outcomes.some(outcome => outcome !== 'exact' && counts[outcome] > 0)) {
  process.exitCode = 1;
}

function findFlowFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFlowFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.flow-meta.xml')) {
      found.push(path);
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}
