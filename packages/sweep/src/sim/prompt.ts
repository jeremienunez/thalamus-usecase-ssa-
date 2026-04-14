/**
 * Turn prompt renderer — composes the user message for sim_operator_agent.
 *
 * The cortex skill body is the system prompt; this file produces the user
 * prompt block. Structure is stable across DAG and Sequential drivers so
 * fixture cache keys match between modes.
 */

import type { AgentContext } from "./types";

const MAX_MEMORIES = 8;
const MAX_OBSERVABLE = 15;

export function renderTurnPrompt(ctx: AgentContext): string {
  return [
    `TURN ${ctx.turnIndex}`,
    "",
    "## Your persona",
    ctx.persona,
    "",
    "## Your goals",
    ctx.goals.map((g) => `- ${g}`).join("\n") || "- (no explicit goals set)",
    "",
    "## Your constraints",
    "```json",
    JSON.stringify(ctx.constraints, null, 2),
    "```",
    "",
    "## Fleet snapshot",
    renderFleetSnapshot(ctx),
    "",
    "## Top relevant memories (private)",
    renderMemories(ctx),
    "",
    "## Observable timeline (what other agents + god-view have done)",
    renderObservable(ctx),
    "",
    "## God-view injections active this turn",
    renderGodEvents(ctx),
    "",
    ...(ctx.telemetryTarget
      ? ["## Telemetry inference target", renderTelemetryTarget(ctx.telemetryTarget), ""]
      : []),
    "## Task",
    "Decide what you do this turn. Respond with a single JSON object matching the schema in your instructions. No prose before or after.",
  ].join("\n");
}

function renderTelemetryTarget(t: import("./types").TelemetryTarget): string {
  const header = [
    `- satelliteId: ${t.satelliteId}`,
    `- name: ${t.satelliteName}`,
    t.noradId != null ? `- noradId: ${t.noradId}` : null,
    t.regime ? `- regime: ${t.regime}` : null,
    t.launchYear != null ? `- launchYear: ${t.launchYear}` : null,
    t.busArchetype ? `- bus: ${t.busArchetype}` : "- bus: (unknown — no datasheet prior available)",
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

function renderFleetSnapshot(ctx: AgentContext): string {
  const s = ctx.fleetSnapshot;
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

function renderMemories(ctx: AgentContext): string {
  if (ctx.topMemories.length === 0) return "- (no prior memories this run)";
  return ctx.topMemories
    .slice(0, MAX_MEMORIES)
    .map((m) => `- [t${m.turnIndex}, ${m.kind}] ${truncate(m.content, 200)}`)
    .join("\n");
}

function renderObservable(ctx: AgentContext): string {
  if (ctx.observable.length === 0) return "- (nothing observed yet)";
  // Rendered in chronological order (oldest first) for readability, even though
  // the query returns DESC.
  const chrono = [...ctx.observable].reverse();
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

function renderGodEvents(ctx: AgentContext): string {
  if (ctx.godEvents.length === 0) return "- (no god-view injections active)";
  return ctx.godEvents
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
