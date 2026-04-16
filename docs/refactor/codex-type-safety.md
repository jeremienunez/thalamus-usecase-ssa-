1. [admin-sweep.controller.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/admin-sweep.controller.ts#L65) (L65-L71) — **HIGH** — Fire-and-forget `sweep()` is intentionally unawaited and errors are swallowed with `.catch(() => {})`, so failed sweeps disappear with no signal.  
Fix: `await` in a background job wrapper (or queue) and at minimum log + persist failure state in the catch.

2. [swarm.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/swarm.service.ts#L186) (L186-L190), [swarm-fish.worker.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L122) (L122-L126), [queues.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/queues.ts#L71) (L71-L77) — **CRIT** — `swarmAggregateQueue.add()` has no retry/error recovery path; it’s called in fish-worker `finally`, and fish jobs have `attempts: 1`, so one transient Redis/BullMQ failure can permanently skip aggregate enqueue.  
Fix: wrap enqueue in retry/backoff + idempotent reconciliation job that periodically enqueues missing aggregates for fully-accounted swarms.

3. [llm-chat.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/llm-chat.ts#L141) (L141-L154, L201-L215) — **HIGH** — External `fetch` calls to Kimi/OpenAI have no `AbortSignal` timeout, so network stalls can hang retries indefinitely and block execution lanes.  
Fix: add `signal: AbortSignal.timeout(...)` (or passed-in controller) to both calls and classify timeout errors distinctly.

4. [voyage-embedder.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/utils/voyage-embedder.ts#L45) (L45-L58, L106-L119) — **HIGH** — Embedding API calls also have no timeout, allowing long hangs during query-time embedding and batch ingest.  
Fix: add timeout signals and fail-fast with structured retry budget.

5. [satellite-sweep-chat.repository.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite-sweep-chat.repository.ts#L55) (L55-L58, L118-L119) — **HIGH** — `JSON.parse` on Redis payloads is unguarded; one corrupted entry can throw and take down history/findings retrieval.  
Fix: parse with `try/catch` + schema validation, drop/repair bad records, and emit corruption telemetry.

6. [nano-sweep.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/nano-sweep.service.ts#L473) (L473-L517) — **MED** — LLM output is parsed and then trusted via ad-hoc casts (`as string`) without full schema validation; only `resolutionPayload` is Zod-checked.  
Fix: define a full `z.array(z.object(...))` for suggestions and only persist `safeParse`-validated items.

7. [sweep.repository.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L314) (L314-L315) — **MED** — Redis strings are cast to `SweepCategory`/`SweepSeverity` directly, bypassing existing Zod enums and allowing invalid states into typed flows.  
Fix: validate with `sweepCategoryEnum/sweepSeverityEnum.safeParse` on read and quarantine invalid rows.

8. [finding-routing.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/finding-routing.ts#L57) (L57-L67) — **MED** — Discriminated-union switch on `InboxSource` has no `never` guard; with `strict: false`, future variants can silently return `undefined`.  
Fix: add explicit `default` with `const _exhaustive: never = source;` and throw.

9. [confidence.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/confidence.ts#L203) (L203-L310) — **HIGH** — `promote()`/`demote()` switches on evidence kinds are non-exhaustive with no `never` assertion; adding a new evidence kind can leave `nextClass/nextValue` unassigned at runtime.  
Fix: enforce exhaustiveness with `never` guard branches and enable `noImplicitReturns`/stricter TS settings for this module.

10. [sweep-resolution.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L237) (L237, L594, L657, L817) — **HIGH** — Multiple `as unknown as` / `as never` casts bypass type safety on DB rows and mutation payloads, masking schema drift until runtime faults.  
Fix: replace casts with typed query helpers/Zod row schemas and typed update DTOs.

11. [executor.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/executor.ts#L31) (L31-L49, L452-L458) — **MED** — `any`-based helper registry (`Record<string, any>`) plus `any` parsing of external response content removes compile-time guarantees for helper invocation/output shape.  
Fix: define a typed helper map interface and parse external response with a Zod schema before extraction.

12. [enrichment.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/config/enrichment.ts#L12) (L12-L25) — **HIGH** — Critical env vars are read directly at import time with no validation/coercion safety (`Number(...)` can become `NaN`, empty keys silently accepted).  
Fix: introduce a single startup `envSchema.parse(process.env)` and export only validated config.

13. [nano-caller.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L97) (L97-L101, L307-L315) — **MED** — “Pretend-null” behavior: unknown OpenAI response shape yields empty text, but function still returns `{ ok: true }`, silently treating parse failure as success.  
Fix: make parsed text mandatory (`if (!text) return { ok:false, error:"invalid response shape" }`) with schema validation.
