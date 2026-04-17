/**
 * Space-Track catalog-diff fetcher.
 *
 * Detects NORAD ids that vanish from the public SATCAT (the strongest
 * opacity signal we have — an object that had a published TLE and no
 * longer does is almost always being hidden deliberately).
 *
 * Storage model — per CLAUDE auto-memory SSA architecture:
 *   KG (Postgres) = curated, FK-joined state
 *   Redis         = ingestion buffer, TTL-bound
 *
 * Each snapshot is a Redis SET at `satcat:snapshot:{YYYY-MM-DD}` containing
 * every NORAD id present in the authoritative catalog that day (TTL 7d).
 * `SDIFF today yesterday` = freshly vanished ids. We promote those hits
 * into `amateur_track` rows with `source_id` pointing at the Space-Track
 * source seed and a synthetic citation URL.
 */

import type Redis from "ioredis";
import { createLogger } from "@interview/shared/observability";
import type { NewAmateurTrack } from "@interview/db-schema";

const logger = createLogger("source-spacetrack-diff");

const SNAPSHOT_KEY_PREFIX = "satcat:snapshot:";
const SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** Format a date as YYYY-MM-DD in UTC — snapshot key suffix. */
export function snapshotDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function snapshotKey(date: Date): string {
  return `${SNAPSHOT_KEY_PREFIX}${snapshotDateKey(date)}`;
}

/**
 * Persist today's catalog as a Redis SET. Idempotent — safe to call
 * multiple times per day (SADD is commutative, TTL refreshed each call).
 */
export async function writeSnapshot(
  redis: Redis,
  date: Date,
  noradIds: readonly number[],
): Promise<void> {
  if (noradIds.length === 0) {
    logger.warn("Empty snapshot — refusing to write");
    return;
  }
  const key = snapshotKey(date);
  const pipeline = redis.pipeline();
  // Chunk SADD to stay well under Redis's command-length limits even with
  // a 50k-object catalog. ioredis handles large varargs but chunks are cheaper.
  const chunkSize = 5_000;
  for (let i = 0; i < noradIds.length; i += chunkSize) {
    const chunk = noradIds.slice(i, i + chunkSize).map(String);
    pipeline.sadd(key, ...chunk);
  }
  pipeline.expire(key, SNAPSHOT_TTL_SECONDS);
  await pipeline.exec();
  logger.info(
    { key, size: noradIds.length },
    "SATCAT snapshot written to Redis",
  );
}

/**
 * Compute vanished NORAD ids between two dates.
 *
 * Returns the set difference `yesterday − today` — ids present in the prior
 * snapshot but absent from today's. Empty if either snapshot is missing
 * (can't reason about opacity without both sides).
 */
export async function diffSnapshots(
  redis: Redis,
  earlier: Date,
  later: Date,
): Promise<number[]> {
  const earlierKey = snapshotKey(earlier);
  const laterKey = snapshotKey(later);

  const [earlierExists, laterExists] = await Promise.all([
    redis.exists(earlierKey),
    redis.exists(laterKey),
  ]);
  if (!earlierExists || !laterExists) {
    logger.debug(
      { earlierKey, laterKey, earlierExists, laterExists },
      "Snapshot missing — cannot diff",
    );
    return [];
  }

  // SDIFF: members in `earlier` that are NOT in `later` = vanished ids.
  const raw = await redis.sdiff(earlierKey, laterKey);
  return raw
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * Transform a set of vanished NORAD ids into `amateur_track` rows.
 *
 * Observed-at is the date of the LATER snapshot (the one where the id
 * disappeared). Citation URL points at Space-Track for reviewer inspection.
 */
export function buildVanishedTracks(
  vanishedNoradIds: readonly number[],
  ctx: { sourceId: bigint; observedAt: Date },
): NewAmateurTrack[] {
  return vanishedNoradIds.map((norad): NewAmateurTrack => ({
    sourceId: ctx.sourceId,
    observedAt: ctx.observedAt,
    candidateNoradId: norad,
    candidateCospar: null,
    tleLine1: null,
    tleLine2: null,
    observerHandle: "Space-Track SATCAT diff",
    citationUrl: `https://www.space-track.org/basicspacedata/query/class/satcat/NORAD_CAT_ID/${norad}`,
    rawExcerpt: `NORAD ${norad} vanished from public SATCAT on ${snapshotDateKey(ctx.observedAt)}`,
  }));
}
