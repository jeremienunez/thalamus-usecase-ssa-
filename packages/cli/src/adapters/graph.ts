export interface ResearchGraphRepo {
  edges(entity: string): Promise<Array<{ from: string; to: string; kind: string }>>;
}

export interface GraphTree {
  root: string;
  levels: Array<{ depth: number; nodes: string[] }>;
}

export async function neighbourhoodAdapter(
  repo: ResearchGraphRepo,
  q: { entity: string; maxDepth?: number; cap?: number },
): Promise<GraphTree> {
  const maxDepth = q.maxDepth ?? 2;
  const cap = q.cap ?? 50;
  const seen = new Set<string>([q.entity]);
  const levels: GraphTree["levels"] = [{ depth: 0, nodes: [q.entity] }];

  for (let d = 1; d <= maxDepth; d++) {
    const prev = levels[d - 1].nodes;
    const next: string[] = [];
    for (const src of prev) {
      if (seen.size >= cap) break;
      const rows = await repo.edges(src);
      for (const e of rows) {
        const candidate = e.from === src ? e.to : e.from;
        if (!seen.has(candidate) && seen.size < cap) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    if (next.length === 0) break;
    levels.push({ depth: d, nodes: next });
  }
  return { root: q.entity, levels };
}
