import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { resolve } from 'path';

const CLI = resolve(__dirname, '../../../cli/bin/flowml.js');
const TMP = resolve(__dirname, '../tmp-positional-arg');
const SOURCE = resolve(TMP, 'source');

const FIXTURE_FLOW = 'Close_Stale_Cases';
const FIXTURE_XML_PATH = resolve(SOURCE, `${FIXTURE_FLOW}.flow-meta.xml`);
const SECOND_FLOW = 'Loop_With_DML';

function run(args: string[], cwd = TMP): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', cwd });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status ?? 1 };
  }
}

describe('positional [file] argument', () => {
  beforeAll(() => {
    // Seed a source dir with two synthetic flows so scoping and mass conversion have something to distinguish
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(SOURCE, { recursive: true });
    copyFileSync(resolve(__dirname, '../fixtures/scheduled-flow.xml'), FIXTURE_XML_PATH);
    copyFileSync(resolve(__dirname, '../fixtures/loop-with-dml.xml'), resolve(SOURCE, `${SECOND_FLOW}.flow-meta.xml`));
  });

  afterAll(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const sub of ['flowml-out', 'xml-out']) {
      const dir = resolve(TMP, sub);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('fromxml positional arg', () => {
    it('scopes conversion to a bare flow name', () => {
      const outDir = resolve(TMP, 'flowml-out');
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', outDir,
        FIXTURE_FLOW,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(resolve(outDir, `${FIXTURE_FLOW}.flowml`))).toBe(true);
      const produced = readdirSync(outDir);
      expect(produced).toEqual([`${FIXTURE_FLOW}.flowml`]);
    });

    it('scopes conversion to a .flow-meta.xml path', () => {
      const outDir = resolve(TMP, 'flowml-out');
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', outDir,
        FIXTURE_XML_PATH,
      ]);

      expect(result.exitCode).toBe(0);
      const produced = readdirSync(outDir);
      expect(produced).toEqual([`${FIXTURE_FLOW}.flowml`]);
    });
  });

  describe('toxml positional arg', () => {
    it('scopes conversion to a .flowml path', () => {
      const flowmlDir = resolve(TMP, 'flowml-out');
      const xmlDir = resolve(TMP, 'xml-out');

      // Seed by converting two flows to flowml
      run([
        'fromxml',
        '--source', SOURCE,
        '--output', flowmlDir,
        FIXTURE_FLOW,
      ]);
      run([
        'fromxml',
        '--source', SOURCE,
        '--output', flowmlDir,
        SECOND_FLOW,
      ]);
      expect(readdirSync(flowmlDir).length).toBe(2);

      // toxml with positional path should scope to one flow
      const result = run([
        'toxml',
        '--source', flowmlDir,
        '--output', xmlDir,
        resolve(flowmlDir, `${FIXTURE_FLOW}.flowml`),
      ]);

      expect(result.exitCode).toBe(0);
      expect(readdirSync(xmlDir)).toEqual([`${FIXTURE_FLOW}.flow-meta.xml`]);
    });
  });

  describe('validation', () => {
    it('rejects unsupported file extensions', () => {
      const result = run([
        'toxml',
        '--source', SOURCE,
        'oops.txt',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unsupported file');
    });

    it('rejects .yaml extension on fromxml', () => {
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', resolve(TMP, 'flowml-out'),
        'foo.yaml',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unsupported file');
    });
  });

  describe('positional vs --flow conflict policy', () => {
    it('accepts matching positional and --flow', () => {
      const outDir = resolve(TMP, 'flowml-out');
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', outDir,
        '--flow', FIXTURE_FLOW,
        `${FIXTURE_FLOW}.flow-meta.xml`,
      ]);

      expect(result.exitCode).toBe(0);
      expect(readdirSync(outDir)).toEqual([`${FIXTURE_FLOW}.flowml`]);
    });

    it('rejects mismatched positional and --flow', () => {
      const result = run([
        'toxml',
        '--source', SOURCE,
        '--flow', 'SomeOtherFlow',
        `${FIXTURE_FLOW}.flowml`,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Conflicting flow names');
    });
  });

  describe('check command positional arg', () => {
    it('accepts positional instead of --flow (no sf CLI)', () => {
      // This test just confirms check does NOT error with "--flow required" when
      // a positional is provided. It will still fail later because `sf` CLI is
      // not installed in the test sandbox, but that's a different error.
      const result = run([
        'check',
        '--source', SOURCE,
        `${FIXTURE_FLOW}.flowml`,
      ]);

      expect(result.exitCode).toBe(1);
      // Old required-option error would say "required option '--flow'".
      expect(result.stderr).not.toContain("required option '--flow'");
      expect(result.stderr).not.toContain('either a [file] positional or --flow is required');
    });

    it('errors when neither positional nor --flow is given', () => {
      const result = run([
        'check',
        '--source', SOURCE,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('either a [file] positional or --flow is required');
    });
  });

  describe('backward compatibility', () => {
    it('mass-converts when no positional and no --flow', () => {
      const outDir = resolve(TMP, 'flowml-out');
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', outDir,
      ]);

      expect(result.exitCode).toBe(0);
      const produced = readdirSync(outDir);
      // Expect more than one flow converted (the source dir holds two)
      expect(produced.length).toBeGreaterThan(1);
    });

    it('--flow alone still scopes to one flow', () => {
      const outDir = resolve(TMP, 'flowml-out');
      const result = run([
        'fromxml',
        '--source', SOURCE,
        '--output', outDir,
        '--flow', FIXTURE_FLOW,
      ]);

      expect(result.exitCode).toBe(0);
      expect(readdirSync(outDir)).toEqual([`${FIXTURE_FLOW}.flowml`]);
    });
  });
});
