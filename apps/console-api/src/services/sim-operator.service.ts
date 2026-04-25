import type {
  AskSimReviewQuestionDto,
  FishTimelineDto,
  FishTraceDto,
  OperatorSwarmListDto,
  OperatorSwarmStatusDto,
  SimReviewEvidenceDto,
  SwarmClustersDto,
  SwarmFishCountsDto,
} from "@interview/shared/dto/sim-http.dto";
import type { SimReviewScope, SimSwarmStatus } from "@interview/db-schema";
import type { SwarmService } from "@interview/sweep/internal";
import type { LlmTransportFactory } from "./llm-transport.port";
import { HttpError } from "../utils/http-error";
import type {
  ListOperatorSwarmsInput,
  SimSwarmRow,
} from "../types/sim-swarm.types";
import type { SimRunRow, SimSwarmFishCounts } from "../types/sim-run.types";
import type { SimAgentRow } from "../types/sim-agent.types";
import type { SimTurnRow } from "../types/sim-turn.types";
import type { SimFishTerminalRow } from "../types/sim-terminal.types";
import type {
  InsertSimReviewEvidenceInput,
  SimReviewEvidenceRow,
} from "../types/sim-review-evidence.types";

const AGGREGATE_KEYS = ["aggregate", "pcAggregate", "telemetryAggregate"] as const;
type AggregateKey = (typeof AGGREGATE_KEYS)[number];

const SIM_REVIEW_QA_PROMPT = `You answer post-run simulation review questions for an operator.
Use only the JSON context provided by the API. Do not invent unavailable facts.
Keep the answer concise and point to the relevant swarm, fish, turn, terminal, or aggregate evidence ids when useful.`;

export interface AskSimReviewQuestionInput {
  swarmId: bigint;
  scope: SimReviewScope;
  question: string;
  fishIndex?: number;
  clusterIndex?: number;
  clusterLabel?: string;
  createdBy?: bigint | null;
  signal?: AbortSignal;
}

export interface SimOperatorEvent {
  event: "status" | "aggregate" | "terminals" | "done";
  data: Record<string, unknown>;
}

export interface SimOperatorServiceDeps {
  swarmRepo: {
    findById(swarmId: bigint): Promise<SimSwarmRow | null>;
    listForOperator(input: ListOperatorSwarmsInput): Promise<{
      rows: SimSwarmRow[];
      nextCursor: bigint | null;
    }>;
  };
  runRepo: {
    countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts>;
    findBySwarmFish(swarmId: bigint, fishIndex: number): Promise<SimRunRow | null>;
  };
  agentRepo: {
    listByRun(simRunId: bigint): Promise<SimAgentRow[]>;
  };
  turnRepo: {
    listTimelineForRun(simRunId: bigint): Promise<SimTurnRow[]>;
  };
  terminalRepo: {
    listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]>;
  };
  evidenceRepo: {
    insert(input: InsertSimReviewEvidenceInput): Promise<SimReviewEvidenceRow>;
    listForSwarm(swarmId: bigint): Promise<SimReviewEvidenceRow[]>;
  };
  swarmStatus: Pick<SwarmService, "status">;
  llm: LlmTransportFactory;
}

export class SimOperatorService {
  constructor(private readonly deps: SimOperatorServiceDeps) {}

  async listSwarms(input: {
    status?: SimSwarmStatus;
    kind?: string;
    limit: number;
    cursor?: bigint;
  }): Promise<OperatorSwarmListDto> {
    const page = await this.deps.swarmRepo.listForOperator(input);
    const counts = await Promise.all(
      page.rows.map((swarm) => this.deps.runRepo.countFishByStatus(swarm.id)),
    );
    return {
      swarms: page.rows.map((swarm, index) => ({
        id: String(swarm.id),
        kind: swarm.kind,
        title: swarm.title,
        size: swarm.size,
        status: swarm.status,
        counts: toCountsDto(counts[index]!),
        aggregateKeys: aggregateKeysOf(swarm.config),
        outcomeReportFindingId: swarm.outcomeReportFindingId?.toString() ?? null,
        suggestionId: swarm.suggestionId?.toString() ?? null,
        startedAt: swarm.startedAt.toISOString(),
        completedAt: swarm.completedAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor?.toString() ?? null,
    };
  }

  async getStatus(swarmId: bigint): Promise<OperatorSwarmStatusDto> {
    const swarm = await this.requireSwarm(swarmId);
    const status = await this.deps.swarmStatus.status(Number(swarmId));
    if (!status) throw HttpError.notFound(`sim_swarm ${swarmId} not found`);
    return {
      swarmId: String(status.swarmId),
      kind: status.kind,
      status: status.status,
      size: status.size,
      done: status.done,
      failed: status.failed,
      timeout: status.timeout,
      running: status.running,
      pending: status.pending,
      reportFindingId:
        status.reportFindingId === null ? null : String(status.reportFindingId),
      suggestionId: status.suggestionId === null ? null : String(status.suggestionId),
      aggregateKeys: aggregateKeysOf(swarm.config),
    };
  }

  async *streamSwarmEvents(
    swarmId: bigint,
    signal?: AbortSignal,
  ): AsyncGenerator<SimOperatorEvent> {
    let lastAggregateSignature = "";
    let lastTerminalSignature = "";

    while (!signal?.aborted) {
      const status = await this.getStatus(swarmId);
      yield { event: "status", data: status as unknown as Record<string, unknown> };

      const clusters = await this.getClusters(swarmId);
      const aggregateSignature = JSON.stringify({
        source: clusters.source,
        keys: status.aggregateKeys,
        clusters: clusters.clusters.length,
      });
      if (aggregateSignature !== lastAggregateSignature) {
        lastAggregateSignature = aggregateSignature;
        yield { event: "aggregate", data: clusters as unknown as Record<string, unknown> };
      }

      const terminals = await this.deps.terminalRepo.listTerminalsForSwarm(swarmId);
      const terminalSignature = terminals
        .map((row) => `${row.fishIndex}:${row.runStatus}:${row.turnsPlayed}`)
        .join("|");
      if (terminalSignature !== lastTerminalSignature) {
        lastTerminalSignature = terminalSignature;
        yield {
          event: "terminals",
          data: {
            swarmId: String(swarmId),
            count: terminals.length,
            terminals: terminals.map(toTerminalEventDto),
          },
        };
      }

      if (status.status === "done" || status.status === "failed") {
        yield { event: "done", data: { swarmId: String(swarmId), status: status.status } };
        return;
      }

      await sleep(1_000, signal);
    }
  }

  async getFishTimeline(
    swarmId: bigint,
    fishIndex: number,
  ): Promise<FishTimelineDto> {
    const run = await this.requireRunByFish(swarmId, fishIndex);
    const [agents, turns] = await Promise.all([
      this.deps.agentRepo.listByRun(run.id),
      this.deps.turnRepo.listTimelineForRun(run.id),
    ]);
    return toTimelineDto(run, agents, turns);
  }

  async getClusters(swarmId: bigint): Promise<SwarmClustersDto> {
    const swarm = await this.requireSwarm(swarmId);
    const extracted = extractAggregate(swarm.config);
    return {
      swarmId: String(swarm.id),
      source: extracted.source,
      clusters: extracted.clusters,
      summary: extracted.summary,
    };
  }

  async getFishTrace(swarmId: bigint, fishIndex: number): Promise<FishTraceDto> {
    return {
      ...(await this.getFishTimeline(swarmId, fishIndex)),
      exportedAt: new Date().toISOString(),
    };
  }

  async askQuestion(
    input: AskSimReviewQuestionInput,
  ): Promise<AskSimReviewQuestionDto> {
    const status = await this.getStatus(input.swarmId);
    if (status.status !== "done" && status.status !== "failed") {
      throw HttpError.conflict("sim review Q&A is only available for terminal swarms");
    }

    const context = await this.buildQuestionContext(input);
    const llmContext = {
      ...context,
      simRunId: context.simRunId?.toString() ?? null,
    };
    const response = await this.deps.llm
      .create(SIM_REVIEW_QA_PROMPT)
      .call(JSON.stringify(llmContext, null, 2), { signal: input.signal });

    const inserted = await this.deps.evidenceRepo.insert({
      swarmId: input.swarmId,
      simRunId: context.simRunId,
      scope: input.scope,
      question: input.question,
      answer: response.content,
      evidenceRefs: context.evidenceRefs,
      traceExcerpt: context.traceExcerpt,
      createdBy: input.createdBy ?? null,
    });

    return {
      evidence: toEvidenceDto(inserted),
      provider: response.provider,
    };
  }

  async listEvidence(swarmId: bigint): Promise<SimReviewEvidenceDto[]> {
    await this.requireSwarm(swarmId);
    const rows = await this.deps.evidenceRepo.listForSwarm(swarmId);
    return rows.map(toEvidenceDto);
  }

  private async buildQuestionContext(input: AskSimReviewQuestionInput): Promise<{
    simRunId: bigint | null;
    evidenceRefs: Array<Record<string, unknown>>;
    traceExcerpt: Record<string, unknown>;
  }> {
    const [swarm, status, clusters, terminals] = await Promise.all([
      this.requireSwarm(input.swarmId),
      this.getStatus(input.swarmId),
      this.getClusters(input.swarmId),
      this.deps.terminalRepo.listTerminalsForSwarm(input.swarmId),
    ]);

    const baseRefs: Array<Record<string, unknown>> = [
      { kind: "sim_swarm", id: String(input.swarmId) },
      ...status.aggregateKeys.map((key) => ({
        kind: "sim_swarm_aggregate",
        swarmId: String(input.swarmId),
        key,
      })),
    ];
    const base = {
      question: input.question,
      scope: input.scope,
      swarm: toQuestionSwarm(swarm),
      status,
      clusters,
      terminals: terminals.map(toTerminalEventDto),
    };

    if (input.scope === "fish") {
      if (input.fishIndex === undefined) {
        throw HttpError.badRequest("fishIndex is required for fish-scoped Q&A");
      }
      const timeline = await this.getFishTimeline(input.swarmId, input.fishIndex);
      const turnRefs = timeline.turns.map((turn) => ({
        kind: "sim_turn",
        id: turn.id,
        turnIndex: turn.turnIndex,
      }));
      return {
        simRunId: BigInt(timeline.simRunId),
        evidenceRefs: [
          ...baseRefs,
          { kind: "sim_run", id: timeline.simRunId, fishIndex: timeline.fishIndex },
          ...turnRefs,
        ],
        traceExcerpt: { ...base, fish: timeline },
      };
    }

    if (input.scope === "cluster") {
      const selected = selectCluster(clusters.clusters, input);
      return {
        simRunId: null,
        evidenceRefs: [
          ...baseRefs,
          {
            kind: "sim_cluster",
            swarmId: String(input.swarmId),
            index: selected.index,
            label: selected.label,
          },
        ],
        traceExcerpt: { ...base, cluster: selected.cluster },
      };
    }

    return {
      simRunId: null,
      evidenceRefs: baseRefs,
      traceExcerpt: base,
    };
  }

  private async requireSwarm(swarmId: bigint): Promise<SimSwarmRow> {
    const swarm = await this.deps.swarmRepo.findById(swarmId);
    if (!swarm) throw HttpError.notFound(`sim_swarm ${swarmId} not found`);
    return swarm;
  }

  private async requireRunByFish(
    swarmId: bigint,
    fishIndex: number,
  ): Promise<SimRunRow> {
    await this.requireSwarm(swarmId);
    const run = await this.deps.runRepo.findBySwarmFish(swarmId, fishIndex);
    if (!run) {
      throw HttpError.notFound(
        `sim_run for swarm ${swarmId} fish ${fishIndex} not found`,
      );
    }
    return run;
  }
}

function toCountsDto(counts: SimSwarmFishCounts): SwarmFishCountsDto {
  return {
    done: counts.done,
    failed: counts.failed,
    timeout: counts.timeout,
    running: counts.running,
    pending: counts.pending,
    paused: counts.paused,
  };
}

function toTimelineDto(
  run: SimRunRow,
  agents: SimAgentRow[],
  turns: SimTurnRow[],
): FishTimelineDto {
  const agentIndexById = new Map(agents.map((agent) => [agent.id, agent.agentIndex]));
  const turnCosts = turns
    .map((turn) => turn.llmCostUsd)
    .filter((cost): cost is number => typeof cost === "number");
  return {
    swarmId: String(run.swarmId),
    simRunId: String(run.id),
    fishIndex: run.fishIndex,
    kind: run.kind,
    status: run.status,
    seedApplied: { ...(run.seedApplied as Record<string, unknown>) },
    perturbation: run.perturbation as Record<string, unknown> & { kind: string },
    config: run.config,
    agents: agents.map((agent) => ({
      id: String(agent.id),
      operatorId: agent.operatorId?.toString() ?? null,
      agentIndex: agent.agentIndex,
      persona: agent.persona,
      goals: agent.goals,
      constraints: agent.constraints,
    })),
    turns: turns.map((turn) => ({
      id: String(turn.id),
      turnIndex: turn.turnIndex,
      actorKind: turn.actorKind,
      agentId: turn.agentId?.toString() ?? null,
      agentIndex: turn.agentId ? agentIndexById.get(turn.agentId) ?? null : null,
      action: turn.action as Record<string, unknown>,
      rationale: turn.rationale,
      observableSummary: turn.observableSummary,
      llmCostUsd: turn.llmCostUsd,
      createdAt: turn.createdAt.toISOString(),
    })),
    totalLlmCostUsd:
      turnCosts.length > 0
        ? Number(turnCosts.reduce((sum, cost) => sum + cost, 0).toFixed(8))
        : run.llmCostUsd,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function toEvidenceDto(row: SimReviewEvidenceRow): SimReviewEvidenceDto {
  return {
    id: String(row.id),
    swarmId: String(row.swarmId),
    simRunId: row.simRunId?.toString() ?? null,
    scope: row.scope,
    question: row.question,
    answer: row.answer,
    evidenceRefs: row.evidenceRefs,
    traceExcerpt: row.traceExcerpt,
    createdBy: row.createdBy?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTerminalEventDto(row: SimFishTerminalRow): Record<string, unknown> {
  return {
    simRunId: String(row.simRunId),
    fishIndex: row.fishIndex,
    runStatus: row.runStatus,
    agentIndex: row.agentIndex,
    action: row.action as Record<string, unknown> | null,
    observableSummary: row.observableSummary,
    turnsPlayed: row.turnsPlayed,
  };
}

function toQuestionSwarm(swarm: SimSwarmRow): Record<string, unknown> {
  return {
    id: String(swarm.id),
    kind: swarm.kind,
    title: swarm.title,
    size: swarm.size,
    status: swarm.status,
    baseSeed: swarm.baseSeed,
    perturbations: swarm.perturbations,
    aggregateKeys: aggregateKeysOf(swarm.config),
    startedAt: swarm.startedAt.toISOString(),
    completedAt: swarm.completedAt?.toISOString() ?? null,
  };
}

function aggregateKeysOf(config: unknown): string[] {
  const record = asRecord(config);
  return AGGREGATE_KEYS.filter((key) => record[key] !== undefined);
}

function extractAggregate(config: unknown): {
  source: AggregateKey | null;
  clusters: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
} {
  const record = asRecord(config);
  for (const key of AGGREGATE_KEYS) {
    const aggregate = asRecord(record[key]);
    if (Object.keys(aggregate).length === 0) continue;
    const clusters = Array.isArray(aggregate.clusters)
      ? aggregate.clusters.filter(isRecord)
      : [];
    const summary = { ...aggregate };
    delete summary.clusters;
    return { source: key, clusters, summary };
  }
  return { source: null, clusters: [], summary: {} };
}

function selectCluster(
  clusters: Array<Record<string, unknown>>,
  input: Pick<AskSimReviewQuestionInput, "clusterIndex" | "clusterLabel">,
): { index: number; label: string | null; cluster: Record<string, unknown> } {
  if (input.clusterIndex !== undefined) {
    const cluster = clusters[input.clusterIndex];
    if (!cluster) throw HttpError.notFound(`cluster ${input.clusterIndex} not found`);
    return {
      index: input.clusterIndex,
      label: typeof cluster.label === "string" ? cluster.label : null,
      cluster,
    };
  }
  if (input.clusterLabel !== undefined) {
    const index = clusters.findIndex((cluster) => cluster.label === input.clusterLabel);
    if (index < 0) throw HttpError.notFound(`cluster ${input.clusterLabel} not found`);
    return {
      index,
      label: input.clusterLabel,
      cluster: clusters[index]!,
    };
  }
  throw HttpError.badRequest("clusterIndex or clusterLabel is required for cluster Q&A");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
