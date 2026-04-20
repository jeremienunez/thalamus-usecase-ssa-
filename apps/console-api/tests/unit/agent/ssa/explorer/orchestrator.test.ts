/**
 * SPEC-TH-001 — Orchestrator
 *
 * Spec-vs-impl mismatch: SPEC-TH-001 describes a `MissionExecutor` with
 * `Mission`/`MissionStep`/`pickFrom`/`feedsInto`/SSE events. The shipped
 * implementation is `ThalamusDAGExecutor` in
 * `packages/thalamus/src/services/thalamus-executor.service.ts`, which uses
 * `DAGNode { cortex, params, dependsOn }`, topological-level parallelism,
 * per-cortex timeout, and Promise.allSettled isolation. None of SPEC-TH-001's
 * 7 ACs map 1-to-1 to the DAG executor surface.
 *
 * Resolution: this file records the mismatch and surfaces ACs as `it.todo`.
 * When the spec is reconciled with ThalamusDAGExecutor (or vice-versa), the
 * ACs can be re-anchored here.
 */
import { describe, it } from "vitest";

describe("SPEC-TH-001 spec/impl reconciliation needed", () => {
  it.todo(
    "re-anchor AC-1 (mission step execution) against ThalamusDAGExecutor.run()",
  );
  it.todo(
    "re-anchor AC-2 (pickFrom/feedsInto) — not present in the DAG executor surface",
  );
  it.todo(
    "re-anchor AC-3 (mutation-intent guard) against the cortex registry config",
  );
  it.todo("re-anchor AC-4 (tool_start/tool_end SSE events) against observer");
  it.todo(
    "re-anchor AC-5 (single-tool retry) — not present in the DAG executor surface",
  );
  it.todo("re-anchor AC-6 (step-level timeout) against per-cortex timeout");
  it.todo(
    "re-anchor AC-7 (all-settled isolation) against Promise.allSettled behaviour",
  );
});
