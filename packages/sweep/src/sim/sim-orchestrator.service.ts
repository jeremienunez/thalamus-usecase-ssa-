import { createLogger } from "@interview/shared/observability";
import type {
  SeedRefs,
  SimConfig,
  SimKind,
  SimRunStatus,
  SwarmConfig,
  PerturbationSpec,
} from "./types";
import { buildSimAgent } from "./agent-builder";
import type {
  SimAgentPersonaComposer,
  SimPerturbationPack,
  SimQueuePort,
  SimRuntimeStore,
  SimSubjectProvider,
  SimSubjectSnapshot,
} from "./ports";

const logger = createLogger("sim-orchestrator");

const DEFAULT_MULTI_SUBJECT_MAX_TURNS = 15;
const DEFAULT_NEGOTIATION_MAX_TURNS = 20;

export interface OrchestratorDeps {
  store: SimRuntimeStore;
  queue: SimQueuePort;
  subjects: SimSubjectProvider;
  persona: SimAgentPersonaComposer;
  perturbationPack: SimPerturbationPack;
}

export interface CreateFishOpts {
  swarmId: number;
  fishIndex: number;
  kind: SimKind;
  seedApplied: SeedRefs;
  perturbation: PerturbationSpec;
  config: SimConfig;
}

export interface CreateFishResult {
  simRunId: number;
  agentIds: number[];
  subjectSnapshots: Map<number, SimSubjectSnapshot>;
}

export interface StartStandaloneOpts {
  kind: SimKind;
  title: string;
  subjectIds: number[];
  baseSeed?: Record<string, unknown>;
  horizonDays?: number;
  turnsPerDay?: number;
  maxTurns?: number;
  llmMode: "cloud" | "fixtures" | "record";
  nanoModel?: string;
  seed?: number;
  createdBy?: number;
  subjectKind?: string;
}

export interface StartStandaloneResult {
  swarmId: number;
  simRunId: number;
  agentIds: number[];
}

export interface GodEventInput {
  kind: string;
  summary: string;
  detail?: string;
  targetEntityId?: number;
  targetSubjectId?: number;
}

export interface SimStatus {
  swarmId: number;
  simRunId: number;
  status: SimRunStatus;
  turnsPlayed: number;
  maxTurns: number;
  lastTurnAt: Date | null;
}

export class SimOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async startStandalone(opts: StartStandaloneOpts): Promise<StartStandaloneResult> {
    if (opts.subjectIds.length < 1) {
      throw new Error("startStandalone requires at least 1 subjectId");
    }

    const maxTurns =
      opts.maxTurns ??
      (opts.subjectIds.length === 2
        ? DEFAULT_NEGOTIATION_MAX_TURNS
        : DEFAULT_MULTI_SUBJECT_MAX_TURNS);

    const swarmConfig: SwarmConfig = {
      llmMode: opts.llmMode,
      quorumPct: 1.0,
      perFishTimeoutMs: 5 * 60_000,
      fishConcurrency: 1,
      nanoModel: opts.nanoModel ?? "gpt-5.4-nano",
      seed: opts.seed ?? 42,
    };

    const baseSeed: SeedRefs = {
      ...(opts.baseSeed ?? {}),
      subjectIds: opts.subjectIds,
      subjectKind: opts.subjectKind,
      horizonDays: opts.horizonDays ?? 5,
      turnsPerDay: opts.turnsPerDay ?? 1,
    };

    const swarmId = await this.deps.store.insertSwarm({
      kind: opts.kind,
      title: opts.title,
      baseSeed,
      perturbations: [{ kind: "noop" }],
      size: 1,
      config: swarmConfig,
      status: "running",
      createdBy: opts.createdBy ?? null,
    });

    const simConfig: SimConfig = {
      turnsPerDay: readPositiveInt(baseSeed.turnsPerDay, 1),
      maxTurns,
      llmMode: opts.llmMode,
      seed: swarmConfig.seed,
      nanoModel: swarmConfig.nanoModel,
    };

    const fish = await this.createFish({
      swarmId,
      fishIndex: 0,
      kind: opts.kind,
      seedApplied: baseSeed,
      perturbation: { kind: "noop" },
      config: simConfig,
    });

    await this.deps.store.updateRunStatus(fish.simRunId, "running");
    await this.enqueueTurn(fish.simRunId, 0);

    logger.info(
      { swarmId, simRunId: fish.simRunId, kind: opts.kind, agentCount: fish.agentIds.length },
      "standalone sim started",
    );

    return { swarmId, simRunId: fish.simRunId, agentIds: fish.agentIds };
  }

  async createFish(opts: CreateFishOpts): Promise<CreateFishResult> {
    const subjectIds = readSubjectIds(opts.seedApplied);
    if (subjectIds.length === 0) {
      throw new Error(
        `createFish(swarm=${opts.swarmId}, fish=${opts.fishIndex}) requires subjectIds in seedApplied`,
      );
    }

    const simRunId = await this.deps.store.insertRun({
      swarmId: opts.swarmId,
      fishIndex: opts.fishIndex,
      kind: opts.kind,
      seedApplied: opts.seedApplied,
      perturbation: opts.perturbation,
      config: opts.config,
      status: "pending",
    });

    const negotiationFraming = subjectIds.length === 2;
    const { subjectHintsByIndex } = this.deps.perturbationPack.agentHints(
      opts.perturbation as Record<string, unknown>,
    );

    const agentIds: number[] = [];
    const subjectSnapshots = new Map<number, SimSubjectSnapshot>();
    const subjectKind = readSubjectKind(opts.seedApplied);
    for (let i = 0; i < subjectIds.length; i++) {
      const subjectId = subjectIds[i];
      const built = await buildSimAgent(
        {
          store: this.deps.store,
          subjects: this.deps.subjects,
          persona: this.deps.persona,
        },
        {
          simRunId,
          subjectId,
          subjectKind,
          agentIndex: i,
          negotiationFraming,
          ...(subjectHintsByIndex.get(i) ?? {}),
        },
      );
      agentIds.push(built.agentId);
      subjectSnapshots.set(built.agentId, built.subjectSnapshot);
    }

    const seededEvents = this.deps.perturbationPack.extractGodEvents(
      opts.perturbation as Record<string, unknown>,
    );
    if (seededEvents.length > 0) {
      for (const event of seededEvents) {
        await this.writeGodTurn(simRunId, 0, {
          kind: event.kind,
          summary: event.summary,
          detail: event.detail,
          targetEntityId:
            typeof event.targets?.targetEntityId === "number"
              ? event.targets.targetEntityId
              : undefined,
          targetSubjectId:
            typeof event.targets?.targetSubjectId === "number"
              ? event.targets.targetSubjectId
              : undefined,
        });
      }
    }

    logger.debug(
      {
        swarmId: opts.swarmId,
        fishIndex: opts.fishIndex,
        simRunId,
        subjectCount: subjectIds.length,
        seededEvents: seededEvents.length,
      },
      "fish created",
    );

    return { simRunId, agentIds, subjectSnapshots };
  }

  async scheduleNext(simRunId: number): Promise<{ scheduled: boolean; reason?: string }> {
    const run = await this.loadRun(simRunId);
    if (!run) return { scheduled: false, reason: "run_not_found" };
    if (run.status !== "running") return { scheduled: false, reason: `status=${run.status}` };

    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    const turnsCompleted = agentCount > 0 ? Math.ceil(played / agentCount) : 0;
    const config = run.config as SimConfig;
    if (turnsCompleted >= config.maxTurns) {
      await this.deps.store.updateRunStatus(simRunId, "done", new Date());
      logger.info({ simRunId, turnsCompleted }, "run reached maxTurns, closing");
      return { scheduled: false, reason: "max_turns_reached" };
    }

    await this.enqueueTurn(simRunId, turnsCompleted);
    return { scheduled: true };
  }

  async pause(simRunId: number): Promise<void> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status !== "running") {
      throw new Error(`cannot pause: status=${run.status}`);
    }
    await this.deps.store.updateRunStatus(simRunId, "paused");
    logger.info({ simRunId }, "sim_run paused");
  }

  async resume(simRunId: number): Promise<void> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status !== "paused") {
      throw new Error(`cannot resume: status=${run.status}`);
    }
    await this.deps.store.updateRunStatus(simRunId, "running");
    await this.scheduleNext(simRunId);
    logger.info({ simRunId }, "sim_run resumed");
  }

  async inject(simRunId: number, event: GodEventInput): Promise<{ simTurnId: number }> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status === "done" || run.status === "failed") {
      throw new Error(`cannot inject: status=${run.status}`);
    }

    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    const turnsCompleted = agentCount > 0 ? Math.ceil(played / agentCount) : 0;
    const simTurnId = await this.writeGodTurn(simRunId, turnsCompleted, event);

    logger.info(
      { simRunId, simTurnId, turnIndex: turnsCompleted, eventKind: event.kind },
      "god event injected",
    );

    return { simTurnId };
  }

  async status(simRunId: number): Promise<SimStatus | null> {
    const run = await this.loadRun(simRunId);
    if (!run) return null;

    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    const turnsPlayed = agentCount > 0 ? Math.ceil(played / agentCount) : 0;
    const config = run.config as SimConfig;

    return {
      swarmId: Number(run.swarmId),
      simRunId,
      status: run.status,
      turnsPlayed,
      maxTurns: config.maxTurns,
      lastTurnAt: await this.deps.store.lastTurnCreatedAt(simRunId),
    };
  }

  private async enqueueTurn(simRunId: number, turnIndex: number): Promise<void> {
    await this.deps.queue.enqueueSimTurn({
      simRunId,
      turnIndex,
      jobId: `sim-${simRunId}-t${turnIndex}`,
    });
    logger.debug({ simRunId, turnIndex }, "sim-turn enqueued");
  }

  private loadRun(simRunId: number) {
    return this.deps.store.getRun(simRunId);
  }

  private async countAgents(simRunId: number): Promise<number> {
    return (await this.deps.store.listAgents(simRunId)).length;
  }

  private async countAgentTurns(simRunId: number): Promise<number> {
    return this.deps.store.countAgentTurnsForRun(simRunId);
  }

  private async writeGodTurn(
    simRunId: number,
    turnIndex: number,
    event: GodEventInput,
  ): Promise<number> {
    return this.deps.store.insertGodTurn({
      simRunId,
      turnIndex,
      action: {
        kind: "hold",
        reason: `event injection: ${event.kind}`,
      },
      rationale: event.detail ?? event.summary,
      observableSummary: event.summary,
    });
  }
}

function readPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function readSubjectIds(seed: Record<string, unknown>): number[] {
  const raw = seed.subjectIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value));
}

function readSubjectKind(seed: Record<string, unknown>): string | undefined {
  return typeof seed.subjectKind === "string" && seed.subjectKind.length > 0
    ? seed.subjectKind
    : undefined;
}
