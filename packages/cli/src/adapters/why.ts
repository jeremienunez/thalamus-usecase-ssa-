export interface WhyNode {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  children: WhyNode[];
}

export interface ProvenanceRepo {
  finding(id: string): Promise<{ id: string; label: string } | null>;
  incomingEdges(findingId: string): Promise<
    Array<{
      kind: string;
      from: string;
      fromKind: string;
      label: string;
      sha256?: string;
    }>
  >;
  sourceItem(id: string): Promise<{ id: string; label: string; sha256?: string } | null>;
}

export async function buildWhyTree(
  repo: ProvenanceRepo,
  q: { findingId: string },
): Promise<WhyNode | null> {
  const f = await repo.finding(q.findingId);
  if (!f) return null;
  const edges = await repo.incomingEdges(q.findingId);
  const children: WhyNode[] = [];
  for (const e of edges) {
    const child: WhyNode = {
      id: e.from,
      label: e.label,
      kind: "edge",
      sha256: e.sha256,
      children: [],
    };
    if (e.fromKind === "source_item") {
      const s = await repo.sourceItem(e.from);
      if (s)
        child.children.push({
          id: s.id,
          label: s.label,
          kind: "source_item",
          sha256: s.sha256,
          children: [],
        });
    }
    children.push(child);
  }
  return { id: f.id, label: f.label, kind: "finding", children };
}
