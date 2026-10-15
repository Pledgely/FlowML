// ============================================================
// flowml check — Validate FlowML against a Salesforce org
// ============================================================

import { Command } from 'commander';
import { readFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { readYaml, writeXml } from 'flowml';
import { findSfProject, getDefaultFlowsPath } from '../sfProject.js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolveFlowName } from '../flowNameArg.js';

const TEMP_FLOW_NAME = '__flowml_check_temp';
const API_VERSION_PATTERN = /^\d+(\.\d+)?$/;
const TARGET_ORG_PATTERN = /^[\w.@+-]+$/;

export const checkCommand = new Command('check')
  .description('Validate a FlowML file against a Salesforce org via dry-run deploy')
  .argument('[file]', 'Optional .flowml file path or bare flow name (shorthand for --flow)')
  .option('--flow <name>', 'Flow to check (required unless [file] is given)')
  .option('--source <path>', 'FlowML directory (default: flowml/)')
  .option('--package <name>', 'Restrict to a specific package directory')
  .option('--target-org <org>', 'Salesforce target org alias or username')
  .option('--api-version <version>', 'Metadata API version for the dry-run deploy (default: the flow\'s declared apiVersion)')
  .action(async (file: string | undefined, options) => {
    let tempXmlPath: string | null = null;
    // The temp flow is Active, so it must never be left in the user's project: clean up on every exit path, including Ctrl-C
    const cleanup = () => { if (tempXmlPath && existsSync(tempXmlPath)) unlinkSync(tempXmlPath); };
    const onSigint = () => { cleanup(); process.exit(130); };
    process.once('SIGINT', onSigint);

    try {
      const resolvedFlow = resolveFlowName(file, options.flow);
      if (!resolvedFlow) {
        console.error('Error: either a [file] positional or --flow is required.');
        process.exit(1);
      }

      if (options.apiVersion !== undefined && !API_VERSION_PATTERN.test(String(options.apiVersion))) {
        console.error(`Error: invalid --api-version "${options.apiVersion}". Expected a version like 64.0.`);
        process.exit(1);
      }

      // --target-org is interpolated into a shell command, so only accept alias/username characters
      if (options.targetOrg !== undefined && !TARGET_ORG_PATTERN.test(String(options.targetOrg))) {
        console.error(`Error: invalid --target-org "${options.targetOrg}". Expected an org alias or username.`);
        process.exit(1);
      }

      // 1. Check sf CLI is available
      try {
        execSync('sf --version', { stdio: 'pipe' });
      } catch {
        console.error('Error: Salesforce CLI (sf) not found. Install it from https://developer.salesforce.com/tools/salesforcecli');
        process.exit(1);
      }

      // 2. Find Salesforce project
      const sfProject = findSfProject();
      if (!sfProject) {
        console.error('Error: Not in a Salesforce project (no sfdx-project.json found).');
        console.error('Run this command from within a Salesforce project directory.');
        process.exit(1);
      }

      // 3. Find the FlowML source file
      const sourceBase = options.source || resolve(process.cwd(), 'flowml');
      if (!existsSync(sourceBase)) {
        console.error(`Error: FlowML directory not found: ${sourceBase}`);
        process.exit(1);
      }

      const flowName = resolvedFlow;
      const flowmlFile = findFlowmlFile(sourceBase, flowName);
      if (!flowmlFile) {
        console.error(`Error: Flow "${flowName}" not found in ${sourceBase}`);
        process.exit(1);
      }

      // 4. Convert FlowML -> XML with Active status
      console.log(`Converting ${flowName}.flowml to XML...`);
      const yamlStr = readFileSync(flowmlFile, 'utf-8');
      const doc = readYaml(yamlStr, { validate: false });
      doc.flow.name = TEMP_FLOW_NAME;
      doc.flow.status = 'Active';
      const xml = writeXml(doc);

      // 5. Write temp XML to flows directory
      let flowsDir: string;
      if (options.package) {
        const pkg = sfProject.packageDirectories.find(
          d => d.path === options.package || d.name === options.package
        );
        if (!pkg) {
          console.error(`Error: Package "${options.package}" not found in sfdx-project.json`);
          process.exit(1);
        }
        flowsDir = pkg.flowsPath;
      } else {
        flowsDir = sfProject.packageDirectories[0].flowsPath;
      }

      if (!existsSync(flowsDir)) {
        mkdirSync(flowsDir, { recursive: true });
      }

      tempXmlPath = resolve(flowsDir, `${TEMP_FLOW_NAME}.flow-meta.xml`);
      writeFileSync(tempXmlPath, xml, 'utf-8');

      // 6. Run sf deploy dry-run with --json for structured output
      // Deploy at the flow's declared API version (not the project's
      // sourceApiVersion) so elements introduced in newer API versions
      // validate against the schema the flow actually targets.
      console.log(`Validating against Salesforce org...`);
      const orgFlag = options.targetOrg ? ` --target-org ${options.targetOrg}` : '';
      const apiVersion = options.apiVersion ?? doc.flow.apiVersion;
      let apiVersionFlag = '';
      if (apiVersion && API_VERSION_PATTERN.test(String(apiVersion))) {
        apiVersionFlag = ` --api-version ${apiVersion}`;
      } else if (apiVersion) {
        console.warn(`Warning: flow apiVersion "${apiVersion}" is not a valid API version; validating at the project's default API version.`);
      }
      const cmd = `sf project deploy start --dry-run --json --source-dir "${tempXmlPath}"${orgFlag}${apiVersionFlag}`;

      let rawOutput: string;
      try {
        rawOutput = execSync(cmd, {
          stdio: 'pipe',
          encoding: 'utf-8',
          cwd: sfProject.projectRoot,
        });
      } catch (err: any) {
        // sf CLI returns non-zero on validation failure, but still outputs JSON
        rawOutput = err.stdout || err.stderr || '';
      }

      const result = parseDeployResult(rawOutput, flowName);
      if (result.success) {
        console.log(`\nCHECK PASSED: ${flowName}.flowml is valid.`);
      } else {
        if (result.errors.length > 0) {
          console.error(`\nErrors:`);
          for (const error of result.errors) {
            console.error(`  - ${error}`);
          }
        }
        if (result.rawMessage) {
          console.error(`\n${result.rawMessage}`);
        }
        console.error(`\nCHECK FAILED: ${flowName}.flowml has errors.`);
        // exitCode rather than process.exit() so the finally block still removes the temp flow
        process.exitCode = 1;
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    } finally {
      // 7. Cleanup temp XML
      process.off('SIGINT', onSigint);
      cleanup();
    }
  });

interface DeployCheckResult {
  success: boolean;
  errors: string[];
  rawMessage?: string;
}

function parseDeployResult(rawOutput: string, flowName: string): DeployCheckResult {
  try {
    const json = JSON.parse(rawOutput);

    // Success case
    if (json.status === 0 || json.result?.success === true) {
      return { success: true, errors: [] };
    }

    const errors: string[] = [];

    // Extract component failures
    const failures = json.result?.details?.componentFailures
      || json.result?.files?.filter((f: any) => f.state === 'Failed')
      || [];

    const failureList = Array.isArray(failures) ? failures : [failures];
    for (const failure of failureList) {
      if (failure.problem || failure.error) {
        const problem = failure.problem || failure.error;
        // Replace temp name with actual flow name in error messages
        const cleaned = problem.replace(/__flowml_check_temp/g, flowName);
        errors.push(cleaned);
      }
    }

    // Check for top-level error message
    if (errors.length === 0 && json.message) {
      return { success: false, errors: [], rawMessage: json.message.replace(/__flowml_check_temp/g, flowName) };
    }

    return { success: false, errors };
  } catch {
    // JSON parse failed — return raw output trimmed
    const trimmed = rawOutput.trim();
    if (!trimmed) {
      return { success: false, errors: [], rawMessage: 'No output from Salesforce CLI.' };
    }
    return { success: false, errors: [], rawMessage: trimmed.replace(/__flowml_check_temp/g, flowName) };
  }
}

function findFlowmlFile(dir: string, flowName: string): string | null {
  if (!existsSync(dir)) return null;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === `${flowName}.flowml`) {
      return resolve(dir, entry.name);
    } else if (entry.isDirectory()) {
      const found = findFlowmlFile(resolve(dir, entry.name), flowName);
      if (found) return found;
    }
  }
  return null;
}
