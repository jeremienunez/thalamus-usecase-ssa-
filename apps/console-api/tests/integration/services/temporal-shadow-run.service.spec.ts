import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildTemporalRouteServices } from "../../../src/container";
import type { TemporalShadowRunService } from "../../../src/services/temporal-shadow-run.service";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let service: TemporalShadowRunService;

const from = new Date("2026-04-27T10:00:00Z");
const to = new Date("2026-04-27T11:00:00Z");

beforeAll(async () => {
  harness = await createIntegrationHarness();
  service = buildTemporalRouteServices(harness.db).shadow;
});

beforeEach(async () => {
  await harness.reset();
  await seedTemporalShadowFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("TemporalShadowRunService integration", () => {
  it("projects closed sim evidence through container wiring without KG writes", async () => {
    const summary = await service.runClosedWindow({
      from,
      to,
      sourceDomain: "simulation",
      targetOutcomes: ["resolved"],
      params: {
        pattern_window_ms: 120_000,
        pre_trace_decay_ms: 120_000,
        activation_threshold: 0.1,
        min_support: 2,
        max_steps: 1,
      },
    });

    expect(summary).toMatchObject({
      mode: "shadow",
      sourceDomain: "simulation",
      projection: {
        reviewEvidenceCount: 2,
        simRunCount: 2,
        eventCount: 4,
        insertedEventCount: 4,
      },
      learning: {
        eventCount: 4,
        patternCount: 1,
        persistedPatternCount: 1,
      },
      kgWriteAttempted: false,
      actionAuthority: false,
    });

    const temporalEvents = await harness.db.execute<{
      event_type: string;
      terminal_status: string | null;
      source_domain: string;
    }>(sql`
      SELECT event_type, terminal_status, source_domain
      FROM temporal_event
      ORDER BY occurred_at, id
    `);
    expect(temporalEvents.rows).toEqual([
      {
        event_type: "review.missing_relative_velocity",
        terminal_status: null,
        source_domain: "simulation",
      },
      {
        event_type: "fish.sim_run_completed",
        terminal_status: "resolved",
        source_domain: "simulation",
      },
      {
        event_type: "review.missing_relative_velocity",
        terminal_status: null,
        source_domain: "simulation",
      },
      {
        event_type: "fish.sim_run_completed",
        terminal_status: "resolved",
        source_domain: "simulation",
      },
    ]);

    const patterns = await harness.db.execute<{
      status: string;
      terminal_status: string;
      support_count: number;
      negative_support_count: number;
    }>(sql`
      SELECT status, terminal_status, support_count, negative_support_count
      FROM temporal_pattern_hypothesis
    `);
    expect(patterns.rows).toEqual([
      {
        status: "reviewable",
        terminal_status: "resolved",
        support_count: 2,
        negative_support_count: 0,
      },
    ]);

    const kgWrites = await harness.db.execute<{ c: number }>(sql`
      SELECT count(*)::int AS c
      FROM research_finding
    `);
    expect(kgWrites.rows[0]?.c).toBe(0);
  });
});

async function seedTemporalShadowFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status, started_at, completed_at
    ) VALUES (
      1,
      'uc_pc_estimator',
      'THL shadow swarm',
      '{"target": 7}'::jsonb,
      '[{"kind":"noop"}]'::jsonb,
      2,
      '{"llmMode":"fixtures","quorumPct":0.8,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'done',
      '2026-04-27T09:55:00Z',
      '2026-04-27T10:21:00Z'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status, started_at, completed_at
    ) VALUES
      (
        10,
        1,
        0,
        'uc_pc_estimator',
        '{"target": 7, "variant": "alpha"}'::jsonb,
        '{"kind":"noop"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
        'done',
        '2026-04-27T10:00:00Z',
        '2026-04-27T10:10:00Z'
      ),
      (
        11,
        1,
        1,
        'uc_pc_estimator',
        '{"target": 7, "variant": "beta"}'::jsonb,
        '{"kind":"noop"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":43,"nanoModel":"stub"}'::jsonb,
        'done',
        '2026-04-27T10:11:00Z',
        '2026-04-27T10:20:00Z'
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_review_evidence (
      id, swarm_id, sim_run_id, scope, question, answer, evidence_refs, trace_excerpt, created_at
    ) VALUES
      (
        100,
        1,
        10,
        'fish',
        'What input is missing?',
        'Relative velocity is missing for this estimate.',
        '[{"kind":"sim_run","id":"10"}]'::jsonb,
        '{"fishIndex":0}'::jsonb,
        '2026-04-27T10:09:00Z'
      ),
      (
        101,
        1,
        11,
        'fish',
        'What input is missing?',
        'Relative velocity is missing for this estimate.',
        '[{"kind":"sim_run","id":"11"}]'::jsonb,
        '{"fishIndex":1}'::jsonb,
        '2026-04-27T10:19:00Z'
      )
  `);
}
