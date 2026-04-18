/**
 * SPEC-SSA-028 — Cortex Data Provider HTTP migration (BDD acceptance tests)
 *
 * Stubbed. Full implementation lives in a future feature branch — the current
 * branch is focused on the kernel-agnosticity prompt refactor. Each `it.todo`
 * captures one acceptance criterion from the spec, so when the branch is
 * opened the scenarios are already named and scoped.
 *
 * See: docs/specs/2026-04-18-cortex-data-provider-http-migration.md
 *
 * Motivating failure: cycle 405 — the planner emitted malformed params
 * (`{bus, " rideshare_flag"}`, `{fleet, shell}`, `{regime, cycle}`) to four
 * cortex helpers. Three of those helpers silently tolerated (0 findings or
 * 4 irrelevant findings), one rejected cleanly because it was the lone helper
 * with defensive param normalisation. Routing all 20 helpers through their
 * existing HTTP routes + Zod schemas turns silent tolerance into a visible
 * 400, which reflexion can replan on.
 */

import { describe, it } from "vitest";

describe("SPEC-SSA-028 — CortexDataProvider via HTTP (stub)", () => {
  describe("AC-1 strict validation surfaces at the boundary", () => {
    it.todo(
      "given planner emits {bus, ' rideshare_flag'} " +
        "when queryReplacementCost is invoked via the HTTP provider " +
        "then the route responds 400 with 'satelliteId: Required' " +
        "and no silent-zero meta-finding is persisted",
    );
  });

  describe("AC-2 planner drift is rejected when schema is strict", () => {
    it.todo(
      "given planner emits {fleet, shell} to queryApogeeHistory " +
        "when ApogeeHistoryQuerySchema is .strict() " +
        "then the route responds 400 with 'Unrecognized keys: fleet, shell' " +
        "and the service method is never called",
    );
  });

  describe("AC-3 skill frontmatter matches route Zod schema", () => {
    it.todo(
      "given every cortex skill declares a params: block " +
        "when a route schema gains a required field " +
        "then a skill/schema diff test fails on CI " +
        "and the divergence is surfaced before merge",
    );
  });

  describe("AC-4 internal HTTP auth does not leak token to kernel", () => {
    it.todo(
      "given the provider is wired with a kernel-scoped token " +
        "when the cortex calls any provider method " +
        "then Authorization header is attached by the provider adapter " +
        "and the token is not reachable from packages/thalamus/",
    );
  });

  describe("AC-5 provider surface equivalence (regression guard)", () => {
    it.todo(
      "given the old (direct-service) and new (HTTP) providers " +
        "when a cortex calls any of the 20 methods with valid params " +
        "then both return structurally identical items[] " +
        "and median loopback latency overhead is below 50ms",
    );
  });

  describe("AC-6 debris_forecaster false-positive is stopped", () => {
    it.todo(
      "given planner emits {regime, cycle} (garbage) to queryDebrisForecast " +
        "when DebrisForecastQuerySchema is .strict() " +
        "then the route rejects 'regime' + 'cycle' as unrecognised " +
        "and the cortex returns no off-topic arXiv papers in the iteration",
    );
  });

  describe("AC-7 reflexion reacts to route validation failures", () => {
    it.todo(
      "given a cortex received a 400 during a research cycle " +
        "when reflexion evaluates the iteration " +
        "then gaps[] names the cortex + validation error " +
        "and replan=true when remaining budget allows",
    );
  });
});

describe("SPEC-SSA-028 — out-of-scope reminders (will NOT be fixed here)", () => {
  it.todo(
    "static helper bug: forecastDebris ignores regimeId/horizonYears in its SQL UNION branches — tracked separately",
  );
  it.todo(
    "planner entity resolution: 'Starlink v2 mini' → satelliteId mapping required before dispatching ID-requiring cortices — planner-level work",
  );
});
