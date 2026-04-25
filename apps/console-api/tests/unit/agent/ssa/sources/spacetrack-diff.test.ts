/**
 * Space-Track catalog-diff — Redis-backed snapshot / diff tests.
 *
 * Uses ioredis-mock — no live Redis required. Verifies:
 *   - snapshot key format
 *   - SADD chunking survives large catalogs
 *   - SDIFF correctly isolates freshly-vanished NORAD ids
 *   - vanished ids become well-formed `amateur_track` rows
 */

import { describe, it, expect, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";
import {
  snapshotDateKey,
  snapshotKey,
  writeSnapshot,
  diffSnapshots,
  buildVanishedTracks,
} from "../../../../../src/agent/ssa/sources/spacetrack-diff";

describe("Space-Track diff — key formatting", () => {
  it("YYYY-MM-DD in UTC, regardless of local time", () => {
    const d = new Date("2026-04-15T23:59:59Z");
    expect(snapshotDateKey(d)).toBe("2026-04-15");
    expect(snapshotKey(d)).toBe("satcat:snapshot:2026-04-15");
  });
});

describe("Space-Track diff — writeSnapshot + diffSnapshots round-trip", () => {
  let redis: InstanceType<typeof RedisMock>;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("persists a snapshot and diffs two days", async () => {
    const yesterday = new Date("2026-04-14T00:00:00Z");
    const today = new Date("2026-04-15T00:00:00Z");

    await writeSnapshot(redis, yesterday, [25544, 39232, 48274, 56789]);
    await writeSnapshot(redis, today, [25544, 48274, 56789]); // 39232 vanished

    const vanished = await diffSnapshots(redis, yesterday, today);
    expect(vanished).toEqual([39232]);
  });

  it("returns an empty array when either snapshot is missing", async () => {
    const yesterday = new Date("2026-04-14T00:00:00Z");
    const today = new Date("2026-04-15T00:00:00Z");

    await writeSnapshot(redis, today, [25544]);
    expect(await diffSnapshots(redis, yesterday, today)).toEqual([]);
  });

  it("survives a catalog larger than the 5k SADD chunk", async () => {
    const yesterday = new Date("2026-04-14T00:00:00Z");
    const today = new Date("2026-04-15T00:00:00Z");

    const huge = Array.from({ length: 12_000 }, (_, i) => 40_000 + i);
    await writeSnapshot(redis, yesterday, huge);
    await writeSnapshot(redis, today, huge.slice(0, 11_997)); // 3 vanished at the tail

    const vanished = await diffSnapshots(redis, yesterday, today);
    expect(vanished).toEqual([51_997, 51_998, 51_999]);
  });

  it("sets a TTL on the snapshot key (≤ 7 days)", async () => {
    const today = new Date();
    await writeSnapshot(redis, today, [1, 2, 3]);
    const ttl = await redis.ttl(snapshotKey(today));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
  });

  it("does not write when the snapshot is empty", async () => {
    const today = new Date();
    await writeSnapshot(redis, today, []);
    expect(await redis.exists(snapshotKey(today))).toBe(0);
  });
});

describe("Space-Track diff — buildVanishedTracks", () => {
  it("maps vanished ids to amateur_track rows with Space-Track citations", () => {
    const rows = buildVanishedTracks([39232, 56789], {
      sourceId: 7n,
      observedAt: new Date("2026-04-15T00:00:00Z"),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sourceId: 7n,
      candidateNoradId: 39232,
      candidateCospar: null,
      tleLine1: null,
      tleLine2: null,
      observerHandle: "Space-Track SATCAT diff",
    });
    expect(rows[0].citationUrl).toContain(
      "/basicspacedata/query/class/satcat/NORAD_CAT_ID/39232",
    );
    expect(rows[0].rawExcerpt).toContain("2026-04-15");
  });
});
