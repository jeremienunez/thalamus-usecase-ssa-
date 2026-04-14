export type WhySourceClass = "field" | "osint" | "sim" | "derived";

export interface WhyNode {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  sourceClass?: WhySourceClass;
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
      sourceClass?: WhySourceClass;
    }>
  >;
  sourceItem(id: string): Promise<{
    id: string;
    label: string;
    sha256?: string;
    sourceClass?: WhySourceClass;
  } | null>;
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
      ...(e.sourceClass && { sourceClass: e.sourceClass }),
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
          ...(s.sourceClass && { sourceClass: s.sourceClass }),
          children: [],
        });
    }
    children.push(child);
  }
  // Sort children at each level by source_class priority: FIELD > OSINT > SIM > derived.
  const priority = (sc?: WhySourceClass): number =>
    sc === "field" ? 0 : sc === "osint" ? 1 : sc === "sim" ? 2 : 3;
  const sortRec = (arr: WhyNode[]): WhyNode[] => {
    arr.forEach((n) => sortRec(n.children));
    arr.sort((a, b) => priority(a.sourceClass) - priority(b.sourceClass));
    return arr;
  };
  sortRec(children);
  return { id: f.id, label: f.label, kind: "finding", children };
}
