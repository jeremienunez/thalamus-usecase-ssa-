/**
 * SSA pre-summarize strategy.
 *
 * Per-cortex aggregation before LLM narration. Karpathy pattern: SQL does
 * the math, pre-summarize groups/buckets the rows into insights, LLM
 * narrates the verdict. Consumed by the kernel via `DomainConfig.preSummarize`.
 */

export function preSummarize(
  rows: Record<string, unknown>[],
  cortexName: string,
): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  if (cortexName === "apogee_tracker") {
    return summarizeApogee(rows);
  }
  if (cortexName === "fleet_analyst" || cortexName === "advisory_radar") {
    return rows; // already aggregated by SQL
  }
  if (cortexName === "classification_auditor") {
    return summarizeClassificationAudit(rows);
  }
  if (cortexName === "payload_profiler") {
    return summarizePayloadProfile(rows);
  }

  // Default: top-10 pass-through.
  return rows.slice(0, 10);
}

function summarizeApogee(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const signals = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const phase = String(row.currentPhase ?? "unknown");
    const yearsToEol = Number(row.yearsToEol) || 0;

    let signal = "HOLD";
    if (phase === "nominal" && yearsToEol > 5) signal = "HEALTHY";
    else if (phase === "nominal" && yearsToEol > 0 && yearsToEol <= 2)
      signal = "PLAN_REPLACEMENT";
    else if (phase === "extended") signal = "RETIRE_OR_DEORBIT";
    else if (phase === "degraded") signal = "URGENT_REPLACE";

    if (!signals.has(signal)) signals.set(signal, []);
    signals.get(signal)!.push(row);
  }

  const insights: Record<string, unknown>[] = [];
  for (const [signal, satellites] of signals) {
    if (signal === "HOLD" || signal === "HEALTHY") continue;
    insights.push({
      type: "mission_health_signal",
      signal,
      count: satellites.length,
      topSatellites: satellites.slice(0, 3).map((s) => ({
        name: String(s.name).slice(0, 60),
        operator: s.operatorName,
        orbitRegime: s.orbitRegimeName,
        currentPhase: s.currentPhase,
        yearsToEol: s.yearsToEol,
        id: s.id,
      })),
    });
  }
  return insights;
}

function summarizeClassificationAudit(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const bySeverity = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const sev = String(row.severity ?? "medium");
    if (!bySeverity.has(sev)) bySeverity.set(sev, []);
    bySeverity.get(sev)!.push(row);
  }
  const insights: Record<string, unknown>[] = [];
  for (const [severity, items] of bySeverity) {
    const totalAffected = items.reduce(
      (s, i) => s + (Number(i.count) || 0),
      0,
    );
    insights.push({
      type: "audit_group",
      severity,
      issueTypes: items.length,
      totalAffectedEntities: totalAffected,
      items: items.slice(0, 5),
    });
  }
  return insights;
}

function summarizePayloadProfile(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const type = String(row.type ?? "unknown");
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(row);
  }

  const insights: Record<string, unknown>[] = [];

  const identity = byType.get("identity")?.[0];
  if (identity) insights.push(identity);

  const satelliteDist = byType.get("satellite_distribution") ?? [];
  if (satelliteDist.length > 0) {
    insights.push({
      type: "satellite_distribution_summary",
      operatorCount: satelliteDist.length,
      distribution: satelliteDist.slice(0, 10),
    });
  }

  const payloadMatches = byType.get("payload_mission") ?? [];
  if (payloadMatches.length > 0) {
    insights.push({
      type: "mission_summary",
      matchCount: payloadMatches.length,
      matches: payloadMatches.slice(0, 10),
    });
  }

  const batchTargets = byType.get("batch_target") ?? [];
  if (batchTargets.length > 0) insights.push(...batchTargets);

  const findings = byType.get("prior_finding") ?? [];
  if (findings.length > 0) {
    insights.push({
      type: "prior_findings_summary",
      count: findings.length,
      findings: findings.slice(0, 5),
    });
  }

  return insights;
}
