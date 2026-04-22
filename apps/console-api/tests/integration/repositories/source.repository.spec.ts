import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SourceRepository } from "../../../src/repositories/source.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SourceRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SourceRepository(harness.db);
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
    INSERT INTO source (id, name, slug, kind, url, category) VALUES
      (1, 'Agency Alerts', 'agency-alerts', 'rss', 'https://alerts.example/rss', 'advisory'),
      (2, 'Field Reports', 'field-reports', 'field', 'https://field.example', 'ops'),
      (3, 'Radar Net', 'radar-net', 'radar', 'https://radar.example', 'ops'),
      (4, 'Mission Press', 'mission-press', 'press', 'https://press.example', 'press'),
      (5, 'Orbital Papers', 'orbital-papers', 'arxiv', 'https://arxiv.example', 'research'),
      (6, 'OSINT Watch', 'osint-watch', 'osint', 'https://osint.example', 'intel'),
      (7, 'News Wire', 'news-wire', 'rss', 'https://news.example/rss', 'news')
  `);

  await harness.db.execute(sql`
    INSERT INTO source_item (
      source_id, external_id, title, abstract, authors, url, published_at, fetched_at, score
    ) VALUES
      (1, 'adv-1', 'Launch advisory for orbital lane', 'Advisory summary', ARRAY['Ops Desk'], 'https://alerts.example/a1', now() - interval '1 day', now() - interval '1 day', 0.9),
      (2, 'obs-1', 'Ground observation handoff', 'Manual field note', ARRAY['Field Team'], 'https://field.example/o1', now() - interval '3 hours', now() - interval '3 hours', 0.7),
      (3, 'rad-1', 'Radar tracking pass', 'Tracking arc received', ARRAY['Radar Team'], 'https://radar.example/r1', now() - interval '2 hours', now() - interval '2 hours', 0.8),
      (4, 'man-1', 'Station-keeping maneuver bulletin', 'Delta-v budget update', ARRAY['Mission Ops'], 'https://press.example/m1', now() - interval '5 hours', now() - interval '5 hours', 0.6),
      (5, 'paper-1', 'Orbital traffic primer', 'A primer on orbit slots', ARRAY['A. Analyst'], 'https://arxiv.example/p1', now() - interval '4 days', now() - interval '4 days', 0.95),
      (6, 'osint-1', 'Open-source conjunction chatter', 'OSINT merge candidate', ARRAY['Watcher'], 'https://osint.example/c1', now() - interval '6 hours', now() - interval '6 hours', 0.65),
      (7, 'rss-1', 'SSA tracking update', 'Tracking and radar recap', ARRAY['Desk'], 'https://news.example/n1', now() - interval '7 hours', now() - interval '7 hours', 0.5),
      (7, 'rss-2', 'Orbital primer news note', 'Primer note for operators', ARRAY['Desk'], 'https://news.example/n2', now() - interval '1 hour', now() - interval '1 hour', 0.55)
  `);

  await harness.db.execute(sql`
    INSERT INTO research_cycle (id, trigger_type, trigger_source, status, findings_count)
    VALUES (1, 'system', 'source-spec', 'completed', 1)
  `);
  await harness.db.execute(sql`
    INSERT INTO research_finding (
      id, research_cycle_id, cortex, finding_type, status, urgency,
      title, summary, evidence, reasoning, confidence, impact_score
    ) VALUES (
      10, 1, 'orbital_analyst', 'insight', 'active', 'medium',
      'Orbital primer finding', 'Primer finding summary', '[]'::jsonb,
      'reasoning', 0.8, 0.4
    )
  `);
}

describe("SourceRepository", () => {
  it("lists advisory feed rows with category and recency filters", async () => {
    const rows = await repo.listAdvisoryFeed({
      category: "advisory",
      sinceIso: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      limit: 10,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        sourceName: "Agency Alerts",
        sourceKind: "rss",
        title: "Launch advisory for orbital lane",
      }),
    ]);
  });

  it("prefers field and radar observations, then falls back to rss tracking", async () => {
    const preferred = await repo.listObservationSources({ limit: 10 });
    expect(preferred.map((row) => row.sourceKind)).toEqual(["radar", "field"]);

    await harness.db.execute(sql`
      DELETE FROM source_item WHERE source_id IN (2, 3)
    `);

    const fallback = await repo.listObservationSources({ limit: 10 });
    expect(fallback).toEqual([
      expect.objectContaining({
        sourceName: "News Wire",
        title: "SSA tracking update",
      }),
    ]);
  });

  it("returns correlation sources across field and osint branches", async () => {
    const rows = await repo.listCorrelationSources({ limit: 10 });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          streamKind: "field",
          sourceName: "Radar Net",
        }),
        expect.objectContaining({
          streamKind: "osint",
          sourceName: "OSINT Watch",
        }),
      ]),
    );
  });

  it("assembles orbital primer sources from paper, news, and prior findings", async () => {
    const rows = await repo.listOrbitalPrimerSources({
      topic: "primer",
      limit: 10,
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "paper",
          title: "Orbital traffic primer",
        }),
        expect.objectContaining({
          kind: "news",
          title: "Orbital primer news note",
        }),
        expect.objectContaining({
          kind: "finding",
          title: "Orbital primer finding",
        }),
      ]),
    );
  });
});
