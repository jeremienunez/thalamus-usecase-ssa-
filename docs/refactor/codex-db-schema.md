## 1) Schema organization

Overall: mostly coherent by bounded context, with a few leaks.

- `research.ts` is cleanly KG-focused (`research_cycle`, `research_finding`, `research_edge`) and does **not** hand-reference satellite columns; it stays on polymorphic `(entityType, entityId)` links ([research.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/research.ts#L136)).
- `satellite.ts` is a large but coherent “catalog” context (reference tables + satellite core + joins) ([satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L51)).
- `sim.ts` is coherent as a sim context, but it leaks satellite field vocabulary by hardcoding inferable telemetry keys/column names ([sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L156), [sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L178)) that mirror satellite columns ([satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L149)).
- `article.ts` + `user.ts` look like CMS/auth context inside an SSA-heavy package ([article.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/article.ts#L4), [user.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/user.ts#L3)); this is the clearest bounded-context outlier.
- Minor schema smell: forward FK with `(): any => satelliteBus.id` suggests ordering workaround ([satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L126)).

Shared column presets that meet your N≥2 métier rule:

- `created_at + updated_at` tuple repeats across at least `article`, `research_finding`, `satellite` ([article.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/article.ts#L12), [research.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/research.ts#L105), [satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L165)).
- Telemetry 14D scalar block repeats almost verbatim in `satellite` and `satellite_bus` ([satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L149), [satellite.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L205)).
- `embedding` vector column is repeated in `research_finding` and `sim_agent_memory` ([research.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/research.ts#L103), [sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L344)).

## 2) Enum hygiene

Not fully hygienic as “pure pgEnum projection of shared/enum”.

- Good: `research.enum.ts` is a clean projection from shared enums via `Object.values(...)` ([research.enum.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/enums/research.enum.ts#L27)).
- Drift risk: `source.enum.ts` and `sweep.enum.ts` are locally hardcoded literals, not derived from shared ([source.enum.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/enums/source.enum.ts#L18), [sweep.enum.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/enums/sweep.enum.ts#L11)).
- Shared currently exports `research/auth/messaging` only, no `source`/`sweep` enum source of truth ([shared enum index](/home/jerem/interview-thalamus-sweep/packages/shared/src/enum/index.ts#L1)).
- `sweep` contract is duplicated separately in Zod literals ([sweep.dto.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/transformers/sweep.dto.ts#L10)), increasing divergence risk.

## 3) Seed files (data vs hidden logic)

`conjunctions.ts` and `sources.ts` are **logic-heavy generators/pipelines**, not data blobs.

- `conjunctions.ts` includes orbital propagation, TLE synthesis, covariance model, Pc computation, and insertion loop ([conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L50), [conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L99), [conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L385)).
- `sources.ts` mixes source registration data with fetch/parse/transform/upsert logic for RSS/arXiv/NTRS ([sources.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/sources.ts#L27), [sources.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/sources.ts#L159), [sources.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/sources.ts#L323)).
- The file itself acknowledges duplicated fetchers to avoid package circular dependency ([sources.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/sources.ts#L5)).

Conclusion: these are orchestration/business ingestion scripts living in `db-schema`; for refactor prep, they should be treated as service code, not static seed data.

## 4) Relations wiring

- There is no `src/relations/` folder and no Drizzle `relations(...)` declarations in `db-schema/src`.
- FK wiring is mostly colocated on the “from” table definitions (good convention), e.g. [conjunction.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/conjunction.ts#L25), [sweep.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sweep.ts#L38), [sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L262).
- So: not scattered, but incomplete if you want Drizzle relation objects for query ergonomics.

## 5) Magic constants / thresholds

Yes, several domain thresholds/constants are hardcoded and should be named exports.

- Conjunction thresholds/defaults are inconsistent:
  - `seedConjunctions` default `thresholdKm = 50` ([conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L168))
  - CLI default `CONJ_THRESHOLD_KM = 5` ([conjunctions-cli.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions-cli.ts#L31))
  - Baseline provenance text says “threshold 5km” ([baselines.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/baselines.ts#L233))
- `hardBodyRadiusM = 20` appears both as schema default and seed constant ([conjunction.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/conjunction.ts#L38), [conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L364)).
- `pcMethod: "foster-gaussian-1d"` is literal in seed write path ([conjunctions.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/conjunctions.ts#L413)).
- `SIM_UNCORROBORATED` appears as a magic string in schema comments/types context ([sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L137)); docs flag this band as cross-package primitive ([sweep-organization.md](/home/jerem/interview-thalamus-sweep/docs/refactor/sweep-organization.md#L67)).

## 6) `index.ts` barrel (fan-in)

Mostly coherent, not a junk drawer.

- Root barrel exports `Database` type plus `schema` and `enums` surfaces only ([src/index.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/index.ts#L11)).
- It does **not** export seed scripts.
- Caveat: because `schema/index.ts` wildcard-exports all schema modules, consumers also pull non-table sim domain types/constants (`TurnAction`, telemetry mappings) via same entrypoint ([schema/index.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/index.ts#L9), [sim.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/sim.ts#L108)). That’s still defensible, but broad.
