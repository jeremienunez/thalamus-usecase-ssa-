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
} from "./repl-followup.types.ssa";

export class SsaReplFollowUpPolicy {
  constructor(
    private readonly deps: Pick<SsaReplFollowUpDeps, "edgeRepo" | "sim" | "sweep">,
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
    const candidates = deduplicateCandidates(
      [
        ...extractCandidatesFromVerification(input.query, verification),
        ...extractCandidatesFromEdges(
          input.query,
          verification,
          edges,
          input.findings,
        ),
      ].map((candidate) => scoreCandidate(candidate, verification)),
    ).sort((left, right) => right.score - left.score);

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
      title: "Extend verification horizon to 30 days",
      rationale: "The parent cycle stopped with a monitoring / horizon signal.",
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
      title: "Extend verification horizon to 30 days",
      rationale:
        "The parent cycle still recommends monitoring after the first pass.",
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
  return /\b30 ?jours\b|\b30[- ]day\b|\b30 days\b|\bmonth\b|\bmonthly\b/i.test(
    query,
  );
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
