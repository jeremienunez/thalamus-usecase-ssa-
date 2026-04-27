import { createHash } from "node:crypto";
import type { TemporalSourceDomain } from "@interview/db-schema";
import type { SimReviewEvidenceRow } from "../types/sim-review-evidence.types";
import type { SimRunRow } from "../types/sim-run.types";
import type {
  CreateTemporalProjectionRunInput,
  InsertTemporalEventInput,
  TemporalProjectionRunRow,
} from "../types/temporal.types";

const DEFAULT_PROJECTION_VERSION = "temporal-projection-v0.2.0";

export interface TemporalProjectionServiceDeps {
  projectionRunRepo: {
    create(input: CreateTemporalProjectionRunInput): Promise<TemporalProjectionRunRow>;
    complete(
      projectionRunId: bigint,
      metricsJson: Record<string, unknown>,
    ): Promise<void>;
    fail(projectionRunId: bigint, metricsJson: Record<string, unknown>): Promise<void>;
  };
  eventRepo: {
    insertMany(events: InsertTemporalEventInput[]): Promise<number>;
  };
  reviewEvidenceRepo: {
    listCreatedBetween(from: Date, to: Date): Promise<SimReviewEvidenceRow[]>;
  };
  simRunRepo: {
    listTerminalCompletedBetween(from: Date, to: Date): Promise<SimRunRow[]>;
  };
}

export interface ProjectClosedWindowInput {
  from: Date;
  to: Date;
  sourceScope?: string;
  projectionVersion?: string;
}

export interface TemporalProjectionSummary {
  projectionRunId: bigint;
  projectionVersion: string;
  sourceScope: string;
  inputSnapshotHash: string;
  reviewEvidenceCount: number;
  simRunCount: number;
  eventCount: number;
  insertedEventCount: number;
}

export class TemporalProjectionService {
  constructor(private readonly deps: TemporalProjectionServiceDeps) {}

  async projectClosedWindow(
    input: ProjectClosedWindowInput,
  ): Promise<TemporalProjectionSummary> {
    assertClosedWindow(input.from, input.to);
    const projectionVersion = input.projectionVersion ?? DEFAULT_PROJECTION_VERSION;
    const sourceScope = input.sourceScope ?? "closed-window";
    const [reviewEvidence, simRuns] = await Promise.all([
      this.deps.reviewEvidenceRepo.listCreatedBetween(input.from, input.to),
      this.deps.simRunRepo.listTerminalCompletedBetween(input.from, input.to),
    ]);
    const inputSnapshotHash = hashJson({
      projectionVersion,
      sourceScope,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      reviewEvidenceIds: reviewEvidence.map((row) => String(row.id)),
      simRunIds: simRuns.map((row) => String(row.id)),
    });

    const projectionRun = await this.deps.projectionRunRepo.create({
      projectionVersion,
      sourceScope,
      fromTs: input.from,
      toTs: input.to,
      inputSnapshotHash,
      status: "running",
    });

    try {
      const events = sortEvents([
        ...reviewEvidence.map((row) =>
          projectReviewEvidence(row, projectionRun.id, projectionVersion),
        ),
        ...simRuns.map((row) =>
          projectCompletedSimRun(row, projectionRun.id, projectionVersion),
        ),
      ]);
      const insertedEventCount = await this.deps.eventRepo.insertMany(events);
      const summary: TemporalProjectionSummary = {
        projectionRunId: projectionRun.id,
        projectionVersion,
        sourceScope,
        inputSnapshotHash,
        reviewEvidenceCount: reviewEvidence.length,
        simRunCount: simRuns.length,
        eventCount: events.length,
        insertedEventCount,
      };
      await this.deps.projectionRunRepo.complete(projectionRun.id, {
        reviewEvidenceCount: summary.reviewEvidenceCount,
        simRunCount: summary.simRunCount,
        eventCount: summary.eventCount,
        insertedEventCount: summary.insertedEventCount,
      });
      return summary;
    } catch (err) {
      await this.deps.projectionRunRepo.fail(projectionRun.id, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

function projectReviewEvidence(
  row: SimReviewEvidenceRow,
  projectionRunId: bigint,
  projectionVersion: string,
): InsertTemporalEventInput {
  const eventType = reviewEventType(row);
  const sourcePk = String(row.id);
  const event: InsertTemporalEventInput = {
    id: canonicalTemporalEventId({
      projectionVersion,
      sourceTable: "sim_review_evidence",
      sourcePk,
      eventType,
    }),
    projectionRunId,
    eventType,
    eventSource: "review",
    entityId: `sim_swarm:${row.swarmId}`,
    simRunId: row.simRunId,
    occurredAt: row.createdAt,
    sourceDomain: "simulation",
    sourceTable: "sim_review_evidence",
    sourcePk,
    payloadHash: hashJson({
      question: row.question,
      answer: row.answer,
      evidenceRefs: row.evidenceRefs,
      traceExcerpt: row.traceExcerpt,
    }),
    canonicalSignature: "",
    metadataJson: {
      swarmId: String(row.swarmId),
      scope: row.scope,
      createdBy: row.createdBy?.toString() ?? null,
    },
  };
  return { ...event, canonicalSignature: canonicalEventSignature(event) };
}

function projectCompletedSimRun(
  row: SimRunRow,
  projectionRunId: bigint,
  projectionVersion: string,
): InsertTemporalEventInput {
  const seededByPatternId = extractSeededByPatternId(row);
  const sourcePk = String(row.id);
  const terminalStatus = terminalStatusFromRun(row);
  const sourceDomain: TemporalSourceDomain = seededByPatternId
    ? "simulation_seeded"
    : "simulation";
  const event: InsertTemporalEventInput = {
    id: canonicalTemporalEventId({
      projectionVersion,
      sourceTable: "sim_run",
      sourcePk,
      eventType: "fish.sim_run_completed",
    }),
    projectionRunId,
    eventType: "fish.sim_run_completed",
    eventSource: "fish",
    entityId: `sim_swarm:${row.swarmId}`,
    simRunId: row.id,
    fishIndex: row.fishIndex,
    occurredAt: row.completedAt ?? row.startedAt,
    terminalStatus,
    seededByPatternId,
    sourceDomain,
    sourceTable: "sim_run",
    sourcePk,
    payloadHash: hashJson({
      swarmId: String(row.swarmId),
      fishIndex: row.fishIndex,
      kind: row.kind,
      status: row.status,
      seedApplied: row.seedApplied,
      perturbation: row.perturbation,
    }),
    canonicalSignature: "",
    metadataJson: {
      swarmId: String(row.swarmId),
      kind: row.kind,
      runStatus: row.status,
    },
  };
  return { ...event, canonicalSignature: canonicalEventSignature(event) };
}

function reviewEventType(row: SimReviewEvidenceRow): string {
  const text = `${row.question}\n${row.answer}`.toLowerCase();
  if (text.includes("relative velocity") || text.includes("vitesse relative")) {
    return "review.missing_relative_velocity";
  }
  if (text.includes("uncertain") || text.includes("incertain")) {
    return "review.high_uncertainty";
  }
  return "review.evidence_recorded";
}

function terminalStatusFromRun(row: SimRunRow): string {
  switch (row.status) {
    case "done":
      return "resolved";
    case "timeout":
      return "timeout";
    case "failed":
      return "anomaly";
    default:
      return "unknown";
  }
}

function extractSeededByPatternId(row: SimRunRow): string | null {
  return (
    stringField(row.seedApplied, "seeded_by_pattern_id") ??
    stringField(row.seedApplied, "seededByPatternId") ??
    stringField(row.perturbation, "seeded_by_pattern_id") ??
    stringField(row.perturbation, "seededByPatternId")
  );
}

function stringField(value: unknown, key: string): string | null {
  if (value == null || typeof value !== "object") return null;
  const found = (value as Record<string, unknown>)[key];
  if (typeof found === "string" && found.trim().length > 0) return found;
  if (typeof found === "number" && Number.isFinite(found)) return String(found);
  if (typeof found === "bigint") return found.toString();
  return null;
}

function canonicalEventSignature(event: Pick<
  InsertTemporalEventInput,
  "eventType" | "eventSource" | "actionKind" | "terminalStatus"
>): string {
  return [
    event.eventType,
    event.eventSource,
    event.actionKind ?? "none",
    event.terminalStatus ?? "none",
  ].join("|");
}

function canonicalTemporalEventId(input: {
  projectionVersion: string;
  sourceTable: string;
  sourcePk: string;
  eventType: string;
}): string {
  return hashStableParts([
    input.projectionVersion,
    input.sourceTable,
    input.sourcePk,
    input.eventType,
  ]);
}

function assertClosedWindow(from: Date, to: Date): void {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error("temporal projection window requires valid dates");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("temporal projection window requires from < to");
  }
}

function sortEvents(events: InsertTemporalEventInput[]): InsertTemporalEventInput[] {
  return [...events].sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.id.localeCompare(right.id),
  );
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function hashStableParts(parts: string[]): string {
  return createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value != null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}
