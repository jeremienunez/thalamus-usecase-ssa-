import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimTerminalRepository } from "../../../src/repositories/sim-terminal.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimTerminalRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimTerminalRepository(harness.db);
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
      'Terminal swarm',
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
    ) VALUES
      (
        10, 1, 0, 'telemetry',
        '{"target": 1}'::jsonb,
        '{"kind":"baseline"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
        'done'
      ),
      (
        11, 1, 1, 'telemetry',
        '{"target": 1}'::jsonb,
        '{"kind":"offset"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":43,"nanoModel":"stub"}'::jsonb,
        'failed'
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_agent (
      id, sim_run_id, operator_id, agent_index, persona, goals, constraints
    ) VALUES
      (100, 10, NULL, 1, 'lead', '[]'::jsonb, '{}'::jsonb),
      (101, 10, NULL, 2, 'backup', '[]'::jsonb, '{}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_turn (
      sim_run_id, turn_index, actor_kind, agent_id, action, rationale, observable_summary
    ) VALUES
      (
        10, 1, 'agent', 100,
        '{"kind":"observe","note":"first"}'::jsonb,
        'first rationale',
        'first summary'
      ),
      (
        10, 2, 'agent', 101,
        '{"kind":"maneuver","deltaVmps":2.5}'::jsonb,
        'second rationale',
        'second summary'
      )
  `);
}

describe("SimTerminalRepository", () => {
  it("returns full terminal rows, keeping empty runs visible", async () => {
    const rows = await repo.listTerminalsForSwarm(1n);

    expect(rows).toEqual([
      {
        simRunId: 10n,
        fishIndex: 0,
        runStatus: "done",
        agentIndex: 2,
        action: { kind: "maneuver", deltaVmps: 2.5 },
        observableSummary: "second summary",
        turnsPlayed: 2,
      },
      {
        simRunId: 11n,
        fishIndex: 1,
        runStatus: "failed",
        agentIndex: null,
        action: null,
        observableSummary: null,
        turnsPlayed: 0,
      },
    ]);
  });

  it("returns slim terminal-action rows for scalar aggregation", async () => {
    const rows = await repo.listTerminalActionsForSwarm(1n);

    expect(rows).toEqual([
      {
        simRunId: 10n,
        runStatus: "done",
        action: { kind: "maneuver", deltaVmps: 2.5 },
      },
      {
        simRunId: 11n,
        runStatus: "failed",
        action: null,
      },
    ]);
  });
});
