// ============================================================
// flowml init — Initialize FlowML in a Salesforce project
// ============================================================

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import { findSfProject } from '../sfProject.js';

export const initCommand = new Command('init')
  .description('Initialize FlowML in a Salesforce project')
  .action(async () => {
    console.log('Initializing FlowML...\n');

    const cwd = process.cwd();

    // 1. Detect project structure
    const sfProject = findSfProject(cwd);
    if (sfProject) {
      const pkgCount = sfProject.packageDirectories.length;
      console.log(`  OK  Detected sfdx-project.json (${pkgCount} package director${pkgCount !== 1 ? 'ies' : 'y'})`);
    } else {
      console.log('  WARN  No sfdx-project.json found (continuing with defaults)');
    }

    // 2. Create flowml/ directory
    const flowmlDir = resolve(cwd, 'flowml');
    if (!existsSync(flowmlDir)) {
      mkdirSync(flowmlDir, { recursive: true });
      console.log('  OK  Created flowml/ directory');
    } else {
      console.log('  OK  flowml/ directory already exists');
    }

    // 3. Configure VS Code settings
    const vscodeDir = resolve(cwd, '.vscode');
    if (!existsSync(vscodeDir)) {
      mkdirSync(vscodeDir, { recursive: true });
    }

    const settingsPath = resolve(vscodeDir, 'settings.json');
    const settings = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, 'utf-8'))
      : {};

    // Merge file associations
    if (!settings['files.associations']) settings['files.associations'] = {};
    settings['files.associations']['*.flowml'] = 'yaml';

    // Copy schema into .vscode/ so it works regardless of install method
    const schemaDestPath = resolve(vscodeDir, 'flowml-schema.json');
    try {
      const require = createRequire(import.meta.url);
      const schemaSourcePath = require.resolve('flowml/schema.json');
      const schemaContent = readFileSync(schemaSourcePath, 'utf-8');
      writeFileSync(schemaDestPath, schemaContent, 'utf-8');
      console.log('  OK  Copied flowml-schema.json to .vscode/');
    } catch {
      console.log('  WARN  Could not copy schema file (flowml package not found)');
    }

    // Merge YAML schema — point to local copy
    if (!settings['yaml.schemas']) settings['yaml.schemas'] = {};
    // Remove old node_modules reference if present
    delete settings['yaml.schemas']['./node_modules/flowml/schema.json'];
    settings['yaml.schemas']['./.vscode/flowml-schema.json'] = '*.flowml';

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log('  OK  Updated .vscode/settings.json');

    // 4. Recommend YAML extension
    const extensionsPath = resolve(vscodeDir, 'extensions.json');
    const extensions = existsSync(extensionsPath)
      ? JSON.parse(readFileSync(extensionsPath, 'utf-8'))
      : {};

    if (!extensions.recommendations) extensions.recommendations = [];
    if (!extensions.recommendations.includes('redhat.vscode-yaml')) {
      extensions.recommendations.push('redhat.vscode-yaml');
    }

    writeFileSync(extensionsPath, JSON.stringify(extensions, null, 2) + '\n', 'utf-8');
    console.log('  OK  Added redhat.vscode-yaml to .vscode/extensions.json');

    // 5. Update .forceignore
    const forceignorePath = resolve(cwd, '.forceignore');
    const flowmlEntry = 'flowml/';

    if (existsSync(forceignorePath)) {
      const content = readFileSync(forceignorePath, 'utf-8');
      if (!content.includes(flowmlEntry)) {
        const newContent = content.endsWith('\n')
          ? content + flowmlEntry + '\n'
          : content + '\n' + flowmlEntry + '\n';
        writeFileSync(forceignorePath, newContent, 'utf-8');
        console.log('  OK  Added flowml/ to .forceignore');
      } else {
        console.log('  OK  flowml/ already in .forceignore');
      }
    } else {
      writeFileSync(forceignorePath, flowmlEntry + '\n', 'utf-8');
      console.log('  OK  Created .forceignore with flowml/');
    }

    console.log("\nFlowML initialized. Run 'flowml fromxml' to convert your flows.");
  });
