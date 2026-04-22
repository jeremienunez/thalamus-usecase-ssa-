import type {
  PerturbationSpec,
  SeedRefs,
  SimConfig,
  SwarmConfig,
} from "@interview/db-schema";
import type { z } from "zod";
import {
  PerturbationSpecSchema,
  SeedRefsSchema,
  SimConfigSchema,
  SwarmConfigSchema,
} from "../schemas/sim.schema";

export function badRequest(message: string): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = 400;
  return err;
}

export function notFound(entity: string, id: bigint | number | string): Error {
  const err = new Error(`${entity} ${id} not found`);
  (err as Error & { statusCode?: number }).statusCode = 404;
  return err;
}

export function conflict(message: string): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = 409;
  return err;
}

export function preconditionFailed(message: string): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = 422;
  return err;
}

export function parseBigIntId(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw badRequest(`${label} must be numeric`);
  }
}

export function parseSafeNumberId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a safe integer`);
  }
  return parsed;
}

export function parseOptionalSafeNumberId(
  value: string | undefined,
  label: string,
): number | undefined {
  return value === undefined ? undefined : parseSafeNumberId(value, label);
}

export function normalizePgError(err: unknown): never {
  const code =
    typeof (err as { code?: unknown })?.code === "string"
      ? (err as { code: string }).code
      : undefined;
  if (code === "23505") {
    throw conflict("resource already exists");
  }
  if (code === "23503") {
    throw preconditionFailed("referenced row not found");
  }
  throw err;
}

export function toSeedRefs(seed: z.infer<typeof SeedRefsSchema>): SeedRefs {
  return { ...(seed as Record<string, unknown>) };
}

export function toPerturbationSpec(
  spec: z.infer<typeof PerturbationSpecSchema>,
): PerturbationSpec {
  return { ...(spec as Record<string, unknown>) } as PerturbationSpec;
}

export function toSimConfig(config: z.infer<typeof SimConfigSchema>): SimConfig {
  return {
    turnsPerDay: config.turnsPerDay,
    maxTurns: config.maxTurns,
    llmMode: config.llmMode,
    seed: config.seed,
    nanoModel: config.nanoModel,
  };
}

export function toSwarmConfig(
  config: z.infer<typeof SwarmConfigSchema>,
): SwarmConfig {
  return {
    llmMode: config.llmMode,
    quorumPct: config.quorumPct,
    perFishTimeoutMs: config.perFishTimeoutMs,
    fishConcurrency: config.fishConcurrency,
    nanoModel: config.nanoModel,
    seed: config.seed,
  };
}
