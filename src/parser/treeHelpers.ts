import { ProcedureCounts, TrpcNode } from "../lib/types";

export function countProcedures(node: TrpcNode): ProcedureCounts {
  const counts: ProcedureCounts = {
    query: 0,
    mutation: 0,
    subscription: 0,
  };

  for (const child of node.children) {
    if (child.type === "router" || child.type === "file") {
      const childProcedureCounts = countProcedures(child);
      counts.query += childProcedureCounts.query;
      counts.mutation += childProcedureCounts.mutation;
      counts.subscription += childProcedureCounts.subscription;
      continue;
    }

    counts[child.type]++;
  }

  return counts;
}
