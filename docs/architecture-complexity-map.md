# Thalamus / Sweep / Fish Complexity Map

This is the one-page reader map for the repository. The codebase is complex because it has three loops that reuse some words - swarm, finding, promotion - while producing different artifacts.

## One-sentence model

Thalamus creates confidence-gated knowledge graph findings. Sweep audits that knowledge and gates changes through human review. Fish are isolated counterfactual runs inside Sweep that explore futures before their aggregate can become a reviewable suggestion.

## The Three Loops

| Loop | Runtime entry point | Unit of work | Collapse step | Persistent surface |
| ---- | ------------------- | ------------ | ------------- | ------------------ |
| Thalamus | `packages/thalamus/src/services/thalamus.service.ts` | a research cycle with a finalized DAG | `CycleLoopRunner` keeps findings above confidence, asks reflexion, replans until stop criteria | `research_cycle`, `research_finding`, `research_cycle_finding`, `research_edge` |
| Sweep audit | `packages/sweep/src/services/nano-sweep.service.ts` and `sweep.worker.ts` | a batch of domain audit candidates | domain audit provider + Redis dedup/routing | Redis `sweep_suggestion` rows |
| Sweep resolution | `packages/sweep/src/services/sweep-resolution.service.ts` | one accepted suggestion | Redis lock, preflight, handler dispatch, promotion adapter | Redis resolution status plus app-owned side effects |
| Fish swarm | `packages/sweep/src/sim/swarm.service.ts` and `swarm-fish.worker.ts` | one fish, stored as one `sim_run` in a `sim_swarm` | `AggregatorService` quorum, clustering, modal outcome, divergence score | `sim_swarm`, `sim_run`, `sim_agent`, `sim_turn`, `sim_agent_memory` |

## Why Fish Is The Hard Part

Fish look agentic, but their power comes from isolation plus aggregation:

- One fish is one perturbed future, identified by `(sim_swarm_id, fishIndex)`.
- Each fish owns its own agents, timeline, and memories.
- `MemoryService.topK` always scopes reads by `simRunId` and `agentId`; there is no cross-fish memory bleed.
- UC3 conjunction runs use the sequential driver: one actor speaks per turn and terminal `accept` / `reject` closes the fish.
- UC1 operator behavior uses the DAG driver: agents act in parallel for a turn, then observations are written as memories.
- Telemetry inference and PC estimator are single-turn DAG flows in the SSA app pack.
- The aggregator is not an LLM judge. It clusters terminal observable summaries with embeddings when available and falls back to pack-owned action bucketing.

That means the swarm can cover many plausible outcomes without letting one simulated future contaminate another. Cross-fish meaning appears only at aggregation time.

## Artifact Boundaries

The vocabulary matters:

- `Finding` means a Postgres knowledge graph row emitted by Thalamus or a promotion path.
- `Suggestion` means a reviewable Redis artifact owned by Sweep.
- `sim_turn` means a per-fish timeline event, not a KG fact.
- `sim_agent_memory` is fish-scoped memory, not global long-term memory.
- `Aggregator` means vector/action clustering over fish outcomes, not the retrieval curator.
- `Curator` means LLM/heuristic source ranking in the SSA explorer path.

## What Is Intentionally Not True

- There is no single magical swarm abstraction. Retrieval swarm, audit swarm, and counterfactual swarm have different workers, collapse rules, and storage.
- Sweep acceptance does not mean "blindly write to the KG." Resolution dispatches app-owned handlers, then calls an app-owned promotion adapter for durable side effects.
- A failed resolution is retryable; only `success` and `partial` are terminal.
- Fish do not emit reviewer suggestions one by one. Suggestions come from aggregate or pack-owned promotion paths.
- The CLI is still hybrid: cycles, KG graph, and why calls go through console-api HTTP, while some local accept/review paths still use public package APIs.

## Code Anchors

- Thalamus cycle: `packages/thalamus/src/services/thalamus.service.ts`
- Thalamus loop/reflexion: `packages/thalamus/src/services/cycle-loop.service.ts`
- Sweep resolution: `packages/sweep/src/services/sweep-resolution.service.ts`
- Sweep container ports: `packages/sweep/src/config/container.ts`
- Fish fan-out: `packages/sweep/src/sim/swarm.service.ts`
- Fish memory isolation: `packages/sweep/src/sim/memory.service.ts`
- Fish schema: `packages/db-schema/src/schema/sim.ts`
- Fish aggregation: `packages/sweep/src/sim/aggregator.service.ts`
- SSA kind guard: `apps/console-api/src/agent/ssa/sim/kind-guard.ts`
