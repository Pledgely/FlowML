// ============================================================
// flowml toxml — Convert FlowML YAML back to Flow XML
// ============================================================

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { readYaml, writeXml, normalizeNewlines } from 'flowml';
import { findSfProject, getDefaultFlowsPath } from '../sfProject.js';
import { resolveFlowName } from '../flowNameArg.js';

export const toxmlCommand = new Command('toxml')
  .description('Convert FlowML YAML to Flow XML, skipping unchanged output files')
  .argument('[file]', 'Optional .flowml file path or bare flow name (shorthand for --flow)')
  .option('--flow <name>', 'Convert a single flow by name')
  .option('--package <name>', 'Restrict to a specific package directory')
  .option('--source <path>', 'FlowML directory (default: flowml/)')
  .option('--output <path>', 'XML output directory')
  .option('--name <outputName>', 'Custom output filename (without extension, requires --flow)')
  .option('--active', 'Force flow status to Active in the output XML')
  .option('--dry-run', 'Show created, updated, and unchanged outputs without writing files')
  .action(async (file: string | undefined, options) => {
    try {
      const resolvedFlow = resolveFlowName(file, options.flow);

      if (options.name && !resolvedFlow) {
        console.error('Error: --name requires --flow (or a [file] positional) to specify which flow to rename.');
        process.exit(1);
      }

      const sfProject = findSfProject();
      const sourceBase = options.source || resolve(process.cwd(), 'flowml');

      if (!existsSync(sourceBase)) {
        console.error(`FlowML directory not found: ${sourceBase}`);
        console.error('Run "flowml fromxml" first to convert flows.');
        process.exit(1);
      }

      // Determine output directories
      const outputDirs = getOutputDirs(sfProject, options);

      // Collect all .flowml files
      const flowmlFiles = collectFlowmlFiles(sourceBase);
      const selectedFiles = resolvedFlow
        ? flowmlFiles.filter(item => item.flowName === resolvedFlow)
        : flowmlFiles;

      if (resolvedFlow && selectedFiles.length === 0) {
        console.error(`FlowML flow not found: ${resolvedFlow}`);
        process.exit(1);
      }

      type GeneratedOutput = {
        flowName: string;
        outputName: string;
        outFile: string;
        xml: string;
        state: 'created' | 'updated' | 'unchanged';
      };
      const generated: GeneratedOutput[] = [];
      const generationErrors: Array<{ flowName: string; message: string }> = [];

      // Generate and classify every output before writing any file. This avoids
      // partial writes when a later FlowML document cannot be transpiled.
      for (const { filePath, flowName } of selectedFiles) {
        try {
          const yamlStr = readFileSync(filePath, 'utf-8');
          const doc = readYaml(yamlStr, { validate: false });

          // When --name is used, update fullName to match the output filename
          if (options.name) {
            doc.flow.name = options.name.replace(/ /g, '_');
          }

          // Force Active status when --active is passed
          if (options.active) {
            doc.flow.status = 'Active';
          }

          const xml = writeXml(doc);

          // Determine output path — match subdirectory to package
          const relPath = relative(sourceBase, filePath);
          const subDir = (relPath.includes('/') || relPath.includes('\\'))
            ? relPath.split(/[/\\]/)[0]
            : null;
          let outDir: string;
          if (subDir && outputDirs.length > 1) {
            const match = outputDirs.find((d: any) => d.name === subDir || d.path === subDir);
            outDir = match ? match.flowsPath : outputDirs[0].flowsPath;
          } else {
            outDir = outputDirs[0].flowsPath;
          }
          const outputName = options.name || flowName;
          const outFile = resolve(outDir, `${outputName}.flow-meta.xml`);
          const state = !existsSync(outFile)
            ? 'created'
            : normalizeNewlines(readFileSync(outFile, 'utf-8')) === normalizeNewlines(xml)
              ? 'unchanged'
              : 'updated';
          generated.push({ flowName, outputName, outFile, xml, state });
        } catch (err: any) {
          generationErrors.push({ flowName, message: err.message });
        }
      }

      if (generationErrors.length > 0) {
        for (const error of generationErrors) {
          console.error(`  ERR ${error.flowName} - ${error.message}`);
        }
        console.error(
          `No files written because generation failed for ${generationErrors.length} flow`
          + `${generationErrors.length === 1 ? '' : 's'}.`
        );
        process.exit(1);
      }

      if (generated.length === 0) {
        console.log('No FlowML files found to convert.');
        return;
      }

      if (!options.dryRun) {
        for (const item of generated) {
          if (item.state === 'unchanged') continue;
          const outDir = dirname(item.outFile);
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
          writeFileSync(item.outFile, item.xml, 'utf-8');
        }
      }

      for (const item of generated) {
        const label = item.state === 'created'
          ? 'CREATE'
          : item.state === 'updated'
            ? 'UPDATE'
            : 'SAME  ';
        console.log(`  ${label} ${item.outputName}.flow-meta.xml`);
      }

      const created = generated.filter(item => item.state === 'created');
      const updated = generated.filter(item => item.state === 'updated');
      const unchanged = generated.filter(item => item.state === 'unchanged');
      const prefix = options.dryRun ? 'Dry run' : 'Converted';
      console.log(
        `\n${prefix} ${generated.length} flow${generated.length === 1 ? '' : 's'}: `
        + `${created.length} created, ${updated.length} updated, ${unchanged.length} unchanged`
      );
      if (updated.length > 0) {
        console.log(`Updated flows: ${updated.map(item => item.outputName).join(', ')}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

function getOutputDirs(sfProject: any, options: any) {
  if (options.output) {
    return [{ flowsPath: resolve(options.output) }];
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

  return [{ flowsPath: resolve(getDefaultFlowsPath()) }];
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
      // Recurse into subdirectories (for multi-package layouts)
      results.push(...collectFlowmlFiles(resolve(dir, entry.name)));
    }
  }

  return results;
}
