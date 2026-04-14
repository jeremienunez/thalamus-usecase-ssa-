/**
 * Sweep Repository — Redis-backed storage for nano-sweep suggestions.
 *
 * Keys:
 *   sweep:suggestions:{id}  → Hash (suggestion data)
 *   sweep:index:all         → Sorted set (id, score=timestamp)
 *   sweep:index:pending     → Set of unreviewed suggestion ids
 *   sweep:counter           → Auto-increment id
 *   sweep:feedback          → List of reviewed suggestions (for self-improvement)
 */

import type IORedis from "ioredis";
import type { SweepCategory, SweepSeverity } from "../transformers/sweep.dto";

const PREFIX = "sweep:suggestions";
const IDX_ALL = "sweep:index:all";
const IDX_PENDING = "sweep:index:pending";
const COUNTER = "sweep:counter";
const FEEDBACK = "sweep:feedback";
const TTL_DAYS = 90;
const TTL_SECS = TTL_DAYS * 86400;

// ─── Types ───────────────────────────────────────────────────────────

export interface InsertSuggestion {
  operatorCountryId: bigint | null;
  operatorCountryName: string;
  category: SweepCategory;
  severity: SweepSeverity;
  title: string;
  description: string;
  affectedSatellites: number;
  suggestedAction: string;
  webEvidence: string | null;
  resolutionPayload: string | null;
  /** Provenance tag when a suggestion is emitted from a sim-swarm aggregate. */
  simSwarmId?: string | null;
  /** JSON-stringified swarm distribution payload (clusters + modal + divergence). */
  simDistribution?: string | null;
}

export interface SweepSuggestionRow {
  id: string;
  operatorCountryId: string | null;
  operatorCountryName: string;
  category: SweepCategory;
  severity: SweepSeverity;
  title: string;
  description: string;
  affectedSatellites: number;
  suggestedAction: string;
  webEvidence: string | null;
  accepted: boolean | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  resolutionPayload: string | null;
  resolutionStatus: string | null;
  resolvedAt: string | null;
  resolutionErrors: string | null;
  pendingSelections: string | null;
  simSwarmId: string | null;
  simDistribution: string | null;
}

export interface PastFeedback {
  category: string;
  wasAccepted: boolean;
  reviewerNote: string | null;
  operatorCountryName: string;
}

// ─── Repository ──────────────────────────────────────────────────────

export class SweepRepository {
  constructor(private redis: IORedis) {}

  /** Insert a batch of suggestions. */
  async insertMany(suggestions: InsertSuggestion[]): Promise<number> {
    const pipe = this.redis.pipeline();
    const now = Date.now();
    let inserted = 0;

    for (const s of suggestions) {
      const id = await this.redis.incr(COUNTER);
      const key = `${PREFIX}:${id}`;
      const createdAt = new Date(now).toISOString();

      pipe.hset(key, {
        id: String(id),
        operatorCountryId:
          s.operatorCountryId != null ? String(s.operatorCountryId) : "",
        operatorCountryName: s.operatorCountryName,
        category: s.category,
        severity: s.severity,
        title: s.title,
        description: s.description,
        affectedSatellites: String(s.affectedSatellites),
        suggestedAction: s.suggestedAction,
        webEvidence: s.webEvidence ?? "",
        accepted: "",
        reviewerNote: "",
        reviewedAt: "",
        createdAt,
        resolutionPayload: s.resolutionPayload ?? "",
        resolutionStatus: "",
        resolvedAt: "",
        resolutionErrors: "",
        pendingSelections: "",
        simSwarmId: s.simSwarmId ?? "",
        simDistribution: s.simDistribution ?? "",
      });
      pipe.expire(key, TTL_SECS);
      pipe.zadd(IDX_ALL, now, String(id));
      pipe.sadd(IDX_PENDING, String(id));
      inserted++;
    }

    await pipe.exec();
    return inserted;
  }

  /**
   * Insert a single suggestion and return its id.
   * Used by the sim-swarm aggregate worker to surface a modal outcome.
   */
  async insertOne(suggestion: InsertSuggestion): Promise<string> {
    const id = await this.redis.incr(COUNTER);
    const key = `${PREFIX}:${id}`;
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const pipe = this.redis.pipeline();
    pipe.hset(key, {
      id: String(id),
      operatorCountryId:
        suggestion.operatorCountryId != null
          ? String(suggestion.operatorCountryId)
          : "",
      operatorCountryName: suggestion.operatorCountryName,
      category: suggestion.category,
      severity: suggestion.severity,
      title: suggestion.title,
      description: suggestion.description,
      affectedSatellites: String(suggestion.affectedSatellites),
      suggestedAction: suggestion.suggestedAction,
      webEvidence: suggestion.webEvidence ?? "",
      accepted: "",
      reviewerNote: "",
      reviewedAt: "",
      createdAt,
      resolutionPayload: suggestion.resolutionPayload ?? "",
      resolutionStatus: "",
      resolvedAt: "",
      resolutionErrors: "",
      pendingSelections: "",
      simSwarmId: suggestion.simSwarmId ?? "",
      simDistribution: suggestion.simDistribution ?? "",
    });
    pipe.expire(key, TTL_SECS);
    pipe.zadd(IDX_ALL, now, String(id));
    pipe.sadd(IDX_PENDING, String(id));
    await pipe.exec();
    return String(id);
  }


  /** List suggestions with filters + pagination. */
  async list(opts: {
    page?: number;
    limit?: number;
    category?: SweepCategory;
    severity?: SweepSeverity;
    reviewed?: boolean;
  }): Promise<{ rows: SweepSuggestionRow[]; total: number }> {
    // Get IDs from the right index
    let ids: string[];
    if (opts.reviewed === false) {
      ids = await this.redis.smembers(IDX_PENDING);
    } else {
      ids = await this.redis.zrevrange(IDX_ALL, 0, -1);
    }

    // Fetch all hashes
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(`${PREFIX}:${id}`);
    const results = await pipe.exec();

    let rows: SweepSuggestionRow[] = (results ?? [])
      .map(([err, data]) => {
        if (err || !data || typeof data !== "object") return null;
        const d = data as Record<string, string>;
        if (!d.id) return null;
        return {
          id: d.id,
          operatorCountryId: d.operatorCountryId || null,
          operatorCountryName: d.operatorCountryName ?? "",
          category: d.category as SweepCategory,
          severity: d.severity as SweepSeverity,
          title: d.title ?? "",
          description: d.description ?? "",
          affectedSatellites: Number(d.affectedSatellites) || 0,
          suggestedAction: d.suggestedAction ?? "",
          webEvidence: d.webEvidence || null,
          accepted:
            d.accepted === "true"
              ? true
              : d.accepted === "false"
                ? false
                : null,
          reviewerNote: d.reviewerNote || null,
          reviewedAt: d.reviewedAt || null,
          createdAt: d.createdAt ?? "",
          resolutionPayload: d.resolutionPayload || null,
          resolutionStatus: d.resolutionStatus || null,
          resolvedAt: d.resolvedAt || null,
          resolutionErrors: d.resolutionErrors || null,
          pendingSelections: d.pendingSelections || null,
          simSwarmId: d.simSwarmId || null,
          simDistribution: d.simDistribution || null,
        };
      })
      .filter((r): r is SweepSuggestionRow => r !== null);

    // Apply filters
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.severity) rows = rows.filter((r) => r.severity === opts.severity);
    if (opts.reviewed === true)
      rows = rows.filter((r) => r.reviewedAt !== null);

    // Sort: critical first, then by creation date desc
    const sevOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    rows.sort(
      (a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2),
    );

    // Paginate
    const total = rows.length;
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    rows = rows.slice(offset, offset + limit);

    return { rows, total };
  }

  /** Review a suggestion (accept/reject). */
  async review(
    id: string,
    accepted: boolean,
    reviewerNote?: string,
  ): Promise<boolean> {
    const key = `${PREFIX}:${id}`;
    const exists = await this.redis.exists(key);
    if (!exists) return false;

    const reviewedAt = new Date().toISOString();
    const ocName = await this.redis.hget(key, "operatorCountryName");
    const category = await this.redis.hget(key, "category");

    await this.redis.hset(key, {
      accepted: String(accepted),
      reviewerNote: reviewerNote ?? "",
      reviewedAt,
    });

    // Remove from pending
    await this.redis.srem(IDX_PENDING, id);

    // Store in feedback list for self-improvement
    await this.redis.lpush(
      FEEDBACK,
      JSON.stringify({
        category,
        wasAccepted: accepted,
        reviewerNote: reviewerNote ?? null,
        operatorCountryName: ocName ?? "",
      }),
    );
    await this.redis.ltrim(FEEDBACK, 0, 199); // keep last 200

    return true;
  }

  /** Load past feedback for self-improvement. */
  async loadPastFeedback(limit = 100): Promise<PastFeedback[]> {
    const raw = await this.redis.lrange(FEEDBACK, 0, limit - 1);
    return raw.map((r) => {
      try {
        return JSON.parse(r) as PastFeedback;
      } catch {
        return {
          category: "",
          wasAccepted: false,
          reviewerNote: null,
          operatorCountryName: "",
        };
      }
    });
  }

  /** Get a single suggestion by ID. */
  async getById(id: string): Promise<SweepSuggestionRow | null> {
    const key = `${PREFIX}:${id}`;
    const d = await this.redis.hgetall(key);
    if (!d.id) return null;
    return {
      id: d.id,
      operatorCountryId: d.operatorCountryId || null,
      operatorCountryName: d.operatorCountryName ?? "",
      category: d.category as SweepCategory,
      severity: d.severity as SweepSeverity,
      title: d.title ?? "",
      description: d.description ?? "",
      affectedSatellites: Number(d.affectedSatellites) || 0,
      suggestedAction: d.suggestedAction ?? "",
      webEvidence: d.webEvidence || null,
      accepted:
        d.accepted === "true" ? true : d.accepted === "false" ? false : null,
      reviewerNote: d.reviewerNote || null,
      reviewedAt: d.reviewedAt || null,
      createdAt: d.createdAt ?? "",
      resolutionPayload: d.resolutionPayload || null,
      resolutionStatus: d.resolutionStatus || null,
      resolvedAt: d.resolvedAt || null,
      resolutionErrors: d.resolutionErrors || null,
      pendingSelections: d.pendingSelections || null,
      simSwarmId: d.simSwarmId || null,
      simDistribution: d.simDistribution || null,
    };
  }

  /** Update resolution result fields on a suggestion. */
  async updateResolution(
    id: string,
    result: {
      status: string;
      resolvedAt?: string;
      errors?: string[];
      pendingSelections?: unknown[];
    },
  ): Promise<void> {
    const key = `${PREFIX}:${id}`;
    await this.redis.hset(key, {
      resolutionStatus: result.status,
      resolvedAt: result.resolvedAt ?? "",
      resolutionErrors: result.errors ? JSON.stringify(result.errors) : "",
      pendingSelections: result.pendingSelections
        ? JSON.stringify(result.pendingSelections)
        : "",
    });
  }

  /** Aggregate stats. */
  async getStats(): Promise<{
    totalSuggestions: number;
    pending: number;
    accepted: number;
    rejected: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const allIds = await this.redis.zcard(IDX_ALL);
    const pendingCount = await this.redis.scard(IDX_PENDING);

    // Need to scan all to count accepted/rejected/severity/category
    const ids = await this.redis.zrevrange(IDX_ALL, 0, -1);
    const pipe = this.redis.pipeline();
    for (const id of ids)
      pipe.hmget(`${PREFIX}:${id}`, "accepted", "severity", "category");
    const results = await pipe.exec();

    let accepted = 0;
    let rejected = 0;
    const bySeverity: Record<string, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    };
    const byCategory: Record<string, number> = {};

    for (const [err, data] of results ?? []) {
      if (err || !data) continue;
      const [acc, sev, cat] = data as string[];
      if (acc === "true") accepted++;
      if (acc === "false") rejected++;
      if (sev) bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return {
      totalSuggestions: allIds,
      pending: pendingCount,
      accepted,
      rejected,
      bySeverity,
      byCategory,
    };
  }
}
