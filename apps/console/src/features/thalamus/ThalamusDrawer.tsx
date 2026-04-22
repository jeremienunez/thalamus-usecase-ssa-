import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { Measure } from "@/shared/ui/Measure";
import { blockBar } from "@/shared/ui/sparkline";
import { ENTITY_COLOR, SOURCE_COLOR } from "@/shared/types/graph-colors";
import { fmtCount } from "@/shared/types/units";
import { countBy, topN, maxCount } from "@/shared/util/aggregate";
import type { EntityClass, KgEdgeDto, KgNodeDto } from "@/dto/http";

function classDescription(cls: EntityClass): string {
  switch (cls) {
    case "Satellite":
      return "Tracked space asset — TLE-propagated, conjunction-screened, optionally fronted by an Operator and bound to a single OrbitRegime.";
    case "Operator":
      return "Sovereign or commercial entity declared as the responsible party for a fleet. Drives provenance and classification posture.";
    case "OrbitRegime":
      return "Coarse altitude/inclination class (LEO/MEO/GEO/HEO/SSO). Aggregates congestion, debris density and conjunction priors.";
    case "ConjunctionEvent":
      return "Pair-wise close-approach event: two assets, a TCA, miss distance and Pc. Promoted into Findings when severity warrants action.";
    case "Payload":
      return "Functional class hosted on a Satellite (comms, EO, nav, science). Used by replacement-cost and capability inference.";
    case "Maneuver":
      return "Detected or planned orbital change — delta-v vector and confidence. Ties Cause→Effect across observation windows.";
    case "Debris":
      return "Untracked or fragment object. No active operator; mass and area are estimated from radar cross-section.";
    default:
      return "Knowledge-graph entity — see cortex provenance for derivation rationale.";
  }
}

function buildNeuronAscii(degree: number, hubness: number): string {
  // 9-line ASCII neuron drawn with stable mono-width chars.
  // Soma intensity scales with hub rank; axon length scales with degree.
  const arms = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(degree))));
  const limbLen = Math.min(10, 2 + Math.floor(arms / 2));
  const limb = "─".repeat(limbLen);
  const pad = " ".repeat(Math.max(0, 10 - limbLen));
  const intensity = hubness > 0.66 ? "▓" : hubness > 0.33 ? "▒" : "░";
  const fill = "▓";
  const rows = [
    `${pad}${" ".repeat(6)}${intensity}${intensity}${intensity}${intensity}${intensity}${intensity}${" ".repeat(6)}`,
    `${pad}${" ".repeat(4)}${intensity}${fill}${fill}${" "}${" "}${fill}${fill}${intensity}${" ".repeat(4)}`,
    `${pad}${" ".repeat(3)}${intensity}${fill}${fill}${fill}${fill}${fill}${fill}${intensity}${" ".repeat(3)}`,
    `${limb}─${intensity}${fill}${fill}╳${fill}${fill}${intensity}─${limb}`,
    `${pad}${" ".repeat(3)}${intensity}${fill}${fill}${fill}${fill}${fill}${fill}${intensity}${" ".repeat(3)}`,
    `${pad}${" ".repeat(4)}${intensity}${fill}${fill}${" "}${" "}${fill}${fill}${intensity}${" ".repeat(4)}`,
    `${pad}${" ".repeat(6)}${intensity}${intensity}${intensity}${intensity}${intensity}${intensity}${" ".repeat(6)}`,
    "",
    ` axons ${String(arms).padStart(2)}   degree ${String(degree).padStart(3)}   hub ${(hubness * 100).toFixed(0).padStart(3)}%`,
  ];
  return rows.join("\n");
}

export function ThalamusDrawer({
  node,
  edges,
}: {
  node: KgNodeDto | null;
  edges: KgEdgeDto[];
}) {
  if (!node) return <Drawer title="ENTITY" subtitle="select a neuron">{null}</Drawer>;

  const incidentDegree = edges.length;
  const relationCount = countBy(edges, (e) => e.relation);
  const sourceCount: Record<"field" | "osint" | "sim" | "derived", number> = {
    field: 0,
    osint: 0,
    sim: 0,
    derived: 0,
  };
  let totalConfidence = 0;
  let confidenceSamples = 0;
  for (const e of edges) {
    const cls = (e.sourceClass ?? "derived") as keyof typeof sourceCount;
    sourceCount[cls] = (sourceCount[cls] ?? 0) + 1;
    if (typeof e.confidence === "number" && Number.isFinite(e.confidence)) {
      totalConfidence += e.confidence;
      confidenceSamples++;
    }
  }
  const meanConfidence = confidenceSamples === 0 ? null : totalConfidence / confidenceSamples;
  const topRelations = topN(relationCount, relationCount.size);
  const maxRelCount = Math.max(1, maxCount(relationCount));
  const hubness = Math.min(1, incidentDegree / 12);

  return (
    <Drawer title="NEURON" subtitle={`${node.label} · ${node.class}`}>
      <DrawerSection title="ASCII MAP">
        <pre className="mono whitespace-pre text-nano leading-tight text-cyan">
{buildNeuronAscii(incidentDegree, hubness)}
        </pre>
        <div className="mt-2 text-caption text-muted leading-snug">
          {classDescription(node.class)}
        </div>
      </DrawerSection>

      <DrawerSection title="IDENTITY">
        <KV k="ID" v={node.id} mono />
        <KV k="Label" v={node.label} />
        <KV
          k="Class"
          v={
            <span className="mono" style={{ color: ENTITY_COLOR[node.class] }}>
              {node.class}
            </span>
          }
        />
        <KV
          k="Cortex"
          v={<span className="mono text-caption text-numeric">{node.cortex || "—"}</span>}
        />
        <KV k="Degree" v={<Measure value={fmtCount(incidentDegree)} />} />
        <KV
          k="Hub rank"
          v={
            <span className="mono tabular-nums text-cyan">
              {(hubness * 100).toFixed(0)}
              <span className="ml-0.5 text-dim">%</span>
            </span>
          }
        />
        <KV
          k="μ-confidence"
          v={
            meanConfidence === null ? (
              <span className="mono text-dim">— no signal</span>
            ) : (
              <span className="mono tabular-nums">
                {(meanConfidence * 100).toFixed(0)}
                <span className="ml-0.5 text-dim">%</span>
              </span>
            )
          }
        />
      </DrawerSection>

      <DrawerSection title={`AXONS · ${edges.length}`}>
        {edges.length === 0 && (
          <div className="text-caption text-dim">isolated · no incident edges yet</div>
        )}
        {edges.length > 0 && (
          <>
            <div className="mb-2 grid grid-cols-[80px_1fr_28px] items-center gap-2">
              {(["field", "osint", "sim", "derived"] as const).map((k) => {
                const n = sourceCount[k];
                if (n === 0) return null;
                const bar = blockBar(n, edges.length, 18);
                return (
                  <div key={k} className="contents">
                    <span
                      className="mono text-nano uppercase tracking-widest"
                      style={{ color: SOURCE_COLOR[k] }}
                    >
                      {k}
                    </span>
                    <pre
                      className="mono whitespace-pre text-nano leading-none"
                      style={{ color: SOURCE_COLOR[k] }}
                    >
                      {bar}
                    </pre>
                    <span className="mono text-right text-nano text-numeric tabular-nums">
                      {n}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[88px_1fr_24px] items-center gap-2 border-t border-hairline pt-2">
              <span className="mono text-nano uppercase tracking-widest text-dim">
                relations
              </span>
              <span />
              <span />
              {topRelations.slice(0, 6).map(([rel, n]) => (
                <div key={rel} className="contents">
                  <span className="mono truncate text-nano text-muted">{rel}</span>
                  <pre className="mono whitespace-pre text-nano leading-none text-cyan">
                    {blockBar(n, maxRelCount, 18)}
                  </pre>
                  <span className="mono text-right text-nano text-numeric tabular-nums">
                    {n}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </DrawerSection>

      <DrawerSection title="INCIDENT EDGES">
        {edges.slice(0, 12).map((e) => {
          const peer = e.source === node.id ? e.target : e.source;
          return (
            <div
              key={e.id}
              className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-hairline py-1 last:border-0"
            >
              <span className="truncate text-caption text-numeric">
                <span className="text-muted">{e.relation}</span>{" "}
                <span className="text-primary">{peer}</span>
              </span>
              <span
                className="mono text-caption tabular-nums"
                style={{ color: SOURCE_COLOR[(e.sourceClass ?? "derived") as keyof typeof SOURCE_COLOR] }}
              >
                {e.sourceClass ?? "derived"}
                {typeof e.confidence === "number" && Number.isFinite(e.confidence) && (
                  <>
                    <span className="ml-1 text-dim">·</span>{" "}
                    {(e.confidence * 100).toFixed(0)}
                    <span className="ml-0.5 text-dim">%</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {edges.length > 12 && (
          <div className="mt-1 text-nano text-dim">+{edges.length - 12} more</div>
        )}
      </DrawerSection>
    </Drawer>
  );
}
