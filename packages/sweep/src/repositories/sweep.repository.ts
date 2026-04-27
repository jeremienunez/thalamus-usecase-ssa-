/**
 * Sweep Repository — Redis-backed storage for reviewable suggestions.
 *
 * Keys:
 *   sweep:suggestions:{id}  → Hash (suggestion data)
 *   sweep:index:all         → Sorted set (id, score=timestamp)
 *   sweep:index:pending     → Set of unreviewed suggestion ids
 *   sweep:counter           → Auto-increment id
 *   sweep:feedback          → List of reviewed suggestions (for self-improvement)
 */

import type IORedis from "ioredis";
import type {
  FindingDomainSchema,
  GenericInsertSuggestion,
  GenericSuggestionRow,
} from "../ports";

const PREFIX = "sweep:suggestions";
const IDX_ALL = "sweep:index:all";
const IDX_PENDING = "sweep:index:pending";
const IDX_RANKED_PREFIX = "sweep:index:ranked";
const COUNTER = "sweep:counter";
const FEEDBACK = "sweep:feedback";
const RESOLVE_LOCK_PREFIX = "sweep:resolve-lock";
const TTL_DAYS = 90;
const TTL_SECS = TTL_DAYS * 86400;
const DOMAIN_BLOB = "domainBlob";
const FILTER_SCAN_BATCH = 100;
const LEGACY_INDEX_SCAN_BATCH = 500;

const RESERVED_HASH_KEYS = new Set([
  "id",
  "domain",
  "accepted",
  "reviewerNote",
  "reviewedAt",
  "createdAt",
  "resolutionPayload",
  "resolutionStatus",
  "resolvedAt",
  "resolutionErrors",
  "pendingSelections",
  "simSwarmId",
  "simDistribution",
  DOMAIN_BLOB,
]);

export interface SuggestionFeedbackRow {
  wasAccepted: boolean;
  reviewerNote: string | null;
  domainFields: Record<string, unknown>;
}

export interface SweepRepositoryOpts {
  redis: IORedis;
  schema?: FindingDomainSchema;
  domain?: string;
}

export class SweepRepository {
  private readonly redis: IORedis;
  private readonly schema: FindingDomainSchema | undefined;
  private readonly domain: string;

  constructor(arg: IORedis | SweepRepositoryOpts) {
    if (arg && typeof arg === "object" && "redis" in arg) {
      this.redis = arg.redis;
      this.schema = arg.schema;
      this.domain = arg.domain ?? "generic";
    } else {
      this.redis = arg as IORedis;
      this.schema = undefined;
      this.domain = "generic";
    }
  }

  private serializeDomainFields(input: Record<string, unknown>): {
    flatFields: Record<string, string | null>;
    blob: Record<string, unknown>;
  } {
    const serialized = this.schema
      ? this.schema.serialize(input)
      : fallbackSerializeDomainFields(input);
    const flatFields = Object.fromEntries(
      Object.entries(serialized.flatFields).map(([key, value]) => [
        key,
        value == null ? null : String(value),
      ]),
    );
    assertNoReservedFlatFields(flatFields);

    return {
      flatFields,
      blob: serialized.blob,
    };
  }

  private deserializeDomainFields(d: Record<string, string>): Record<string, unknown> {
    const flatFields = extractFlatFields(d);
    const blob = parseBlob(d[DOMAIN_BLOB]);
    if (this.schema) {
      return this.schema.deserialize({ flatFields, blob });
    }
    return {
      ...flatFields,
      ...blob,
    };
  }

  private toHash(
    suggestion: GenericInsertSuggestion,
    id: number,
    createdAt: string,
  ): Record<string, string> {
    const { flatFields, blob } = this.serializeDomainFields(suggestion.domainFields);
    return {
      id: String(id),
      domain: suggestion.domain || this.domain,
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
      [DOMAIN_BLOB]: isEmptyRecord(blob) ? "" : JSON.stringify(blob),
      ...Object.fromEntries(
        Object.entries(flatFields).map(([key, value]) => [key, value ?? ""]),
      ),
    };
  }

  private enqueueWrite(
    pipe: ReturnType<IORedis["pipeline"]>,
    suggestion: GenericInsertSuggestion,
    id: number,
    now: number,
  ): number {
    const key = `${PREFIX}:${id}`;
    const createdAt = new Date(now).toISOString();
    const hash = this.toHash(suggestion, id, createdAt);
    pipe.hset(key, hash);
    pipe.expire(key, TTL_SECS);
    pipe.zadd(IDX_ALL, now, String(id));
    pipe.sadd(IDX_PENDING, String(id));
    this.indexSuggestion(pipe, String(id), hash, ["all", "pending"]);
    return id;
  }

  async insertMany(suggestions: GenericInsertSuggestion[]): Promise<number> {
    if (suggestions.length === 0) return 0;
    const lastId = await this.redis.incrby(COUNTER, suggestions.length);
    const firstId = lastId - suggestions.length + 1;
    const pipe = this.redis.pipeline();
    const now = Date.now();
    for (let i = 0; i < suggestions.length; i++) {
      this.enqueueWrite(pipe, suggestions[i]!, firstId + i, now);
    }
    await pipe.exec();
    return suggestions.length;
  }

  async insertOne(suggestion: GenericInsertSuggestion): Promise<string> {
    return this.insertGeneric(suggestion);
  }

  async insertGeneric(input: GenericInsertSuggestion): Promise<string> {
    const pipe = this.redis.pipeline();
    const id = await this.redis.incr(COUNTER);
    this.enqueueWrite(pipe, input, id, Date.now());
    await pipe.exec();
    return String(id);
  }

  async list(opts: {
    page?: number;
    limit?: number;
    category?: string;
    severity?: string;
    reviewed?: boolean;
  }): Promise<{ rows: GenericSuggestionRow[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.max(1, opts.limit ?? 20);
    const offset = (page - 1) * limit;
    const scope = scopeFromReviewed(opts.reviewed);
    await this.ensureRankedIndexesForRead(scope);
    const severity = normalizeFilter(opts.severity);
    const category = normalizeFilter(opts.category);
    const directIndex = this.directListIndex(scope, { severity, category });

    if (directIndex) {
      const [ids, total] = await Promise.all([
        this.redis.zrevrange(directIndex, offset, offset + limit - 1),
        this.redis.zcard(directIndex),
      ]);
      const rows = (await this.rowsByIds(ids)).filter((row) =>
        matchesListFilters(row, { reviewed: opts.reviewed, severity, category }),
      );
      return { rows, total };
    }

    const filtered = await this.scanFilteredIndex(
      await this.smallestCandidateIndex(scope, { severity, category }),
      { reviewed: opts.reviewed, severity, category },
      offset,
      limit,
    );

    return {
      rows: filtered.rows,
      total: filtered.total,
    };
  }

  async listGeneric(opts: {
    page?: number;
    limit?: number;
    category?: string;
    severity?: string;
    reviewed?: boolean;
  }): Promise<{ rows: GenericSuggestionRow[]; total: number }> {
    return this.list(opts);
  }

  async review(
    id: string,
    accepted: boolean,
    reviewerNote?: string,
  ): Promise<boolean> {
    const key = `${PREFIX}:${id}`;
    const current = await this.redis.hgetall(key);
    if (!current.id) return false;

    const reviewedAt = new Date().toISOString();
    const patched = {
      ...current,
      accepted: String(accepted),
      reviewerNote: reviewerNote ?? "",
      reviewedAt,
    };

    const pipe = this.redis.pipeline();
    pipe.hset(key, {
      accepted: patched.accepted,
      reviewerNote: patched.reviewerNote,
      reviewedAt: patched.reviewedAt,
    });
    pipe.srem(IDX_PENDING, id);
    this.unindexSuggestion(pipe, id, patched, ["pending"]);
    this.indexSuggestion(pipe, id, patched, ["reviewed"]);
    await pipe.exec();

    const row = this.toRow(patched);
    await this.redis.lpush(
      FEEDBACK,
      JSON.stringify({
        wasAccepted: accepted,
        reviewerNote: reviewerNote ?? null,
        domainFields: row?.domainFields ?? {},
      } satisfies SuggestionFeedbackRow),
    );
    await this.redis.ltrim(FEEDBACK, 0, 199);

    return true;
  }

  async loadPastFeedback(limit = 100): Promise<SuggestionFeedbackRow[]> {
    const raw = await this.redis.lrange(FEEDBACK, 0, limit - 1);
    return raw.map((entry) => {
      try {
        const parsed = JSON.parse(entry) as Partial<SuggestionFeedbackRow>;
        return {
          wasAccepted: parsed.wasAccepted === true,
          reviewerNote:
            parsed.reviewerNote == null ? null : String(parsed.reviewerNote),
          domainFields:
            parsed.domainFields && typeof parsed.domainFields === "object"
              ? (parsed.domainFields as Record<string, unknown>)
              : {},
        };
      } catch {
        return {
          wasAccepted: false,
          reviewerNote: null,
          domainFields: {},
        };
      }
    });
  }

  async getById(id: string): Promise<GenericSuggestionRow | null> {
    const data = await this.redis.hgetall(`${PREFIX}:${id}`);
    return this.toRow(data);
  }

  async getGeneric(id: string): Promise<GenericSuggestionRow | null> {
    return this.getById(id);
  }

  private toRow(d: Record<string, string>): GenericSuggestionRow | null {
    if (!d.id) return null;
    return {
      id: d.id,
      domain: d.domain || this.domain,
      createdAt: d.createdAt ?? "",
      accepted:
        d.accepted === "true" ? true : d.accepted === "false" ? false : null,
      reviewedAt: d.reviewedAt || null,
      reviewerNote: d.reviewerNote || null,
      resolutionStatus: d.resolutionStatus || "pending",
      resolvedAt: d.resolvedAt || null,
      resolutionErrors: d.resolutionErrors || null,
      simSwarmId: d.simSwarmId || null,
      simDistribution: d.simDistribution || null,
      domainFields: this.deserializeDomainFields(d),
      resolutionPayload: d.resolutionPayload || null,
    };
  }

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

  async claimResolutionLock(
    id: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      resolutionLockKey(id),
      token,
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  }

  async releaseResolutionLock(id: string, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      resolutionLockKey(id),
      token,
    );
  }

  async getStats(): Promise<{
    totalSuggestions: number;
    pending: number;
    accepted: number;
    rejected: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const totalSuggestions = await this.redis.zcard(IDX_ALL);
    const pending = await this.redis.scard(IDX_PENDING);

    let accepted = 0;
    let rejected = 0;
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    await this.forEachLegacyIndexBatch(async (ids) => {
      const pipe = this.redis.pipeline();
      for (const id of ids) {
        pipe.hmget(`${PREFIX}:${id}`, "accepted", "severity", "category");
      }
      const results = await pipe.exec();

      for (const [err, data] of results ?? []) {
        if (err || !data) continue;
        const [flag, severity, category] = data as string[];
        if (flag === "true") accepted++;
        if (flag === "false") rejected++;
        if (severity) bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
        if (category) byCategory[category] = (byCategory[category] ?? 0) + 1;
      }
    });

    return {
      totalSuggestions,
      pending,
      accepted,
      rejected,
      bySeverity,
      byCategory,
    };
  }

  private indexSuggestion(
    pipe: ReturnType<IORedis["pipeline"]>,
    id: string,
    hash: Record<string, string>,
    scopes: SuggestionIndexScope[],
  ): void {
    const score = rankedScore(hash.createdAt, hash.severity);
    const severity = normalizeFilter(hash.severity);
    const category = normalizeFilter(hash.category);

    for (const scope of scopes) {
      pipe.zadd(scopeIndex(scope), score, id);
      if (severity) pipe.zadd(severityIndex(scope, severity), score, id);
      if (category) pipe.zadd(categoryIndex(scope, category), score, id);
    }
  }

  private unindexSuggestion(
    pipe: ReturnType<IORedis["pipeline"]>,
    id: string,
    hash: Record<string, string>,
    scopes: SuggestionIndexScope[],
  ): void {
    const severity = normalizeFilter(hash.severity);
    const category = normalizeFilter(hash.category);

    for (const scope of scopes) {
      pipe.zrem(scopeIndex(scope), id);
      if (severity) pipe.zrem(severityIndex(scope, severity), id);
      if (category) pipe.zrem(categoryIndex(scope, category), id);
    }
  }

  private directListIndex(
    scope: SuggestionIndexScope,
    filters: { severity?: string; category?: string },
  ): string | null {
    if (filters.severity && filters.category) return null;
    if (filters.severity) return severityIndex(scope, filters.severity);
    if (filters.category) return categoryIndex(scope, filters.category);
    return scopeIndex(scope);
  }

  private async smallestCandidateIndex(
    scope: SuggestionIndexScope,
    filters: { severity?: string; category?: string },
  ): Promise<string> {
    const candidates = [
      filters.severity ? severityIndex(scope, filters.severity) : null,
      filters.category ? categoryIndex(scope, filters.category) : null,
    ].filter((key): key is string => key !== null);

    if (candidates.length === 0) return scopeIndex(scope);
    const sizes = await Promise.all(
      candidates.map(async (key) => ({ key, total: await this.redis.zcard(key) })),
    );
    sizes.sort((a, b) => a.total - b.total);
    return sizes[0]?.key ?? scopeIndex(scope);
  }

  private async scanFilteredIndex(
    indexKey: string,
    filters: {
      reviewed?: boolean;
      severity?: string;
      category?: string;
    },
    offset: number,
    limit: number,
  ): Promise<{ rows: GenericSuggestionRow[]; total: number }> {
    const rows: GenericSuggestionRow[] = [];
    let total = 0;
    let start = 0;

    while (true) {
      const ids = await this.redis.zrevrange(
        indexKey,
        start,
        start + FILTER_SCAN_BATCH - 1,
      );
      if (ids.length === 0) break;

      for (const row of await this.rowsByIds(ids)) {
        if (!matchesListFilters(row, filters)) continue;
        if (total >= offset && rows.length < limit) rows.push(row);
        total++;
      }

      if (ids.length < FILTER_SCAN_BATCH) break;
      start += FILTER_SCAN_BATCH;
    }

    return { rows, total };
  }

  private async rowsByIds(ids: string[]): Promise<GenericSuggestionRow[]> {
    if (ids.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(`${PREFIX}:${id}`);
    const results = await pipe.exec();

    return (results ?? [])
      .map(([err, data]) => {
        if (err || !data || typeof data !== "object") return null;
        return this.toRow(data as Record<string, string>);
      })
      .filter((row): row is GenericSuggestionRow => row !== null);
  }

  private async ensureRankedIndexesForRead(
    scope: SuggestionIndexScope,
  ): Promise<void> {
    const [ranked, legacy] = await Promise.all([
      this.redis.zcard(scopeIndex("all")),
      this.redis.zcard(IDX_ALL),
    ]);
    if (ranked === 0 && legacy > 0) {
      await this.rebuildRankedIndexesFromLegacy();
      return;
    }

    if (scope === "pending") {
      await this.ensurePendingRankedIndexForRead();
    }
  }

  private async rebuildRankedIndexesFromLegacy(): Promise<void> {
    await Promise.all([
      this.deleteRankedScopeIndexes("all"),
      this.deleteRankedScopeIndexes("pending"),
      this.deleteRankedScopeIndexes("reviewed"),
    ]);
    await this.forEachLegacyIndexBatch(async (ids) => {
      const rows = await this.rowsByIds(ids);
      if (rows.length === 0) return;

      const pipe = this.redis.pipeline();
      for (const row of rows) {
        const hash = {
          createdAt: row.createdAt,
          severity: String(row.domainFields.severity ?? ""),
          category: String(row.domainFields.category ?? ""),
        };
        this.indexSuggestion(pipe, row.id, hash, ["all"]);
        this.indexSuggestion(pipe, row.id, hash, [
          row.reviewedAt ? "reviewed" : "pending",
        ]);
      }
      await pipe.exec();
    });
  }

  private async ensurePendingRankedIndexForRead(): Promise<void> {
    const [ranked, pending] = await Promise.all([
      this.redis.zcard(scopeIndex("pending")),
      this.redis.scard(IDX_PENDING),
    ]);

    if (pending === 0) {
      await this.deleteRankedScopeIndexes("pending");
      return;
    }
    if (ranked === pending && (await this.pendingRankedSampleMatchesSet())) {
      return;
    }

    await this.deleteRankedScopeIndexes("pending");
    const ids = await this.redis.smembers(IDX_PENDING);
    const rows = await this.rowsByIds(ids);
    const pipe = this.redis.pipeline();
    for (const row of rows) {
      this.indexSuggestion(
        pipe,
        row.id,
        {
          createdAt: row.createdAt,
          severity: String(row.domainFields.severity ?? ""),
          category: String(row.domainFields.category ?? ""),
        },
        ["pending"],
      );
    }
    await pipe.exec();
  }

  private async pendingRankedSampleMatchesSet(): Promise<boolean> {
    const ids = await this.redis.zrevrange(scopeIndex("pending"), 0, 19);
    if (ids.length === 0) return false;

    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.sismember(IDX_PENDING, id);
    const results = await pipe.exec();
    return (results ?? []).every(([err, present]) => !err && present === 1);
  }

  private async deleteRankedScopeIndexes(
    scope: SuggestionIndexScope,
  ): Promise<void> {
    const pattern = `${scopeIndex(scope)}*`;
    let cursor = "0";
    let keys: string[] = [];

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);

      if (keys.length >= 100) {
        await this.redis.del(...keys);
        keys = [];
      }
    } while (cursor !== "0");

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  private async forEachLegacyIndexBatch(
    visit: (ids: string[]) => Promise<void>,
  ): Promise<void> {
    let start = 0;

    while (true) {
      const ids = await this.redis.zrevrange(
        IDX_ALL,
        start,
        start + LEGACY_INDEX_SCAN_BATCH - 1,
      );
      if (ids.length === 0) return;

      await visit(ids);

      if (ids.length < LEGACY_INDEX_SCAN_BATCH) return;
      start += LEGACY_INDEX_SCAN_BATCH;
    }
  }
}

type SuggestionIndexScope = "all" | "pending" | "reviewed";

function scopeFromReviewed(reviewed: boolean | undefined): SuggestionIndexScope {
  if (reviewed === false) return "pending";
  if (reviewed === true) return "reviewed";
  return "all";
}

function scopeIndex(scope: SuggestionIndexScope): string {
  return `${IDX_RANKED_PREFIX}:${scope}`;
}

function severityIndex(scope: SuggestionIndexScope, severity: string): string {
  return `${scopeIndex(scope)}:severity:${indexKeyPart(severity)}`;
}

function categoryIndex(scope: SuggestionIndexScope, category: string): string {
  return `${scopeIndex(scope)}:category:${indexKeyPart(category)}`;
}

function rankedScore(createdAt: string, severity: string | null | undefined): number {
  const time = Date.parse(createdAt);
  const timeScore = Number.isFinite(time) ? Math.max(0, time) : 0;
  return severityPriority(severity) * 10_000_000_000_000 + timeScore;
}

function severityPriority(severity: string | null | undefined): number {
  switch (normalizeFilter(severity)) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function matchesListFilters(
  row: GenericSuggestionRow,
  filters: {
    reviewed?: boolean;
    severity?: string;
    category?: string;
  },
): boolean {
  if (filters.reviewed === true && row.reviewedAt === null) return false;
  if (filters.reviewed === false && row.reviewedAt !== null) return false;
  if (
    filters.severity &&
    normalizeFilter(row.domainFields.severity) !== filters.severity
  ) {
    return false;
  }
  if (
    filters.category &&
    normalizeFilter(row.domainFields.category) !== filters.category
  ) {
    return false;
  }
  return true;
}

function normalizeFilter(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function indexKeyPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function resolutionLockKey(id: string): string {
  return `${RESOLVE_LOCK_PREFIX}:${id}`;
}

function assertNoReservedFlatFields(
  flatFields: Record<string, string | null>,
): void {
  const reserved = Object.keys(flatFields).filter((key) =>
    RESERVED_HASH_KEYS.has(key),
  );
  if (reserved.length > 0) {
    throw new Error(
      `Sweep domain field(s) use reserved storage key(s): ${reserved.join(", ")}`,
    );
  }
}

function fallbackSerializeDomainFields(input: Record<string, unknown>): {
  flatFields: Record<string, string | number | null>;
  blob: Record<string, unknown>;
} {
  const flatFields: Record<string, string | number | null> = {};
  const blob: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      flatFields[key] = null;
    } else if (typeof value === "string" || typeof value === "number") {
      flatFields[key] = value;
    } else if (typeof value === "boolean" || typeof value === "bigint") {
      flatFields[key] = String(value);
    } else {
      blob[key] = value;
    }
  }

  return { flatFields, blob };
}

function extractFlatFields(d: Record<string, string>): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(d)
      .filter(([key]) => !RESERVED_HASH_KEYS.has(key))
      .map(([key, value]) => [key, value === "" ? null : value]),
  );
}

function parseBlob(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isEmptyRecord(input: Record<string, unknown>): boolean {
  return Object.keys(input).length === 0;
}
