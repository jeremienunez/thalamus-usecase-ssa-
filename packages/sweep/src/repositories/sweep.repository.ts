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
const COUNTER = "sweep:counter";
const FEEDBACK = "sweep:feedback";
const TTL_DAYS = 90;
const TTL_SECS = TTL_DAYS * 86400;
const DOMAIN_BLOB = "domainBlob";

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

    return {
      flatFields: Object.fromEntries(
        Object.entries(serialized.flatFields).map(([key, value]) => [
          key,
          value == null ? null : String(value),
        ]),
      ),
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

  private async enqueueWrite(
    pipe: ReturnType<IORedis["pipeline"]>,
    suggestion: GenericInsertSuggestion,
    now: number,
  ): Promise<number> {
    const id = await this.redis.incr(COUNTER);
    const key = `${PREFIX}:${id}`;
    const createdAt = new Date(now).toISOString();
    pipe.hset(key, this.toHash(suggestion, id, createdAt));
    pipe.expire(key, TTL_SECS);
    pipe.zadd(IDX_ALL, now, String(id));
    pipe.sadd(IDX_PENDING, String(id));
    return id;
  }

  async insertMany(suggestions: GenericInsertSuggestion[]): Promise<number> {
    const pipe = this.redis.pipeline();
    const now = Date.now();
    for (const suggestion of suggestions) {
      await this.enqueueWrite(pipe, suggestion, now);
    }
    await pipe.exec();
    return suggestions.length;
  }

  async insertOne(suggestion: GenericInsertSuggestion): Promise<string> {
    return this.insertGeneric(suggestion);
  }

  async insertGeneric(input: GenericInsertSuggestion): Promise<string> {
    const pipe = this.redis.pipeline();
    const id = await this.enqueueWrite(pipe, input, Date.now());
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
    let ids: string[];
    if (opts.reviewed === false) {
      ids = await this.redis.smembers(IDX_PENDING);
    } else {
      ids = await this.redis.zrevrange(IDX_ALL, 0, -1);
    }

    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(`${PREFIX}:${id}`);
    const results = await pipe.exec();

    let rows: GenericSuggestionRow[] = (results ?? [])
      .map(([err, data]) => {
        if (err || !data || typeof data !== "object") return null;
        return this.toRow(data as Record<string, string>);
      })
      .filter((row): row is GenericSuggestionRow => row !== null);

    if (opts.category) {
      rows = rows.filter(
        (row) => String(row.domainFields.category ?? "") === opts.category,
      );
    }
    if (opts.severity) {
      rows = rows.filter(
        (row) => String(row.domainFields.severity ?? "") === opts.severity,
      );
    }
    if (opts.reviewed === true) {
      rows = rows.filter((row) => row.reviewedAt !== null);
    }

    const severityRank: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    rows.sort((a, b) => {
      const left = severityRank[String(a.domainFields.severity ?? "")] ?? 99;
      const right = severityRank[String(b.domainFields.severity ?? "")] ?? 99;
      if (left !== right) return left - right;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const total = rows.length;
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;

    return {
      rows: rows.slice(offset, offset + limit),
      total,
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

    await this.redis.hset(key, {
      accepted: patched.accepted,
      reviewerNote: patched.reviewerNote,
      reviewedAt: patched.reviewedAt,
    });
    await this.redis.srem(IDX_PENDING, id);

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

    const ids = await this.redis.zrevrange(IDX_ALL, 0, -1);
    const pipe = this.redis.pipeline();
    for (const id of ids) {
      pipe.hmget(`${PREFIX}:${id}`, "accepted", "severity", "category");
    }
    const results = await pipe.exec();

    let accepted = 0;
    let rejected = 0;
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const [err, data] of results ?? []) {
      if (err || !data) continue;
      const [flag, severity, category] = data as string[];
      if (flag === "true") accepted++;
      if (flag === "false") rejected++;
      if (severity) bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
      if (category) byCategory[category] = (byCategory[category] ?? 0) + 1;
    }

    return {
      totalSuggestions,
      pending,
      accepted,
      rejected,
      bySeverity,
      byCategory,
    };
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
