// ============================================================
// Helpers for parsing a positional [file] argument into a flow name
// ============================================================

import { basename } from 'path';

const FLOW_META_EXT = '.flow-meta.xml';
const FLOWML_EXT = '.flowml';

export function parseFlowNameArg(raw: string): string {
  if (!raw || raw.trim() === '') throw new Error('Empty flow name');
  const base = basename(raw.replace(/\\/g, '/'));

  if (base.endsWith(FLOW_META_EXT)) {
    const name = base.slice(0, -FLOW_META_EXT.length);
    if (!name) throw new Error(`Invalid flow path: "${raw}"`);
    return name;
  }
  if (base.endsWith(FLOWML_EXT)) {
    const name = base.slice(0, -FLOWML_EXT.length);
    if (!name) throw new Error(`Invalid flow path: "${raw}"`);
    return name;
  }
  if (base.includes('.')) {
    throw new Error(
      `Unsupported file: "${raw}". Expected a .flowml or .flow-meta.xml path, or a bare flow name.`
    );
  }
  return base;
}

export function resolveFlowName(
  positional: string | undefined,
  flowOption: string | undefined
): string | undefined {
  const fromPos = positional ? parseFlowNameArg(positional) : undefined;
  const fromOpt = flowOption
    ? flowOption.replace(/\.flow-meta\.xml$/, '').replace(/\.flowml$/, '')
    : undefined;

  if (fromPos && fromOpt && fromPos !== fromOpt) {
    throw new Error(
      `Conflicting flow names: positional "${fromPos}" vs --flow "${fromOpt}". Pass only one.`
    );
  }
  return fromPos ?? fromOpt;
}
