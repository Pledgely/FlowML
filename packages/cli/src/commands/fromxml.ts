// ============================================================
// flowml fromxml — Convert Flow XML to FlowML YAML
// ============================================================

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, basename, relative } from 'path';
import { readFlowXml, emitYaml } from 'flowml';
import { findSfProject, getDefaultFlowsPath } from '../sfProject.js';
import { resolveFlowName } from '../flowNameArg.js';

export const fromxmlCommand = new Command('fromxml')
  .description('Convert Flow XML to FlowML YAML')
  .argument('[file]', 'Optional .flow-meta.xml file path or bare flow name (shorthand for --flow)')
  .option('--flow <name>', 'Convert a single flow by name')
  .option('--package <name>', 'Restrict to a specific package directory')
  .option('--source <path>', 'Source flows directory')
  .option('--output <path>', 'Output directory (default: flowml/)')
  .option('--name <outputName>', 'Custom output filename (without extension, requires --flow)')
  .option('--compact', 'Compact mode: strip canvas coordinates and filter boilerplate metadata to minimize token count (lossy round-trip)')
  .action(async (file: string | undefined, options) => {
    try {
      const resolvedFlow = resolveFlowName(file, options.flow);

      if (options.name && !resolvedFlow) {
        console.error('Error: --name requires --flow (or a [file] positional) to specify which flow to rename.');
        process.exit(1);
      }

      const sfProject = findSfProject();
      const outputBase = options.output || resolve(process.cwd(), 'flowml');

      // Determine source directories
      const sourceDirs = getSourceDirs(sfProject, options);

      if (!existsSync(outputBase)) {
        mkdirSync(outputBase, { recursive: true });
      }

      let totalConverted = 0;
      let totalErrors = 0;

      for (const { flowsPath, name: pkgName } of sourceDirs) {
        if (!existsSync(flowsPath)) continue;

        // Determine output directory (flat or per-package)
        const outDir = sourceDirs.length > 1 && pkgName
          ? resolve(outputBase, pkgName)
          : outputBase;

        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }

        const files = readdirSync(flowsPath)
          .filter(f => f.endsWith('.flow-meta.xml'));

        for (const xmlFile of files) {
          const flowName = xmlFile.replace('.flow-meta.xml', '');

          if (resolvedFlow && flowName !== resolvedFlow) continue;

          const filePath = resolve(flowsPath, xmlFile);
          try {
            const xml = readFileSync(filePath, 'utf-8');
            const doc = readFlowXml(xml, { compact: options.compact, fallbackName: flowName });
            const yamlStr = emitYaml(doc);
            const outputName = options.name || flowName;
            const outFile = resolve(outDir, `${outputName}.flowml`);
            writeFileSync(outFile, yamlStr, 'utf-8');
            console.log(`  OK  ${outputName}.flowml`);
            totalConverted++;
          } catch (err: any) {
            console.error(`  ERR ${flowName}.flowml - ${err.message}`);
            totalErrors++;
          }
        }
      }

      if (totalConverted > 0 || totalErrors > 0) {
        const relOut = relative(process.cwd(), outputBase) || outputBase;
        console.log(`\nConverted ${totalConverted} flow${totalConverted !== 1 ? 's' : ''} (XML -> FlowML) to ${relOut}/`);
      } else {
        if (resolvedFlow) {
          console.error(`Flow XML not found: ${resolvedFlow}`);
          process.exit(1);
        }
        console.log('No flows found to convert.');
      }

      if (totalErrors > 0) {
        console.log(`${totalErrors} error${totalErrors !== 1 ? 's' : ''} encountered.`);
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

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
