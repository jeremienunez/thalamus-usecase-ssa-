import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { simRun, simSwarm } from "@interview/db-schema";

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

  it("snapshots an aggregate payload under a stable config key", async () => {
    await repo.snapshotAggregate({
      swarmId: 100n,
      key: "aggregate_pc",
      value: {
        consensus: "monitor",
        confidence: 0.82,
      },
    });

    const swarm = await repo.findById(100n);
    expect(swarm?.config).toMatchObject({
      aggregate_pc: {
        consensus: "monitor",
        confidence: 0.82,
      },
    });
  });

  it("closes a swarm with explicit outcome refs", async () => {
    const completedAt = new Date("2026-04-22T12:00:00Z");
    await harness.db.execute(sql`
      INSERT INTO research_cycle (
        id, trigger_type, status
      ) VALUES (
        500,
        'system',
        'completed'
      )
    `);
    await harness.db.execute(sql`
      INSERT INTO research_finding (
        id, research_cycle_id, cortex, finding_type, status, title, summary, confidence
      ) VALUES (
        55,
        500,
        'strategist',
        'insight',
        'active',
        'Outcome finding',
        'Outcome summary',
        0.9
      )
    `);

    await repo.closeSwarm({
      swarmId: 100n,
      status: "done",
      suggestionId: 44n,
      reportFindingId: 55n,
      completedAt,
    });

    expect(await repo.findById(100n)).toMatchObject({
      id: 100n,
      status: "done",
      suggestionId: 44n,
      outcomeReportFindingId: 55n,
      completedAt,
    });
  });

  it("aborts a swarm atomically with its pending and running fish", async () => {
    await harness.db.execute(sql`
      INSERT INTO sim_run (
        id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
      ) VALUES
        (
          201,
          100,
          0,
          'telemetry',
          '{"target": 7}'::jsonb,
          '{"kind":"baseline"}'::jsonb,
          '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
          'pending'
        ),
        (
          202,
          100,
          1,
          'telemetry',
          '{"target": 7}'::jsonb,
          '{"kind":"noisy"}'::jsonb,
          '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":43,"nanoModel":"stub"}'::jsonb,
          'running'
        ),
        (
          203,
          100,
          2,
          'telemetry',
          '{"target": 7}'::jsonb,
          '{"kind":"lagged"}'::jsonb,
          '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":44,"nanoModel":"stub"}'::jsonb,
          'done'
        )
    `);

    await repo.abortSwarm(100n);

    const swarm = await repo.findById(100n);
    expect(swarm).toMatchObject({
      id: 100n,
      status: "failed",
    });
    expect(swarm?.completedAt).toBeInstanceOf(Date);

    const runs = await harness.db
      .select({
        id: simRun.id,
        status: simRun.status,
        completedAt: simRun.completedAt,
      })
      .from(simRun)
      .where(eq(simRun.swarmId, 100n))
      .orderBy(simRun.id);

    expect(runs).toEqual([
      {
        id: 201n,
        status: "failed",
        completedAt: swarm?.completedAt ?? null,
      },
      {
        id: 202n,
        status: "failed",
        completedAt: swarm?.completedAt ?? null,
      },
      {
        id: 203n,
        status: "done",
        completedAt: null,
      },
    ]);

    const rawSwarm = await harness.db
      .select({ completedAt: simSwarm.completedAt })
      .from(simSwarm)
      .where(eq(simSwarm.id, 100n))
      .limit(1);
    expect(rawSwarm[0]?.completedAt).toEqual(swarm?.completedAt ?? null);
  });
});
