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
  ThalamusBudgetsConfig,
  ConsoleAutonomyConfig,
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
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  fieldKindOf,
} from "@interview/shared/config";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("runtime-config");

/**
 * Port — storage backend for runtime config. The concrete
 * `RuntimeConfigRepository` (Redis-backed) satisfies this by duck typing
 * and is wired at the container level. Keeping the service ignorant of
 * the repo concrete type upholds the "services never import
 * repositories" rule (DIP).
 */
export interface RuntimeConfigStorePort {
  read(domain: string): Promise<Record<string, string>>;
  write(domain: string, patch: Record<string, string>): Promise<void>;
  clear(domain: string): Promise<void>;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepMergeJson(target: unknown, source: unknown): unknown {
  if (source === undefined) return target;
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] =
      isPlainObject(out[key]) && isPlainObject(value)
        ? deepMergeJson(out[key], value)
        : value;
  }
  return out;
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

  constructor(private readonly repo: RuntimeConfigStorePort) {}

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
      const kind = fieldKindOf(spec as FieldSpec);
      const parsed = parseValue(kind, rawValue);
      if (parsed === undefined) continue;
      out[key] =
        kind === "json" ? deepMergeJson(out[key], parsed) : parsed;
    }
    return out as unknown as RuntimeConfigMap[D];
  }

  async update<D extends RuntimeConfigDomain>(
    domain: D,
    patch: Partial<RuntimeConfigMap[D]>,
  ): Promise<RuntimeConfigMap[D]> {
    const { schema, validate } = this.specOrThrow(domain);
    const schemaMap = schema as unknown as Record<string, FieldSpec>;
    const current = await this.get(domain);
    const currentMap = current as unknown as Record<string, unknown>;
    const candidate: Record<string, unknown> = { ...current };
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in schemaMap)) {
        throw new ValidationError(
          `unknown field "${key}" for domain "${domain}"`,
        );
      }
      if (value === undefined) continue;
      const kind = fieldKindOf(schemaMap[key]!);
      if (kind === "json") {
        const next = deepMergeJson(currentMap[key], value);
        candidate[key] = next;
        normalized[key] = serializeValue("json", next);
      } else {
        candidate[key] = value;
        normalized[key] = serializeValue(kind, value);
      }
    }
    validate?.(candidate as unknown as RuntimeConfigMap[D]);
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
  ThalamusBudgetsConfig,
  ConsoleAutonomyConfig,
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
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
};
