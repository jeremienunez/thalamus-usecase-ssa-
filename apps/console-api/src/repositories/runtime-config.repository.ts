/**
 * RuntimeConfigRepository — Redis-backed overrides for runtime-tunable knobs.
 *
 * Layout: one hash per domain at `config:runtime:<domain>`. Values are
 * stringified scalars; callers (service) merge with typed defaults so the
 * UI only needs to send what it wants to change.
 *
 * No TTL — config persists indefinitely.
 */

import type IORedis from "ioredis";
import type { RuntimeConfigDomain } from "@interview/shared/config";

const KEY_PREFIX = "config:runtime";

export class RuntimeConfigRepository {
  constructor(private readonly redis: IORedis) {}

  async read(domain: RuntimeConfigDomain): Promise<Record<string, string>> {
    const raw = await this.redis.hgetall(`${KEY_PREFIX}:${domain}`);
    return raw ?? {};
  }

  async write(
    domain: RuntimeConfigDomain,
    patch: Record<string, string>,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.redis.hset(`${KEY_PREFIX}:${domain}`, patch);
  }

  async clear(domain: RuntimeConfigDomain): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}:${domain}`);
  }
}
