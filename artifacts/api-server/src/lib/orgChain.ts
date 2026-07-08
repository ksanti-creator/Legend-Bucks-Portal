import { db, employeesTable } from "@workspace/db";

/**
 * Management-chain resolution over the self-referencing `employees.manager_id`
 * tree.
 *
 * The tree can nest arbitrarily deep: an employee's *chain of managers* is their
 * direct manager, that manager's manager, and so on up to the root; a manager's
 * *subtree* is every direct and indirect report beneath them.
 *
 * All traversals are cycle-safe: a `visited` set stops resolution if
 * `manager_id` ever forms a loop (bad data), so we terminate instead of
 * recursing forever.
 */

export type OrgGraph = Map<number, number | null>;

/**
 * Load the whole org as an id -> managerId map. The employees table is small,
 * so a single read + in-memory traversal is far cheaper than recursive SQL.
 */
export async function loadOrgGraph(): Promise<OrgGraph> {
  const rows = await db
    .select({ id: employeesTable.id, managerId: employeesTable.managerId })
    .from(employeesTable);
  const graph: OrgGraph = new Map();
  for (const r of rows) graph.set(r.id, r.managerId ?? null);
  return graph;
}

/**
 * The upward chain of managers for `employeeId`: [directManager, grandManager, …].
 * Excludes the employee themselves. Cycle-safe and self-reference-safe.
 */
export function managerChainFromGraph(employeeId: number, graph: OrgGraph): number[] {
  const chain: number[] = [];
  const visited = new Set<number>([employeeId]);
  let current = graph.get(employeeId) ?? null;
  while (current != null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = graph.get(current) ?? null;
  }
  return chain;
}

/** Convenience: load the graph and return the manager chain for one employee. */
export async function getManagerChain(employeeId: number): Promise<number[]> {
  const graph = await loadOrgGraph();
  return managerChainFromGraph(employeeId, graph);
}

/**
 * All direct and indirect reports beneath `managerId` (its subtree), excluding
 * the manager themselves. Cycle-safe.
 */
export function subtreeFromGraph(managerId: number, graph: OrgGraph): number[] {
  // Build a children index once.
  const children = new Map<number, number[]>();
  for (const [id, mgr] of graph) {
    if (mgr == null) continue;
    const list = children.get(mgr);
    if (list) list.push(id);
    else children.set(mgr, [id]);
  }

  const result: number[] = [];
  const visited = new Set<number>([managerId]);
  const stack = [...(children.get(managerId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    const kids = children.get(id);
    if (kids) stack.push(...kids);
  }
  return result;
}

/** Convenience: load the graph and return the subtree report ids for a manager. */
export async function getSubtreeIds(managerId: number): Promise<number[]> {
  const graph = await loadOrgGraph();
  return subtreeFromGraph(managerId, graph);
}
