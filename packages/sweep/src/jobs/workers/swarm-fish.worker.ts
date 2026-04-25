/**
 * swarm-fish worker — drains the turns of ONE fish inline.
 *
 * Why inline (no per-turn BullMQ round-trip): fish are short (≤20 turns),
 * and the swarm is already fanned out across K parallel BullMQ jobs.
 * Per-turn round-trips would add ~10× latency for no benefit. See
 * SPEC-SW-006 §Turn loop and tasks/sweep-sim-plan.md §4.5c.
 *
 * On failure: if a turn throws repeatedly (JSON validation, LLM error),
 * the fish transitions to sim_run.status='failed' and the swarm counts
 * it against quorum but continues. The exception is re-thrown so BullMQ
 * records the job as failed — but crucially, onFishComplete() is called
 * in a `finally` block so the swarm can still aggregate once quorum is
 * reached.
 */

import type { Worker } from "bullmq";
import { createLogger } from "@interview/shared/observability";
import type { SequentialTurnRunner } from "../../sim/turn-runner-sequential";
import type { DagTurnRunner } from "../../sim/turn-runner-dag";
import type { SimKindGuard, SimRuntimeStore } from "../../sim/ports";
import type { SwarmService, SwarmFishJobPayload } from "../../sim/swarm.service";
import type { SimConfig } from "../../sim/types";
import { createWorker } from "./helpers";

const logger = createLogger("swarm-fish-worker");
const DEFAULT_FISH_TIMEOUT_MS = 60_000;
type SwarmFishRun = NonNullable<Awaited<ReturnType<SimRuntimeStore["getRun"]>>>;

export interface SwarmFishWorkerDeps {
  store: Pick<SimRuntimeStore, "getRun" | "updateRunStatus">;
  swarmService: Pick<SwarmService, "onFishComplete">;
  sequentialRunner: Pick<SequentialTurnRunner, "runTurn">;
  dagRunner: Pick<DagTurnRunner, "runTurn">;
  kindGuard: SimKindGuard;
  concurrency?: number;
}

export function createSwarmFishWorker(
  deps: SwarmFishWorkerDeps,
): Worker<SwarmFishJobPayload> {
  return createWorker<SwarmFishJobPayload>({
    name: "swarm-fish",
    concurrency: deps.concurrency ?? 8,
    processor: async (job) => processSwarmFishJob(deps, job.data),
  });
}

export async function processSwarmFishJob(
  deps: SwarmFishWorkerDeps,
  payload: SwarmFishJobPayload,
): Promise<{ ok: true } | { skipped: true } | { timeout: true }> {
  const { swarmId, simRunId, fishIndex } = payload;

  let success = false;
  let timedOut = false;
  let failureReason: string | null = null;

  try {
    const run = await deps.store.getRun(simRunId);

    if (!run) throw new Error(`sim_run ${simRunId} not found`);
    if (run.status !== "running") {
      logger.info(
        { swarmId, simRunId, status: run.status },
        "fish not in running state, skipping",
      );
      success = true; // not a failure — someone else closed it
      return { skipped: true };
    }

    const config = run.config as SimConfig;
    const maxTurns = config.maxTurns;
    const timeoutMs = readPositiveInt(
      config.perFishTimeoutMs,
      DEFAULT_FISH_TIMEOUT_MS,
    );
    const controller = new AbortController();
    const timeoutError = createFishTimeoutError(simRunId, timeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });

    try {
      const drained = await Promise.race([
        drainFishTurns({
          deps,
          run,
          simRunId,
          maxTurns,
          signal: controller.signal,
        }),
        timeout,
      ]);

      // Close the fish if it ran to maxTurns without a terminal action
      // (sequential with no accept/reject, or DAG always).
      await deps.store.updateRunStatus(simRunId, "done", new Date());

      success = true;
      logger.info(
        {
          swarmId,
          simRunId,
          fishIndex,
          turnsPlayed: drained.turnsPlayed,
          terminal: drained.terminal,
        },
        "fish drained",
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (err) {
    failureReason = (err as Error).message;
    if (timedOut || isFishTimeoutError(err)) {
      timedOut = true;
      logger.warn(
        { swarmId, simRunId, fishIndex, err: failureReason },
        "fish timed out",
      );
      await deps.store.updateRunStatus(simRunId, "timeout", new Date());
      success = true;
    } else {
      logger.error(
        { swarmId, simRunId, fishIndex, err: failureReason },
        "fish failed",
      );
      // Mark the fish as failed so the swarm can still aggregate.
      await deps.store.updateRunStatus(simRunId, "failed", new Date());
    }
  } finally {
    // Always notify the swarm — even on failure — so quorum tracking
    // can progress.
    await deps.swarmService.onFishComplete(swarmId);
  }

  if (timedOut) return { timeout: true };
  if (!success && failureReason) {
    throw new Error(failureReason);
  }
  return { ok: true };
}

async function drainFishTurns(args: {
  deps: SwarmFishWorkerDeps;
  run: SwarmFishRun;
  simRunId: number;
  maxTurns: number;
  signal: AbortSignal;
}): Promise<{ turnsPlayed: number; terminal: boolean }> {
  let terminal = false;
  let turnIndex = 0;
  const driver = args.deps.kindGuard.driverForKind(args.run.kind);
  while (turnIndex < args.maxTurns && !terminal) {
    throwIfAborted(args.signal);
    if (driver.runner === "sequential") {
      const r = await args.deps.sequentialRunner.runTurn({
        simRunId: args.simRunId,
        turnIndex,
        signal: args.signal,
      });
      terminal = r.terminal;
    } else {
      await args.deps.dagRunner.runTurn({
        simRunId: args.simRunId,
        turnIndex,
        signal: args.signal,
      });
      terminal = driver.singleTurn;
    }
    turnIndex++;
  }
  throwIfAborted(args.signal);
  return { turnsPlayed: turnIndex, terminal };
}

function createFishTimeoutError(simRunId: number, timeoutMs: number): Error {
  const err = new Error(`sim_run ${simRunId} timed out after ${timeoutMs}ms`);
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw createFishTimeoutError(-1, DEFAULT_FISH_TIMEOUT_MS);
}

function isFishTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" && /timed out/i.test(err.message);
}

function readPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
