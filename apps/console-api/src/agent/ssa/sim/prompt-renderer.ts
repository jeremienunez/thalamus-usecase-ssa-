/**
 * SsaPromptRenderer — renders the SSA turn prompt from a PromptRenderContext.
 *
 * Plan 2 · B.4. Lifted verbatim from packages/sweep/src/sim/prompt.ts.
 *
 * The pack reads ctx.frame plus ctx.domain.{subjectSnapshot, scenarioContext}.
 *
 * Structure is stable across DAG and Sequential drivers so fixture cache
 * keys match between modes.
 */

import type {
  PromptRenderContext,
  SimPromptComposer,
} from "@interview/sweep";

const MAX_MEMORIES = 8;
const MAX_OBSERVABLE = 15;

interface SubjectSnapshot {
  operatorName: string;
  operatorCountry: string | null;
  satelliteCount: number;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  avgLaunchYear: number | null;
}

interface TelemetryTarget {
  satelliteId: number;
  satelliteName: string;
  noradId: number | null;
  regime: string | null;
  launchYear: number | null;
  busArchetype: string | null;
  busDatasheetPrior: Record<
    string,
    { typical: number; min: number; max: number; unit: string }
  > | null;
  sources: string[];
}

interface PcEstimatorTarget {
  conjunctionId: number;
  tca: Date | null;
  missDistanceKm: number | null;
  relativeVelocityKmps: number | null;
  currentPc: number | null;
  hardBodyRadiusMeters: number | null;
  combinedSigmaKm: number | null;
  primary: { id: number; name: string; noradId: number | null; bus: string | null };
  secondary: { id: number; name: string; noradId: number | null; bus: string | null };
  assumptions: {
    hardBodyRadiusMeters: number;
    covarianceScale: "tight" | "nominal" | "loose";
  } | null;
}

export class SsaPromptRenderer implements SimPromptComposer {
  render(ctx: PromptRenderContext): string {
    const frame = ctx.frame as {
      turnIndex: number;
      persona: string;
      goals: string[];
      constraints: Record<string, unknown>;
    };
    const domain = ctx.domain as {
      subjectSnapshot: {
        displayName: string;
        attributes: Record<string, unknown>;
      } | null;
      scenarioContext: {
        telemetryTarget: TelemetryTarget | null;
        pcEstimatorTarget: PcEstimatorTarget | null;
      } | null;
    };
    const subjectSnapshot = toSubjectSnapshot(domain.subjectSnapshot);
    const scenario = domain.scenarioContext;

    return [
      `TURN ${frame.turnIndex}`,
      "",
      "## Your persona",
      frame.persona,
      "",
      "## Your goals",
      frame.goals.map((g) => `- ${g}`).join("\n") || "- (no explicit goals set)",
      "",
      "## Your constraints",
      "```json",
      JSON.stringify(frame.constraints, null, 2),
      "```",
      "",
      "## Fleet snapshot",
      renderFleetSnapshot(subjectSnapshot),
      "",
      "## Top relevant memories (private)",
      renderMemories(ctx.topMemories),
      "",
      "## Observable timeline (what other agents + god-view have done)",
      renderObservable(ctx.observable),
      "",
      "## God-view injections active this turn",
      renderGodEvents(ctx.godEvents),
      "",
      ...(scenario?.telemetryTarget
        ? [
            "## Telemetry inference target",
            renderTelemetryTarget(scenario.telemetryTarget),
            "",
          ]
        : []),
      ...(scenario?.pcEstimatorTarget
        ? [renderPcEstimatorTarget(scenario.pcEstimatorTarget), ""]
        : []),
      "## Task",
      "Decide what you do this turn. Respond with a single JSON object matching the schema in your instructions. No prose before or after.",
    ].join("\n");
  }
}

function renderPcEstimatorTarget(t: PcEstimatorTarget): string {
  const fmt = (v: number | null | undefined, digits = 3): string =>
    v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
  const fmtSci = (v: number | null | undefined): string =>
    v == null || Number.isNaN(v) ? "—" : Number(v).toExponential(3);
  const tca = t.tca ? new Date(t.tca).toISOString() : "—";
  const hbr =
    t.assumptions?.hardBodyRadiusMeters != null
      ? `${t.assumptions.hardBodyRadiusMeters} m`
      : t.hardBodyRadiusMeters != null
      ? `${t.hardBodyRadiusMeters} m (catalog)`
      : "—";
  const scale = t.assumptions?.covarianceScale ?? "—";
  const primaryBus = t.primary.bus ?? "—";
  const secondaryBus = t.secondary.bus ?? "—";
  const primaryNorad = t.primary.noradId != null ? String(t.primary.noradId) : "—";
  const secondaryNorad =
    t.secondary.noradId != null ? String(t.secondary.noradId) : "—";
  return [
    "## Pc estimation target",
    `- Conjunction ID: ${t.conjunctionId}`,
    `- TCA: ${tca}`,
    `- Miss distance: ${fmt(t.missDistanceKm)} km`,
    `- Relative velocity: ${fmt(t.relativeVelocityKmps)} km/s`,
    `- Algorithmic Pc (current): ${fmtSci(t.currentPc)}`,
    `- Primary:   ${t.primary.name} (NORAD ${primaryNorad}) · bus ${primaryBus}`,
    `- Secondary: ${t.secondary.name} (NORAD ${secondaryNorad}) · bus ${secondaryBus}`,
    `- Covariance (combined σ): ${fmt(t.combinedSigmaKm)} km`,
    "",
    "### Your perturbation",
    `- Hard-body radius: ${hbr}`,
    `- Covariance scale: ${scale}`,
  ].join("\n");
}

function renderTelemetryTarget(t: TelemetryTarget): string {
  const header = [
    `- satelliteId: ${t.satelliteId}`,
    `- name: ${t.satelliteName}`,
    t.noradId != null ? `- noradId: ${t.noradId}` : null,
    t.regime ? `- regime: ${t.regime}` : null,
    t.launchYear != null ? `- launchYear: ${t.launchYear}` : null,
    t.busArchetype
      ? `- bus: ${t.busArchetype}`
      : "- bus: (unknown — no datasheet prior available)",
  ].filter((l): l is string => l !== null);

  if (!t.busDatasheetPrior || Object.keys(t.busDatasheetPrior).length === 0) {
    header.push(
      "",
      "### Bus datasheet prior",
      "(no public datasheet matched — infer conservatively from regime + operator norms, and set self-reported confidence ≤ 0.25)",
    );
    return header.join("\n");
  }

  const rows = Object.entries(t.busDatasheetPrior)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, r]) => {
      const band =
        r.min === r.max
          ? `${r.typical} ${r.unit}`
          : `[${r.min}, ${r.typical}, ${r.max}] ${r.unit}`;
      return `| ${key} | ${band} |`;
    });

  header.push(
    "",
    "### Bus datasheet prior",
    "Values you infer MUST lie within the range below (±10% tolerance).",
    "",
    "| scalar | [min, typical, max] unit |",
    "|---|---|",
    ...rows,
  );

  if (t.sources.length > 0) {
    header.push("", `Sources: ${t.sources.join(", ")}`);
  }

  return header.join("\n");
}

function renderFleetSnapshot(s: SubjectSnapshot | null): string {
  if (!s) return "- (no snapshot available)";
  const regimes = s.regimeMix.length
    ? s.regimeMix.map((r) => `${r.regime}: ${r.count}`).join(", ")
    : "(none)";
  const platforms = s.platformMix.length
    ? s.platformMix.map((p) => `${p.platform}: ${p.count}`).join(", ")
    : "(none)";
  const launch = s.avgLaunchYear !== null ? String(s.avgLaunchYear) : "unknown";
  return [
    `- Operator: ${s.operatorName} (${s.operatorCountry ?? "unspecified"})`,
    `- Active satellites: ${s.satelliteCount}`,
    `- Regime mix: ${regimes}`,
    `- Platform mix: ${platforms}`,
    `- Avg launch year: ${launch}`,
  ].join("\n");
}

function toSubjectSnapshot(input: {
  displayName: string;
  attributes: Record<string, unknown>;
} | null): SubjectSnapshot | null {
  if (!input) return null;
  const attrs = input.attributes;
  return {
    operatorName: input.displayName,
    operatorCountry: (attrs.operatorCountry as string | null) ?? null,
    satelliteCount: (attrs.satelliteCount as number | undefined) ?? 0,
    regimeMix:
      (attrs.regimeMix as Array<{ regime: string; count: number }> | undefined) ?? [],
    platformMix:
      (attrs.platformMix as Array<{ platform: string; count: number }> | undefined) ?? [],
    avgLaunchYear: (attrs.avgLaunchYear as number | null) ?? null,
  };
}

function renderMemories(
  topMemories: PromptRenderContext["topMemories"],
): string {
  if (topMemories.length === 0) return "- (no prior memories this run)";
  return topMemories
    .slice(0, MAX_MEMORIES)
    .map(
      (m) => `- [t${m.turnIndex}, ${m.kind}] ${truncate(m.content, 200)}`,
    )
    .join("\n");
}

function renderObservable(observable: PromptRenderContext["observable"]): string {
  if (observable.length === 0) return "- (nothing observed yet)";
  // Rendered in chronological order (oldest first) for readability, even though
  // the query returns DESC.
  const chrono = [...observable].reverse();
  return chrono
    .slice(-MAX_OBSERVABLE)
    .map((o) => {
      const label =
        o.actorKind === "god"
          ? "GOD"
          : o.actorKind === "system"
          ? "SYSTEM"
          : o.authorLabel;
      return `- [t${o.turnIndex}] ${label}: ${truncate(o.observableSummary, 200)}`;
    })
    .join("\n");
}

function renderGodEvents(godEvents: PromptRenderContext["godEvents"]): string {
  if (godEvents.length === 0) return "- (no god-view injections active)";
  return godEvents
    .map((g) =>
      g.detail
        ? `- [t${g.turnIndex}] ${g.summary} — ${truncate(g.detail, 300)}`
        : `- [t${g.turnIndex}] ${g.summary}`,
    )
    .join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
