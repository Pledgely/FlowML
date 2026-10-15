import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { resolve } from 'path';

const CLI = resolve(__dirname, '../../../cli/bin/flowml.js');
const TMP = resolve(__dirname, '../tmp-cli-honesty');

const EXACT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <label>Test Flow</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Draft</status>
</Flow>
`;

const FLOWML = `flow:
  name: Test_Flow
  label: Test Flow
  processType: AutoLaunchedFlow
  apiVersion: "65.0"
  status: Draft
  hasEnvironments: false
  rawProcessMetadata: []
steps: []
`;

function run(args: string[], cwd = TMP): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', cwd });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status ?? 1,
    };
  }
}

function seedFile(relativePath: string, content: string): string {
  const filePath = resolve(TMP, relativePath);
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('CLI fidelity and scope safeguards', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  describe('roundtrip structural outcomes', () => {
    it.each([
      ['exact', EXACT_XML, 'OK  Test_Flow - newline-equivalent', 0],
      [
        'format-diff',
        EXACT_XML.replace('    <label>', '  <label>'),
        'DIFF Test_Flow [format-diff]',
        1,
      ],
      [
        'reordered',
        EXACT_XML.replace(
          '    <apiVersion>65.0</apiVersion>\n    <label>Test Flow</label>',
          '    <label>Test Flow</label>\n    <apiVersion>65.0</apiVersion>'
        ),
        'DIFF Test_Flow [reordered]',
        1,
      ],
      [
        'semantic-diff',
        EXACT_XML.replace(
          '    <label>Test Flow</label>',
          '    <label>Test Flow</label>\n    <unknownProperty>lost</unknownProperty>'
        ),
        'DIFF Test_Flow [semantic-diff]',
        1,
      ],
    ])('maps %s to the printed outcome and exit code', (_name, xml, message, exitCode) => {
      const source = resolve(TMP, 'roundtrip');
      seedFile('roundtrip/Test_Flow.flow-meta.xml', xml);

      const result = run(['roundtrip', '--source', source, 'Test_Flow']);

      expect(result.exitCode).toBe(exitCode);
      expect(result.stdout).toContain(message);
    });

    it('prints ERR and exits nonzero when the pipeline crashes', () => {
      const source = resolve(TMP, 'roundtrip');
      seedFile('roundtrip/Test_Flow.flow-meta.xml', 'not xml');

      const result = run(['roundtrip', '--source', source, 'Test_Flow']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERR Test_Flow');
    });

    it('fails instead of reporting a clean run when the named flow is absent', () => {
      const source = resolve(TMP, 'roundtrip');
      seedFile('roundtrip/Test_Flow.flow-meta.xml', EXACT_XML);

      const result = run(['roundtrip', '--source', source, 'Missing_Flow']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Flow XML not found: Missing_Flow');
      expect(result.stdout).not.toContain('0 passed, 0 failed');
    });

    it('resolves a path argument to a flow name and fails when it is not in scope', () => {
      const source = resolve(TMP, 'roundtrip');
      seedFile('roundtrip/Test_Flow.flow-meta.xml', EXACT_XML);
      const outsidePath = seedFile('elsewhere/Other_Flow.flow-meta.xml', EXACT_XML);

      const result = run(['roundtrip', '--source', source, outsidePath]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Flow XML not found: Other_Flow');
      expect(result.stdout).not.toContain('0 passed, 0 failed');
    });

    it('fails when the source directory holds no flows at all', () => {
      mkdirSync(resolve(TMP, 'empty'), { recursive: true });

      const result = run(['roundtrip', '--source', resolve(TMP, 'empty')]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No flows found to test.');
      expect(result.stdout).not.toContain('0 passed, 0 failed');
    });
  });

  describe('check api-version validation', () => {
    it('rejects a malformed --api-version before attempting any deploy', () => {
      const result = run(['check', 'Test_Flow', '--api-version', '64.x']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('invalid --api-version "64.x"');
    });
  });

  describe('toxml write safety', () => {
    it('generates all inputs before writing any output', () => {
      seedFile('flowml/Test_Flow.flowml', FLOWML);
      seedFile('flowml/Z_Broken.flowml', 'flow: [not valid');
      const output = resolve(TMP, 'xml');

      const result = run(['toxml', '--source', resolve(TMP, 'flowml'), '--output', output]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No files written because generation failed');
      expect(existsSync(output)).toBe(false);
    });

    it('skips newline-equivalent files and reports an unchanged summary', () => {
      seedFile('flowml/Test_Flow.flowml', FLOWML);
      const output = resolve(TMP, 'xml');
      expect(run(['toxml', '--source', resolve(TMP, 'flowml'), '--output', output]).exitCode).toBe(0);
      const xmlPath = resolve(output, 'Test_Flow.flow-meta.xml');
      const crlf = readFileSync(xmlPath, 'utf-8').replace(/\n/g, '\r\n');
      writeFileSync(xmlPath, crlf, 'utf-8');

      const result = run(['toxml', '--source', resolve(TMP, 'flowml'), '--output', output]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0 created, 0 updated, 1 unchanged');
      expect(readFileSync(xmlPath, 'utf-8')).toBe(crlf);
    });

    it('dry-run reports updates without writing them', () => {
      seedFile('flowml/Test_Flow.flowml', FLOWML);
      const output = resolve(TMP, 'xml');
      seedFile('xml/Test_Flow.flow-meta.xml', EXACT_XML.replace('Test Flow', 'Old Label'));

      const result = run([
        'toxml',
        '--source', resolve(TMP, 'flowml'),
        '--output', output,
        '--dry-run',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dry run 1 flow: 0 created, 1 updated, 0 unchanged');
      expect(result.stdout).toContain('Updated flows: Test_Flow');
      expect(readFileSync(resolve(output, 'Test_Flow.flow-meta.xml'), 'utf-8')).toContain('Old Label');
    });
  });

  describe('explicit missing flow names', () => {
    it('fails fromxml when an explicitly named flow is absent', () => {
      mkdirSync(resolve(TMP, 'xml'), { recursive: true });
      const result = run([
        'fromxml',
        '--source', resolve(TMP, 'xml'),
        '--output', resolve(TMP, 'flowml'),
        'Missing',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Flow XML not found: Missing');
    });

    it('fails toxml when an explicitly named flow is absent', () => {
      mkdirSync(resolve(TMP, 'flowml'), { recursive: true });
      const result = run([
        'toxml',
        '--source', resolve(TMP, 'flowml'),
        '--output', resolve(TMP, 'xml'),
        'Missing',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('FlowML flow not found: Missing');
    });

    it('keeps an empty bulk conversion successful', () => {
      mkdirSync(resolve(TMP, 'flowml'), { recursive: true });
      const result = run([
        'toxml',
        '--source', resolve(TMP, 'flowml'),
        '--output', resolve(TMP, 'xml'),
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No FlowML files found');
    });
  });

  describe('lint target locator', () => {
    it('uses a nested explicit FlowML path unchanged', () => {
      const path = seedFile('nested/Test_Flow.flowml', FLOWML);
      expect(run(['lint', path]).exitCode).toBe(0);
    });

    it('uses an explicit Flow XML path and its filename-derived API name', () => {
      const path = seedFile('xml/Api_Name.flow-meta.xml', EXACT_XML);
      const result = run(['lint', path, '--format', 'json']);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      const ruleIds = report.categories.flatMap((category: any) =>
        category.results.map((item: any) => item.ruleId)
      );
      expect(ruleIds).not.toContain('flow-name-invalid-chars');
    });

    it('resolves a bare name in the default flowml directory', () => {
      seedFile('flowml/Test_Flow.flowml', FLOWML);
      expect(run(['lint', 'Test_Flow']).exitCode).toBe(0);
    });

    it('resolves a bare name in a package flows directory', () => {
      seedFile('sfdx-project.json', JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }],
        sourceApiVersion: '65.0',
      }));
      seedFile('force-app/main/default/flows/Test_Flow.flow-meta.xml', EXACT_XML);
      expect(run(['lint', 'Test_Flow']).exitCode).toBe(0);
    });

    it('fails clearly for a missing bare name', () => {
      const result = run(['lint', 'Missing']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Flow "Missing" not found');
    });

    it('lists duplicate package matches and requires an explicit path', () => {
      seedFile('sfdx-project.json', JSON.stringify({
        packageDirectories: [{ path: 'pkg-a' }, { path: 'pkg-b' }],
        sourceApiVersion: '65.0',
      }));
      seedFile('pkg-a/main/default/flows/Test_Flow.flow-meta.xml', EXACT_XML);
      seedFile('pkg-b/main/default/flows/Test_Flow.flow-meta.xml', EXACT_XML);

      const result = run(['lint', 'Test_Flow']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Multiple files match flow "Test_Flow"');
      expect(result.stderr).toContain('pkg-a');
      expect(result.stderr).toContain('pkg-b');
    });

    it('uses --source as the search root when a positional name is present', () => {
      seedFile('custom/Test_Flow.flowml', FLOWML);
      seedFile('custom/Unrelated.flowml', FLOWML.replace(/Test_Flow/g, 'Unrelated'));

      const found = run(['lint', 'Test_Flow', '--source', resolve(TMP, 'custom')]);
      const missing = run(['lint', 'Missing', '--source', resolve(TMP, 'custom')]);

      expect(found.exitCode).toBe(0);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain('Flow "Missing" not found');
    });

    it('never falls back from a nonexistent explicit path to a matching bare name', () => {
      seedFile('flowml/Test_Flow.flowml', FLOWML);
      const typo = resolve(TMP, 'missing', 'Test_Flow.flowml');

      const result = run(['lint', typo]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`File not found: ${typo}`);
    });
  });
});
