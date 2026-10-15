// ============================================================
// Execution Order Linearizer
// Modified DFS that handles loop back-edges and decision branches
// ============================================================

import type { ExecutionGraph, GraphNode } from './graph.js';

/**
 * Linearize the execution graph into a deterministic step order.
 *
 * Uses modified DFS from the start element:
 * - Decision branches are ordered by rule index (first rule first, then default)
 * - Loop body elements connect back to the loop (back-edge), detected and skipped
 * - Fault paths are traversed after the main path
 *
 * Returns element names in execution order.
 */
export function linearize(graph: ExecutionGraph): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  function dfs(name: string): void {
    if (!name || visited.has(name)) return;
    visited.add(name);
    result.push(name);

    const node = graph.nodes.get(name);
    if (!node) return;

    // Decision: traverse rule branches in order, then default
    if (node.ruleBranches) {
      for (const branchTarget of node.ruleBranches) {
        if (branchTarget) dfs(branchTarget);
      }
      if (node.defaultBranch) {
        dfs(node.defaultBranch);
      }
      return;
    }

    // Loop: traverse iteration body first, then after-last
    if (node.iterationNext !== undefined) {
      // Iteration body - DFS into it
      if (node.iterationNext) dfs(node.iterationNext);
      // After last - continue after loop
      if (node.afterLastNext) dfs(node.afterLastNext);
      return;
    }

    // Standard element: follow main connector, then fault
    // Find main connector target (next)
    const mainTarget = findMainTarget(node);
    if (mainTarget) dfs(mainTarget);

    // Fault connector
    const faultTarget = findFaultTarget(node);
    if (faultTarget) dfs(faultTarget);
  }

  // Start from the main start element
  if (graph.startName) {
    dfs(graph.startName);
  }

  // Also traverse scheduled path starts
  for (const spStart of graph.scheduledPathStarts) {
    dfs(spStart);
  }

  // Add any remaining unvisited elements (disconnected)
  for (const [name] of graph.nodes) {
    if (!visited.has(name)) {
      dfs(name);
    }
  }

  return result;
}

/**
 * Find the main connector target from node edges.
 * For non-decision, non-loop nodes, the first edge that isn't a fault target.
 */
function findMainTarget(node: GraphNode): string | undefined {
  // The edges array contains all targets. For standard elements,
  // the main connector is the first edge (if any).
  return node.edges[0];
}

function findFaultTarget(node: GraphNode): string | undefined {
  // Fault target is the second edge for standard elements
  return node.edges.length > 1 ? node.edges[1] : undefined;
}
