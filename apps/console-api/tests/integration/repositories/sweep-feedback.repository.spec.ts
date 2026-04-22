// @ts-expect-error -- ioredis-mock default export type is looser than ioredis
import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import { SweepFeedbackRepository } from "../../../src/repositories/sweep-feedback.repository";

let redis: InstanceType<typeof RedisMock> | null = null;

afterEach(async () => {
  await redis?.quit();
  redis = null;
});

describe("SweepFeedbackRepository", () => {
  it("pushes feedback entries newest-first", async () => {
    redis = new RedisMock();
    const repo = new SweepFeedbackRepository(redis);

    await repo.push({
      category: "mass_anomaly",
      wasAccepted: true,
      reviewerNote: "kept",
      operatorCountryName: "France",
    });
    await repo.push({
      category: "doctrine_mismatch",
      wasAccepted: false,
      reviewerNote: "reject",
      operatorCountryName: "USA",
    });

    const rows = await redis.lrange("sweep:feedback", 0, -1);
    expect(rows).toEqual([
      JSON.stringify({
        category: "doctrine_mismatch",
        wasAccepted: false,
        reviewerNote: "reject",
        operatorCountryName: "USA",
      }),
      JSON.stringify({
        category: "mass_anomaly",
        wasAccepted: true,
        reviewerNote: "kept",
        operatorCountryName: "France",
      }),
    ]);
  });

  it("trims the feedback list to the latest 200 entries", async () => {
    redis = new RedisMock();
    const repo = new SweepFeedbackRepository(redis);

    for (let i = 0; i < 205; i += 1) {
      await repo.push({
        category: `cat-${i}`,
        wasAccepted: i % 2 === 0,
        reviewerNote: `note-${i}`,
        operatorCountryName: "France",
      });
    }

    expect(await redis.llen("sweep:feedback")).toBe(200);
    const newest = await redis.lindex("sweep:feedback", 0);
    const oldest = await redis.lindex("sweep:feedback", -1);
    expect(newest).toContain('"category":"cat-204"');
    expect(oldest).toContain('"category":"cat-5"');
  });
});
