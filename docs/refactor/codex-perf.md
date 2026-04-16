### Performance / Scalability Findings (new)

- **[HIGH] N+1 SQL writes in sweep resolution actions**  
  Evidence: [`sweep-resolution.service.ts` L432]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L432), [L475]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L475), [L536]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L536), [L654]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L654), [L688]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L688).  
  One-line fix: replace per-satellite/per-payload loops with set-based SQL (`INSERT ... SELECT`, `DELETE ... WHERE satellite_id = ANY(...)`, `UPDATE ... WHERE id = ANY(...)`).

- **[MED] N+1 DB pattern in explorer promotion/injection loop**  
  Evidence: [`orchestrator.ts` L172]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts#L172), [L181]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts#L181), [L294]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts#L294), [L300]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts#L300).  
  One-line fix: batch inject/promote with one prefetch of existing domains + bulk upsert instead of per-item select/insert.

- **[HIGH] Hot-path query indexes missing for `satellite` workflows**  
  Evidence: reads by slug/foreign key/search in [`satellite.repository.ts` L312]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts#L312), [L885]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts#L885), [`sweep-resolution.service.ts` L591]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts#L591); schema has no satellite indexes in [`satellite.ts` L112]( /home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L112) and migration index block omits satellite indexes [`0000_flawless_dorian_gray.sql` L223]( /home/jerem/interview-thalamus-sweep/packages/db-schema/migrations/0000_flawless_dorian_gray.sql#L223).  
  One-line fix: add btree indexes on `satellite.slug` (unique), `satellite.operator_country_id`, `satellite.created_at`, and FK columns used in joins/filters.

- **[MED] `similarity(op.name, ...)` query has no trigram index**  
  Evidence: [`satellite.repository.ts` L464]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts#L464), operator schema has no name index [`satellite.ts` L94]( /home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L94).  
  One-line fix: enable `pg_trgm` and create `GIN (operator.name gin_trgm_ops)`.

- **[HIGH] Redis list/stats paths scale as full scans**  
  Evidence: full ID fetch + full hash fetch + in-memory filter/sort in [`sweep.repository.ts` L175]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L175), [L184]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L184), [L236]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L236); stats scans all suggestions each call [`sweep.repository.ts` L370]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L370).  
  One-line fix: move filters/counters to Redis-native indexes (ZSET/SET per facet + counters) and paginate IDs before `HMGET`.

- **[MED] Redis RTT amplification from sequential commands where `MULTI/pipeline` should be used**  
  Evidence: per-item `INCR` in batch insert [`sweep.repository.ts` L85]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L85); sequential `INCR`/`EXPIRE` and `RPUSH`/`LTRIM`/`EXPIRE` in chat repo [`satellite-sweep-chat.repository.ts` L33]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite-sweep-chat.repository.ts#L33), [L46]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite-sweep-chat.repository.ts#L46); sequential review updates [`sweep.repository.ts` L261]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L261).  
  One-line fix: wrap related operations in `MULTI`/pipeline (or Lua) and use `INCRBY` allocation for batch IDs.

- **[HIGH] Unbounded cache growth in source registry**  
  Evidence: global cache map with TTL but no eviction/pruning [`registry.ts` L19]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/sources/registry.ts#L19), [L45]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/sources/registry.ts#L45), [L69]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/sources/registry.ts#L69).  
  One-line fix: replace with bounded LRU (max entries) and prune expired keys on set/get.

- **[HIGH] Unbounded in-memory state in `ConfidenceService` for long-running processes**  
  Evidence: unbounded `edges` map + `history_` array [`confidence.ts` L133]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/confidence.ts#L133), [L134]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/confidence.ts#L134), pushes at [L271]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/confidence.ts#L271); instantiated as shared runtime service [`container.ts` L129]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts#L129).  
  One-line fix: persist confidence/provenance in DB and cap in-memory history by size/time window.

- **[HIGH] Embedding regeneration of identical text (avoidable cost/latency)**  
  Evidence: same `observableSummary` copied to many agents per turn [`turn-runner-dag.ts` L179]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/turn-runner-dag.ts#L179), [`turn-runner-sequential.ts` L118]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/turn-runner-sequential.ts#L118); each row embedded independently [`memory.service.ts` L95]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/memory.service.ts#L95).  
  One-line fix: dedupe embedding calls per batch by content hash (`Map<hash, vector>`), then fan out reused vectors.

- **[MED] Missing abort propagation on SSE disconnects (wasted upstream LLM work)**  
  Evidence: SSE handler streams but never hooks socket close/abort [`satellite-sweep-chat.controller.ts` L26]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/satellite-sweep-chat.controller.ts#L26), [L34]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/satellite-sweep-chat.controller.ts#L34), [L46]( /home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/satellite-sweep-chat.controller.ts#L46); upstream stream call has timeout but no caller-provided abort [`nano-caller.ts` L235]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L235), [L246]( /home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L246).  
  One-line fix: create `AbortController` per request, cancel on `request.raw.close`, and pass signal into `callNanoStream`.

- **[MED] Frontend bundle bloat risk from eager loading 3D mode**  
  Evidence: static route import [`ops.tsx` L2]( /home/jerem/interview-thalamus-sweep/apps/console/src/routes/ops.tsx#L2) plus heavy Three/R3F imports [`OpsMode.tsx` L1]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/OpsMode.tsx#L1), [L2]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/OpsMode.tsx#L2).  
  One-line fix: lazy-load `/ops` route component with code splitting so non-ops users don’t download Three.js/R3F upfront.

- **[MED] React/Three frame-loop allocation hotspot in large satellite sets**  
  Evidence: per-frame per-satellite object allocations (`clone`, new `Euler`) in [`SatelliteField.tsx` L160]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/SatelliteField.tsx#L160), [L165]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/SatelliteField.tsx#L165), [L190]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/SatelliteField.tsx#L190), [L200]( /home/jerem/interview-thalamus-sweep/apps/console/src/modes/ops/SatelliteField.tsx#L200).  
  One-line fix: reuse preallocated vectors/quaternions/eulers and avoid per-frame object creation inside `useFrame` loops.
