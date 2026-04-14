/**
 * Satellite Sweep Chat Repository — Redis-backed storage for chat messages and findings.
 *
 * Keys:
 *   satellite-sweep:{satelliteId}:messages:{userId}  → List (JSON messages, capped 50)
 *   satellite-sweep:{satelliteId}:findings:{id}      → Hash (structured finding)
 *   satellite-sweep:{satelliteId}:findings:index     → Sorted set (id, score=timestamp)
 *   satellite-sweep:{satelliteId}:counter            → Auto-increment finding id
 *   satellite-sweep:rate:{userId}                    → Counter with 60s TTL (rate limit)
 */

import type IORedis from "ioredis";
import type {
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../transformers/satellite-sweep-chat.dto";

const PREFIX = "satellite-sweep";
const TTL_DAYS = 90;
const TTL_SECS = TTL_DAYS * 86400;
const MAX_MESSAGES = 50;
const RATE_LIMIT = 10; // per minute
const RATE_TTL = 60;

export class SatelliteSweepChatRepository {
  constructor(private redis: IORedis) {}

  // ─── Rate Limiting ──────────────────────────────────────────────

  async checkRateLimit(userId: string): Promise<boolean> {
    const key = `${PREFIX}:rate:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, RATE_TTL);
    return count <= RATE_LIMIT;
  }

  // ─── Messages ───────────────────────────────────────────────────

  async appendMessage(
    satelliteId: string,
    userId: string,
    msg: SweepChatMessage,
  ): Promise<void> {
    const key = `${PREFIX}:${satelliteId}:messages:${userId}`;
    await this.redis.rpush(key, JSON.stringify(msg));
    await this.redis.ltrim(key, -MAX_MESSAGES, -1);
    await this.redis.expire(key, TTL_SECS);
  }

  async getHistory(
    satelliteId: string,
    userId: string,
  ): Promise<SweepChatMessage[]> {
    const key = `${PREFIX}:${satelliteId}:messages:${userId}`;
    const raw = await this.redis.lrange(key, 0, -1);
    return raw.map((r) => JSON.parse(r) as SweepChatMessage);
  }

  // ─── Findings ───────────────────────────────────────────────────

  async storeFinding(
    satelliteId: string,
    finding: Omit<SweepFinding, "id" | "createdAt">,
  ): Promise<SweepFinding> {
    const counterKey = `${PREFIX}:${satelliteId}:counter`;
    const id = String(await this.redis.incr(counterKey));
    const createdAt = new Date().toISOString();
    const key = `${PREFIX}:${satelliteId}:findings:${id}`;
    const indexKey = `${PREFIX}:${satelliteId}:findings:index`;

    const full: SweepFinding = { ...finding, id, createdAt };

    const pipe = this.redis.pipeline();
    pipe.hset(key, {
      id,
      satelliteId: finding.satelliteId,
      category: finding.category,
      title: finding.title,
      summary: finding.summary,
      confidence: String(finding.confidence),
      evidence: JSON.stringify(finding.evidence),
      calculation: finding.calculation ?? "",
      createdAt,
    });
    pipe.expire(key, TTL_SECS);
    pipe.zadd(indexKey, Date.now(), id);
    await pipe.exec();

    return full;
  }

  async getFindings(
    satelliteId: string,
    limit = 20,
  ): Promise<SweepFinding[]> {
    const indexKey = `${PREFIX}:${satelliteId}:findings:index`;
    const ids = await this.redis.zrevrange(indexKey, 0, limit - 1);
    if (ids.length === 0) return [];

    const pipe = this.redis.pipeline();
    for (const id of ids)
      pipe.hgetall(`${PREFIX}:${satelliteId}:findings:${id}`);
    const results = await pipe.exec();

    const findings: SweepFinding[] = [];
    for (const [err, data] of results ?? []) {
      if (err || !data || typeof data !== "object") continue;
      const d = data as Record<string, string>;
      if (!d.id) continue;
      findings.push({
        id: d.id,
        satelliteId: d.satelliteId ?? satelliteId,
        category: d.category as SweepFinding["category"],
        title: d.title ?? "",
        summary: d.summary ?? "",
        confidence: Number(d.confidence) || 0,
        evidence: d.evidence ? (JSON.parse(d.evidence) as string[]) : [],
        calculation: d.calculation || undefined,
        createdAt: d.createdAt ?? "",
      });
    }
    return findings;
  }

  // ─── Full State ─────────────────────────────────────────────────

  async getState(
    satelliteId: string,
    userId: string,
  ): Promise<SweepChatState> {
    const [messages, findings] = await Promise.all([
      this.getHistory(satelliteId, userId),
      this.getFindings(satelliteId),
    ]);
    return { messages, findings };
  }
}
