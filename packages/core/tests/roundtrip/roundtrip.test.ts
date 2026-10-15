import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { XMLParser } from 'fast-xml-parser';
import { readFlowXml } from '../../src/reader/xmlReader.js';
import { emitYaml } from '../../src/emitter/yamlEmitter.js';
import { readYaml } from '../../src/reader/yamlReader.js';
import { writeXml } from '../../src/writer/xmlWriter.js';
import type { FlowMLDocument, FlowStep } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
});

describe('phase 9 whitespace preservation', () => {
  function pipeline(xml: string): string {
    const doc = readFlowXml(xml, { fallbackName: 'Whitespace_Fidelity' });
    return writeXml(readYaml(emitYaml(doc), { validate: true }));
  }

  it('round-trips a stringValue with significant trailing whitespace byte-identically', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <constants>
        <name>Separator</name>
        <dataType>String</dataType>
        <value>
            <stringValue>, </stringValue>
        </value>
    </constants>
    <fullName>Whitespace_Fidelity</fullName>
    <label>Whitespace Fidelity</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Draft</status>
</Flow>
`;
    expect(pipeline(xml)).toBe(xml);
  });

  it('round-trips fieldText with significant trailing whitespace byte-identically', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <fullName>Whitespace_Fidelity</fullName>
    <label>Whitespace Fidelity</label>
    <processType>Flow</processType>
    <screens>
        <name>Screen_One</name>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <fields>
            <name>Instructions</name>
            <fieldText>Keep this space </fieldText>
            <fieldType>DisplayText</fieldType>
        </fields>
    </screens>
    <status>Draft</status>
</Flow>
`;
    expect(pipeline(xml)).toBe(xml);
  });
});

/**
 * Full round-trip: XML -> FlowML doc -> YAML -> FlowML doc -> XML -> FlowML doc
 * Returns original and final doc for comparison.
 */
function fullRoundTrip(fixtureName: string): {
  originalDoc: FlowMLDocument;
  restoredDoc: FlowMLDocument;
  yamlStr: string;
  generatedXml: string;
} {
  const xml = loadFixture(fixtureName);
  const originalDoc = readFlowXml(xml);
  const yamlStr = emitYaml(originalDoc);
  const yamlDoc = readYaml(yamlStr, { validate: false });
  const generatedXml = writeXml(yamlDoc);
  const restoredDoc = readFlowXml(generatedXml);
  return { originalDoc, restoredDoc, yamlStr, generatedXml };
}

// ============================================================
// Round-trip fidelity tests for each fixture
// ============================================================

const fixtures = [
  { name: 'simple-record-triggered.xml', label: 'simple record-triggered' },
  { name: 'loop-with-dml.xml', label: 'loop with DML' },
  { name: 'action-subflow.xml', label: 'action and subflow' },
  { name: 'scheduled-flow.xml', label: 'scheduled flow' },
  { name: 'record-update-modes.xml', label: 'record update modes' },
  { name: 'simple-screen-flow.xml', label: 'simple screen flow' },
];

describe('round-trip fidelity', () => {
  // ============================================================
  // Synthetic fixtures
  // ============================================================

  for (const fixture of fixtures) {
    describe(fixture.label, () => {
      const { originalDoc, restoredDoc, generatedXml } = fullRoundTrip(fixture.name);

      it('preserves flow name', () => {
        expect(restoredDoc.flow.name).toBe(originalDoc.flow.name);
      });

      it('preserves flow label', () => {
        expect(restoredDoc.flow.label).toBe(originalDoc.flow.label);
      });

      it('preserves processType', () => {
        expect(restoredDoc.flow.processType).toBe(originalDoc.flow.processType);
      });

      it('preserves apiVersion', () => {
        expect(restoredDoc.flow.apiVersion).toBe(originalDoc.flow.apiVersion);
      });

      it('preserves status', () => {
        expect(restoredDoc.flow.status).toBe(originalDoc.flow.status);
      });

      it('preserves step count', () => {
        expect(restoredDoc.steps.length).toBe(originalDoc.steps.length);
      });

      it('preserves variable count', () => {
        const origCount = originalDoc.variables ? Object.keys(originalDoc.variables).length : 0;
        const restoredCount = restoredDoc.variables ? Object.keys(restoredDoc.variables).length : 0;
        expect(restoredCount).toBe(origCount);
      });

      it('preserves trigger/start', () => {
        if (originalDoc.trigger) {
          expect(restoredDoc.trigger).toBeDefined();
          expect(restoredDoc.trigger!.type).toBe(originalDoc.trigger.type);
          expect(restoredDoc.trigger!.object).toBe(originalDoc.trigger.object);
        }
        if (originalDoc.start) {
          expect(restoredDoc.start).toBeDefined();
          expect(restoredDoc.start!.next).toBe(originalDoc.start.next);
        }
      });

      it('generates valid XML', () => {
        expect(generatedXml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(generatedXml).toContain('<Flow xmlns=');
        expect(generatedXml).toContain('</Flow>');
      });
    });
  }

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('handles empty flow with only start', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <label>Empty Flow</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </start>
    <status>Draft</status>
</Flow>`;

      const doc = readFlowXml(xml);
      const yamlStr = emitYaml(doc);
      const yamlDoc = readYaml(yamlStr, { validate: false });
      const genXml = writeXml(yamlDoc);
      const reparsed = readFlowXml(genXml);

      expect(reparsed.flow.label).toBe('Empty Flow');
      expect(reparsed.steps.length).toBe(0);
    });

    it('handles flow with only one step', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <assignments>
        <name>Only_Step</name>
        <label>Only Step</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <assignmentItems>
            <assignToReference>varTest</assignToReference>
            <operator>Assign</operator>
            <value><stringValue>hello</stringValue></value>
        </assignmentItems>
    </assignments>
    <label>Single Step Flow</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Only_Step</targetReference>
        </connector>
    </start>
    <status>Draft</status>
</Flow>`;

      const doc = readFlowXml(xml);
      expect(doc.steps.length).toBe(1);

      const yamlStr = emitYaml(doc);
      const yamlDoc = readYaml(yamlStr, { validate: false });
      const genXml = writeXml(yamlDoc);
      const reparsed = readFlowXml(genXml);

      expect(reparsed.steps.length).toBe(1);
    });

    it('handles special characters in strings', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <description>Flow with &lt;special&gt; &amp; &quot;characters&quot;</description>
    <label>Special &amp; Characters</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </start>
    <status>Draft</status>
</Flow>`;

      const doc = readFlowXml(xml);
      expect(doc.flow.description).toContain('<special>');
      expect(doc.flow.description).toContain('&');

      const yamlStr = emitYaml(doc);
      const yamlDoc = readYaml(yamlStr, { validate: false });
      const genXml = writeXml(yamlDoc);

      // The generated XML should have proper escaping
      expect(genXml).toContain('&amp;');
      expect(genXml).toContain('&lt;special&gt;');
    });
  });

  // ============================================================
  // Deep document comparison: originalDoc must equal restoredDoc
  // This catches data silently lost on the first pass that
  // idempotency tests would miss.
  // ============================================================

  describe('deep document fidelity (originalDoc vs restoredDoc)', () => {
    const allFixtureNames = fixtures.map(f => f.name);

    for (const fixtureName of allFixtureNames) {
      const label = fixtureName.replace('.flow-meta.xml', '').replace('.xml', '');

      describe(label, () => {
        const { originalDoc, restoredDoc } = fullRoundTrip(fixtureName);

        it('preserves flow header completely', () => {
          expect(restoredDoc.flow).toEqual(originalDoc.flow);
        });

        it('preserves trigger/start completely', () => {
          expect(restoredDoc.trigger).toEqual(originalDoc.trigger);
          expect(restoredDoc.start).toEqual(originalDoc.start);
        });

        it('preserves all variables', () => {
          expect(restoredDoc.variables).toEqual(originalDoc.variables);
        });

        it('preserves all formulas', () => {
          expect(restoredDoc.formulas).toEqual(originalDoc.formulas);
        });

        it('preserves all text templates', () => {
          expect(restoredDoc.textTemplates).toEqual(originalDoc.textTemplates);
        });

        it('preserves all constants', () => {
          expect(restoredDoc.constants).toEqual(originalDoc.constants);
        });

        it('preserves all choice sets', () => {
          expect(restoredDoc.choiceSets).toEqual(originalDoc.choiceSets);
        });

        it('preserves all choices', () => {
          expect(restoredDoc.choices).toEqual(originalDoc.choices);
        });

        it('preserves every step completely', () => {
          expect(restoredDoc.steps.length).toBe(originalDoc.steps.length);
          for (let i = 0; i < originalDoc.steps.length; i++) {
            expect(restoredDoc.steps[i]).toEqual(originalDoc.steps[i]);
          }
        });
      });
    }
  });

  // ============================================================
  // XML idempotency: second round-trip XML must equal first
  // XML -> YAML -> XML(1) -> YAML -> XML(2) : XML(1) === XML(2)
  // ============================================================

  describe('XML idempotency (stable after first normalization)', () => {
    const allFixtures = fixtures.map(f => f.name);

    for (const fixtureName of allFixtures) {
      const label = fixtureName.replace('.flow-meta.xml', '').replace('.xml', '');

      it(`${label}: second round-trip XML is identical to first`, () => {
        const xml = loadFixture(fixtureName);

        // First pass: XML -> YAML -> XML
        const doc1 = readFlowXml(xml);
        const yaml1 = emitYaml(doc1);
        const yamlDoc1 = readYaml(yaml1, { validate: false });
        const xml1 = writeXml(yamlDoc1);

        // Second pass: XML(1) -> YAML -> XML
        const doc2 = readFlowXml(xml1);
        const yaml2 = emitYaml(doc2);
        const yamlDoc2 = readYaml(yaml2, { validate: false });
        const xml2 = writeXml(yamlDoc2);

        // XML(1) and XML(2) must be identical
        expect(xml2).toBe(xml1);
      });
    }
  });

  // ============================================================
  // YAML idempotency: second round-trip YAML must equal first
  // XML -> YAML(1) -> XML -> YAML(2) : YAML(1) === YAML(2)
  // ============================================================

  describe('YAML idempotency (stable after first normalization)', () => {
    const allFixtures = fixtures.map(f => f.name);

    for (const fixtureName of allFixtures) {
      const label = fixtureName.replace('.flow-meta.xml', '').replace('.xml', '');

      it(`${label}: second round-trip YAML is identical to first`, () => {
        const xml = loadFixture(fixtureName);

        // First pass: XML -> YAML
        const doc1 = readFlowXml(xml);
        const yaml1 = emitYaml(doc1);

        // Round-trip: YAML -> XML -> YAML
        const yamlDoc1 = readYaml(yaml1, { validate: false });
        const xml1 = writeXml(yamlDoc1);
        const doc2 = readFlowXml(xml1);
        const yaml2 = emitYaml(doc2);

        // YAML(1) and YAML(2) must be identical
        expect(yaml2).toBe(yaml1);
      });
    }
  });

  // ============================================================
  // XML semantic comparison: original XML vs generated XML
  // Parses both XMLs and compares key elements field-by-field.
  // Known normalization differences (locationX/Y, element order,
  // processMetadataValues) are stripped before comparison.
  // ============================================================

  describe('XML semantic fidelity (original vs generated)', () => {
    const ELEMENT_TAGS = [
      'decisions', 'assignments', 'recordLookups', 'recordCreates',
      'recordUpdates', 'recordDeletes', 'loops', 'collectionProcessors',
      'actionCalls', 'subflows', 'screens',
    ] as const;

    const DECLARATION_TAGS = [
      'variables', 'formulas', 'textTemplates', 'constants',
      'dynamicChoiceSets', 'recordChoiceSets',
    ] as const;

    function stripNormalized(obj: Record<string, unknown>): Record<string, unknown> {
      const clone = { ...obj };
      // Strips fields that are absent in compact mode but present in default mode
      // (used for cross-mode XML comparisons). The default-mode round-trip preserves
      // both, so this strip is overly tolerant in default mode but keeps the helper
      // usable from any caller.
      delete clone.locationX;
      delete clone.locationY;
      delete clone.processMetadataValues;
      return clone;
    }

    function ensureArray(val: unknown): Record<string, unknown>[] {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      return [val as Record<string, unknown>];
    }

    function getByName(elements: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
      const map = new Map<string, Record<string, unknown>>();
      for (const el of elements) {
        const name = el.name as string;
        if (name) map.set(name, stripNormalized(el));
      }
      return map;
    }

    const allFixtureNames = fixtures.map(f => f.name);

    for (const fixtureName of allFixtureNames) {
      const label = fixtureName.replace('.flow-meta.xml', '').replace('.xml', '');

      describe(label, () => {
        const originalXml = loadFixture(fixtureName);
        const doc = readFlowXml(originalXml);
        const yaml = emitYaml(doc);
        const yamlDoc = readYaml(yaml, { validate: false });
        const generatedXml = writeXml(yamlDoc);
        const origParsed = xmlParser.parse(originalXml).Flow;
        const genParsed = xmlParser.parse(generatedXml).Flow;

        it('preserves all element counts by tag', () => {
          for (const tag of ELEMENT_TAGS) {
            const origCount = ensureArray(origParsed[tag]).length;
            const genCount = ensureArray(genParsed[tag]).length;
            expect(genCount, `${tag} count mismatch`).toBe(origCount);
          }
        });

        it('preserves all declaration counts by tag', () => {
          for (const tag of DECLARATION_TAGS) {
            const origCount = ensureArray(origParsed[tag]).length;
            const genCount = ensureArray(genParsed[tag]).length;
            expect(genCount, `${tag} count mismatch`).toBe(origCount);
          }
        });

        for (const tag of ELEMENT_TAGS) {
          const origElements = ensureArray(origParsed[tag]);
          if (origElements.length === 0) continue;

          it(`preserves ${tag} elements by name and content`, () => {
            const genElements = ensureArray(genParsed[tag]);
            const origByName = getByName(origElements);
            const genByName = getByName(genElements);

            for (const [name, origEl] of origByName) {
              const genEl = genByName.get(name);
              expect(genEl, `missing ${tag} element: ${name}`).toBeDefined();

              // Compare all non-connector scalar properties
              for (const key of Object.keys(origEl)) {
                if (['connector', 'faultConnector', 'defaultConnector',
                     'noMoreValuesConnector', 'nextValueConnector'].includes(key)) continue;
                const origVal = origEl[key];
                const genVal = genEl![key];

                if (typeof origVal === 'string' || typeof origVal === 'number' || typeof origVal === 'boolean') {
                  expect(genVal, `${tag}[${name}].${key}`).toBe(origVal);
                }
              }
            }
          });
        }
      });
    }
  });

  // ============================================================
  // Writer fallback when coordinates absent (compact-mode contract):
  // even with no coords on the input doc, writer emits 0 placeholders.
  // ============================================================

  describe('writer fallback when coordinates absent', () => {
    it('falls back to locationX/Y=0 when absent on doc', () => {
      const doc: FlowMLDocument = {
        flow: {
          name: 'NoCoordTest',
          label: 'NoCoordTest',
          processType: 'AutoLaunchedFlow',
          apiVersion: '65.0',
          status: 'Draft',
        },
        start: { next: 'A1' },
        steps: [
          { label: 'A1', assignment: 'A1', operations: ['varX = "hello"'] } as FlowStep,
        ],
      };

      const xml = writeXml(doc);
      expect(xml).toContain('<locationX>0</locationX>');
      expect(xml).toContain('<locationY>0</locationY>');
    });
  });
});
