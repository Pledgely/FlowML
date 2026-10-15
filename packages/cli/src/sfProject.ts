// ============================================================
// Salesforce Project Detection
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';

export interface SfProject {
  projectRoot: string;
  packageDirectories: PackageDir[];
}

export interface PackageDir {
  path: string;
  flowsPath: string;
  name?: string;
}

/**
 * Find sfdx-project.json by walking up from the given directory.
 */
export function findSfProject(startDir: string = process.cwd()): SfProject | null {
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, 'sfdx-project.json');
    if (existsSync(candidate)) {
      return parseSfProject(candidate, dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function parseSfProject(configPath: string, projectRoot: string): SfProject {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  const packageDirs = (raw.packageDirectories || []) as Array<{ path: string; default?: boolean }>;

  const dirs: PackageDir[] = packageDirs.map(pd => {
    const pkgPath = pd.path;
    const flowsPath = resolve(projectRoot, pkgPath, 'main', 'default', 'flows');
    return {
      path: pkgPath,
      flowsPath,
      name: pkgPath,
    };
  });

  if (dirs.length === 0) {
    dirs.push({
      path: 'force-app',
      flowsPath: resolve(projectRoot, 'force-app', 'main', 'default', 'flows'),
      name: 'force-app',
    });
  }

  return { projectRoot, packageDirectories: dirs };
}

/**
 * Get the default flows path when no sfdx-project.json is found.
 */
export function getDefaultFlowsPath(startDir: string = process.cwd()): string {
  return resolve(startDir, 'force-app', 'main', 'default', 'flows');
}
