import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimTurnRepository } from "../../../src/repositories/sim-turn.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimTurnRepository;

function vec(head: number[]): number[] {
  return Array.from({ length: 2048 }, (_, index) => head[index] ?? 0);
}

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimTurnRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'telemetry',
      'Turn swarm',
      '{"target": 1}'::jsonb,
      '[{"kind":"baseline"}]'::jsonb,
      1,
      '{"llmMode":"fixtures","quorumPct":60,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'running'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
    ) VALUES (
      10,
      1,
      0,
      'telemetry',
      '{"target": 1}'::jsonb,
      '{"kind":"baseline"}'::jsonb,
      '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
      'running'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_agent (
      id, sim_run_id, operator_id, agent_index, persona, goals, constraints
    ) VALUES
      (100, 10, NULL, 1, 'lead', '[]'::jsonb, '{}'::jsonb),
      (101, 10, NULL, 2, 'backup', '[]'::jsonb, '{}'::jsonb)
  `);
}

describe("SimTurnRepository", () => {
  it("inserts agent and god turns and reads them back", async () => {
    const agentTurnId = await repo.insertAgentTurn({
      simRunId: 10n,
      turnIndex: 1,
      agentId: 100n,
      action: { kind: "observe", priority: "high" },
      rationale: "agent rationale",
      observableSummary: "agent summary",
      llmCostUsd: 0.12,
    });
    const godTurnId = await repo.insertGodTurn({
      simRunId: 10n,
      turnIndex: 2,
      action: { kind: "anomaly", code: "solar-flare" },
      rationale: "god rationale",
      observableSummary: "god summary",
    });

    expect(await repo.findById(agentTurnId)).toMatchObject({
      id: agentTurnId,
      actorKind: "agent",
      agentId: 100n,
      action: { kind: "observe", priority: "high" },
    });
    expect(await repo.findById(godTurnId)).toMatchObject({
      id: godTurnId,
      actorKind: "god",
      agentId: null,
      action: { kind: "anomaly", code: "solar-flare" },
    });
    expect(await repo.listGodEventsAtOrBefore(10n, 3)).toEqual([
      {
        turnIndex: 2,
        observableSummary: "god summary",
        action: { kind: "anomaly", code: "solar-flare" },
      },
    ]);
  });

  it("persists batches atomically and exposes recent observable state", async () => {
    expect(
      await repo.persistTurnBatch({ agentTurns: [], memoryRows: [] }),
    ).toEqual([]);

    const ids = await repo.persistTurnBatch({
      agentTurns: [
        {
          simRunId: 10n,
          turnIndex: 1,
          agentId: 100n,
          action: { kind: "plan", step: "one" },
          rationale: "plan rationale",
          observableSummary: "plan summary",
          llmCostUsd: 0.2,
        },
        {
          simRunId: 10n,
          turnIndex: 2,
          agentId: 101n,
          action: { kind: "maneuver", deltaVmps: 1.5 },
          rationale: "maneuver rationale",
          observableSummary: "maneuver summary",
          llmCostUsd: 0.3,
        },
      ],
      memoryRows: [
        {
          simRunId: 10n,
          agentId: 100n,
          turnIndex: 2,
          kind: "observation",
          content: "remember this",
          embedding: vec([1, 0]),
        },
      ],
    });

    expect(ids).toHaveLength(2);
    expect(await repo.countAgentTurnsForRun(10n)).toBe(2);
    expect(await repo.lastTurnCreatedAt(10n)).toBeInstanceOf(Date);
    expect(await repo.listTimelineForRun(10n)).toEqual([
      expect.objectContaining({
        id: ids[0],
        turnIndex: 1,
        action: { kind: "plan", step: "one" },
        rationale: "plan rationale",
      }),
      expect.objectContaining({
        id: ids[1],
        turnIndex: 2,
        action: { kind: "maneuver", deltaVmps: 1.5 },
        rationale: "maneuver rationale",
      }),
    ]);
    expect(
      await repo.recentObservable({
        simRunId: 10n,
        sinceTurnIndex: 0,
        excludeAgentId: 100n,
        limit: 10,
      }),
    ).toEqual([
      {
        turnIndex: 2,
        actorKind: "agent",
        agentId: 101n,
        observableSummary: "maneuver summary",
      },
    ]);
  });
});
