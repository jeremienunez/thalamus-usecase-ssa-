import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimRunRepository } from "../../../src/repositories/sim-run.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimRunRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimRunRepository(harness.db);
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
      'Primary swarm',
      '{"target": 7}'::jsonb,
      '[{"kind":"baseline"}]'::jsonb,
      3,
      '{"llmMode":"fixtures","quorumPct":60,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'running'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
    ) VALUES
      (
        10,
        1,
        0,
        'telemetry',
        '{"target": 7, "variant": "alpha"}'::jsonb,
        '{"kind":"baseline"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
        'pending'
      ),
      (
        11,
        1,
        1,
        'telemetry',
        '{"target": 7, "variant": "beta"}'::jsonb,
        '{"kind":"noisy"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":43,"nanoModel":"stub"}'::jsonb,
        'running'
      ),
      (
        12,
        1,
        2,
        'telemetry',
        '{"target": 7, "variant": "gamma"}'::jsonb,
        '{"kind":"lagged"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":44,"nanoModel":"stub"}'::jsonb,
        'done'
      )
  `);
}

describe("SimRunRepository", () => {
  it("inserts runs and reads them back by id and seed payload", async () => {
    const id = await repo.insert({
      swarmId: 1n,
      fishIndex: 3,
      kind: "telemetry",
      seedApplied: { target: 7, variant: "delta" },
      perturbation: { kind: "shifted" },
      config: {
        turnsPerDay: 2,
        maxTurns: 6,
        llmMode: "fixtures",
        seed: 55,
        nanoModel: "stub",
      },
      status: "paused",
    });

    const row = await repo.findById(id);
    expect(row).toMatchObject({
      id,
      swarmId: 1n,
      fishIndex: 3,
      status: "paused",
    });
    expect(await repo.getSeedApplied(id)).toEqual({
      target: 7,
      variant: "delta",
    });
    expect(await repo.findById(999n)).toBeNull();
  });

  it("counts fish by status and updates statuses", async () => {
    expect(await repo.countFishByStatus(1n)).toEqual({
      done: 1,
      failed: 0,
      running: 1,
      pending: 1,
      paused: 0,
    });

    const completedAt = new Date("2026-04-22T00:00:00Z");
    await repo.updateStatus(10n, "done", completedAt);

    const updated = await repo.findById(10n);
    expect(updated).toMatchObject({
      status: "done",
      completedAt,
    });
  });

  it("fails pending and running runs for a swarm without touching done rows", async () => {
    await repo.failPendingAndRunningForSwarm(1n);

    expect(await repo.countFishByStatus(1n)).toEqual({
      done: 1,
      failed: 2,
      running: 0,
      pending: 0,
      paused: 0,
    });
  });
});
