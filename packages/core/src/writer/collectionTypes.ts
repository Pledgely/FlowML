// ============================================================
// Collection Type Inference
// ============================================================
//
// Resolves the SObject type of a collection reference used by a filter step.
// Used to auto-synthesize `itemVariable` declarations so the generated XML is
// activation-valid without forcing users to write boilerplate.

import type { FlowMLDocument, LookupStep, LoopStep } from '../types.js';

/**
 * Look up the SObject type of a collection identified by `collectionRef`.
 *
 * Resolution order:
 *   1. Prior `lookup:` step — `lookup.object` is the SObject type.
 *   2. Top-level variable with `dataType: SObject` — `objectType` is the type.
 *   3. Loop step — same type as its source collection (recursive).
 *
 * Returns `undefined` when the type cannot be determined. Callers decide
 * whether that is an error or simply triggers an explicit-declaration path.
 */
export function inferCollectionObjectType(
  doc: FlowMLDocument,
  collectionRef: string
): string | undefined {
  if (!collectionRef) return undefined;
  return resolve(doc, collectionRef, new Set());
}

function resolve(doc: FlowMLDocument, ref: string, seen: Set<string>): string | undefined {
  if (seen.has(ref)) return undefined;
  seen.add(ref);

  for (const step of doc.steps) {
    if ('lookup' in step) {
      const ls = step as LookupStep;
      if (ls.lookup === ref && ls.object) return ls.object;
    }
    if ('loop' in step) {
      const loop = step as LoopStep;
      if (loop.loop === ref && loop.collection) {
        return resolve(doc, loop.collection, seen);
      }
    }
  }

  const v = doc.variables?.[ref];
  if (v && v.dataType === 'SObject' && v.objectType) return v.objectType;

  return undefined;
}
