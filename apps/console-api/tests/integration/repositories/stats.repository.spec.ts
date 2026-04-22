import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { StatsRepository } from "../../../src/repositories/stats.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: StatsRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new StatsRepository(harness.db);
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
    INSERT INTO orbit_regime (id, name) VALUES (1, 'LEO')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id)
    VALUES (1, 'France', 'france', 1)
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES (1, 'CNES', 'cnes')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (id, name, slug, norad_id, operator_id, operator_country_id)
    VALUES
      (1, 'Sat A', 'sat-a', 1001, 1, 1),
      (2, 'Sat B', 'sat-b', 1002, 1, 1)
  `);
  await harness.db.execute(sql`
    INSERT INTO conjunction_event (
      id, primary_satellite_id, secondary_satellite_id, epoch, min_range_km, relative_velocity_kmps, probability_of_collision
    ) VALUES
      (1, 1, 2, now(), 0.1, 12.3, 0.002)
  `);
  await harness.db.execute(sql`
    INSERT INTO research_cycle (id, trigger_type, trigger_source, status, findings_count)
    VALUES
      (1, 'system', 'stats-seed', 'running', 2),
      (2, 'user', 'stats-seed-2', 'completed', 1)
  `);
  await harness.db.execute(sql`
    INSERT INTO research_finding (
      id, research_cycle_id, cortex, finding_type, status, urgency,
      title, summary, evidence, reasoning, confidence, impact_score
    ) VALUES
      (10, 1, 'orbital_analyst', 'insight', 'active', 'medium', 'A', 'A', '[]'::jsonb, 'A', 0.8, 0.5),
      (11, 1, 'strategist', 'alert', 'archived', 'high', 'B', 'B', '[]'::jsonb, 'B', 0.6, 0.4),
      (12, 2, 'orbital_analyst', 'trend', 'active', 'low', 'C', 'C', '[]'::jsonb, 'C', 0.7, 0.3)
  `);
  await harness.db.execute(sql`
    INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight)
    VALUES
      (10, 'satellite', 1, 'about', 1.0),
      (11, 'operator', 1, 'supports', 0.5)
  `);
}

describe("StatsRepository", () => {
  it("returns aggregate counts across the core tables", async () => {
    expect(await repo.aggregates()).toEqual({
      satellites: 2,
      conjunctions: 1,
      findings: 3,
      kg_edges: 2,
      research_cycles: 2,
    });
  });

  it("groups findings by status and cortex", async () => {
    expect(await repo.findingsByStatus()).toEqual(
      expect.arrayContaining([
        { status: "active", count: 2 },
        { status: "archived", count: 1 },
      ]),
    );

    expect(await repo.findingsByCortex()).toEqual(
      expect.arrayContaining([
        { cortex: "orbital_analyst", count: 2 },
        { cortex: "strategist", count: 1 },
      ]),
    );
  });

  it("returns zeros and empty groups on an empty schema", async () => {
    await harness.reset();

    expect(await repo.aggregates()).toEqual({
      satellites: 0,
      conjunctions: 0,
      findings: 0,
      kg_edges: 0,
      research_cycles: 0,
    });
    expect(await repo.findingsByStatus()).toEqual([]);
    expect(await repo.findingsByCortex()).toEqual([]);
  });
});
