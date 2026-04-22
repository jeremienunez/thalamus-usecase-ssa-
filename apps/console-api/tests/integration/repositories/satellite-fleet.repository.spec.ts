import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SatelliteFleetRepository } from "../../../src/repositories/satellite-fleet.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SatelliteFleetRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SatelliteFleetRepository(harness.db);
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
    INSERT INTO orbit_regime (id, name, altitude_band)
    VALUES (1, 'LEO', '160-2000km')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id)
    VALUES (1, 'France', 'france', 1)
  `);
  await harness.db.execute(sql`
    INSERT INTO platform_class (id, name) VALUES (1, 'EO')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite_bus (id, name, generation)
    VALUES (1, 'LEOStar', 'v2')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES (1, 'CNES', 'cnes')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, operator_id, operator_country_id, platform_class_id, satellite_bus_id, launch_year
    ) VALUES
      (1, 'Fleet A', 'fleet-a', 7001, 1, 1, 1, 1, 2022),
      (2, 'Fleet B', 'fleet-b', 7002, 1, 1, 1, 1, 2024)
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'telemetry',
      'Fleet swarm',
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
  await harness.db.execute(sql`
    INSERT INTO sim_agent (id, sim_run_id, operator_id, agent_index, persona, goals, constraints)
    VALUES
      (100, 10, 1, 1, 'lead', '["monitor"]'::jsonb, '{"fuel":"nominal"}'::jsonb),
      (101, 10, null, 2, 'observer', '["note"]'::jsonb, '{}'::jsonb)
  `);
}

describe("SatelliteFleetRepository", () => {
  it("returns an operator fleet snapshot with regime and platform mix", async () => {
    expect(await repo.getOperatorFleetSnapshot(1)).toEqual({
      operatorName: "CNES",
      operatorCountry: "France",
      satelliteCount: 2,
      regimeMix: [{ regime: "LEO", count: 2 }],
      platformMix: [{ platform: "EO", count: 2 }],
      avgLaunchYear: 2023,
    });
  });

  it("builds author labels with operator names and agent-index fallback", async () => {
    const labels = await repo.getSimAgentAuthorLabels([100, 101, 100]);

    expect(labels.get(100)).toBe("CNES");
    expect(labels.get(101)).toBe("agent#2");
    expect(labels.size).toBe(2);
  });

  it("throws when the requested operator does not exist", async () => {
    await expect(repo.getOperatorFleetSnapshot(999)).rejects.toThrow(
      /operator 999 not found/i,
    );
  });
});
