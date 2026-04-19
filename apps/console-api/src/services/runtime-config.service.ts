/**
 * RuntimeConfigService — registry-driven, Redis-backed runtime config.
 *
 * Read path (get): always fetches fresh from Redis, merges with registered
 * defaults, validates types. No in-memory caching — hit rate is low (nano
 * call startup) and freshness matters more than latency.
 *
 * Write path (update): partial patch, validates each field's kind before
 * persisting. Unknown keys are rejected — caller gets a `ValidationError`.
 *
 * Registry: the service holds NO hardcoded schema table. Each package
 * (thalamus, sweep, sim) registers its own domains at boot via
 * `registerDomain`. The service is closed to modification when a new
 * domain is added.
 */

import type {
  ConfigProvider,
  DomainSpec,
  FieldKind,
  FieldSpec,
  NanoConfig,
  NanoSweepConfig,
  NanoSwarmConfig,
  RuntimeConfigDomain,
  RuntimeConfigMap,
  RuntimeConfigRegistrar,
  ThalamusPlannerConfig,
  ThalamusCortexConfig,
  ThalamusReflexionConfig,
} from "@interview/shared/config";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  fieldKindOf,
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

function parseValue(kind: FieldKind, raw: string): unknown {
  switch (kind) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      if (raw === "1" || raw === "true") return true;
      if (raw === "0" || raw === "false") return false;
      return undefined;
    case "string[]":
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) &&
          parsed.every((x) => typeof x === "string")
          ? parsed
          : undefined;
      } catch {
        return undefined;
      }
    case "json":
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    case "string":
    default:
      return raw;
  }
}

function serializeValue(kind: FieldKind, value: unknown): string {
  switch (kind) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ValidationError(`expected finite number, got ${typeof value}`);
      }
      return String(value);
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ValidationError(`expected boolean, got ${typeof value}`);
      }
      return value ? "1" : "0";
    case "string[]":
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new ValidationError("expected string[]");
      }
      return JSON.stringify(value);
    case "json":
      // No deep validation — admin caller trusted.
      return JSON.stringify(value);
    case "string":
    default:
      if (typeof value !== "string") {
        throw new ValidationError(`expected string, got ${typeof value}`);
      }
      return value;
  }
}

export class RuntimeConfigService implements RuntimeConfigRegistrar {
  private readonly registry = new Map<
    RuntimeConfigDomain,
    DomainSpec<RuntimeConfigDomain>
  >();

  constructor(private readonly repo: RuntimeConfigRepository) {}

  registerDomain<D extends RuntimeConfigDomain>(
    domain: D,
    spec: DomainSpec<D>,
  ): void {
    if (this.registry.has(domain)) {
      logger.warn({ domain }, "runtime config domain re-registered (overwrite)");
    }
    this.registry.set(
      domain,
      spec as unknown as DomainSpec<RuntimeConfigDomain>,
    );
  }

  hasDomain(domain: RuntimeConfigDomain): boolean {
    return this.registry.has(domain);
  }

  registeredDomains(): RuntimeConfigDomain[] {
    return Array.from(this.registry.keys());
  }

  /** Returns the static (schema + defaults) metadata for a domain, for UI
   *  introspection. Separate from `get()` which reads live values. */
  describe<D extends RuntimeConfigDomain>(
    domain: D,
  ): { schema: DomainSpec<D>["schema"]; defaults: RuntimeConfigMap[D] } {
    const { schema, defaults } = this.specOrThrow(domain);
    return { schema, defaults };
  }

  /** Whether any override exists for this domain in the backing store. */
  async hasOverrides(domain: RuntimeConfigDomain): Promise<boolean> {
    this.specOrThrow(domain);
    const raw = await this.repo.read(domain);
    return Object.keys(raw).length > 0;
  }

  private specOrThrow<D extends RuntimeConfigDomain>(
    domain: D,
  ): DomainSpec<D> {
    const spec = this.registry.get(domain);
    if (!spec) {
      throw new ValidationError(`domain "${domain}" is not registered`);
    }
    return spec as unknown as DomainSpec<D>;
  }

  async get<D extends RuntimeConfigDomain>(
    domain: D,
  ): Promise<RuntimeConfigMap[D]> {
    const { defaults, schema } = this.specOrThrow(domain);
    const raw = await this.repo.read(domain);
    const out: Record<string, unknown> = { ...defaults };
    for (const [key, spec] of Object.entries(schema)) {
      const rawValue = raw[key];
      if (rawValue == null || rawValue === "") continue;
      const parsed = parseValue(fieldKindOf(spec as FieldSpec), rawValue);
      if (parsed !== undefined) out[key] = parsed;
    }
    return out as unknown as RuntimeConfigMap[D];
  }

  async update<D extends RuntimeConfigDomain>(
    domain: D,
    patch: Partial<RuntimeConfigMap[D]>,
  ): Promise<RuntimeConfigMap[D]> {
    const { schema } = this.specOrThrow(domain);
    const schemaMap = schema as unknown as Record<string, FieldSpec>;
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in schemaMap)) {
        throw new ValidationError(
          `unknown field "${key}" for domain "${domain}"`,
        );
      }
      if (value === undefined) continue;
      normalized[key] = serializeValue(fieldKindOf(schemaMap[key]!), value);
    }
    await this.repo.write(domain, normalized);
    logger.info({ domain, patch }, "runtime config updated");
    return this.get(domain);
  }

  async reset<D extends RuntimeConfigDomain>(
    domain: D,
  ): Promise<RuntimeConfigMap[D]> {
    this.specOrThrow(domain); // validate registration
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
  ThalamusPlannerConfig,
  ThalamusCortexConfig,
  ThalamusReflexionConfig,
  RuntimeConfigDomain,
  RuntimeConfigMap,
};
export {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
};
