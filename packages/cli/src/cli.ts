// ============================================================
// FlowML CLI Entry Point
// ============================================================

import { Command } from 'commander';
import { fromxmlCommand } from './commands/fromxml.js';
import { toxmlCommand } from './commands/toxml.js';
import { lintCommand } from './commands/lint.js';
import { roundtripCommand } from './commands/roundtrip.js';
import { initCommand } from './commands/init.js';
import { syntaxCommand } from './commands/syntax.js';
import { checkCommand } from './commands/check.js';
import { bestPracticesCommand } from './commands/best-practices.js';

const program = new Command();

program
  .name('flowml')
  .description('FlowML - Salesforce Flow YAML Transpiler')
  .version('1.0.0');

program.addCommand(fromxmlCommand);
program.addCommand(toxmlCommand);
program.addCommand(lintCommand);
program.addCommand(roundtripCommand);
program.addCommand(initCommand);
program.addCommand(syntaxCommand);
program.addCommand(checkCommand);
program.addCommand(bestPracticesCommand);

program.parse();
