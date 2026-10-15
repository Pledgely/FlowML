// ============================================================
// flowml lint — Schema validation + best-practice scoring
// ============================================================

import { Command } from 'commander';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, extname, basename } from 'path';
import { readYaml, readFlowXml, lintFlow, type ScoreReport, type CategoryScore } from 'flowml';
import { findSfProject, getDefaultFlowsPath } from '../sfProject.js';

export const lintCommand = new Command('lint')
  .description('Lint FlowML files: schema validation + best-practice scoring (110 points)')
  .argument('[file]', 'A .flowml/.flow-meta.xml path or bare flow name to lint')
  .option('--source <path>', 'Directory to lint, or FlowML search root for a bare flow name')
  .option('--format <type>', 'Output format: text or json (default: text)', 'text')
  .option('--threshold <score>', 'Fail if score is below this value', '0')
  .option('--check', 'Chain a dry-run deploy after lint (requires sf CLI + org)')
  .option('--target-org <org>', 'Salesforce org alias (used with --check)')
  .action(async (file: string | undefined, options) => {
    try {
      const threshold = parseInt(options.threshold, 10) || 0;

      if (file) {
        const locatedFile = locateLintTarget(file, options.source);
        const exitCode = await lintSingleFile(locatedFile, options.format, threshold);
        if (exitCode !== 0) process.exit(exitCode);

        // Chain into check if requested
        if (options.check) {
          await runCheck(file, options.targetOrg);
        }
      } else if (options.source) {
        await lintDirectory(options.source, options.format, threshold);
      } else {
        // Default: lint flowml/ directory
        const defaultDir = resolve(process.cwd(), 'flowml');
        if (existsSync(defaultDir)) {
          await lintDirectory(defaultDir, options.format, threshold);
        } else {
          console.error('Usage: flowml lint <file> or flowml lint --source <dir>');
          process.exit(1);
        }
      }
    } catch (err: unknown) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

async function lintSingleFile(filePath: string, format: string, threshold: number): Promise<number> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    return 1;
  }

  const content = readFileSync(absPath, 'utf-8');
  const ext = extname(absPath);

  let doc;
  try {
    if (ext === '.xml' || absPath.endsWith('.flow-meta.xml')) {
      doc = readFlowXml(content, {
        fallbackName: basename(absPath, '.flow-meta.xml'),
      });
    } else {
      // .flowml or .yaml — validate schema first
      doc = readYaml(content, { validate: true });
    }
  } catch (err: unknown) {
    console.error(`Schema error in ${filePath}: ${(err as Error).message}`);
    return 1;
  }

  const report = lintFlow(doc);

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  // A critical finding is a flow that will not deploy — fail regardless of score.
  if (report.criticalCount > 0) {
    console.error(`\n${report.criticalCount} critical issue(s) found — the flow will not deploy cleanly.`);
    return 1;
  }

  if (threshold > 0 && report.totalScore < threshold) {
    console.error(`\nScore ${report.totalScore} is below threshold ${threshold}`);
    return 1;
  }
  return 0;
}

function locateLintTarget(raw: string, source?: string): string {
  const isBareName = !raw.includes('/') && !raw.includes('\\') && extname(raw) === '';
  if (!isBareName) return raw;

  const flowmlRoot = resolve(source || resolve(process.cwd(), 'flowml'));
  const flowmlMatches = collectFlowmlFiles(flowmlRoot)
    .filter(item => item.flowName === raw)
    .map(item => item.filePath);
  if (flowmlMatches.length > 0) return requireUniqueLintMatch(raw, flowmlMatches);

  const sfProject = findSfProject();
  const flowDirs = sfProject
    ? sfProject.packageDirectories.map(item => item.flowsPath)
    : [getDefaultFlowsPath()];
  const xmlMatches = flowDirs
    .map(dir => resolve(dir, `${raw}.flow-meta.xml`))
    .filter(existsSync);
  if (xmlMatches.length > 0) return requireUniqueLintMatch(raw, xmlMatches);

  throw new Error(
    `Flow "${raw}" not found as ${raw}.flowml in ${flowmlRoot} `
    + `or as ${raw}.flow-meta.xml in the package flow directories.`
  );
}

function requireUniqueLintMatch(flowName: string, matches: string[]): string {
  if (matches.length === 1) return matches[0];
  throw new Error(
    `Multiple files match flow "${flowName}". Pass an explicit path:\n`
    + matches.map(match => `  ${match}`).join('\n')
  );
}

async function lintDirectory(dirPath: string, format: string, threshold: number): Promise<void> {
  const absDir = resolve(dirPath);
  if (!existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }

  const files = collectFlowmlFiles(absDir);
  if (files.length === 0) {
    console.error(`No .flowml files found in ${absDir}`);
    process.exit(1);
  }

  let failures = 0;
  const reports: Array<{ name: string; report: ScoreReport }> = [];

  for (const { filePath, flowName } of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const doc = readYaml(content, { validate: true });
      const report = lintFlow(doc);
      reports.push({ name: flowName, report });

      if (report.criticalCount > 0 || (threshold > 0 && report.totalScore < threshold)) {
        failures++;
      }
    } catch (err: unknown) {
      console.error(`  ERR ${flowName}: ${(err as Error).message}`);
      failures++;
    }
  }

  if (format === 'json') {
    console.log(JSON.stringify(reports.map(r => r.report), null, 2));
  } else {
    for (const { name, report } of reports) {
      const icon = report.criticalCount > 0 ? 'ERR'
        : report.percentage >= 80 ? 'OK '
          : report.percentage >= 55 ? 'WRN' : 'ERR';
      const criticals = report.criticalCount > 0 ? ` [${report.criticalCount} critical]` : '';
      console.log(`  ${icon} ${name} — ${report.totalScore}/${report.maxScore} (${report.percentage}%) ${report.rating}${criticals}`);
    }

    const total = reports.reduce((sum, r) => sum + r.report.totalScore, 0);
    const maxTotal = reports.reduce((sum, r) => sum + r.report.maxScore, 0);
    console.log(`\nLinted ${reports.length} file(s): ${total}/${maxTotal} total`);
  }

  if (failures > 0) process.exit(1);
}

async function runCheck(file: string, targetOrg?: string): Promise<void> {
  console.log('\nRunning dry-run deploy check...');
  try {
    const { checkCommand } = await import('./check.js');
    // Invoke check command programmatically
    const args = ['--flow', file.replace(/\.flowml$/, '').replace(/\.flow-meta\.xml$/, '')];
    if (targetOrg) args.push('--target-org', targetOrg);
    await checkCommand.parseAsync(args, { from: 'user' });
  } catch {
    console.error('Failed to run check — ensure sf CLI is installed and an org is configured');
    process.exit(1);
  }
}

function collectFlowmlFiles(dir: string): Array<{ filePath: string; flowName: string }> {
  const results: Array<{ filePath: string; flowName: string }> = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.flowml')) {
      results.push({
        filePath: resolve(dir, entry.name),
        flowName: entry.name.replace('.flowml', ''),
      });
    } else if (entry.isDirectory()) {
      results.push(...collectFlowmlFiles(resolve(dir, entry.name)));
    }
  }
  return results;
}

// ============================================================
// Text Report Formatter
// ============================================================

function formatTextReport(report: ScoreReport): string {
  const lines: string[] = [];
  const W = 60;
  const bar = '='.repeat(W);
  const thin = '-'.repeat(W);

  lines.push('');
  lines.push(bar);
  lines.push(`  Flow Lint Report: ${report.flowName} (API ${report.apiVersion})`);
  lines.push(bar);
  lines.push('');

  for (const cat of report.categories) {
    const pct = cat.maxPoints > 0 ? Math.round((cat.score / cat.maxPoints) * 100) : 100;
    const icon = pct === 100 ? 'OK' : pct >= 70 ? '!!' : 'XX';
    lines.push(`  ${icon} ${cat.label}: ${cat.score}/${cat.maxPoints} (${pct}%)`);

    for (const r of cat.results) {
      if (r.deduction === 0 && r.severity === 'info') continue; // skip advisory-only with 0 deduction
      const prefix = r.severity === 'critical' ? '  !! ' : '     ';
      lines.push(`${prefix}${r.message}`);
    }
  }

  lines.push('');
  lines.push(thin);

  // A critical finding means the flow is broken, however high the score is —
  // never approve on percentage alone.
  const deployMsg = report.criticalCount > 0
    ? `DEPLOYMENT BLOCKED — ${report.criticalCount} critical issue(s) must be fixed`
    : report.percentage >= 80
      ? 'DEPLOYMENT APPROVED'
      : report.percentage >= 55
        ? 'REVIEW RECOMMENDED before deployment'
        : 'DEPLOYMENT BLOCKED — fix critical issues';

  lines.push(`  Score: ${report.totalScore}/${report.maxScore} (${report.percentage}%) — ${report.rating}`);
  lines.push(`  ${deployMsg}`);
  lines.push(bar);
  lines.push('');

  return lines.join('\n');
}
