import { randomUUID } from "node:crypto";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import type { ReplFindingSummaryView } from "../../../types/repl-chat.types";
import type {
  FollowUpCandidate,
  FollowUpEdgeRow,
  FollowUpPlan,
  FollowUpVerification,
  SsaReplFollowUpKind,
  SsaReplFollowUpDeps,
  FollowUpTemporalPattern,
} from "./repl-followup.types.ssa";

export class SsaReplFollowUpPolicy {
  private readonly usedDeepResearchSignatures = new Set<string>();

  constructor(
    private readonly deps: Pick<
      SsaReplFollowUpDeps,
      "edgeRepo" | "sim" | "sweep" | "temporalMemory"
    >,
  ) {}

  async plan(input: {
    query: string;
    parentCycleId: string;
    verification: FollowUpVerification | undefined;
    findings: ReplFindingSummaryView[];
  }): Promise<FollowUpPlan> {
    const verification = input.verification ?? {
      needsVerification: false,
      reasonCodes: [],
      confidence: 1,
      targetHints: [],
    };
    const ids = input.findings
      .map((f) => parseBigIntOrNull(f.id))
      .filter((id): id is bigint => id !== null);
    const edges = await this.deps.edgeRepo.findByFindingIds(ids);
    const temporalPatterns = await this.loadAcceptedTemporalPatterns(verification);
    const deepResearchAlreadyUsed = this.usedDeepResearchSignatures.has(
      deepResearchSignature(input.query),
    );
    const candidates = deduplicateCandidates(
      [
        ...extractCandidatesFromVerification(input.query, verification),
        ...extractCandidatesFromEdges(
          input.query,
          verification,
          edges,
          input.findings,
        ),
      ]
        .map((candidate) => scoreCandidate(candidate, verification))
        .map((candidate) =>
          applyTemporalHypothesis(candidate, temporalPatterns),
        ),
    )
      .filter(
        (candidate) =>
          !deepResearchAlreadyUsed || candidate.kind !== "deep_research_30d",
      )
      .sort((left, right) => right.score - left.score);

    const autoLaunched: ReplFollowUpPlanItem[] = [];
    const proposed: ReplFollowUpPlanItem[] = [];
    const dropped: ReplFollowUpPlanItem[] = [];

    let deepResearchUsed = false;
    let proofPipelineUsed = false;

    for (const candidate of candidates) {
      const autoLaunchAllowed = await this.canAutoLaunch(candidate);
      const item = toPlanItem(
        autoLaunchAllowed
          ? candidate
          : downgradeAutoLaunch(candidate),
      );
      const isDeep = candidate.kind === "deep_research_30d";
      const budgetAllows =
        autoLaunched.length < 2 &&
        (isDeep ? !deepResearchUsed : !proofPipelineUsed);
      if (candidate.autoEligible && autoLaunchAllowed && budgetAllows) {
        autoLaunched.push({ ...item, auto: true });
        if (isDeep) deepResearchUsed = true;
        else proofPipelineUsed = true;
        continue;
      }
      if (candidate.score >= 0.45 && candidate.gateScore >= 0.35) {
        proposed.push({ ...item, auto: false });
        continue;
      }
      dropped.push({ ...item, auto: false });
    }

    if (autoLaunched.some((item) => item.kind === "deep_research_30d")) {
      this.usedDeepResearchSignatures.add(deepResearchSignature(input.query));
    }

    return { autoLaunched, proposed, dropped };
  }

  private async canAutoLaunch(candidate: FollowUpCandidate): Promise<boolean> {
    if (!candidate.autoEligible) return false;

    switch (candidate.kind) {
      case "deep_research_30d":
        return true;
      case "sim_pc_verification": {
        const conjunctionId = Number(getTargetRef(candidate.target, "conjunctionId"));
        if (!Number.isFinite(conjunctionId)) return false;
        return (
          (await this.deps.sim?.preflight?.canStartPc?.({ conjunctionId })) ??
          false
        );
      }
      case "sim_telemetry_verification": {
        const satelliteId = Number(getTargetRef(candidate.target, "satelliteId"));
        if (!Number.isFinite(satelliteId)) return false;
        return (
          (await this.deps.sim?.preflight?.canStartTelemetry?.({ satelliteId })) ??
          false
        );
      }
      case "sweep_targeted_audit":
        return (
          this.deps.sweep?.nanoSweepService != null &&
          candidate.target?.entityType === "operator_country"
        );
    }
  }

  private async loadAcceptedTemporalPatterns(
    verification: FollowUpVerification,
  ): Promise<FollowUpTemporalPattern[]> {
    if (!verification.needsVerification || !this.deps.temporalMemory) return [];
    try {
      const result = await this.deps.temporalMemory.queryPatterns({ limit: 5 });
      return result.patterns.filter(isAcceptedTemporalHypothesis);
    } catch {
      return [];
    }
  }
}

function extractCandidatesFromVerification(
  query: string,
  verification: FollowUpVerification,
): FollowUpCandidate[] {
  const out: FollowUpCandidate[] = [];
  if (!verification.needsVerification) return out;

  if (
    !queryRequestsThirtyDays(query) &&
    verification.reasonCodes.some((code) =>
      [
        "horizon_insufficient",
        "needs_monitoring",
        "budget_exhausted",
        "iteration_limit_reached",
      ].includes(code),
    )
  ) {
    out.push({
      followupId: randomUUID(),
      kind: "deep_research_30d",
      title: buildDeepResearchTitle(query),
      rationale: buildDeepResearchRationale(
        query,
        "The parent cycle stopped with a monitoring / horizon signal.",
      ),
      reasonCodes: verification.reasonCodes,
      target: null,
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  const conjunctionHint = firstTargetHint(
    verification.targetHints,
    "conjunction_event",
  );
  if (conjunctionHint) {
    out.push({
      followupId: randomUUID(),
      kind: "sim_pc_verification",
      title: buildTitle(
        "sim_pc_verification",
        conjunctionHint.entityType,
        conjunctionHint.entityId,
      ),
      rationale:
        conjunctionHint.sourceTitle != null
          ? `Derived from "${conjunctionHint.sourceTitle}".`
          : "Derived from the parent verification signal.",
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sim_pc_verification",
        conjunctionHint.entityType,
        conjunctionHint.entityId,
      ),
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  const satelliteHint = firstTargetHint(verification.targetHints, "satellite");
  if (satelliteHint && verification.reasonCodes.includes("data_gap")) {
    out.push({
      followupId: randomUUID(),
      kind: "sim_telemetry_verification",
      title: buildTitle(
        "sim_telemetry_verification",
        satelliteHint.entityType,
        satelliteHint.entityId,
      ),
      rationale:
        satelliteHint.sourceTitle != null
          ? `Derived from "${satelliteHint.sourceTitle}".`
          : "Derived from the parent verification signal.",
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sim_telemetry_verification",
        satelliteHint.entityType,
        satelliteHint.entityId,
      ),
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  const operatorCountryHint = firstTargetHint(
    verification.targetHints,
    "operator_country",
  );
  if (operatorCountryHint && verification.reasonCodes.includes("data_gap")) {
    out.push({
      followupId: randomUUID(),
      kind: "sweep_targeted_audit",
      title: buildTitle(
        "sweep_targeted_audit",
        operatorCountryHint.entityType,
        operatorCountryHint.entityId,
      ),
      rationale:
        operatorCountryHint.sourceTitle != null
          ? `Derived from "${operatorCountryHint.sourceTitle}".`
          : "Derived from the parent verification signal.",
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sweep_targeted_audit",
        operatorCountryHint.entityType,
        operatorCountryHint.entityId,
      ),
      score: 0,
      gateScore: 0,
      costClass: "low",
      autoEligible: true,
    });
  }

  return out;
}

function extractCandidatesFromEdges(
  query: string,
  verification: FollowUpVerification,
  edges: FollowUpEdgeRow[],
  findings: ReplFindingSummaryView[],
): FollowUpCandidate[] {
  if (!verification.needsVerification) return [];
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const firstEdge = (entityType: string): FollowUpEdgeRow | undefined =>
    edges.find((edge) => edge.entity_type === entityType);
  const out: FollowUpCandidate[] = [];

  const conjunction = firstEdge("conjunction_event");
  if (conjunction) {
    out.push({
      followupId: randomUUID(),
      kind: "sim_pc_verification",
      title: buildTitle(
        "sim_pc_verification",
        "conjunction_event",
        conjunction.entity_id,
      ),
      rationale: buildEdgeRationale(findingsById.get(conjunction.finding_id)),
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sim_pc_verification",
        "conjunction_event",
        conjunction.entity_id,
      ),
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  const satellite = firstEdge("satellite");
  if (satellite && verification.reasonCodes.includes("data_gap")) {
    out.push({
      followupId: randomUUID(),
      kind: "sim_telemetry_verification",
      title: buildTitle(
        "sim_telemetry_verification",
        "satellite",
        satellite.entity_id,
      ),
      rationale: buildEdgeRationale(findingsById.get(satellite.finding_id)),
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sim_telemetry_verification",
        "satellite",
        satellite.entity_id,
      ),
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  const operatorCountry = firstEdge("operator_country");
  if (operatorCountry && verification.reasonCodes.includes("data_gap")) {
    out.push({
      followupId: randomUUID(),
      kind: "sweep_targeted_audit",
      title: buildTitle(
        "sweep_targeted_audit",
        "operator_country",
        operatorCountry.entity_id,
      ),
      rationale: buildEdgeRationale(findingsById.get(operatorCountry.finding_id)),
      reasonCodes: verification.reasonCodes,
      target: toTarget(
        "sweep_targeted_audit",
        "operator_country",
        operatorCountry.entity_id,
      ),
      score: 0,
      gateScore: 0,
      costClass: "low",
      autoEligible: true,
    });
  }

  if (
    !queryRequestsThirtyDays(query) &&
    verification.reasonCodes.includes("needs_monitoring")
  ) {
    out.push({
      followupId: randomUUID(),
      kind: "deep_research_30d",
      title: buildDeepResearchTitle(query),
      rationale: buildDeepResearchRationale(
        query,
        "The parent cycle still recommends monitoring after the first pass.",
      ),
      reasonCodes: verification.reasonCodes,
      target: null,
      score: 0,
      gateScore: 0,
      costClass: "medium",
      autoEligible: true,
    });
  }

  return out;
}

function scoreCandidate(
  candidate: FollowUpCandidate,
  verification: FollowUpVerification,
): FollowUpCandidate {
  let actionability = 0.5;
  let targetability = candidate.target ? 0.95 : 0.7;
  let expectedYield = 0.55;
  const confidence = clamp01(
    Math.max(verification.confidence, candidate.target ? 0.65 : 0.6),
  );
  let costPenalty = candidate.costClass === "medium" ? 0.12 : 0.05;

  switch (candidate.kind) {
    case "deep_research_30d":
      actionability = candidate.reasonCodes.some((code) =>
        ["horizon_insufficient", "needs_monitoring"].includes(code),
      )
        ? 0.85
        : 0.6;
      targetability = 0.85;
      expectedYield = candidate.reasonCodes.includes("budget_exhausted")
        ? 0.8
        : 0.7;
      break;
    case "sim_pc_verification":
      actionability = 0.9;
      targetability = getTargetRef(candidate.target, "conjunctionId") ? 1 : 0;
      expectedYield = candidate.reasonCodes.includes("needs_monitoring")
        ? 0.82
        : 0.7;
      costPenalty = 0.14;
      break;
    case "sim_telemetry_verification":
      actionability = candidate.reasonCodes.includes("data_gap") ? 0.82 : 0.55;
      targetability = getTargetRef(candidate.target, "satelliteId") ? 1 : 0;
      expectedYield = candidate.reasonCodes.includes("low_confidence_round")
        ? 0.76
        : 0.68;
      costPenalty = 0.14;
      break;
    case "sweep_targeted_audit":
      actionability = candidate.reasonCodes.includes("data_gap") ? 0.78 : 0.45;
      targetability =
        candidate.target?.entityType === "operator_country" ? 1 : 0.25;
      expectedYield =
        candidate.target?.entityType === "operator_country" ? 0.7 : 0.35;
      costPenalty = 0.06;
      break;
  }

  const score =
    0.3 * actionability +
    0.25 * targetability +
    0.25 * expectedYield +
    0.2 * confidence -
    costPenalty;
  const gateScore = Math.min(actionability, targetability, confidence);
  const autoEligible =
    candidate.autoEligible &&
    score >= 0.65 &&
    gateScore >= 0.55 &&
    (candidate.kind !== "sweep_targeted_audit" ||
      candidate.target?.entityType === "operator_country");

  return {
    ...candidate,
    score: roundScore(score),
    gateScore: roundScore(gateScore),
    autoEligible,
  };
}

function applyTemporalHypothesis(
  candidate: FollowUpCandidate,
  patterns: FollowUpTemporalPattern[],
): FollowUpCandidate {
  if (!isFishVerification(candidate.kind)) return candidate;
  const pattern = bestTemporalPattern(patterns, candidate.kind);
  if (!pattern || !candidate.target) return candidate;

  const refs = {
    ...(candidate.target.refs ?? {}),
    seededByPatternId: pattern.patternId,
    temporalPatternId: pattern.patternId,
    temporalPatternHash: pattern.patternHash,
  };
  return {
    ...candidate,
    reasonCodes: addUnique(candidate.reasonCodes, "temporal_hypothesis"),
    rationale: `${candidate.rationale} ${temporalRationale(pattern)}`,
    target: {
      ...candidate.target,
      refs,
    },
  };
}

function isFishVerification(kind: SsaReplFollowUpKind): boolean {
  return kind === "sim_pc_verification" || kind === "sim_telemetry_verification";
}

function bestTemporalPattern(
  patterns: FollowUpTemporalPattern[],
  kind: SsaReplFollowUpKind,
): FollowUpTemporalPattern | null {
  const ranked = patterns
    .filter((pattern) => pattern.status === "accepted")
    .filter((pattern) => pattern.hypothesis === true)
    .filter((pattern) => pattern.decisionAuthority === false)
    .map((pattern) => ({
      pattern,
      rank: temporalPatternRank(pattern, kind),
    }))
    .filter((row) => row.rank > 0)
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      return right.pattern.patternScore - left.pattern.patternScore;
    });
  return ranked[0]?.pattern ?? null;
}

function temporalPatternRank(
  pattern: FollowUpTemporalPattern,
  kind: SsaReplFollowUpKind,
): number {
  const haystack = [
    pattern.terminalStatus,
    ...pattern.sequence.map((step) => step.eventSignature),
  ]
    .join("\n")
    .toLowerCase();
  let rank = 1 + pattern.patternScore;
  if (kind === "sim_pc_verification") {
    if (haystack.includes("pc") || haystack.includes("relative_velocity")) {
      rank += 1;
    }
  }
  if (kind === "sim_telemetry_verification") {
    if (haystack.includes("telemetry") || haystack.includes("data_gap")) {
      rank += 1;
    }
  }
  if (pattern.sourceDomain === "simulation_seeded") rank -= 1;
  return rank;
}

function temporalRationale(pattern: FollowUpTemporalPattern): string {
  const lift =
    typeof pattern.lift === "number" && Number.isFinite(pattern.lift)
      ? `, lift ${roundScore(pattern.lift)}`
      : "";
  return (
    `Temporal hypothesis ${pattern.patternId} is accepted read-only evidence for ` +
    `${pattern.terminalStatus} trajectories (score ${roundScore(pattern.patternScore)}, ` +
    `support ${pattern.supportCount}, negative ${pattern.negativeSupportCount}${lift}); ` +
    "it has no decision authority."
  );
}

function isAcceptedTemporalHypothesis(
  pattern: FollowUpTemporalPattern,
): boolean {
  return (
    pattern.status === "accepted" &&
    pattern.hypothesis === true &&
    pattern.decisionAuthority === false
  );
}

function addUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function deduplicateCandidates(
  candidates: FollowUpCandidate[],
): FollowUpCandidate[] {
  const byKey = new Map<string, FollowUpCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.kind,
      candidate.target?.entityType ?? "none",
      candidate.target?.entityId ?? "none",
      JSON.stringify(candidate.target?.refs ?? {}),
    ].join(":");
    const prev = byKey.get(key);
    if (!prev || candidate.score > prev.score) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function downgradeAutoLaunch(candidate: FollowUpCandidate): FollowUpCandidate {
  if (!candidate.autoEligible) return candidate;
  return {
    ...candidate,
    autoEligible: false,
    rationale:
      `${candidate.rationale} Auto-launch held back because the target is not currently launchable.`,
  };
}

function toPlanItem(candidate: FollowUpCandidate): ReplFollowUpPlanItem {
  return {
    followupId: candidate.followupId,
    kind: candidate.kind,
    auto: false,
    title: candidate.title,
    rationale: candidate.rationale,
    score: candidate.score,
    gateScore: candidate.gateScore,
    costClass: candidate.costClass,
    reasonCodes: candidate.reasonCodes,
    target: candidate.target ?? null,
  };
}

function queryRequestsThirtyDays(query: string): boolean {
  return /\b30(?:\s+\p{L}+){0,4}\s+jours?\b|\b30[- ]day\b|\b30 days\b|\bmonth\b|\bmonthly\b/iu.test(
    query,
  );
}

function deepResearchSignature(query: string): string {
  return query
    .toLowerCase()
    .replace(/\bcycle\s+\S+/g, "cycle")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function buildDeepResearchTitle(query: string): string {
  const low = query.toLowerCase();
  if (/\b(launch|launches|lancement|lancements|manifest)\b/.test(low)) {
    return "Corroborate launch report over 30 days";
  }
  if (/\b(conjunction|collision|pc|conjonctions?)\b/.test(low)) {
    return "Extend conjunction verification to 30 days";
  }
  if (/\b(fleet|flotte|operator|operateur|opérateur)\b/.test(low)) {
    return "Extend operator risk verification to 30 days";
  }
  if (/\b(audit|catalog|catalogue|quality|qualite|qualité)\b/.test(low)) {
    return "Extend catalog audit verification to 30 days";
  }
  return "Extend verification horizon to 30 days";
}

function buildDeepResearchRationale(query: string, base: string): string {
  const low = query.toLowerCase();
  if (/\b(launch|launches|lancement|lancements|manifest)\b/.test(low)) {
    return `${base} The follow-up stays launch-focused and checks the same manifest horizon.`;
  }
  if (/\b(conjunction|collision|pc|conjonctions?)\b/.test(low)) {
    return `${base} The follow-up stays focused on conjunction risk verification.`;
  }
  if (/\b(audit|catalog|catalogue|quality|qualite|qualité)\b/.test(low)) {
    return `${base} The follow-up stays focused on catalog evidence quality.`;
  }
  return base;
}

function buildTitle(
  kind: SsaReplFollowUpKind,
  entityType: string | null,
  entityId: bigint | string | null,
): string {
  switch (kind) {
    case "deep_research_30d":
      return "Extend verification horizon to 30 days";
    case "sim_pc_verification":
      return `Verify conjunction ${String(entityId ?? "?")} with a Pc swarm`;
    case "sim_telemetry_verification":
      return `Verify telemetry gaps on satellite ${String(entityId ?? "?")}`;
    case "sweep_targeted_audit":
      return `Run a targeted audit on ${entityType ?? "entity"} ${String(entityId ?? "?")}`;
  }
}

function toTarget(
  kind: SsaReplFollowUpKind,
  entityType: string | null,
  entityId: bigint | string | null,
): ReplFollowUpPlanItem["target"] {
  const strId = entityId == null ? null : String(entityId);
  switch (kind) {
    case "deep_research_30d":
      return null;
    case "sim_pc_verification":
      return {
        entityType,
        entityId: strId,
        refs: strId ? { conjunctionId: strId } : null,
      };
    case "sim_telemetry_verification":
      return {
        entityType,
        entityId: strId,
        refs: strId ? { satelliteId: strId } : null,
      };
    case "sweep_targeted_audit":
      return {
        entityType,
        entityId: strId,
      };
  }
}

function buildEdgeRationale(
  finding: ReplFindingSummaryView | undefined,
): string {
  if (!finding) return "Derived from the parent cycle evidence graph.";
  return `Derived from #${finding.id}: ${finding.title}.`;
}

function parseBigIntOrNull(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function getTargetRef(
  target: ReplFollowUpPlanItem["target"] | undefined,
  key: string,
): string | null {
  const value = target?.refs?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstTargetHint(
  targetHints: FollowUpVerification["targetHints"] | undefined,
  entityType: string,
): NonNullable<FollowUpVerification["targetHints"]>[number] | undefined {
  return targetHints?.find((hint) => hint.entityType === entityType);
}
