import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimSwarmRepository } from "../../../src/repositories/sim-swarm.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimSwarmRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimSwarmRepository(harness.db);
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
      100,
      'telemetry',
      'Existing swarm',
      '{"target": 7}'::jsonb,
      '[{"kind":"baseline"}]'::jsonb,
      3,
      '{"llmMode":"fixtures","quorumPct":60,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'running'
    )
  `);
}

describe("SimSwarmRepository", () => {
  it("inserts a swarm and reads it back", async () => {
    const id = await repo.insert({
      kind: "telemetry",
      title: "Inserted swarm",
      baseSeed: { target: 9 },
      perturbations: [{ kind: "baseline" }],
      size: 2,
      config: {
        llmMode: "fixtures",
        quorumPct: 70,
        perFishTimeoutMs: 900,
        fishConcurrency: 1,
        nanoModel: "stub",
        seed: 77,
      },
      status: "pending",
      createdBy: 12n,
    });

    expect(await repo.findById(id)).toMatchObject({
      id,
      title: "Inserted swarm",
      status: "pending",
      createdBy: 12n,
      baseSeed: { target: 9 },
    });
  });

  it("marks a swarm done and can link a suggestion outcome", async () => {
    await repo.linkOutcome(100n, { suggestionId: 99n });
    await repo.markDone(100n);

    expect(await repo.findById(100n)).toMatchObject({
      id: 100n,
      status: "done",
      suggestionId: 99n,
    });
    expect((await repo.findById(100n))?.completedAt).toBeInstanceOf(Date);
  });

  it("marks a swarm failed", async () => {
    await repo.markFailed(100n);

    expect(await repo.findById(100n)).toMatchObject({
      id: 100n,
      status: "failed",
    });
  });
});
