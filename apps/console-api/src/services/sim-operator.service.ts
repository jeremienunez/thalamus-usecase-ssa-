import type {
  AskSimReviewQuestionDto,
  FishTimelineDto,
  FishTraceDto,
  OperatorSwarmListDto,
  OperatorSwarmStatusDto,
  PcAggregateClusterDto,
  SimReviewEvidenceDto,
  SwarmClusterDto,
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

const AUTO_REVIEW_QUESTIONS = {
  swarm: "Auto-review: What is the swarm-level outcome?",
  topCluster: "Auto-review: Which cluster drove the aggregate?",
  outlier: "Auto-review: Which fish looks outlier or uncertain?",
} as const;

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
    return toSwarmClustersDto(String(swarm.id), extracted);
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
    const rows = await this.ensureAutoReviewEvidence(swarmId);
    return rows.map(toEvidenceDto);
  }

  async recordAutoReviewEvidence(swarmId: bigint): Promise<void> {
    await this.requireSwarm(swarmId);
    await this.ensureAutoReviewEvidence(swarmId);
  }

  private async ensureAutoReviewEvidence(
    swarmId: bigint,
  ): Promise<SimReviewEvidenceRow[]> {
    const existing = await this.deps.evidenceRepo.listForSwarm(swarmId);
    const existingQuestions = new Set(existing.map((row) => row.question));
    if (
      existingQuestions.has(AUTO_REVIEW_QUESTIONS.swarm) &&
      existingQuestions.has(AUTO_REVIEW_QUESTIONS.topCluster) &&
      existingQuestions.has(AUTO_REVIEW_QUESTIONS.outlier)
    ) {
      return existing;
    }

    const [swarm, status, clusters, terminals] = await Promise.all([
      this.requireSwarm(swarmId),
      this.getStatus(swarmId),
      this.getClusters(swarmId),
      this.deps.terminalRepo.listTerminalsForSwarm(swarmId),
    ]);
    if (
      status.status !== "done" &&
      status.status !== "failed"
    ) {
      return existing;
    }
    if (!clusters.source) return existing;

    const drafts = buildAutoReviewDrafts({
      swarm,
      status,
      clusters,
      terminals,
    }).filter((draft) => !existingQuestions.has(draft.question));
    if (drafts.length === 0) return existing;

    const inserted: SimReviewEvidenceRow[] = [];
    for (const draft of drafts) {
      inserted.push(
        await this.deps.evidenceRepo.insert({
          swarmId,
          simRunId: draft.simRunId,
          scope: draft.scope,
          question: draft.question,
          answer: draft.answer,
          evidenceRefs: draft.evidenceRefs,
          traceExcerpt: draft.traceExcerpt,
          createdBy: null,
        }),
      );
    }
    return [...existing, ...inserted].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.id - b.id),
    );
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

interface AutoReviewDraft {
  simRunId: bigint | null;
  scope: SimReviewScope;
  question: string;
  answer: string;
  evidenceRefs: Array<Record<string, unknown>>;
  traceExcerpt: Record<string, unknown>;
}

function buildAutoReviewDrafts(input: {
  swarm: SimSwarmRow;
  status: OperatorSwarmStatusDto;
  clusters: SwarmClustersDto;
  terminals: SimFishTerminalRow[];
}): AutoReviewDraft[] {
  const swarmId = String(input.swarm.id);
  const baseRefs: Array<Record<string, unknown>> = [
    { kind: "sim_swarm", id: swarmId },
    {
      kind: "sim_swarm_aggregate",
      swarmId,
      key: input.clusters.source,
    },
  ];
  const top = topCluster(input.clusters.clusters);
  const outlier = chooseOutlierFish(input.terminals, top.cluster);

  return [
    {
      simRunId: null,
      scope: "swarm",
      question: AUTO_REVIEW_QUESTIONS.swarm,
      answer:
        `Swarm ${swarmId} closed ${input.status.status}: ` +
        `${input.status.done} done, ${input.status.failed} failed, ` +
        `${input.status.timeout} timeout. Aggregate source ${input.clusters.source} ` +
        `contains ${input.clusters.clusters.length} clusters.`,
      evidenceRefs: baseRefs,
      traceExcerpt: {
        swarm: toQuestionSwarm(input.swarm),
        status: input.status,
        aggregateSummary: input.clusters.summary,
      },
    },
    {
      simRunId: null,
      scope: "cluster",
      question: AUTO_REVIEW_QUESTIONS.topCluster,
      answer: top.cluster
        ? topClusterAnswer(top.index, top.cluster, input.status.size)
        : "No aggregate cluster was available to identify a driver.",
      evidenceRefs: top.cluster
        ? [
            ...baseRefs,
            {
              kind: "sim_cluster",
              swarmId,
              index: top.index,
              label: clusterLabelOf(top.cluster, top.index),
            },
          ]
        : baseRefs,
      traceExcerpt: {
        cluster: top.cluster ?? null,
        aggregateSummary: input.clusters.summary,
      },
    },
    {
      simRunId: outlier.terminal?.simRunId ?? null,
      scope: outlier.terminal ? "fish" : "swarm",
      question: AUTO_REVIEW_QUESTIONS.outlier,
      answer: outlier.answer,
      evidenceRefs: outlier.terminal
        ? [
            ...baseRefs,
            {
              kind: "sim_run",
              id: String(outlier.terminal.simRunId),
              fishIndex: outlier.terminal.fishIndex,
            },
          ]
        : baseRefs,
      traceExcerpt: {
        terminal: outlier.terminal
          ? toTerminalEventDto(outlier.terminal)
          : null,
        topCluster: top.cluster ?? null,
      },
    },
  ];
}

function topCluster(
  clusters: SwarmClustersDto["clusters"],
): { index: number; cluster: SwarmClustersDto["clusters"][number] | null } {
  let best: { index: number; cluster: SwarmClustersDto["clusters"][number] | null; size: number } = {
    index: -1,
    cluster: null,
    size: -1,
  };
  clusters.forEach((cluster, index) => {
    const size = clusterMembers(cluster).length;
    if (size > best.size) best = { index, cluster, size };
  });
  return { index: best.index, cluster: best.cluster };
}

function topClusterAnswer(
  index: number,
  cluster: SwarmClustersDto["clusters"][number],
  swarmSize: number,
): string {
  const members = clusterMembers(cluster);
  const label = clusterLabelOf(cluster, index);
  const fraction =
    typeof cluster.fraction === "number"
      ? cluster.fraction
      : swarmSize > 0
        ? members.length / swarmSize
        : 0;
  const pcRange =
    Array.isArray(cluster.pcRange) && cluster.pcRange.length === 2
      ? ` Pc range ${Number(cluster.pcRange[0]).toExponential(2)}..${Number(cluster.pcRange[1]).toExponential(2)}.`
      : "";
  return `Cluster "${label}" is the largest group with ${members.length} fish (${Math.round(
    fraction * 100,
  )}%).${pcRange}`;
}

function chooseOutlierFish(
  terminals: SimFishTerminalRow[],
  top: SwarmClustersDto["clusters"][number] | null,
): { terminal: SimFishTerminalRow | null; answer: string } {
  const topMembers = new Set(top ? clusterMembers(top) : []);
  const failed = terminals.find((row) => row.runStatus === "failed" || row.runStatus === "timeout");
  if (failed) {
    return {
      terminal: failed,
      answer: `Fish ${failed.fishIndex} is the clearest uncertainty candidate because it ended ${failed.runStatus}.`,
    };
  }

  const unclustered = terminals.find((row) => !topMembers.has(row.fishIndex));
  if (unclustered) {
    return {
      terminal: unclustered,
      answer:
        `Fish ${unclustered.fishIndex} sits outside the top cluster. ` +
        `Status ${unclustered.runStatus}, action ${actionKindOfTerminal(unclustered)}.`,
    };
  }

  const flagged = terminals.find((row) => terminalFlags(row).length > 0);
  if (flagged) {
    return {
      terminal: flagged,
      answer:
        `Fish ${flagged.fishIndex} carries terminal flags: ` +
        `${terminalFlags(flagged).join(", ")}.`,
    };
  }

  const shortest = [...terminals]
    .filter((row) => row.runStatus === "done")
    .sort((a, b) => a.turnsPlayed - b.turnsPlayed || a.fishIndex - b.fishIndex)[0] ?? null;
  if (shortest) {
    return {
      terminal: shortest,
      answer:
        `No strong outlier was detected; fish ${shortest.fishIndex} is retained as the shortest completed trace for review.`,
    };
  }

  return {
    terminal: null,
    answer: "No terminal fish rows were available for outlier review.",
  };
}

function terminalFlags(row: SimFishTerminalRow): string[] {
  const flags = isRecord(row.action) ? row.action.flags : undefined;
  return Array.isArray(flags)
    ? flags.filter((flag): flag is string => typeof flag === "string")
    : [];
}

function actionKindOfTerminal(row: SimFishTerminalRow): string {
  return isRecord(row.action) && typeof row.action.kind === "string"
    ? row.action.kind
    : "none";
}

function clusterMembers(cluster: SwarmClustersDto["clusters"][number]): number[] {
  const members =
    readNumberArray(cluster.memberFishIndexes) ??
    readNumberArray(cluster.fishIndexes) ??
    readNumberArray(cluster.members);
  if (members) return members;
  if (!Array.isArray(cluster.members)) return [];
  return cluster.members
    .map((member) => {
      if (typeof member === "number") return member;
      if (isRecord(member) && typeof member.fishIndex === "number") {
        return member.fishIndex;
      }
      return null;
    })
    .filter((value): value is number => value !== null);
}

function clusterLabelOf(
  cluster: SwarmClustersDto["clusters"][number],
  index: number,
): string {
  return typeof cluster.label === "string" ? cluster.label : `cluster-${index}`;
}

function aggregateKeysOf(config: unknown): string[] {
  const record = asRecord(config);
  return AGGREGATE_KEYS.filter((key) => record[key] !== undefined);
}

function extractAggregate(config: unknown): {
  source: AggregateKey | null;
  clusters: SwarmClustersDto["clusters"];
  summary: Record<string, unknown>;
} {
  const record = asRecord(config);
  for (const key of AGGREGATE_KEYS) {
    const aggregate = asRecord(record[key]);
    if (Object.keys(aggregate).length === 0) continue;
    const clusters = normalizeClusters(key, aggregate.clusters);
    const summary = { ...aggregate };
    delete summary.clusters;
    return { source: key, clusters, summary };
  }
  return { source: null, clusters: [], summary: {} };
}

function toSwarmClustersDto(
  swarmId: string,
  extracted: ReturnType<typeof extractAggregate>,
): SwarmClustersDto {
  if (extracted.source === "pcAggregate") {
    return {
      swarmId,
      source: "pcAggregate",
      clusters: extracted.clusters as PcAggregateClusterDto[],
      summary: extracted.summary,
    };
  }
  return {
    swarmId,
    source: extracted.source,
    clusters: extracted.clusters as SwarmClusterDto[],
    summary: extracted.summary,
  };
}

function normalizeClusters(
  key: AggregateKey,
  value: unknown,
): SwarmClustersDto["clusters"] {
  const clusters = Array.isArray(value) ? value.filter(isRecord) : [];
  if (key !== "pcAggregate") return clusters as SwarmClusterDto[];
  return clusters
    .map(toPcClusterDto)
    .filter((cluster): cluster is PcAggregateClusterDto => cluster !== null);
}

function toPcClusterDto(cluster: Record<string, unknown>): PcAggregateClusterDto | null {
  const label = typeof cluster.label === "string" ? cluster.label : null;
  const memberFishIndexes = readNumberArray(cluster.memberFishIndexes);
  const fishCount = typeof cluster.fishCount === "number" ? cluster.fishCount : null;
  const pcRange = readPcRange(cluster.pcRange);
  const mode = typeof cluster.mode === "string" ? cluster.mode : null;
  const flags = readStringArray(cluster.flags);
  const exemplarFishIndex =
    typeof cluster.exemplarFishIndex === "number" ? cluster.exemplarFishIndex : null;
  const exemplarSimRunId =
    typeof cluster.exemplarSimRunId === "number"
      ? String(cluster.exemplarSimRunId)
      : typeof cluster.exemplarSimRunId === "string"
        ? cluster.exemplarSimRunId
        : null;
  if (
    !label ||
    !memberFishIndexes ||
    fishCount === null ||
    !pcRange ||
    !mode ||
    !flags ||
    exemplarFishIndex === null
  ) {
    return null;
  }
  return {
    ...cluster,
    label,
    memberFishIndexes,
    exemplarFishIndex,
    exemplarSimRunId,
    fishCount,
    pcRange,
    mode,
    flags,
  };
}

function selectCluster(
  clusters: SwarmClustersDto["clusters"],
  input: Pick<AskSimReviewQuestionInput, "clusterIndex" | "clusterLabel">,
): { index: number; label: string | null; cluster: SwarmClustersDto["clusters"][number] } {
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

function readNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : null;
}

function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function readPcRange(value: unknown): [number, number] | null {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
    ? [value[0], value[1]]
    : null;
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
