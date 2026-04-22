import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimAgentRepository } from "../../../src/repositories/sim-agent.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimAgentRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimAgentRepository(harness.db);
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
    INSERT INTO operator (id, name, slug) VALUES (1, 'CNES', 'cnes')
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'telemetry',
      'Primary swarm',
      '{"target": 1}'::jsonb,
      '[{"kind":"baseline"}]'::jsonb,
      2,
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
}

describe("SimAgentRepository", () => {
  it("inserts agents, lists them by run order, and counts them", async () => {
    const second = await repo.insert({
      simRunId: 10n,
      operatorId: null,
      agentIndex: 2,
      persona: "backup",
      goals: ["stabilize"],
      constraints: { fuel: "low" },
    });
    const first = await repo.insert({
      simRunId: 10n,
      operatorId: 1n,
      agentIndex: 1,
      persona: "lead",
      goals: ["monitor", "report"],
      constraints: { fuel: "nominal" },
    });

    expect([first, second].every((id) => id > 0n)).toBe(true);

    const rows = await repo.listByRun(10n);
    expect(rows.map((row) => row.agentIndex)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({
      simRunId: 10n,
      operatorId: 1n,
      persona: "lead",
      goals: ["monitor", "report"],
      constraints: { fuel: "nominal" },
    });
    expect(await repo.countForRun(10n)).toBe(2);
  });

  it("returns zero agents for an empty run and surfaces FK failures", async () => {
    expect(await repo.countForRun(999n)).toBe(0);

    await expect(
      repo.insert({
        simRunId: 999n,
        operatorId: null,
        agentIndex: 1,
        persona: "ghost",
        goals: [],
        constraints: {},
      }),
    ).rejects.toThrow(/sim_run/i);
  });
});
