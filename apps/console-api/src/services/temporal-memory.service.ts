import type {
  TemporalPatternExampleDto,
  TemporalPatternMemoryDto,
  TemporalPatternQueryDto,
  TemporalPatternQueryResultDto,
  TemporalPatternScoreComponentsDto,
  TemporalPatternStepDto,
} from "@interview/shared/dto";
import type {
  ListTemporalPatternsForMemoryInput,
  TemporalPatternMemoryRepositoryRow,
} from "../types/temporal.types";

export interface TemporalMemoryServiceDeps {
  patternRepo: {
    listForMemory(
      input: ListTemporalPatternsForMemoryInput,
    ): Promise<TemporalPatternMemoryRepositoryRow[]>;
  };
}

export class TemporalMemoryService {
  constructor(private readonly deps: TemporalMemoryServiceDeps) {}

  async queryPatterns(
    input: TemporalPatternQueryDto = {},
  ): Promise<TemporalPatternQueryResultDto> {
    const rows = await this.deps.patternRepo.listForMemory({
      statuses: input.includeAuditOnly ? ["accepted", "reviewable"] : ["accepted"],
      terminalStatus: input.terminalStatus,
      sourceDomain: input.sourceDomain,
      limit: normalizeLimit(input.limit),
    });

    return {
      patterns: rows.map(toPatternDto),
      nextCursor: null,
    };
  }
}

function toPatternDto(row: TemporalPatternMemoryRepositoryRow): TemporalPatternMemoryDto {
  const positiveExamples = row.examples.filter((example) => example.role === "positive");
  const counterexamples = row.examples.filter((example) => example.role !== "positive");

  return {
    patternId: row.hypothesis.id.toString(),
    patternHash: row.hypothesis.patternHash,
    status: row.hypothesis.status,
    sourceDomain: row.hypothesis.sourceDomain,
    terminalStatus: row.hypothesis.terminalStatus,
    patternScore: row.hypothesis.patternScore,
    supportCount: row.hypothesis.supportCount,
    negativeSupportCount: row.hypothesis.negativeSupportCount,
    baselineRate: row.hypothesis.baselineRate,
    patternRate: row.hypothesis.patternRate,
    lift: row.hypothesis.lift,
    bestComponentSignature: row.hypothesis.bestComponentSignature,
    bestComponentRate: row.hypothesis.bestComponentRate,
    sequenceLiftOverBestComponent: row.hypothesis.sequenceLiftOverBestComponent,
    leadTimeMsAvg: row.hypothesis.leadTimeMsAvg,
    leadTimeMsP50: row.hypothesis.leadTimeMsP50,
    leadTimeMsP95: row.hypothesis.leadTimeMsP95,
    temporalOrderQuality: row.hypothesis.temporalOrderQuality,
    containsTargetProxy: row.hypothesis.containsTargetProxy,
    containsSingletonOnly: row.hypothesis.containsSingletonOnly,
    patternWindowMs: row.hypothesis.patternWindowMs,
    patternVersion: row.hypothesis.patternVersion,
    sequence: row.steps.map(toStepDto),
    examples: positiveExamples.map(toExampleDto),
    counterexamples: counterexamples.map(toExampleDto),
    scoreComponents: toScoreComponentsDto(row.hypothesis.scoreComponentsJson),
    hypothesis: true,
    decisionAuthority: false,
  };
}

function toStepDto(
  step: TemporalPatternMemoryRepositoryRow["steps"][number],
): TemporalPatternStepDto {
  return {
    stepIndex: step.stepIndex,
    eventSignature: step.eventSignature,
    avgDeltaMs: step.avgDeltaMs,
    supportCount: step.supportCount,
  };
}

function toExampleDto(
  example: TemporalPatternMemoryRepositoryRow["examples"][number],
): TemporalPatternExampleDto {
  return {
    eventId: example.eventId,
    role: example.role,
    entityId: example.entityId,
    simRunId: example.simRunId?.toString() ?? null,
    fishIndex: example.fishIndex,
    turnIndex: example.turnIndex,
    embeddingId: example.embeddingId,
    occurredAt: example.occurredAt.toISOString(),
  };
}

function toScoreComponentsDto(
  components: TemporalPatternMemoryRepositoryRow["hypothesis"]["scoreComponentsJson"],
): TemporalPatternScoreComponentsDto {
  return {
    temporalWeight: components.temporal_weight,
    supportFactor: components.support_factor,
    liftFactor: components.lift_factor,
    negativePenalty: components.negative_penalty,
    stabilityFactor: components.stability_factor,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}
