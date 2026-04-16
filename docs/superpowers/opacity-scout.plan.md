# OpacityScout — implementation plan

> **Status 2026-04-15**: Chunks C1 → C7 shipped. 305 unit + 1 live-Postgres integration test green. See "Landed artefacts" section at end.

**Goal:** surface satellites and launches with a public-information deficit (operators that don't publish, payloads marked "undisclosed", TLEs that appear then disappear, catalog gaps vs. launch manifests) by fusing the official catalog with amateur OSINT tracker feeds. Output lives in the research KG as findings tagged `cortex=OpacityScout`, `severity = opacity score`, never with the word "classified" in the UI.

**Business framing for the interview:** we add a _data-fusion_ cortex that fills the blind spots of the official catalog using legal, published amateur-tracking sources. Same architecture pattern as existing cortices — no new infra. What LeoLabs / Slingshot / COMSPOC do commercially, we do as an SSA reviewer feature.

**Legitimacy:**

- 100% public sources (mailing list archives, personal blogs, RSS, HTML scrapes)
- no operational intel produced (we surface _data deficits_, not orbital positions for targeting)
- source_class `OSINT_AMATEUR` is labeled explicitly in the KG, reviewer decides trust level

---

## Phase 0 — prep & guardrails (before touching code)

Land these from [docs/refactor/INDEX.md](../refactor/INDEX.md) first — the Scout lives downstream of them:

- [ ] Break the `llm-chat` ⇄ `fixture-transport` cycle (Scout will use `createLlmTransport`)
- [ ] Rename `cortices/sql-helpers.*` → `cortices/queries/*` (Scout's query file lands in the new directory)
- [ ] Create `packages/thalamus/src/prompts/` (Scout's prompt lands here)
- [ ] Add `safeFetch` (SSRF allowlist) — **already a HIGH finding in [codex-security.md](../refactor/codex-security.md)**; the new fetchers MUST consume it

**Why gated:** shipping OpacityScout on top of the current `fetch(source.url)` without allowlist would add three new SSRF entry points.

---

## Phase 1 — data model (Drizzle + migrations)

### 1.1 Extend `source` vocabulary

Add to [packages/db-schema/src/enums/research.enum.ts](../../packages/db-schema/src/enums/research.enum.ts):

```ts
enum SourceClass {
  // existing: OFFICIAL, COMMERCIAL, ACADEMIC, MEDIA, COMMUNITY …
  OSINT_AMATEUR = "OSINT_AMATEUR", // SeeSat-L, Langbroek, Molczan, Bassa, Tilley
}
```

Projected to `pgEnum` in the db-schema enum barrel. Migration via `drizzle-kit generate`.

### 1.2 New table `amateur_track`

Colocated with [schema/satellite.ts](../../packages/db-schema/src/schema/satellite.ts) (new sibling `amateur-track.ts` exported from the schema barrel):

```ts
// packages/db-schema/src/schema/amateur-track.ts
export const amateurTrack = pgTable("amateur_track", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: integer("source_id")
    .references(() => source.id)
    .notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  // matching key against official catalog
  candidateNoradId: integer("candidate_norad_id"), // nullable — unidentified
  candidateCospar: text("candidate_cospar"), // nullable
  // proposed elements (optional — some trackers give full TLE, others just "seen at")
  tleLine1: text("tle_line_1"),
  tleLine2: text("tle_line_2"),
  orbitRegime: orbitRegimeEnum("orbit_regime"),
  // provenance
  observerHandle: text("observer_handle"), // e.g. "Molczan", "Langbroek"
  citationUrl: text("citation_url").notNull(),
  rawExcerpt: text("raw_excerpt"), // preserved for reviewer
  // fusion outcome (written by the OpacityScout cortex, not the fetcher)
  resolvedSatelliteId: bigint("resolved_satellite_id", {
    mode: "number",
  }).references(() => satellite.id), // null if unmatched
  matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
});
```

Indexes on `(candidateNoradId)`, `(candidateCospar)`, `(resolvedSatelliteId)`, `(observedAt desc)`.

### 1.3 Extend `satellite` with opacity fields (non-destructive)

Two nullable columns on [schema/satellite.ts](../../packages/db-schema/src/schema/satellite.ts):

```ts
opacityScore: numeric("opacity_score", { precision: 4, scale: 3 }),  // [0..1], last computed by Scout
opacityComputedAt: timestamp("opacity_computed_at", { withTimezone: true }),
```

Migration note: **fix the broken baseline migration flagged in [codex-dx-correctness.md](../refactor/codex-dx-correctness.md) CRIT#2 BEFORE adding this** — otherwise the new migration stacks on top of a dirty baseline.

---

## Phase 2 — source fetchers (`cortices/sources/`)

Follow the existing fetcher convention: pure function, input `Source` row, output `NewSourceItem[]`, caller handles upsert on `(source_id, external_id)`. Reuse [fetcher-rss.ts](../../packages/thalamus/src/cortices/sources/fetcher-rss.ts) as template where applicable.

### 2.1 `fetcher-seesat.ts` — SeeSat-L mailing list archive

- URL: `https://satobs.org/seesat/` (monthly archive pages)
- Shape: HTML index → per-message HTML pages; messages carry TLEs in plain text and positional observations in a regex-tractable line format (`COSPAR NNNN-NNN  AAA yyyy mm dd.dddddd ...`).
- Extraction: reuse the `parseXmlEntry` helper proposed in [thalamus-organization.md §4](../refactor/thalamus-organization.md#4) once landed — otherwise inline regex for the TLE triplet and the `observer:` / `site:` fields.
- Output: `NewSourceItem` per observation, `external_id = sha256(msg-id + line-offset)`.

### 2.2 `fetcher-planet4589.ts` — Jonathan's Space Report

- URLs: `https://planet4589.org/space/gcat/tsv/` (GCAT payload catalog, already ingested via `enrich-gcat`) + `https://planet4589.org/space/log/` (narrative launch log, richer than the machine catalog).
- Extraction: TSV rows → structured; narrative log → regex on launch date + `Remarks:` blocks that flag "undisclosed" / "payload classified" / "operator: NRO".
- This one is **not really "amateur"** — McDowell is the gold standard. Tag as `OFFICIAL` in source_class, not `OSINT_AMATEUR`. Clearer separation.

### 2.3 `fetcher-sattrackcam.ts` — Marco Langbroek blog + RSS

- URL: `https://sattrackcam.blogspot.com/feeds/posts/default?alt=rss` (standard Atom — reuse [fetcher-rss.ts](../../packages/thalamus/src/cortices/sources/fetcher-rss.ts) directly with a source row, no new fetcher needed).
- No code change, just a `source` seed row. Free.

### 2.4 `fetcher-spacetrack-diff.ts` — Space-Track catalog diff

- Query Space-Track (requires auth — env vars via the validated config proposed in [codex-type-safety.md](../refactor/codex-type-safety.md)) for the full SATCAT snapshot, diff against the previous snapshot, emit an observation per "vanished" NORAD id.
- This is the gold signal: NORAD ids that _had_ TLEs and _no longer do_ are the strongest opacity indicator.
- Persist snapshots in a new `satcat_snapshot` table or Redis keyed by date.

### 2.5 Seed source rows

Add to [packages/db-schema/src/seed/sources.ts](../../packages/db-schema/src/seed/sources.ts) with the relevant `source_class`, `fetch_interval`, and `citation_required=true`.

---

## Phase 3 — cortex `OpacityScout`

### 3.1 Skill registration

Add to the cortex skill registry (markdown-frontmatter convention per [registry.ts](../../packages/thalamus/src/cortices/registry.ts)):

```
packages/thalamus/src/cortices/skills/opacity-scout.md
```

Header: `name: OpacityScout`, `query_complexity: moderate`, `sources: [amateur_track, satellite, launch, space_catalog_snapshot]`, `output_type: finding`.

### 3.2 Queries file

New `packages/thalamus/src/cortices/queries/opacity-scout.ts` (post-rename per refactor plan) exporting:

- `listOpaqueSatellites(db, { minScore = 0.5, limit = 50 })` — join `satellite` + `operator` + `operator_country` + `payload`, left-join `amateur_track` (via resolved id), SELECT with computed signals:
  - `has_amateur_observations` boolean
  - `payload_undisclosed` boolean (payload.description ilike '%undisclosed%' OR payload.name is null)
  - `operator_country_sensitive` boolean (country in {USA-USSF, USA-NRO, RUS-VKS, CHN-SSF, …})
  - `catalog_dropout_count` int (from Space-Track snapshot diffs)
  - `manifest_vs_catalog_gap` int (launches where declared payloads > catalog-visible payloads)
- `resolveAmateurToCatalog(db, amateurTrackId)` — matching function used by the cortex when ingesting (nearest NORAD by epoch + inclination + mean-motion within tolerance).

### 3.3 Prompt

`packages/thalamus/src/prompts/opacity-scout.prompt.ts`:

```ts
export const OPACITY_SCOUT_SYSTEM_PROMPT = `
You are OpacityScout, an SSA analyst that identifies information-deficit
patterns in the public satellite catalog. You receive rows combining the
official catalog with amateur-tracker observations.

Rules:
- NEVER output the word "classified", "secret", "restricted", or any
  synonym. You describe INFORMATION DEFICIT — what is missing.
- Ground every finding in at least one citation URL (citation_required).
- Severity scale:
    0.9-1.0  4+ deficit signals AND amateur corroboration present
    0.7-0.9  3 deficit signals OR amateur tracker disagrees with official catalog
    0.5-0.7  2 deficit signals
    <0.5     single signal — do not emit finding
- Source class is OSINT_AMATEUR when the primary evidence is a tracker
  observation; OFFICIAL when it's catalog drift from Space-Track.
`;
```

Hoisted per the prompts convention from refactor plan.

### 3.4 Executor path

No new path — the cortex is dispatched through [cortices/executor.ts](../../packages/thalamus/src/cortices/executor.ts) like any other, with:

- `preSummarize` branch for OpacityScout (per [thalamus-organization.md §1](../refactor/thalamus-organization.md#1) this becomes `cortices/pre-summarizers/opacity-scout.ts` after the executor split) that formats the signal bundle for the LLM.
- `webSearchFallback` prompt entry in the map — if the cortex cannot ground a finding in amateur_track alone, it can fall back to a web search on the NORAD id.

### 3.5 Confidence band

Findings emit with `source_class = OSINT_AMATEUR` initially, promotable to `OSINT_CORROBORATED` when ≥2 independent amateur sources agree (same mechanism as telemetry inference — per [sim-confidence-promotion.ts](../../packages/sweep/src/sim/config/container.ts) hook pattern).

---

## Phase 4 — UI surface (apps/console)

Two touchpoints in the **ops** mode (satellite-centric):

### 4.1 Opacity overlay on the globe

- In [SatelliteField.tsx](../../apps/console/src/modes/ops/SatelliteField.tsx), tint satellites by `opacity_score`: `≥0.7` → amber halo, `≥0.9` → pulsing. Uses the existing instanced-mesh color channel, zero new geometry.
- Legend entry in the already-expanded ops legend panel.

### 4.2 Opacity drawer panel

- In [OpsDrawer.tsx](../../apps/console/src/modes/ops/OpsDrawer.tsx) — when the selected satellite has `opacity_score > 0`, add an "Information deficit" section listing the contributing signals (`payload_undisclosed`, `catalog_dropout`, etc.) with citation links to the amateur tracker observations.

### 4.3 Thalamus KG

- New node type `AmateurObservation` in the KG. Edge type `CORROBORATES` between `AmateurObservation` and `Satellite`.
- Class-sector layout (per [ThalamusMode.tsx](../../apps/console/src/modes/thalamus/ThalamusMode.tsx) `layoutByClass`) gets a new sector for `AmateurObservation` clusters.

---

## Phase 5 — tests

TDD, in this order:

1. `packages/thalamus/tests/fetcher-seesat.spec.ts` — given fixture HTML archive, expect N `NewSourceItem`.
2. `packages/thalamus/tests/fetcher-spacetrack-diff.spec.ts` — given two SATCAT snapshots, expect the right `vanished` set.
3. `packages/thalamus/tests/opacity-scout-resolver.spec.ts` — given amateur observation + candidate catalog rows, expect correct match or no-match.
4. `packages/thalamus/tests/integration/opacity-scout-cortex.spec.ts` — pg-mem seeded with satellite + launch + amateur_track, run the cortex end-to-end, assert ≥1 finding with correct severity and citation.
5. `packages/thalamus/tests/e2e/opacity-scout.e2e.spec.ts` — full pipeline: fetcher → ingest → cortex → finding in KG → console drawer renders it. Use the fixture LLM transport (THALAMUS_MODE=fixtures) so no real Kimi call.

---

## Phase 6 — demo script (interview)

One-liner demo flow to pitch:

1. Show the satellite field with 3 amber halos. Click one — drawer shows "Information deficit: payload undisclosed, catalog dropout 2026-03-12, 2 amateur observations on SeeSat-L (Molczan, Langbroek)."
2. Jump to Thalamus mode — show the `AmateurObservation` sector in the KG, edges tying observations back to the satellite.
3. Show the finding in Sweep's reviewer inbox — reviewer can accept → promotes to `OSINT_CORROBORATED`, satellite gets an enrichment with the reconstructed TLE.

Talk track: _"We fuse the official catalog with the amateur-tracking community (SeeSat-L, Langbroek, Molczan, Bassa, Tilley, McDowell) to surface information-deficit patterns. Zero restricted data — only public feeds. The same cortex pattern as the other 22 skills; OpacityScout becomes the 23rd."_

---

## Chunking (~25k tokens per task per CLAUDE.md rule)

| Chunk | Scope                                                                                                                    | Est. tokens |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| C1    | Phase 0 prereqs (cycle break + sql-helpers rename + prompts dir + safeFetch)                                             | ~20k        |
| C2    | Phase 1 schema (`amateur_track`, `SourceClass.OSINT_AMATEUR`, opacity columns, migration) — AFTER fixing broken baseline | ~15k        |
| C3    | Phase 2.1 + 2.3 (seesat fetcher + sattrackcam as source row) + tests                                                     | ~25k        |
| C4    | Phase 2.2 + 2.4 (planet4589 + spacetrack-diff) + tests                                                                   | ~25k        |
| C5    | Phase 3 cortex (queries + prompt + skill + preSummarize branch) + unit tests                                             | ~25k        |
| C6    | Phase 3 integration test (pg-mem end-to-end)                                                                             | ~15k        |
| C7    | Phase 4 UI (opacity overlay + drawer section + KG node type)                                                             | ~20k        |
| C8    | Phase 5 e2e + Phase 6 demo fixtures                                                                                      | ~15k        |

Total budget: ~160k tokens across 8 chunks, sequential. Every chunk ends with `pnpm test` green.

---

## Non-goals (explicit)

- No operational intel — no "next pass time" calculators, no targeting windows, no reverse-engineered manoeuvre logs.
- No Space-Track scraping beyond the official API (rate-limit respecting).
- No ingest of any source with a `robots.txt` disallow on `/feeds` or `/archive`.
- No UI label containing "classified" / "secret" / "restricted" — enforced by a lint rule (regex on `apps/console/src/**/*.tsx` in CI).

---

## Risks

| Risk                                                     | Mitigation                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space-Track ToS violation if diff cadence too aggressive | Respect their 30-req/min cap, cache snapshots for 24h                                                                                                                |
| Amateur observer consent                                 | Already public archives; cite every observation with URL + handle                                                                                                    |
| SSRF via amateur blog URLs                               | safeFetch + allowlist (the 5 domains listed above)                                                                                                                   |
| Finding mislabeled → reviewer embarrassment              | Confidence band forces OSINT_AMATEUR until corroborated; UI says "information deficit" not "classified"; human reviewer in the loop via existing sweep approval flow |
| Broken migration baseline blocks the new migration       | Fix baseline FIRST (codex-dx-correctness.md CRIT#2)                                                                                                                  |

---

## Landed artefacts (2026-04-15)

### Phase 0 — prereqs

- **C1a** Cycle break [`llm-chat`](../../packages/thalamus/src/transports/llm-chat.ts) ⇄ [`fixture-transport`](../../packages/thalamus/src/transports/fixture-transport.ts) via new [`transports/types.ts`](../../packages/thalamus/src/transports/types.ts) + [`transports/factory.ts`](../../packages/thalamus/src/transports/factory.ts). Dep-cruiser: 0 cycles.
- **C1b** Renamed `cortices/sql-helpers.*.ts` → [`cortices/queries/*.ts`](../../packages/thalamus/src/cortices/queries) (24 files). Deleted 2 orphans ([`sweep/utils/satellite-entity-patterns.ts`](../../packages/sweep/src/utils), [`thalamus/utils/sql-helpers.ts`](../../packages/thalamus/src/utils)).
- **C1c** Created [`packages/thalamus/src/prompts/`](../../packages/thalamus/src/prompts) with [`planner.prompt.ts`](../../packages/thalamus/src/prompts/planner.prompt.ts) as exemplar + barrel.
- **C1d** Promoted safeFetch to [`@interview/shared/net/safe-fetch.ts`](../../packages/shared/src/net/safe-fetch.ts) with default 10s timeout; shim at `thalamus/utils/ssrf-guard.ts` for back-compat.

### Phase 1 — schema

- **C2** [`schema/amateur-track.ts`](../../packages/db-schema/src/schema/amateur-track.ts) + `satellite.opacity_score` + `satellite.opacity_computed_at` columns. `drizzle-kit push` applied to live DB. `ResearchCortex.OpacityScout = "opacity_scout"` added; `ALTER TYPE cortex ADD VALUE` executed on live pgEnum.

### Phase 2 — fetchers

- **C3** [`fetcher-seesat.ts`](../../packages/thalamus/src/cortices/sources/fetcher-seesat.ts) — pure `extractTleTriplets` + `parseSeesatMessage` + `fetchSeesatArchive` via safeFetch. [7 unit tests](../../packages/thalamus/tests/fetcher-seesat.spec.ts). Source seed rows: `sattrackcam` (RSS), `seesat-archive-current` (osint).
- **C4** [`spacetrack-diff.ts`](../../packages/thalamus/src/cortices/sources/spacetrack-diff.ts) — Redis-backed `writeSnapshot` / `diffSnapshots` / `buildVanishedTracks` (SADD chunked at 5k, 7d TTL, SDIFF for vanished NORAD ids). [7 unit tests via ioredis-mock](../../packages/thalamus/tests/spacetrack-diff.spec.ts). Source seed: `spacetrack-satcat-diff`.

### Phase 3 — cortex

- **C5** [`cortices/queries/opacity-scout.ts`](../../packages/thalamus/src/cortices/queries/opacity-scout.ts) — `listOpacityCandidates` (CTE fusion catalog + amateur_track + payload), `writeOpacityScore`, `computeOpacityScore` pure scorer. [`prompts/opacity-scout.prompt.ts`](../../packages/thalamus/src/prompts/opacity-scout.prompt.ts) — system prompt with strict linguistic rules. [`cortices/skills/opacity-scout.md`](../../packages/thalamus/src/cortices/skills/opacity-scout.md) — skill registry entry. [6 scorer tests](../../packages/thalamus/tests/opacity-scout.spec.ts).
- **C6** [`tests/integration/opacity-scout.int.spec.ts`](../../packages/thalamus/tests/integration/opacity-scout.int.spec.ts) — live Postgres end-to-end: seed operator_country "USSF" + undisclosed payload + amateur_track, assert `listOpacityCandidates` surfaces the row with all 3 signals, write score back, verify `satellite.opacity_score` populated, rollback transaction.

### Phase 4 — UI

- **C7** [`apps/console/src/lib/api.ts`](../../apps/console/src/lib/api.ts) + [`apps/console-api/src/fixtures.ts`](../../apps/console-api/src/fixtures.ts) — SatelliteDTO extended with `opacityScore` + `opacityDeficitReasons`; fixtures generate ~12% sats with opacity signals citing SeeSat-L / Langbroek / catalog dropouts.
- [`OpsDrawer.tsx`](../../apps/console/src/modes/ops/OpsDrawer.tsx) — new "INFORMATION DEFICIT" section with coloured score + amber-bulleted reasons + "source class: OSINT_AMATEUR" footer.
- [`SatelliteField.tsx`](../../apps/console/src/modes/ops/SatelliteField.tsx) — amber chassis+halo for sats with `opacityScore >= 0.7` (hot amber ≥0.9, soft amber ≥0.7).

### Deferred

- **C7 remainder**: KG node type `AmateurObservation` + `CORROBORATES` edges in [`ThalamusMode.tsx`](../../apps/console/src/modes/thalamus/ThalamusMode.tsx). Fixtures.ts KG generator would need a new node kind — straightforward extension.
- **C8 e2e**: Playwright flow (globe → amber halo → click → drawer shows deficit → find in Thalamus graph → accept in Sweep inbox) — fixtures are already plumbed end-to-end, just needs the script.
- **Wider rollout**: Migrate existing `fetch()` call-sites (crawler, nano-caller, voyage-embedder, llm-chat) to safeFetch — tracked under [codex-security.md HIGH findings](../refactor/codex-security.md).

### Verification

```
pnpm test:unit         # 305 passed (+19 new: seesat 7 + spacetrack-diff 7 + opacity-scout 6)
pnpm test:integration  # 1 passed (opacity-scout.int.spec.ts — live Postgres)
pnpm -r typecheck      # clean across 7 workspaces
```
