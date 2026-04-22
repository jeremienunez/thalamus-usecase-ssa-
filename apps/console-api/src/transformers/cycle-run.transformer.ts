// apps/console-api/src/transformers/cycle-run.transformer.ts
//
// Pure mapper from the service-internal `CycleRun` / `CycleRunFinding`
// shapes to the wire DTOs consumed by `POST /api/cycles/run`.
//
// The service owns the in-memory shape; the controller owns the HTTP
// response; this transformer is the single bridge. Keeping it free of
// business logic preserves the SRP violation fix at the core of Phase 10.
import type { CycleRun, CycleRunFinding } from "../types/cycle.types";
import type {
  CycleRunDto,
  CycleRunFindingDto,
  CycleRunResponseDto,
} from "@interview/shared/dto/cycle-run.dto";

/**
 * Minimal structural shape of a thalamus finding row as it leaves the
 * graph service. Kept local to avoid pulling drizzle column types into
 * the transformer — only the fields the wire contract exposes.
 */
export interface ThalamusFindingLike {
  id: bigint | number | string;
  researchCycleId: bigint | number | string;
  title: string;
  summary: string;
  confidence: number;
}

/**
 * Project a raw graph finding row onto the internal `CycleRunFinding`
 * shape. Centralised here so the "sourceClass = KG", string id coercion,
 * and empty evidenceRefs defaults live in one place — the service just
 * feeds rows in.
 */
export function projectThalamusFinding(
  f: ThalamusFindingLike,
): CycleRunFinding {
  return {
    id: String(f.id),
    title: f.title,
    summary: f.summary,
    sourceClass: "KG",
    confidence: f.confidence,
    evidenceRefs: [],
  };
}

/**
 * Project a single internal finding onto the wire DTO. Currently a
 * structural copy — the shapes match by construction (see
 * {@link projectThalamusFinding} in the service). Kept as a separate
 * function so future changes (e.g. evidenceRefs enrichment) land in one
 * place instead of being scattered across callers.
 */
export function toCycleRunFindingDto(
  f: CycleRunFinding,
): CycleRunFindingDto {
  return {
    id: f.id,
    title: f.title,
    summary: f.summary,
    sourceClass: f.sourceClass,
    confidence: f.confidence,
    evidenceRefs: [...f.evidenceRefs],
  };
}

/**
 * Project the internal `CycleRun` onto the wire DTO. Optional fields
 * (`findings`, `costUsd`, `error`) are included conditionally so the
 * response body stays minimal for fish-only runs and success paths.
 */
export function toCycleRunDto(cycle: CycleRun): CycleRunDto {
  const dto: CycleRunDto = {
    id: cycle.id,
    kind: cycle.kind,
    startedAt: cycle.startedAt,
    completedAt: cycle.completedAt,
    findingsEmitted: cycle.findingsEmitted,
    cortices: [...cycle.cortices],
  };
  if (cycle.error !== undefined) dto.error = cycle.error;
  if (cycle.findings !== undefined)
    dto.findings = cycle.findings.map(toCycleRunFindingDto);
  if (cycle.costUsd !== undefined) dto.costUsd = cycle.costUsd;
  return dto;
}

/**
 * Wrap the projected cycle in the top-level `{ cycle }` envelope the
 * controller returns. The failure path may set a top-level `error`
 * mirror for client convenience — see cycles.controller.ts.
 */
export function toCycleRunResponseDto(cycle: CycleRun): CycleRunResponseDto {
  return { cycle: toCycleRunDto(cycle) };
}
