import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { resolve } from 'path';

const CLI = resolve(__dirname, '../../../cli/bin/flowml.js');
const TMP = resolve(__dirname, '../tmp-name-flag');
const SOURCE = resolve(TMP, 'source');
const FIXTURE_FLOW = 'Close_Stale_Cases';

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', cwd: TMP });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status ?? 1 };
  }
}

describe('--name flag', () => {
  beforeAll(() => {
    // Seed a source dir with a synthetic flow so the CLI has a real .flow-meta.xml to convert
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(SOURCE, { recursive: true });
    copyFileSync(resolve(__dirname, '../fixtures/scheduled-flow.xml'), resolve(SOURCE, `${FIXTURE_FLOW}.flow-meta.xml`));
  });

  afterAll(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  afterEach(() => {
    // Clean up generated files
    for (const sub of ['flowml-out', 'xml-out']) {
      const dir = resolve(TMP, sub);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('fromxml --name', () => {
    it('should rename the output .flowml file', () => {
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--flow', FIXTURE_FLOW,
        '--output', resolve(TMP, 'flowml-out'),
        '--name', 'MyCustomName',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MyCustomName.flowml');

      const outDir = resolve(TMP, 'flowml-out');
      expect(existsSync(resolve(outDir, 'MyCustomName.flowml'))).toBe(true);
      // Original name should NOT exist
      expect(existsSync(resolve(outDir, `${FIXTURE_FLOW}.flowml`))).toBe(false);
    });

    it('should error when --name is used without --flow', () => {
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', resolve(TMP, 'flowml-out'),
        '--name', 'SomeName',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--name requires --flow');
    });
  });

  describe('toxml --name', () => {
    it('should rename the output .flow-meta.xml file', () => {
      // First convert a flow to YAML
      const flowmlDir = resolve(TMP, 'flowml-out');
      run([
        'fromxml',
        '--source', SOURCE,
        '--flow', FIXTURE_FLOW,
        '--output', flowmlDir,
      ]);

      // Now convert back with a custom name
      const xmlDir = resolve(TMP, 'xml-out');
      const result = run([
        'toxml',
        '--source', flowmlDir,
        '--flow', FIXTURE_FLOW,
        '--output', xmlDir,
        '--name', 'RenamedFlow',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('RenamedFlow.flow-meta.xml');
      expect(existsSync(resolve(xmlDir, 'RenamedFlow.flow-meta.xml'))).toBe(true);
      expect(existsSync(resolve(xmlDir, `${FIXTURE_FLOW}.flow-meta.xml`))).toBe(false);
    });

    it('should error when --name is used without --flow', () => {
      const result = run([
        'toxml',
        '--source', SOURCE,
        '--output', resolve(TMP, 'xml-out'),
        '--name', 'SomeName',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--name requires --flow');
    });
  });

  describe('fromxml --name + toxml without --name', () => {
    it('should persist the renamed filename through round-trip', () => {
      const flowmlDir = resolve(TMP, 'flowml-out');
      const xmlDir = resolve(TMP, 'xml-out');

      // Convert XML to YAML with a custom name
      run([
        'fromxml',
        '--source', SOURCE,
        '--flow', FIXTURE_FLOW,
        '--output', flowmlDir,
        '--name', 'CustomFlow',
      ]);
      expect(existsSync(resolve(flowmlDir, 'CustomFlow.flowml'))).toBe(true);

      // Convert back without --name — should use the .flowml filename
      const result = run([
        'toxml',
        '--source', flowmlDir,
        '--flow', 'CustomFlow',
        '--output', xmlDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(resolve(xmlDir, 'CustomFlow.flow-meta.xml'))).toBe(true);
      // Original name should NOT appear
      const files = readdirSync(xmlDir);
      expect(files).toEqual(['CustomFlow.flow-meta.xml']);
    });
  });
});
