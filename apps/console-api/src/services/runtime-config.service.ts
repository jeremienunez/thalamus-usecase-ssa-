/**
 * RuntimeConfigService — merges Redis overrides with typed defaults and
 * vends `ConfigProvider<T>` instances the package-side code consumes.
 *
 * Read path (get): always fetches fresh from Redis, merges with defaults,
 * validates types. No in-memory caching — hit rate is low (nano call
 * startup) and freshness matters more than latency.
 *
 * Write path (update): partial patch, validates each field's type before
 * persisting. Unknown keys are rejected — caller gets a `ValidationError`.
 */

import type {
  ConfigProvider,
  NanoConfig,
  NanoSweepConfig,
  NanoSwarmConfig,
  RuntimeConfigDomain,
  RuntimeConfigMap,
} from "@interview/shared/config";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  RUNTIME_CONFIG_DEFAULTS,
} from "@interview/shared/config";
import { createLogger } from "@interview/shared/observability";
import type { RuntimeConfigRepository } from "../repositories/runtime-config.repository";

const logger = createLogger("runtime-config");

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

type FieldKind = "string" | "number";
type DomainSchema<D extends RuntimeConfigDomain> = {
  [K in keyof RuntimeConfigMap[D]]: FieldKind;
};

const SCHEMAS: {
  [D in RuntimeConfigDomain]: DomainSchema<D>;
} = {
  "thalamus.nano": {
    model: "string",
    callTimeoutMs: "number",
  },
  "thalamus.nanoSwarm": {
    waveSize: "number",
    waveDelayMs: "number",
    maxMicroQueries: "number",
  },
  "sweep.nanoSweep": {
    batchSize: "number",
    nullScanMaxIdsPerSuggestion: "number",
  },
};

function parseValue(kind: FieldKind, raw: string): unknown {
  if (kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return n;
  }
  return raw;
}

function serializeValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  throw new ValidationError(
    `unsupported value type: ${typeof value} (expected string or number)`,
  );
}

export class RuntimeConfigService {
  constructor(private readonly repo: RuntimeConfigRepository) {}

  async get<D extends RuntimeConfigDomain>(
    domain: D,
  ): Promise<RuntimeConfigMap[D]> {
    const raw = await this.repo.read(domain);
    const schema = SCHEMAS[domain];
    const defaults = RUNTIME_CONFIG_DEFAULTS[domain];
    const out: Record<string, unknown> = { ...defaults };
    for (const [key, kind] of Object.entries(schema)) {
      const rawValue = raw[key];
      if (rawValue == null || rawValue === "") continue;
      const parsed = parseValue(kind as FieldKind, rawValue);
      if (parsed !== undefined) out[key] = parsed;
    }
    return out as unknown as RuntimeConfigMap[D];
  }

  async update<D extends RuntimeConfigDomain>(
    domain: D,
    patch: Partial<RuntimeConfigMap[D]>,
  ): Promise<RuntimeConfigMap[D]> {
    const schema = SCHEMAS[domain] as Record<string, FieldKind>;
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in schema)) {
        throw new ValidationError(
          `unknown field "${key}" for domain "${domain}"`,
        );
      }
      if (value === undefined) continue;
      const kind = schema[key]!;
      if (kind === "number" && typeof value !== "number") {
        throw new ValidationError(
          `"${key}" must be a number, got ${typeof value}`,
        );
      }
      if (kind === "string" && typeof value !== "string") {
        throw new ValidationError(
          `"${key}" must be a string, got ${typeof value}`,
        );
      }
      normalized[key] = serializeValue(value);
    }
    await this.repo.write(domain, normalized);
    logger.info({ domain, patch }, "runtime config updated");
    return this.get(domain);
  }

  async reset<D extends RuntimeConfigDomain>(
    domain: D,
  ): Promise<RuntimeConfigMap[D]> {
    await this.repo.clear(domain);
    logger.info({ domain }, "runtime config reset to defaults");
    return this.get(domain);
  }

  /**
   * Vends a ConfigProvider<T> that reads fresh from Redis on every get().
   * Caller passes it into the package-side setter (e.g.
   * setNanoConfigProvider) at container boot.
   */
  provider<D extends RuntimeConfigDomain>(
    domain: D,
  ): ConfigProvider<RuntimeConfigMap[D]> {
    return {
      get: () => this.get(domain),
    };
  }
}

// Re-exports for convenient consumption by the controller layer.
export type {
  NanoConfig,
  NanoSwarmConfig,
  NanoSweepConfig,
  RuntimeConfigDomain,
  RuntimeConfigMap,
};
export {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
};
