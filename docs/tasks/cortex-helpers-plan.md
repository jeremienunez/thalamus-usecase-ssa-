# Plan — Implement all cortex SQL helpers so the pipeline produces findings

**Goal:** every cortex skill under `packages/thalamus/src/cortices/skills/*.md` that declares `sqlHelper: queryFoo` must have a working export named exactly `queryFoo` in the sql-helpers module, returning rows against the LIVE schema. Outcome: `THALAMUS_MODE=record make thalamus-cycle` produces N>0 findings persisted to `research_finding` + edges, observable via `make psql`.

**Why this matters:** the executor's helper map is built by `Object.entries(sqlHelpers).filter(typeof === 'function')` at [packages/thalamus/src/cortices/executor.ts:45-49](packages/thalamus/src/cortices/executor.ts#L45). If the skill asks for `queryConjunctionScreen` and no export matches, helperFn is undefined → helper silently returns `[]` → no data → no findings. **The declared name must exist verbatim.**

---

## Phase 0 — Discovery (DONE)

Findings consolidated in this plan. Full evidence in [Phase 0 subagent report above]. Key numbers:

- **22 cortex skills** inspected. **18 declare sqlHelper**, 4 declare `none`.
- **13 existing helper exports** across 9 files, none match declared names 1-to-1 except accidentally.
- **Live tables**: article, exploration_log, launch, operator, operator_country, orbit_regime, payload, platform_class, research_cycle, research_edge, research_finding, satellite, satellite_bus, satellite_payload, source, source_item, sweep_audit, user.
- **Tables NOT in DB** (never reference): conjunction_event, maneuver, fragmentation_event, tle_history, observation_track, launch_epoch, fleet, watchlist, mv_mission_class_stats.
- **Columns NOT in satellite** (never reference): signal_power_dbw, mission_class, confidence_score, launch_cost, telemetry_14d (as single vector — we have 14 scalar cols).
- **UDF NOT available**: `safe_mission_window(sat_id)` does not exist.

### Allowed APIs

| API | Where to find | Pattern |
|---|---|---|
| Database type | [packages/db-schema/src/index.ts#L14](packages/db-schema/src/index.ts#L14) | `import type { Database } from "@interview/db-schema"` |
| Raw SQL | Drizzle 0.30 | `db.execute(sql\`SELECT ...\`)` returns `{ rows: [] }` |
| Tagged interpolation | drizzle-orm | `sql\`WHERE foo = ${value}\`` — safe against injection |
| Conditional fragment | drizzle-orm | `const f = cond ? sql\`AND x = ${v}\` : sql\`\`; ... ${f} ...` |
| Row cast | TS | `results.rows as unknown as T[]` |
| Enum value | [packages/shared/src/enum/research.enum.ts](packages/shared/src/enum/research.enum.ts) | `ResearchEntityType.Satellite` etc. |

### Copy-from template

Use [sql-helpers.rss.ts#L1-L44](packages/thalamus/src/cortices/sql-helpers.rss.ts#L1-L44) as the skeleton for every new helper. It has zero drift and only uses live columns.

### Mapping table (authoritative)

| Skill | Declared name | Action | Source data |
|---|---|---|---|
| advisory_radar | queryAdvisoryFeed | NEW-SOURCE | source_item where category IN ('ADVISORIES','SPACE_WEATHER') or kind IN ('press','field') |
| apogee_tracker | queryApogeeHistory | NEW-STUB | source_item ILIKE '%TLE%|apogee|decay%' + matching satellite |
| catalog | queryCatalogIngest | NEW-SATELLITE | satellite ORDER BY created_at DESC with operator/regime joins |
| classification_auditor | queryClassificationAudit | ALIAS + REWRITE | rewrite querySatelliteClassificationAudit body (drop missing cols), export both names |
| conjunction_analysis | queryConjunctionScreen | NEW-STUB | source_item ILIKE '%conjunction|close approach|CDM%' + candidate satellite pairs |
| correlation | queryCorrelationMerge | NEW-STUB | source_item by kind='field' + kind='rss' merged |
| data_auditor | queryDataAudit | ALIAS + REWRITE | rewrite querySatelliteDataAudit (drop missing cols), export both names |
| debris_forecaster | queryDebrisForecast | NEW-HYBRID | satellite GROUP BY regime + source_item ILIKE '%debris|fragmentation|kessler%' |
| fleet_analyst | queryOperatorFleet | NEW-SATELLITE | satellite aggregates by operator_id + joins |
| launch_scout | queryLaunchManifest | NEW-HYBRID | launch + source_item category='LAUNCH_MARKET' |
| maneuver_planning | queryManeuverPlan | NEW-STUB | source_item ILIKE '%maneuver|burn|delta-v%' + satellite context |
| observations | queryObservationIngest | NEW-STUB | source_item where kind IN ('radar','field') |
| orbital_analyst | queryOrbitalPrimer | NEW-SOURCE | source_item by topic keyword + recent research_finding anchors |
| orbit_slot_optimizer | queryOrbitSlotPlan | NEW-SATELLITE | satellite aggregates by operator/regime (slots used vs free) |
| payload_profiler | queryPayloadProfile | ALIAS | = queryPayloadContext |
| regime_profiler | queryRegimeProfile | ALIAS + REWRITE | rewrite queryOrbitRegimeProfile (drop launch_epoch), export both names |
| replacement_cost_analyst | queryReplacementCost | NEW-SATELLITE | satellite+bus+payload join, heuristic cost bands from mass_kg |
| traffic_spotter | queryOrbitalTraffic | NEW-HYBRID | satellite COUNT by regime + source_item ILIKE '%congestion|rideshare|traffic%' |

### Anti-patterns (grep these after implementation; should return 0)

```bash
# Missing tables
grep -n 'conjunction_event\|maneuver \|launch_epoch\|fleet\.\|watchlist' packages/thalamus/src/cortices/sql-helpers.*.ts

# Missing columns
grep -n 'signal_power_dbw\|mission_class\|confidence_score\|launch_cost\b\|telemetry_14d' packages/thalamus/src/cortices/sql-helpers.*.ts

# Missing UDF
grep -n 'safe_mission_window' packages/thalamus/src/cortices/sql-helpers.*.ts
```

All three should come back empty after Phase 2 completes.

---

## Phase 1 — Aliases (no new logic) — ~15 min

**What to implement** — add named re-exports at the bottom of the existing helper files so the declared name exists verbatim in the barrel.

1. In [sql-helpers.payload-profiler.ts](packages/thalamus/src/cortices/sql-helpers.payload-profiler.ts), append:
   ```ts
   export { queryPayloadContext as queryPayloadProfile } from "./sql-helpers.payload-profiler";
   ```
   (Or `export const queryPayloadProfile = queryPayloadContext;` inline — same effect.)

### Verification
- `grep -c 'export.*queryPayloadProfile' packages/thalamus/src/cortices/sql-helpers.*.ts` → 1
- `pnpm typecheck` → 0 errors
- DO NOT add aliases for the 3 helpers that need REWRITE (classification, data, regime). Those come in Phase 2.

### Anti-pattern guard
- Don't try to alias `querySatelliteDataAudit` → `queryDataAudit` here — the body is broken (missing columns). Rewrite first (Phase 2), then alias.

---

## Phase 2 — Rewrite 3 drifted helpers — ~30 min

### 2a. Rewrite [sql-helpers.data-audit.ts](packages/thalamus/src/cortices/sql-helpers.data-audit.ts) → `querySatelliteDataAudit` + alias `queryDataAudit`

Rewrite body to drop references to `signal_power_dbw`, `mission_class`, `confidence_score`, `mv_mission_class_stats`. Replacement logic: quality audit per regime using ONLY columns that exist.

**Available satellite cols for quality scoring:**
- `mass_kg` (null check)
- `telemetry_summary jsonb` (presence / key count)
- `operator_id`, `operator_country_id`, `platform_class_id` (FK integrity)
- `launch_year` (null check, range sanity)
- telemetry 14D scalars (null count)

Return shape: `{ regimeId, satellitesInRegime, missingMass, missingLaunchYear, missingTelemetry, avgTelemetryCompleteness, flaggedCount }[]`

End of file: `export const queryDataAudit = querySatelliteDataAudit;`

### 2b. Rewrite [sql-helpers.classification-audit.ts](packages/thalamus/src/cortices/sql-helpers.classification-audit.ts) → `querySatelliteClassificationAudit` + alias `queryClassificationAudit`

Replacement logic: find satellites where `classification_tier` is null/`'unclassified'` OR where platform_class/regime pair is suspicious.

**Simple heuristic to encode:**
- flag if `classification_tier IS NULL`
- flag if `mass_kg > 5000 AND platform_class.name = 'earth_observation'` (outlier)
- flag if `launch_year < 2010 AND mission_age < 1` (impossible)

Return shape: `{ satelliteId, name, operatorName, platformClass, classificationTier, flag, details }[]`

End of file: `export const queryClassificationAudit = querySatelliteClassificationAudit;`

### 2c. Rewrite [sql-helpers.orbit-regime.ts](packages/thalamus/src/cortices/sql-helpers.orbit-regime.ts) → `queryOrbitRegimeProfile` + alias `queryRegimeProfile`

**Drop** the `launch_epoch` JOIN (table doesn't exist). Keep the operator_country / regime / doctrine logic.

Return shape: `{ regimeId, regimeName, altitudeBand, satelliteCount, operatorCountries, topOperators, doctrineKeys }[]` — aggregated from satellite+operator_country+orbit_regime.

Also drop `queryLaunchEpochWeather` OR rewrite to stub (returns `[]` with a comment).

End of file: `export const queryRegimeProfile = queryOrbitRegimeProfile;`

### Verification (Phase 2)
```bash
pnpm --filter @interview/thalamus typecheck
# Expected: 0 errors

grep -rn 'signal_power_dbw\|mission_class\|confidence_score\|launch_cost\b\|launch_epoch\|mv_mission_class_stats\|safe_mission_window' \
  packages/thalamus/src/cortices/sql-helpers.*.ts
# Expected: empty (no matches)
```

### Anti-pattern guard
- Don't "preserve backward compatibility" with fake columns — delete them outright.
- Don't create views to alias missing columns — simpler to rewrite the SELECT.

---

## Phase 3 — NEW SATELLITE helpers — ~45 min

One file per cortex domain, following the queryRssItems template. Each reads ONLY live tables.

### 3a. Create [sql-helpers.catalog.ts](packages/thalamus/src/cortices/sql-helpers.catalog.ts)

Export `queryCatalogIngest(db, opts: { source?: string; sinceEpoch?: string; limit?: number })`.

Logic: `SELECT s.*, op.name as operator, oc.name as operator_country, pc.name as platform_class, orr.name as orbit_regime FROM satellite s LEFT JOIN operator op ... WHERE created_at > $sinceEpoch LIMIT $limit ORDER BY created_at DESC`.

Return: `CatalogIngestRow[]` with `satelliteId, name, noradId (from telemetry_summary->>'noradId'), operator, operatorCountry, platformClass, orbitRegime, launchYear, ingestedAt`.

### 3b. Create [sql-helpers.operator-fleet.ts](packages/thalamus/src/cortices/sql-helpers.operator-fleet.ts)

Export `queryOperatorFleet(db, opts: { operatorId?: string|number; userId?: string|number; limit?: number })`.

Note: user-scoped cortex (fleet_analyst) — `userId` is passed but there is no user_fleet link table in live DB. Use `operatorId` if provided, otherwise group by operator and return top N.

Return: `OperatorFleetRow[]` with `operatorId, operatorName, country, satelliteCount, avgAgeYears, regimeMix (jsonb), platformMix (jsonb), busMix (jsonb)`.

### 3c. Create [sql-helpers.orbit-slot.ts](packages/thalamus/src/cortices/sql-helpers.orbit-slot.ts)

Export `queryOrbitSlotPlan(db, opts: { operatorId?: string|number; horizonYears?: number; limit?: number })`.

Logic: aggregate satellites by operator+regime, compute "slots used per regime". No real ITU filing data available — return the aggregation that lets the LLM reason about density.

Return: `OrbitSlotRow[]` with `regimeId, regimeName, operatorId, operatorName, satellitesInRegime, shareOfRegime (pct)`.

### 3d. Create [sql-helpers.replacement-cost.ts](packages/thalamus/src/cortices/sql-helpers.replacement-cost.ts)

Export `queryReplacementCost(db, opts: { satelliteId: string|number })`.

Logic: single satellite + joined bus + payloads + operator. Compute heuristic cost bands from `mass_kg`:
- `busCost = mass_kg * 50_000` (USD, rough)
- `payloadCost = sum(sp.mass_kg * 150_000)`
- `launchCost = mass_kg * 10_000` (cheap rideshare heuristic)
- Return `{ low, mid, high }` with +/- 30% spread.

Return: `ReplacementCostRow[]` (single-row array) with fields above + the source satellite context.

### Verification (Phase 3)
```bash
pnpm typecheck   # 0 errors

# Confirm all four helpers are exported through the barrel:
for h in queryCatalogIngest queryOperatorFleet queryOrbitSlotPlan queryReplacementCost; do
  node -e "import('./packages/thalamus/src/cortices/sql-helpers.js').then(m => console.log('$h:', typeof m.$h))"
done
# Expected: all "function"
```

(If the TS can't be required directly, use `tsx --eval`.)

### Anti-pattern guard
- Don't compute cost by reading a `launch_cost` column — it doesn't exist. Derive from mass.
- Don't JOIN on `satellite.orbit_regime_id` — regime lives on `operator_country`.
- Use `BigInt(opts.satelliteId)` for bigint casts.

---

## Phase 4 — NEW HYBRID helpers — ~45 min

Hybrid = satellite-table aggregates JOINED or UNIONED with source_item context. One file per cortex.

### 4a. Create [sql-helpers.launch-manifest.ts](packages/thalamus/src/cortices/sql-helpers.launch-manifest.ts)

Export `queryLaunchManifest(db, opts: { horizonDays?: number; regimeId?: string|number; limit?: number })`.

Logic: 
- Recent `launch` table rows (limited data)
- UNION ALL with `source_item` rows from source.category ILIKE '%launch%' or kind='rss' where title ILIKE '%launch|manifest|rideshare%'

Return: `LaunchManifestRow[]` with `{ kind: 'db'|'news', title, detail, year, vehicle, url }`.

### 4b. Create [sql-helpers.orbital-traffic.ts](packages/thalamus/src/cortices/sql-helpers.orbital-traffic.ts)

Export `queryOrbitalTraffic(db, opts: { windowDays?: number; regimeId?: string|number; limit?: number })`.

Logic:
- CTE `density` = `SELECT regime_id, count(*) FROM satellite JOIN operator_country ...`
- UNION news items ILIKE '%conjunction|traffic|congestion|close approach%'

Return: `OrbitalTrafficRow[]` with `{ kind: 'density'|'news', regimeName, satelliteCount?, title?, publishedAt?, url? }`.

### 4c. Create [sql-helpers.debris-forecast.ts](packages/thalamus/src/cortices/sql-helpers.debris-forecast.ts)

Export `queryDebrisForecast(db, opts: { regimeId?: string|number; horizonYears?: number; limit?: number })`.

Logic:
- Satellite count + age distribution per regime (proxy for debris production rate)
- UNION source_item ILIKE '%debris|fragmentation|kessler|breakup%', preferring kind='arxiv'/'ntrs'

Return: `DebrisForecastRow[]`.

### Verification (Phase 4)
Same grep + typecheck pattern. Additionally run one targeted cortex against live DB via a small script (optional) or just trust Phase 7 demo verification.

---

## Phase 5 — NEW SOURCE-only helpers — ~30 min

Pure `source_item` filtered queries. Template: copy queryRssItems and swap the WHERE filters.

### 5a. Create [sql-helpers.advisory-feed.ts](packages/thalamus/src/cortices/sql-helpers.advisory-feed.ts)

Export `queryAdvisoryFeed(db, opts: { sinceIso?: string; operatorId?: string|number; category?: string; limit?: number })`.

Filter: `source.kind IN ('rss','press','field')` AND `si.fetched_at > $sinceIso` AND `(s.category ILIKE '%advisor%' OR si.title ILIKE '%advisory|bulletin|NOTAM|alert%')`.

Return: `AdvisoryRow[]`.

### 5b. Create [sql-helpers.orbital-primer.ts](packages/thalamus/src/cortices/sql-helpers.orbital-primer.ts)

Export `queryOrbitalPrimer(db, opts: { topic?: string; stakeholderLevel?: string; limit?: number })`.

Filter: prefer `source.kind IN ('arxiv','ntrs')` (explanatory papers), fall back to RSS. Filter `title ILIKE '%${topic}%' OR abstract ILIKE '%${topic}%'`. Also JOIN recent `research_finding` where cortex='orbital_analyst' for anchor examples (LIMIT 3).

Return: `OrbitalPrimerRow[]` with `{ kind: 'paper'|'news'|'finding', title, abstract, authors?, url, publishedAt }`.

---

## Phase 6 — NEW STUB helpers (fallback to source_item) — ~30 min

For cortices whose proper tables (conjunction_event, maneuver, observation_track, tle_history) don't exist, the helper **MUST STILL EXIST AND RETURN DATA** — otherwise the cortex finds nothing. Strategy: keyword filter on source_item (news + papers) that matches the cortex topic, + a couple of candidate satellite rows for context.

Create one file per cortex:

### 6a. [sql-helpers.conjunction.ts](packages/thalamus/src/cortices/sql-helpers.conjunction.ts)
Export `queryConjunctionScreen(db, opts: { windowHours?: number; primaryNoradId?: string|number; limit?: number })`.
- Filter source_item ILIKE '%conjunction|close approach|CDM|cdm|probability of collision%'
- + return 5 satellite rows matching primaryNoradId (if given) as "candidates"
- Shape: `{ kind: 'news'|'candidate', title, summary, satelliteRef? }[]`

### 6b. [sql-helpers.correlation.ts](packages/thalamus/src/cortices/sql-helpers.correlation.ts)
Export `queryCorrelationMerge(db, opts: { conjunctionEventId?: string|number; limit?: number })`.
- UNION kind='field' items + kind='rss' items
- LIMIT 10 each, mark `streamKind`.

### 6c. [sql-helpers.maneuver.ts](packages/thalamus/src/cortices/sql-helpers.maneuver.ts)
Export `queryManeuverPlan(db, opts: { conjunctionEventId?: string|number; maxDeltaVmps?: number; limit?: number })`.
- Filter source_item ILIKE '%maneuver|burn|delta-v|station-keeping|avoidance%'
- LIMIT N.

### 6d. [sql-helpers.observations.ts](packages/thalamus/src/cortices/sql-helpers.observations.ts)
Export `queryObservationIngest(db, opts: { stationId?: string; windowMinutes?: number; limit?: number })`.
- Filter source WHERE kind IN ('radar','field')
- If none exist (likely — we seeded 0 radar/field sources), fall back to kind='rss' ILIKE '%tracking|observation|radar|telescope%'.

### 6e. [sql-helpers.apogee.ts](packages/thalamus/src/cortices/sql-helpers.apogee.ts)
Export `queryApogeeHistory(db, opts: { noradId?: string|number; windowDays?: number; limit?: number })`.
- Filter source_item ILIKE '%TLE|apogee|perigee|decay|orbit raise%'
- + satellite rows matching noradId via `telemetry_summary->>'noradId'`.

### Anti-pattern guard (Phase 6)
- Don't return `[]` from a stub — that's the current failure mode. ALWAYS return at least the keyword-filtered source items (even if 0 match, the executor treats empty as "no data"; returning a single placeholder row may force the web fallback, which we don't want — so if the source_item filter returns 0, return a single synthetic `{ kind: 'empty', hint: 'no recent news on topic' }` row to give the LLM SOMETHING).

Actually — rethink: the executor already triggers web fallback when sqlData.length === 0, so stub helpers SHOULD return the keyword-matched items and accept that if there's nothing in source_item, the cortex will still produce no findings. That's acceptable for the initial ship — at least the OTHER cortices will work.

---

## Phase 7 — Wire barrel, typecheck, re-run demo — ~15 min

### 7a. Update [packages/thalamus/src/cortices/sql-helpers.ts](packages/thalamus/src/cortices/sql-helpers.ts) barrel

Add exports for every new file:
```ts
export * from "./sql-helpers.catalog";
export * from "./sql-helpers.operator-fleet";
export * from "./sql-helpers.orbit-slot";
export * from "./sql-helpers.replacement-cost";
export * from "./sql-helpers.launch-manifest";
export * from "./sql-helpers.orbital-traffic";
export * from "./sql-helpers.debris-forecast";
export * from "./sql-helpers.advisory-feed";
export * from "./sql-helpers.orbital-primer";
export * from "./sql-helpers.conjunction";
export * from "./sql-helpers.correlation";
export * from "./sql-helpers.maneuver";
export * from "./sql-helpers.observations";
export * from "./sql-helpers.apogee";
```

### 7b. Verify all 18 declared names are resolvable

```bash
node --env-file=./.env --import tsx -e '
  const helpers = await import("./packages/thalamus/src/cortices/sql-helpers.ts");
  const declared = [
    "queryAdvisoryFeed","queryApogeeHistory","queryCatalogIngest",
    "queryClassificationAudit","queryConjunctionScreen","queryCorrelationMerge",
    "queryDataAudit","queryDebrisForecast","queryOperatorFleet",
    "queryLaunchManifest","queryManeuverPlan","queryObservationIngest",
    "queryOrbitalPrimer","queryOrbitalTraffic","queryOrbitSlotPlan",
    "queryPayloadProfile","queryRegimeProfile","queryReplacementCost",
  ];
  for (const name of declared) {
    const ok = typeof helpers[name] === "function";
    console.log((ok?"✓":"✗"), name);
  }
'
```
Expected: 18 ✓, 0 ✗.

### 7c. `pnpm typecheck` → 0 errors all 4 packages.

### 7d. Run demo end-to-end:

```bash
THALAMUS_MODE=record make thalamus-cycle
```

Expected output:
- Planner emits DAG plan
- Each selected cortex logs "Running SQL helper" with non-zero `sqlRows`
- `Cycle Summary` shows `findings: N` with N >= 1
- `make psql -c 'SELECT count(*) FROM research_finding'` returns N > 0
- `make psql -c 'SELECT count(*) FROM research_edge'` returns M > 0
- Fixtures recorded under `fixtures/recorded/*.json`

### 7e. Run sweep demo:

```bash
make sweep-run
```

Expected: nano-sweep scans 50 satellites, produces suggestions in Redis, resolves one, writes sweep_audit row.

### 7f. Final anti-pattern sweep (all should return 0 matches)

```bash
grep -rn 'signal_power_dbw\|mission_class\|confidence_score\|launch_cost\b\|telemetry_14d\|launch_epoch\|mv_mission_class_stats\|safe_mission_window\|conjunction_event\b\|maneuver\b\|fleet\.\|watchlist' \
  packages/thalamus/src/cortices/sql-helpers.*.ts
```

---

## Execution sequencing notes

- Phases 1-2 are independent, can run sequentially or in parallel.
- Phases 3-6 are independent (one file per helper), can run in parallel by a subagent.
- Phase 7 must run LAST after 1-6 are all complete.
- Each phase ends with `pnpm typecheck` → 0 errors. Never advance with red.
- Never mock data or return synthetic rows to "make findings happen". If a helper genuinely can't find data, let it return `[]` — the strategist will still synthesize from OTHER cortices that succeeded.

## Exit criteria for plan complete

1. All 18 skill-declared helper names are exported as functions from `sql-helpers.ts` barrel.
2. `pnpm typecheck` → 0 errors.
3. `THALAMUS_MODE=record make thalamus-cycle` persists **≥ 3 findings** to `research_finding` table.
4. Grep for anti-pattern strings returns 0 matches in `sql-helpers.*.ts`.
5. `research_finding` and `research_edge` tables both have non-zero counts after demo run.
