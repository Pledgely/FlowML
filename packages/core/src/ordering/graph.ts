// ============================================================
// Execution Graph Builder
// ============================================================

export interface GraphNode {
  name: string;
  elementType: string;
  /** Outgoing edges: connector target names */
  edges: string[];
  /** For loops: the iteration body target */
  iterationNext?: string;
  /** For loops: the after-last target */
  afterLastNext?: string;
  /** For decisions: ordered list of rule branch targets */
  ruleBranches?: string[];
  /** For decisions: default branch target */
  defaultBranch?: string;
}

export interface ExecutionGraph {
  nodes: Map<string, GraphNode>;
  startName: string | undefined;
  scheduledPathStarts: string[];
}

/**
 * Build an execution graph from parsed Flow XML elements.
 * Each element contributes a node with its outgoing connector targets.
 */
export function buildGraph(
  elements: Array<{
    name: string;
    elementType: string;
    connectorTarget?: string;
    faultTarget?: string;
    iterationNext?: string;
    afterLastNext?: string;
    ruleBranches?: string[];
    defaultBranch?: string;
  }>,
  startName: string | undefined,
  scheduledPathStarts: string[]
): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();

  for (const el of elements) {
    const edges: string[] = [];

    // Decision branches
    if (el.ruleBranches) {
      for (const target of el.ruleBranches) {
        if (target) edges.push(target);
      }
    }
    if (el.defaultBranch) edges.push(el.defaultBranch);

    // Loop targets
    if (el.iterationNext) edges.push(el.iterationNext);
    if (el.afterLastNext) edges.push(el.afterLastNext);

    // Standard connector
    if (el.connectorTarget && !edges.includes(el.connectorTarget)) {
      edges.push(el.connectorTarget);
    }

    // Fault connector
    if (el.faultTarget && !edges.includes(el.faultTarget)) {
      edges.push(el.faultTarget);
    }

    nodes.set(el.name, {
      name: el.name,
      elementType: el.elementType,
      edges,
      iterationNext: el.iterationNext,
      afterLastNext: el.afterLastNext,
      ruleBranches: el.ruleBranches,
      defaultBranch: el.defaultBranch,
    });
  }

  return { nodes, startName, scheduledPathStarts };
}
