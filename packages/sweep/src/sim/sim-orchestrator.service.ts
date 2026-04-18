/**
 * Sim Orchestrator — creates sim_run structures, schedules turns via
 * BullMQ, handles pause/resume/inject/status.
 *
 * Two modes:
 *   1. Standalone (this file's startStandalone) — admin/debug single runs,
 *      each turn is a BullMQ sim-turn job processed by sim-turn.worker.ts.
 *      Supports pause/resume and god-event injection mid-run.
 *   2. Swarm-fish (via createFish) — the swarm service creates sim_run rows
 *      here then drives turns INLINE inside its fish worker, bypassing the
 *      sim-turn queue. The orchestrator never schedules turns for swarm
 *      fish; it just provides the shared "create run + agents" primitive.
 */

import { eq, sql } from "drizzle-orm";
import type { Queue } from "bullmq";
import type { Database, NewSimRun, NewSimSwarm, NewSimTurn } from "@interview/db-schema";
import {
  simRun,
  simSwarm,
  simTurn,
} from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type {
  FleetSnapshot,
  SeedRefs,
  SimConfig,
  SimKind,
  SimRunStatus,
  SwarmConfig,
  PerturbationSpec,
} from "./types";
import { buildOperatorAgent } from "./agent-builder";
import type {
  SimFleetProvider,
  SimAgentPersonaComposer,
  SimPerturbationPack,
} from "./ports";
import type { SimTurnJobPayload } from "../jobs/queues";

const logger = createLogger("sim-orchestrator");

const DEFAULT_UC1_MAX_TURNS = 15;
const DEFAULT_UC3_MAX_TURNS = 20;

export interface OrchestratorDeps {
  db: Database;
  simTurnQueue: Queue<SimTurnJobPayload>;
  /** Plan 2 · B.1 — fleet port, consumed by buildOperatorAgent. */
  fleet: SimFleetProvider;
  /** Plan 2 · B.3 — persona composer port. */
  persona: SimAgentPersonaComposer;
  /** Plan 2 · B.6 — perturbation pack: god-event extraction + generator set. */
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
  fleetSnapshots: Map<number, FleetSnapshot>;
}

export interface StartStandaloneOpts {
  kind: SimKind;
  title: string;
  operatorIds: number[];
  horizonDays?: number;
  turnsPerDay?: number;
  maxTurns?: number;
  llmMode: "cloud" | "fixtures" | "record";
  nanoModel?: string;
  seed?: number;
  createdBy?: number;
  conjunctionFindingId?: number;
}

export interface StartStandaloneResult {
  swarmId: number;
  simRunId: number;
  agentIds: number[];
}

export interface GodEventInput {
  kind:
    | "regulation"
    | "asat_event"
    | "launch_surge"
    | "debris_cascade"
    | "custom";
  summary: string;
  detail?: string;
  targetSatelliteId?: number;
  targetOperatorId?: number;
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

  // -------------------------------------------------------------------
  // Standalone — size-1 swarm, scheduler-driven turns
  // -------------------------------------------------------------------

  async startStandalone(opts: StartStandaloneOpts): Promise<StartStandaloneResult> {
    if (opts.operatorIds.length < 1) {
      throw new Error("startStandalone requires at least 1 operatorId");
    }
    if (opts.kind === "uc3_conjunction" && opts.operatorIds.length !== 2) {
      throw new Error("UC3 requires exactly 2 operators");
    }

    const maxTurns =
      opts.maxTurns ??
      (opts.kind === "uc3_conjunction" ? DEFAULT_UC3_MAX_TURNS : DEFAULT_UC1_MAX_TURNS);

    const swarmConfig: SwarmConfig = {
      llmMode: opts.llmMode,
      quorumPct: 1.0,
      perFishTimeoutMs: 5 * 60_000,
      fishConcurrency: 1,
      nanoModel: opts.nanoModel ?? "gpt-5.4-nano",
      seed: opts.seed ?? 42,
    };

    const baseSeed: SeedRefs = {
      operatorIds: opts.operatorIds,
      conjunctionFindingId: opts.conjunctionFindingId,
      horizonDays: opts.horizonDays ?? 5,
      turnsPerDay: opts.turnsPerDay ?? 1,
    };

    const swarmInsert: NewSimSwarm = {
      kind: opts.kind,
      title: opts.title,
      baseSeed,
      perturbations: [{ kind: "noop" }],
      size: 1,
      config: swarmConfig,
      status: "running",
      createdBy: opts.createdBy !== undefined ? BigInt(opts.createdBy) : null,
    };

    const [swarmRow] = await this.deps.db
      .insert(simSwarm)
      .values(swarmInsert)
      .returning({ id: simSwarm.id });
    if (!swarmRow) throw new Error("insert sim_swarm returned no row");
    const swarmId = Number(swarmRow.id);

    const simConfig: SimConfig = {
      turnsPerDay: baseSeed.turnsPerDay ?? 1,
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

    // Mark the run as running and enqueue turn 0.
    await this.deps.db
      .update(simRun)
      .set({ status: "running" })
      .where(eq(simRun.id, BigInt(fish.simRunId)));

    await this.enqueueTurn(fish.simRunId, 0);

    logger.info(
      { swarmId, simRunId: fish.simRunId, kind: opts.kind, agentCount: fish.agentIds.length },
      "standalone sim started",
    );

    return { swarmId, simRunId: fish.simRunId, agentIds: fish.agentIds };
  }

  // -------------------------------------------------------------------
  // Shared primitive — create sim_run + agents (reused by swarm service)
  // -------------------------------------------------------------------

  async createFish(opts: CreateFishOpts): Promise<CreateFishResult> {
    const operatorIds = opts.seedApplied.operatorIds ?? [];
    if (operatorIds.length === 0) {
      throw new Error(
        `createFish(swarm=${opts.swarmId}, fish=${opts.fishIndex}) requires operatorIds in seedApplied`,
      );
    }

    const runInsert: NewSimRun = {
      swarmId: BigInt(opts.swarmId),
      fishIndex: opts.fishIndex,
      kind: opts.kind,
      seedApplied: opts.seedApplied,
      perturbation: opts.perturbation,
      config: opts.config,
      status: "pending",
    };
    const [runRow] = await this.deps.db
      .insert(simRun)
      .values(runInsert)
      .returning({ id: simRun.id });
    if (!runRow) throw new Error("insert sim_run returned no row");
    const simRunId = Number(runRow.id);

    // Apply perturbations that target agent composition before build.
    const negotiationFraming = opts.kind === "uc3_conjunction";
    const { riskProfileByIndex, constraintOverridesByIndex } =
      this.projectAgentPerturbations(opts.perturbation);

    const agentIds: number[] = [];
    const fleetSnapshots = new Map<number, FleetSnapshot>();
    for (let i = 0; i < operatorIds.length; i++) {
      const operatorId = operatorIds[i];
      const built = await buildOperatorAgent(
        {
          db: this.deps.db,
          fleet: this.deps.fleet,
          persona: this.deps.persona,
        },
        {
          simRunId,
          operatorId,
          agentIndex: i,
          riskProfile: riskProfileByIndex.get(i),
          constraintOverrides: constraintOverridesByIndex.get(i),
          negotiationFraming,
        },
      );
      agentIds.push(built.agentId);
      fleetSnapshots.set(built.agentId, built.fleetSnapshot);
    }

    // Seed god events from perturbation (if any), as a pre-turn (index -1 is
    // reserved; we use turn_index = 0 for pre-seeded god turns — agents see
    // them in their observable timeline at turn 0).
    const rawGod = this.deps.perturbationPack.extractGodEvents(
      opts.perturbation as unknown as Record<string, unknown>,
    );
    const seededGod: GodEventInput[] = rawGod.map((g) => ({
      kind: g.kind as GodEventInput["kind"],
      summary: g.summary,
      detail: g.detail,
      targetSatelliteId: (g.targets?.targetSatelliteId as number | undefined),
      targetOperatorId: (g.targets?.targetOperatorId as number | undefined),
    }));
    if (seededGod.length > 0) {
      for (const ev of seededGod) {
        await this.writeGodTurn(simRunId, 0, ev);
      }
    }

    logger.debug(
      {
        swarmId: opts.swarmId,
        fishIndex: opts.fishIndex,
        simRunId,
        operatorCount: operatorIds.length,
        godSeeded: seededGod.length,
      },
      "fish created",
    );

    return { simRunId, agentIds, fleetSnapshots };
  }

  // -------------------------------------------------------------------
  // Scheduling — called by sim-turn.worker after each turn completes
  // -------------------------------------------------------------------

  async scheduleNext(simRunId: number): Promise<{ scheduled: boolean; reason?: string }> {
    const run = await this.loadRun(simRunId);
    if (!run) return { scheduled: false, reason: "run_not_found" };
    if (run.status !== "running") return { scheduled: false, reason: `status=${run.status}` };

    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    // "turnsPlayed" at DAG = number of full turns where at least one agent
    // acted. Approximation: ceil(agent_turn_rows / agentCount).
    const turnsCompleted = agentCount > 0 ? Math.ceil(played / agentCount) : 0;

    const config = run.config as SimConfig;
    if (turnsCompleted >= config.maxTurns) {
      await this.deps.db
        .update(simRun)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(simRun.id, BigInt(simRunId)));
      logger.info({ simRunId, turnsCompleted }, "run reached maxTurns, closing");
      return { scheduled: false, reason: "max_turns_reached" };
    }

    await this.enqueueTurn(simRunId, turnsCompleted);
    return { scheduled: true };
  }

  private async enqueueTurn(simRunId: number, turnIndex: number): Promise<void> {
    await this.deps.simTurnQueue.add(
      "sim-turn",
      { simRunId, turnIndex },
      { jobId: `sim-${simRunId}-t${turnIndex}` },
    );
    logger.debug({ simRunId, turnIndex }, "sim-turn enqueued");
  }

  // -------------------------------------------------------------------
  // Pause / resume
  // -------------------------------------------------------------------

  async pause(simRunId: number): Promise<void> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status !== "running") {
      throw new Error(`cannot pause: status=${run.status}`);
    }
    await this.deps.db
      .update(simRun)
      .set({ status: "paused" })
      .where(eq(simRun.id, BigInt(simRunId)));
    logger.info({ simRunId }, "sim_run paused");
  }

  async resume(simRunId: number): Promise<void> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status !== "paused") {
      throw new Error(`cannot resume: status=${run.status}`);
    }
    await this.deps.db
      .update(simRun)
      .set({ status: "running" })
      .where(eq(simRun.id, BigInt(simRunId)));
    // Schedule the next turn based on what's already played.
    await this.scheduleNext(simRunId);
    logger.info({ simRunId }, "sim_run resumed");
  }

  // -------------------------------------------------------------------
  // God channel injection
  // -------------------------------------------------------------------

  async inject(simRunId: number, event: GodEventInput): Promise<{ simTurnId: number }> {
    const run = await this.loadRun(simRunId);
    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status === "done" || run.status === "failed") {
      throw new Error(`cannot inject: status=${run.status}`);
    }

    // Inject at currentTurn + 1 so the event surfaces on the *next* agent
    // turn's observable timeline.
    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    const turnsCompleted = agentCount > 0 ? Math.ceil(played / agentCount) : 0;
    const injectTurnIndex = turnsCompleted;

    const simTurnId = await this.writeGodTurn(simRunId, injectTurnIndex, event);

    logger.info(
      { simRunId, simTurnId, turnIndex: injectTurnIndex, godKind: event.kind },
      "god event injected",
    );

    return { simTurnId };
  }

  // -------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------

  async status(simRunId: number): Promise<SimStatus | null> {
    const run = await this.loadRun(simRunId);
    if (!run) return null;

    const played = await this.countAgentTurns(simRunId);
    const agentCount = await this.countAgents(simRunId);
    const turnsPlayed = agentCount > 0 ? Math.ceil(played / agentCount) : 0;
    const config = run.config as SimConfig;

    const lastTurn = await this.deps.db.execute(sql`
      SELECT MAX(created_at) AS last_at
      FROM sim_turn
      WHERE sim_run_id = ${BigInt(simRunId)}
    `);
    const lastAt = (lastTurn.rows[0] as { last_at: Date | null } | undefined)?.last_at ?? null;

    return {
      swarmId: Number(run.swarmId),
      simRunId,
      status: run.status,
      turnsPlayed,
      maxTurns: config.maxTurns,
      lastTurnAt: lastAt,
    };
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async loadRun(simRunId: number) {
    const rows = await this.deps.db
      .select()
      .from(simRun)
      .where(eq(simRun.id, BigInt(simRunId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async countAgents(simRunId: number): Promise<number> {
    const rows = await this.deps.db.execute(sql`
      SELECT count(*)::int AS c FROM sim_agent WHERE sim_run_id = ${BigInt(simRunId)}
    `);
    return (rows.rows[0] as { c: number } | undefined)?.c ?? 0;
  }

  private async countAgentTurns(simRunId: number): Promise<number> {
    const rows = await this.deps.db.execute(sql`
      SELECT count(*)::int AS c
      FROM sim_turn
      WHERE sim_run_id = ${BigInt(simRunId)} AND actor_kind = 'agent'
    `);
    return (rows.rows[0] as { c: number } | undefined)?.c ?? 0;
  }

  private async writeGodTurn(
    simRunId: number,
    turnIndex: number,
    event: GodEventInput,
  ): Promise<number> {
    const insert: NewSimTurn = {
      simRunId: BigInt(simRunId),
      turnIndex,
      actorKind: "god",
      agentId: null,
      action: {
        kind: "hold",
        reason: `god event injection: ${event.kind}`,
      } as never,
      rationale: event.detail ?? event.summary,
      observableSummary: event.summary,
      llmCostUsd: null,
    };
    const [row] = await this.deps.db
      .insert(simTurn)
      .values(insert)
      .returning({ id: simTurn.id });
    if (!row) throw new Error("insert god sim_turn returned no row");
    return Number(row.id);
  }

  private projectAgentPerturbations(p: PerturbationSpec): {
    riskProfileByIndex: Map<number, "conservative" | "balanced" | "aggressive">;
    constraintOverridesByIndex: Map<number, Record<string, unknown>>;
  } {
    const risk = new Map<number, "conservative" | "balanced" | "aggressive">();
    const constraints = new Map<number, Record<string, unknown>>();
    if (p.kind === "persona_tweak") {
      risk.set(p.agentIndex, p.riskProfile);
    } else if (p.kind === "constraint_override") {
      constraints.set(p.agentIndex, p.overrides);
    } else if (p.kind === "delta_v_budget") {
      constraints.set(p.agentIndex, { maxDeltaVMpsPerSat: p.maxPerSat });
    }
    return { riskProfileByIndex: risk, constraintOverridesByIndex: constraints };
  }

  // Plan 2 · B.6: extractGodEvents moved to SimPerturbationPack port.
}
