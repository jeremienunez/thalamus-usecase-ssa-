import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TemporalPatternReviewRepository } from "../../../src/repositories/temporal-pattern-review.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: TemporalPatternReviewRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new TemporalPatternReviewRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("TemporalPatternReviewRepository", () => {
  it("loads audit evidence counts and persists review plus status atomically", async () => {
    const target = await repo.findReviewTarget(123n);

    expect(target).toMatchObject({
      positiveExampleCount: 1,
      counterexampleCount: 1,
    });
    expect(target?.hypothesis.status).toBe("reviewable");

    const result = await repo.applyReview({
      patternId: 123n,
      status: "accepted",
      reviewerId: 42n,
      reviewOutcome: "accepted",
      notes: "evidence checked",
    });

    expect(result.hypothesis.status).toBe("accepted");
    expect(result.review).toMatchObject({
      patternId: 123n,
      reviewerId: 42n,
      reviewOutcome: "accepted",
      notes: "evidence checked",
    });

    const rows = await harness.db.execute<{
      status: string;
      review_outcome: string;
      notes: string;
    }>(sql`
      SELECT p.status, r.review_outcome, r.notes
      FROM temporal_pattern_hypothesis p
      JOIN temporal_pattern_review r ON r.pattern_id = p.id
      WHERE p.id = 123
    `);
    expect(rows.rows).toEqual([
      {
        status: "accepted",
        review_outcome: "accepted",
        notes: "evidence checked",
      },
    ]);
  });
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO temporal_learning_run (
      id, pattern_version, source_domain, input_snapshot_hash, status
    ) VALUES (
      77,
      'temporal-v0.2.0',
      'production',
      'review-test',
      'completed'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO temporal_projection_run (
      id, projection_version, source_scope, from_ts, to_ts, input_snapshot_hash, status
    ) VALUES (
      88,
      'temporal-projection-v0.2.0',
      'temporal-review-test',
      '2026-04-28T09:00:00.000Z',
      '2026-04-28T10:00:00.000Z',
      'projection-review-test',
      'completed'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO temporal_event (
      id,
      projection_run_id,
      event_type,
      event_source,
      occurred_at,
      source_domain,
      canonical_signature,
      source_table,
      source_pk,
      payload_hash
    ) VALUES
      (
        'event-positive',
        88,
        'review.missing_relative_velocity',
        'review',
        '2026-04-28T09:10:00.000Z',
        'production',
        'review.missing_relative_velocity|review|none|none',
        'sim_review_evidence',
        '501',
        'hash-positive'
      ),
      (
        'event-counterexample',
        88,
        'review.missing_relative_velocity',
        'review',
        '2026-04-28T09:20:00.000Z',
        'production',
        'review.missing_relative_velocity|review|none|none',
        'sim_review_evidence',
        '502',
        'hash-counterexample'
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO temporal_pattern_hypothesis (
      id,
      pattern_hash,
      pattern_version,
      status,
      source_domain,
      terminal_status,
      pattern_window_ms,
      pattern_score,
      support_count,
      negative_support_count,
      created_from_learning_run_id
    ) VALUES (
      123,
      'pattern-hash-review',
      'temporal-v0.2.0',
      'reviewable',
      'production',
      'timeout',
      900000,
      0.9,
      8,
      1,
      77
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO temporal_pattern_example (
      pattern_id,
      event_id,
      role,
      occurred_at
    ) VALUES
      (123, 'event-positive', 'positive', '2026-04-28T09:10:00.000Z'),
      (123, 'event-counterexample', 'counterexample', '2026-04-28T09:20:00.000Z')
  `);
}
