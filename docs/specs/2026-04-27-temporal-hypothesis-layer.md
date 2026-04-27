# Temporal Hypothesis Layer

Version: v0.2  
Date: 2026-04-27  
Status: shadow-mode architecture spec  
Engine: Temporal Pattern Memory  
Scoring: temporal episode mining + STDP-like decay scoring

## Executive Summary

Temporal Hypothesis Layer, or THL, is a separate hypothesis layer for temporal trajectories. It learns from closed runs and finalized reviews, then produces auditable correlation hypotheses. It never produces facts, never writes to the factual KG, and never triggers actions by itself.

The contract is:

```text
historically, this trajectory often preceded this outcome
```

The target loop is:

```text
closed runs/reviews
 -> canonical TemporalEvent projection
 -> deterministic batch learning
 -> TemporalPatternHypothesis
 -> Sweep or human review
 -> read-only consumption by FollowUp/Fish/agents
 -> targeted follow-up wave
 -> seeded runs tagged with seeded_by_pattern_id
```

The first active consumer should be the FollowUp planner, because it chooses investigations rather than final actions.

## Locked Decisions

| ID | Decision | Rule |
| --- | --- | --- |
| D-001 | Product name | Temporal Hypothesis Layer. STDP is scoring detail only. |
| D-002 | Engine | Temporal Pattern Memory. |
| D-003 | Scoring | Temporal episode mining plus STDP-like decay scoring. No opaque neural model. |
| D-004 | Default signature | `event_type + event_source + action_kind + terminal_status`. `entity_id` is excluded. |
| D-005 | Visibility | Only `accepted` patterns are visible to normal consumers. `reviewable` is audit-only. |
| D-006 | Domains | `production`, `simulation`, `simulation_seeded`, `mixed`. Do not learn `mixed` directly. |
| D-007 | Negative evidence | Required before a pattern can become accepted. |
| D-008 | First consumer | FollowUp planner before general agents. |
| D-009 | Anti-contamination | Fish runs launched from a pattern must carry `seeded_by_pattern_id`. |
| D-010 | KG boundary | THL cannot import or call KG writers or `sim-promotion` paths. |

## Repo Anchors

| Anchor | Path | THL use |
| --- | --- | --- |
| Post-run evidence | `packages/db-schema/src/schema/sim.ts` | `sim_review_evidence` is the precedent for durable post-run proof. |
| Auto-review | `apps/console-api/src/services/sim-operator.service.ts` | Natural projection trigger after terminal swarms. |
| REPL follow-up | `apps/console-api/src/services/repl-chat.service.ts` | First read-only consumer through planning. |
| Follow-up policy | `apps/console-api/src/agent/ssa/followup/repl-followup-policy.ssa.ts` | Existing place to turn hypotheses into investigations. |
| KG risk boundary | `apps/console-api/src/services/sim-promotion.service.ts` | Must remain outside THL. |

## Target Architecture

```text
packages/temporal
  src/types.ts
  src/event-signature.ts
  src/episode-windows.ts
  src/stdp-like-scorer.ts
  src/negative-evidence.ts
  src/pattern-hash.ts

packages/db-schema/src/schema/temporal.ts

apps/console-api/src/repositories/temporal-event.repository.ts
apps/console-api/src/repositories/temporal-pattern.repository.ts
apps/console-api/src/repositories/temporal-learning-run.repository.ts

apps/console-api/src/services/temporal-projection.service.ts
apps/console-api/src/services/temporal-learning.service.ts
apps/console-api/src/services/temporal-memory.service.ts

apps/console-api/src/controllers/temporal.controller.ts
apps/console-api/src/routes/temporal.routes.ts

packages/shared/src/dto/temporal-memory.dto.ts
```

`packages/temporal` must stay pure: no DB, no HTTP, no KG, no Sweep mutation, no Fish runtime mutation. It only receives typed events and parameters, then returns deterministic pattern drafts.

## Canonical TemporalEvent

Temporal events are canonical projections from trusted tables. `stepLog` can help observability, but it is not a source of truth for learning.

```ts
interface TemporalEvent {
  id: string;
  projection_run_id: string;
  event_type: string;
  event_source: string;
  entity_id?: string;
  sim_run_id?: string;
  fish_index?: number;
  turn_index?: number;
  timestamp: number;
  agent_id?: string;
  action_kind?: string;
  confidence_before?: number;
  confidence_after?: number;
  review_outcome?: string;
  terminal_status?: string;
  embedding_id?: string;
  seeded_by_pattern_id?: string;
  source_domain: "production" | "simulation" | "simulation_seeded" | "mixed";
  canonical_signature: string;
  source_table: string;
  source_pk: string;
  payload_hash: string;
  metadata?: Record<string, unknown>;
}
```

Event ids should be deterministic:

```text
event_id = sha256(projection_version, source_table, source_pk, event_type)
```

## Pattern Hypothesis

```ts
interface TemporalPatternHypothesis {
  pattern_id: string;
  pattern_hash: string;
  pattern_version: string;
  status: "candidate" | "reviewable" | "accepted" | "rejected" | "deprecated";
  source_domain: "production" | "simulation" | "simulation_seeded" | "mixed";
  terminal_status: string;
  pattern_window_ms: number;
  pattern_score: number;
  support_count: number;
  negative_support_count: number;
  baseline_rate: number;
  lift: number;
  sources: string[];
  example_event_ids: string[];
  counterexample_event_ids: string[];
  score_components: {
    temporal_weight: number;
    support_factor: number;
    lift_factor: number;
    negative_penalty: number;
    stability_factor: number;
  };
  created_from_learning_run_id: string;
}
```

Score components are first-class audit data. Sweep must be able to see whether a score came from proximity, support, lift, or a weak negative-evidence penalty.

## Deterministic Scorer

Default signature:

```ts
canonical_signature = [
  event_type,
  event_source,
  action_kind ?? "none",
  terminal_status ?? "none",
].join("|");
```

Deterministic rules:

- sort events by `timestamp`, then `id`;
- build windows only around closed outcome events;
- use only events before the target outcome for v0.2;
- generate bounded ordered episodes with `max_steps`;
- count positive support per target outcome window;
- count negative support from comparable closed windows without the target outcome;
- filter by `min_support` and `activation_threshold`;
- hash the canonical pattern representation, not example ids;
- never merge outcomes such as `timeout` and `reject` into one pattern.

## Domains And Anti-Contamination

`simulation_seeded` must be isolated. It can be analyzed, but it must not contribute to a `production` score.

```text
if sim_run.seeded_by_pattern_id is not null:
  source_domain = "simulation_seeded"
  exclude_from_production_score = true
  link temporal_pattern_seeded_run(pattern_id, sim_run_id)
```

`mixed` is not a learning input in v0.2. It can only be a reviewed cross-domain relationship created after separate domain learning.

## Visibility

| Status | Normal consumers | Audit UI |
| --- | --- | --- |
| candidate | hidden | visible |
| reviewable | hidden | visible |
| accepted | visible read-only | visible |
| rejected | hidden | visible |
| deprecated | hidden | visible |

Every normal response must include `hypothesis: true` and `decisionAuthority: false`.

## Read-only Cortex Surface

Console API mounts the first read-only surface at:

```text
GET /api/cortex/temporal-patterns
```

Default behavior:

- returns only `accepted` patterns;
- clamps `limit` to `1..50`;
- supports `terminalStatus` and `sourceDomain` filters;
- includes `reviewable` only with explicit `includeAuditOnly=true`;
- exposes no mutable endpoint on the cortex route.

The response DTO is `TemporalPatternMemoryDto` from `@interview/shared/dto`. It separates positive examples from counterexamples and always carries `hypothesis: true` plus `decisionAuthority: false`.

## Edge Cases That Prove DoD

The initial executable DoD is encoded in:

- `packages/temporal/tests/thl-dod-edge-cases.spec.ts`
- `packages/temporal/tests/thl-architecture-boundary.spec.ts`
- `apps/console-api/tests/unit/services/temporal-projection.service.test.ts`
- `apps/console-api/tests/unit/services/temporal-learning.service.test.ts`
- `apps/console-api/tests/unit/services/temporal-memory.service.test.ts`
- `apps/console-api/tests/unit/controllers/temporal.controller.test.ts`
- `apps/console-api/tests/unit/services/temporal-architecture-boundary.test.ts`

Required covered cases:

- EC-001: same timestamp sorts by id.
- EC-004: projections are deterministic/idempotent by source table and primary key.
- EC-012: default signature excludes `entity_id`.
- EC-013: `agent_id` does not enter the global signature.
- EC-014: missing `action_kind` becomes `none`.
- EC-016: same sequence before different outcomes creates distinct patterns.
- EC-017: negative evidence suppresses frequent non-predictive sequences.
- EC-018: low support is filtered.
- EC-022: version changes produce different pattern hashes.
- EC-027: `simulation_seeded` is excluded from `production` learning.
- EC-038: pure THL package cannot import KG writers or `sim-promotion`.
- EC-052: scorer params are versioned through `pattern_version`.

## Definition Of Done For Shadow Slice

- `packages/temporal` is pure, deterministic, and testable without DB.
- Canonical signatures exclude `entity_id` and default missing fields to `none`.
- Same input plus same params yields same pattern hashes.
- Positive and negative evidence are both represented.
- `simulation_seeded` cannot contaminate `production` learning.
- Distinct outcomes create distinct hypotheses.
- Pattern hashes include `pattern_version`.
- Architecture tests block KG/promotion imports from `packages/temporal`.
- Console API exposes a read-only cortex route with `accepted` visibility by default.
- No automatic action or KG write is wired; this remains shadow-mode until evaluation proves value.
