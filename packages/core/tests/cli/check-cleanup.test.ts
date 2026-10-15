import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, resolve } from 'path';

// `flowml check` writes an Active temp flow into the user's project and dry-run deploys it with `sf`.
// These tests put a fake `sf` first on PATH so they never touch a real org.

const CLI = resolve(__dirname, '../../../cli/bin/flowml.js');
const TEMP_FLOW_FILE = '__flowml_check_temp.flow-meta.xml';
const FAIL_JSON = '{"status":1,"result":{"success":false,"details":{"componentFailures":[{"problem":"Simulated deploy failure"}]}}}';
const PASS_JSON = '{"status":0,"result":{"success":true}}';

const FLOWML = `flow:
  name: Sample_Flow
  label: Sample Flow
  processType: AutoLaunchedFlow
  apiVersion: "65.0"
  status: Draft
  hasEnvironments: false
  rawProcessMetadata: []
steps: []
`;

let root: string;
let project: string;
let fakeBin: string;

function writeFakeSf(): void {
  // Records whether the temp flow existed while "deploying", then prints a pass/fail result chosen by FAKE_SF_RESULT
  writeFileSync(resolve(fakeBin, 'sf.cmd'), [
    '@echo off',
    'if "%1"=="--version" exit /b 0',
    'echo %*> "%~dp0args.txt"',
    'if exist %7 echo present> "%~dp0seen.txt"',
    `if "%FAKE_SF_RESULT%"=="pass" (echo ${PASS_JSON}& exit /b 0)`,
    `echo ${FAIL_JSON}`,
    'exit /b 1',
    '',
  ].join('\r\n'));
  const sh = resolve(fakeBin, 'sf');
  writeFileSync(sh, [
    '#!/bin/sh',
    '[ "$1" = "--version" ] && exit 0',
    'dir=$(dirname "$0")',
    'echo "$@" > "$dir/args.txt"',
    '[ -f "$7" ] && echo present > "$dir/seen.txt"',
    `[ "$FAKE_SF_RESULT" = "pass" ] && echo '${PASS_JSON}' && exit 0`,
    `echo '${FAIL_JSON}'`,
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(sh, 0o755);
}

function run(args: string[], result: 'pass' | 'fail'): { stdout: string; stderr: string; exitCode: number } {
  // Windows env keys are case-insensitive and may arrive as both PATH and Path, so collapse them to one key
  const env: NodeJS.ProcessEnv = { ...process.env, FAKE_SF_RESULT: result };
  const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path');
  const path = pathKeys.map(key => env[key]).find(Boolean) ?? '';
  for (const key of pathKeys) delete env[key];
  env.PATH = `${fakeBin}${delimiter}${path}`;
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', cwd: project, env });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status ?? 1 };
  }
}

const flowsDir = () => resolve(project, 'force-app/main/default/flows');

describe('flowml check temp flow cleanup', () => {
  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), 'flowml-check-'));
    project = resolve(root, 'project');
    fakeBin = resolve(root, 'bin');
    mkdirSync(resolve(project, 'flowml'), { recursive: true });
    mkdirSync(fakeBin);
    writeFileSync(resolve(project, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    writeFileSync(resolve(project, 'flowml/Sample_Flow.flowml'), FLOWML);
    writeFakeSf();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('removes the temp flow when the dry-run deploy fails', () => {
    const result = run(['check', 'Sample_Flow'], 'fail');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Simulated deploy failure');
    expect(result.stderr).toContain('CHECK FAILED: Sample_Flow.flowml has errors.');
    expect(readFileSync(resolve(fakeBin, 'args.txt'), 'utf-8')).toContain(TEMP_FLOW_FILE);
    expect(existsSync(resolve(fakeBin, 'seen.txt'))).toBe(true);
    expect(readdirSync(flowsDir())).toEqual([]);
  });

  it('removes the temp flow when the dry-run deploy passes', () => {
    const result = run(['check', 'Sample_Flow'], 'pass');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CHECK PASSED: Sample_Flow.flowml is valid.');
    expect(existsSync(resolve(fakeBin, 'seen.txt'))).toBe(true);
    expect(readdirSync(flowsDir())).toEqual([]);
  });

  it('rejects a --target-org containing shell metacharacters before running sf', () => {
    const result = run(['check', 'Sample_Flow', '--target-org', 'dev & echo injected'], 'pass');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid --target-org');
    expect(existsSync(resolve(fakeBin, 'args.txt'))).toBe(false);
    expect(existsSync(flowsDir())).toBe(false);
  });

  it('passes a valid --target-org through to sf', () => {
    run(['check', 'Sample_Flow', '--target-org', 'dev.user+qa@example.com'], 'pass');

    expect(readFileSync(resolve(fakeBin, 'args.txt'), 'utf-8')).toContain('--target-org dev.user+qa@example.com');
  });
});
