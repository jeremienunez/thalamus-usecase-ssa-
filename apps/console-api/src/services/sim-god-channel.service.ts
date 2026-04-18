/**
 * SimGodChannelService — server-side god-event injection.
 *
 * Handles `POST /api/sim/runs/:id/inject` (§5.8 of the HTTP contract).
 * Zod validation of the request body happens in the controller; this
 * service receives an already-typed event and:
 *
 *   1. Loads the target run, rejects if terminal (done/failed).
 *   2. Computes the insertion turn index from agent-turn / agent counts
 *      (same formula the kernel orchestrator uses — injection targets
 *      the CURRENT turn so agents see the event on their next context
 *      build).
 *   3. Writes a god sim_turn via SimTurnRepository (action.kind="hold"
 *      with synthetic rationale/summary matching the legacy writeGodTurn
 *      shape — keeps downstream consumers wire-stable).
 *
 * Replaces the kernel's `GodChannelService`. The kernel class is deleted
 * in Phase 3 of Plan 5.
 *
 * Introduced: Plan 5 Task 1.B.4.
 */

import { createLogger } from "@interview/shared/observability";
import type { TurnAction } from "@interview/db-schema";
import type { InsertGodTurnInput } from "../types/sim-turn.types";
import type { SimRunRow } from "../types/sim-run.types";

const logger = createLogger("sim-god-channel-service");

// ── Ports (structural — repos satisfy these by duck typing) ─────────

export interface SimRunStatusReadPort {
  findById(simRunId: bigint): Promise<SimRunRow | null>;
}

export interface SimAgentCountReadPort {
  countForRun(simRunId: bigint): Promise<number>;
}

export interface SimTurnGodWritePort {
  countAgentTurnsForRun(simRunId: bigint): Promise<number>;
  insertGodTurn(input: InsertGodTurnInput): Promise<bigint>;
}

/**
 * Event kinds accepted by the god-channel. Mirrors the nested union in
 * `@interview/db-schema`'s `PerturbationSpec['god_event'].event.kind`;
 * not re-exported as a named type in db-schema, so we inline it here.
 */
export type GodEventKind =
  | "regulation"
  | "asat_event"
  | "launch_surge"
  | "debris_cascade"
  | "custom";

export interface GodEventInput {
  kind: GodEventKind;
  summary: string;
  detail?: string;
  targetSatelliteId?: number;
  targetOperatorId?: number;
}

export class SimGodChannelService {
  constructor(
    private readonly simRunRepo: SimRunStatusReadPort,
    private readonly simAgentRepo: SimAgentCountReadPort,
    private readonly simTurnRepo: SimTurnGodWritePort,
  ) {}

  async inject(
    simRunId: bigint,
    event: GodEventInput,
  ): Promise<{ simTurnId: bigint }> {
    const run = await this.simRunRepo.findById(simRunId);
    if (!run) {
      const e = new Error(`sim_run ${simRunId} not found`);
      (e as Error & { statusCode?: number }).statusCode = 404;
      throw e;
    }
    if (run.status === "done" || run.status === "failed") {
      const e = new Error(`cannot inject: status=${run.status}`);
      (e as Error & { statusCode?: number }).statusCode = 409;
      throw e;
    }

    const [agentTurns, agentCount] = await Promise.all([
      this.simTurnRepo.countAgentTurnsForRun(simRunId),
      this.simAgentRepo.countForRun(simRunId),
    ]);
    const turnsCompleted = agentCount > 0 ? Math.ceil(agentTurns / agentCount) : 0;

    const action: TurnAction = {
      kind: "hold",
      reason: `god event injection: ${event.kind}`,
    };

    const simTurnId = await this.simTurnRepo.insertGodTurn({
      simRunId,
      turnIndex: turnsCompleted,
      action,
      rationale: event.detail ?? event.summary,
      observableSummary: event.summary,
    });

    logger.info(
      {
        simRunId: Number(simRunId),
        simTurnId: Number(simTurnId),
        turnIndex: turnsCompleted,
        godKind: event.kind,
      },
      "god event injected",
    );

    return { simTurnId };
  }
}
