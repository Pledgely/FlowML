// ============================================================
// flowml roundtrip — Test round-trip fidelity: XML -> FlowML -> XML
// ============================================================

import { Command } from 'commander';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  readFlowXml,
  emitYaml,
  readYaml,
  writeXml,
  compareFlowXml,
  type FlowXmlDiffOutcome,
} from 'flowml';
import { findSfProject, getDefaultFlowsPath } from '../sfProject.js';
import { resolveFlowName } from '../flowNameArg.js';

export const roundtripCommand = new Command('roundtrip')
  .description('Verify newline-equivalent XML -> FlowML -> XML fidelity with a structural comparator')
  .argument('[file]', 'Optional .flow-meta.xml file path or bare flow name (shorthand for --flow)')
  .option('--flow <name>', 'Test a single flow')
  .option('--package <name>', 'Restrict to a specific package directory')
  .option('--source <path>', 'Source flows directory')
  .option('--compact', 'Exercise documented lossy compact mode; structural differences still fail the check')
  .action(async (file: string | undefined, options) => {
    try {
      const resolvedFlow = resolveFlowName(file, options.flow);
      const sfProject = findSfProject();
      const sourceDirs = getSourceDirs(sfProject, options);

      let totalTested = 0;
      let totalPassed = 0;
      let totalFailed = 0;

      for (const { flowsPath } of sourceDirs) {
        if (!existsSync(flowsPath)) continue;

        const files = readdirSync(flowsPath)
          .filter(f => f.endsWith('.flow-meta.xml'));

        for (const xmlFile of files) {
          const flowName = xmlFile.replace('.flow-meta.xml', '');
          if (resolvedFlow && flowName !== resolvedFlow) continue;

          totalTested++;
          const filePath = resolve(flowsPath, xmlFile);

          try {
            const originalXml = readFileSync(filePath, 'utf-8');

            // XML -> FlowML doc -> YAML -> FlowML doc -> XML
            const doc1 = readFlowXml(originalXml, {
              compact: options.compact,
              fallbackName: flowName,
            });
            const yamlStr = emitYaml(doc1);
            const doc2 = readYaml(yamlStr, { validate: true });
            const generatedXml = writeXml(doc2);
            const comparison = compareFlowXml(originalXml, generatedXml);
            const mapped = mapRoundtripOutcome(comparison.outcome);
            const detail = comparison.differences.slice(0, 3).join('; ');

            if (mapped === 'OK') {
              console.log(`  OK  ${flowName} - newline-equivalent`);
              totalPassed++;
            } else if (mapped === 'DIFF') {
              console.log(
                `  DIFF ${flowName} [${comparison.outcome}]${detail ? ` - ${detail}` : ''}`
              );
              totalFailed++;
            } else {
              console.error(`  ERR ${flowName}${detail ? ` - ${detail}` : ''}`);
              totalFailed++;
            }
          } catch (err: any) {
            console.error(`  ERR ${flowName} - ${err.message}`);
            totalFailed++;
          }
        }
      }

      if (totalTested === 0) {
        // Reporting "0 passed, 0 failed" with a zero exit reads as a clean run.
        if (resolvedFlow) {
          console.error(`Flow XML not found: ${resolvedFlow}`);
          process.exit(1);
        }
        console.error('No flows found to test.');
        process.exit(1);
      }

      console.log(`\nRound-trip tested ${totalTested} flow${totalTested !== 1 ? 's' : ''}: ${totalPassed} passed, ${totalFailed} failed`);

      if (totalFailed > 0) process.exit(1);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

function mapRoundtripOutcome(outcome: FlowXmlDiffOutcome): 'OK' | 'DIFF' | 'ERR' {
  switch (outcome) {
    case 'exact':
      return 'OK';
    case 'format-diff':
    case 'reordered':
    case 'semantic-diff':
      return 'DIFF';
    case 'crashed':
      return 'ERR';
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled round-trip outcome: ${exhaustive}`);
    }
  }
}

function getSourceDirs(sfProject: any, options: any) {
  if (options.source) {
    return [{ flowsPath: resolve(options.source), name: undefined }];
  }

  if (sfProject) {
    let dirs = sfProject.packageDirectories;
    if (options.package) {
      dirs = dirs.filter((d: any) => d.path === options.package || d.name === options.package);
      if (dirs.length === 0) {
        throw new Error(`Package "${options.package}" not found in sfdx-project.json`);
      }
    }
    return dirs;
  }

  return [{ flowsPath: getDefaultFlowsPath(), name: undefined }];
}
