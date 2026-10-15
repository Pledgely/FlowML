import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { basename, resolve } from 'path';
import { emitYaml, readFlowXml, readYaml, writeXml } from '../../src/index.js';

const REGRESSION_DIR = resolve(__dirname, '../regression');

describe('synthetic round-trip fidelity regressions', () => {
  const xmlFixtures = readdirSync(REGRESSION_DIR)
    .filter(file => file.endsWith('.flow-meta.xml'))
    .sort();

  it.each(xmlFixtures)('%s round-trips byte-identically', file => {
    const original = readFileSync(resolve(REGRESSION_DIR, file), 'utf-8');
    const flowName = basename(file, '.flow-meta.xml').replace(/[^A-Za-z0-9_]/g, '_');
    const document = readFlowXml(original, { fallbackName: flowName });
    const yaml = emitYaml(document);
    const reparsed = readYaml(yaml, { validate: true });

    expect(writeXml(reparsed)).toBe(original);
  });

  it('keeps legacy string-valued inputXmlTags compatible', () => {
    const yaml = readFileSync(
      resolve(REGRESSION_DIR, 'legacy-input-xml-tags.flowml'),
      'utf-8'
    );
    const document = readYaml(yaml, { validate: true });

    expect(writeXml(document)).toContain(
      '<elementReference>Bare_Record_Id</elementReference>'
    );
  });
});
