// apps/console-api/src/transformers/cycle-run.dto.ts
//
// Wire-shape DTO for `POST /api/cycles/run`. This file contains types only —
// no logic, no Zod schemas, no imports from business code. Its job is to
// describe the edge contract the controller returns and the CLI adapter
// (packages/cli/src/adapters/thalamus.http.ts) consumes.
//
// Keeping DTOs separated from the internal CycleRun type lets the service
// evolve its in-memory shape without breaking the HTTP contract, and vice
// versa. The transformer (cycle-run.transformer.ts) is the single bridge.
import type { CycleKind } from "../schemas/cycles.schema";

/**
 * Per-finding wire shape returned when a thalamus branch ran. Mirrors
 * `ThalamusHttpFinding` on the CLI side — any change here is a breaking
 * contract change for every HTTP consumer.
 */
export type CycleRunFindingDto = {
  id: string;
  title: string;
  summary: string;
  sourceClass: string;
  confidence: number;
  evidenceRefs: string[];
};

/**
 * Wire shape of a single cycle run. `findings` and `costUsd` are optional
 * so fish-only runs stay additive and kind="thalamus"|"both" responses
 * carry the extra payload without widening the schema for every caller.
 */
export type CycleRunDto = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
  findings?: CycleRunFindingDto[];
  costUsd?: number;
};

/**
 * Top-level response body. Mirrors what the controller returns on both
 * success and failure paths (the failure path additionally sets HTTP 500
 * and attaches a top-level `error` field for client convenience).
 */
export type CycleRunResponseDto = {
  cycle: CycleRunDto;
  error?: string;
};
