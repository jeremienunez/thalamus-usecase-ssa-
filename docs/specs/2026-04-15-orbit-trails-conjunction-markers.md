# Orbit Trails & Conjunction Markers — Design Spec

**Date:** 2026-04-15
**Scope:** Frontend (apps/console) + small API extension (apps/console-api)
**Goal:** Visualize realistic orbital trails on the 3D globe and mark every possible collision as a cross (✕) with rich SSA info on demand.

---

## 1. Architecture

Two new components under [apps/console/src/modes/ops/](../../apps/console/src/modes/ops/):

- **`OrbitTrails.tsx`** — hybrid trail renderer: full orbit rings for the selected regime, fading tails for the rest.
- **`ConjunctionMarkers.tsx`** — ✕ markers at TCA points + full-SSA info card on hover/select. Augments existing [ConjunctionArcs.tsx](../../apps/console/src/modes/ops/ConjunctionArcs.tsx).

Shared Keplerian propagator extracted to [apps/console/src/lib/orbit.ts](../../apps/console/src/lib/orbit.ts) (currently duplicated inside [SatelliteField.tsx](../../apps/console/src/modes/ops/SatelliteField.tsx)).

Both mount inside [Globe.tsx](../../apps/console/src/modes/ops/Globe.tsx) alongside the existing `SatelliteField` and `ConjunctionArcs`.

---

## 2. OrbitTrails

### 2.1 Full orbit rings (selected regime)

- Sample each orbit at **128 points** across one full period using Keplerian elements (a, e, i, Ω, ω) from the satellite row.
- Geometry is static per TLE — cache keyed on `satellite.id + tle_epoch`.
- Render as one merged `BufferGeometry` per regime (4 draw calls total: LEO / MEO / GEO / HEO), `THREE.LineSegments` with `LineBasicMaterial`, `blending: AdditiveBlending`, `opacity: 0.35`.
- Color per regime: LEO cyan `#8ecae6`, MEO teal `#2a9d8f`, GEO amber `#e9c46a`, HEO magenta `#c77dff`.

### 2.2 Fading tails (non-selected regimes)

- Ring buffer of last 60 positions per satellite (~30 min at current tick cadence).
- Vertex-colored line with alpha ramp head→tail, opacity baseline 0.15.
- Updated each frame from the same position stream `SatelliteField` already computes — zero extra propagation cost.

### 2.3 Mode toggle

[RegimeFilter.tsx](../../apps/console/src/modes/ops/RegimeFilter.tsx) gains a tri-state:
`Trails: off | tails | full`. Default = `tails`.

### 2.4 Performance budget

- Rings: ~1215 sats × 128 verts = ~156k verts, batched → 4 draw calls.
- Tails: ~1215 × 60 verts = ~73k verts, 1 draw call with vertex colors.
- Target: 60fps on integrated GPU.

---

## 3. ConjunctionMarkers

### 3.1 Rendering

- One `THREE.Sprite` per conjunction at TCA position (ECI → world).
- 16px ✕ texture, color by Pc severity:
  - `pc < 1e-6` → green `#2ecc71`
  - `1e-6 ≤ pc < 1e-4` → yellow `#f1c40f`
  - `pc ≥ 1e-4` → red `#e74c3c`
- **Hidden by default** (opacity 0). Revealed only when the corresponding conjunction arc is hovered OR the conjunction is selected from [FindingsPanel.tsx](../../apps/console/src/modes/ops/FindingsPanel.tsx).

### 3.2 Hover interaction

- Raycast against the existing arc lines in [ConjunctionArcs.tsx](../../apps/console/src/modes/ops/ConjunctionArcs.tsx).
- On hit → reveal ✕ + info card for that conjunction.
- Dismiss on `mouseleave + 500ms` grace window (so the user can move onto the card).

### 3.3 Info card (full SSA)

Floating HTML panel (React portal, anchored to screen-projected TCA point). Styled to match existing Drawer cards.

Fields:

| Field                    | Source                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| `satA.name / satB.name`  | satellite join                                                                   |
| `miss_km`                | `minRangeKm`                                                                     |
| `tca_utc`                | `epoch`                                                                          |
| `pc`                     | `probabilityOfCollision`                                                         |
| `relative_velocity_km_s` | `relativeVelocityKmps`                                                           |
| `regime`                 | satellite join                                                                   |
| `covariance_quality`     | derived: `combinedSigmaKm < 0.1` → HIGH, `< 1` → MED, else LOW                   |
| `screening_source`       | `pcMethod`                                                                       |
| `last_update`            | `computedAt`                                                                     |
| `action`                 | derived: `pc ≥ 1e-4` → maneuver_candidate, `pc ≥ 1e-6` → monitor, else no_action |

---

## 4. Data flow

### 4.1 API change

[apps/console-api/src/server.ts](../../apps/console-api/src/server.ts) — extend `GET /api/conjunctions`:

- Join `satellite` twice (primary + secondary) for names and regime.
- Return all fields from [conjunction_event](../../packages/db-schema/src/schema/conjunction.ts) plus `primary.name`, `secondary.name`, `regime`.
- Compute `covariance_quality` and `action` server-side (deterministic derivations, not mocks).

### 4.2 Frontend shape

Zod schema added to [packages/shared](../../packages/shared/src/) for `ConjunctionView`, consumed by `ConjunctionMarkers` and `FindingsPanel`.

---

## 5. Error handling

- Missing TLE for a satellite in a conjunction → skip that marker, log once per session.
- Orbit ring computation failure (degenerate elements) → omit that ring, do not block render.
- API endpoint failure → existing `FindingsPanel` error state applies; trails unaffected.

---

## 6. Testing

- **API:** smoke test on `/api/conjunctions` — shape assertion + one real row with all derived fields present.
- **Trails geometry:** snapshot test on ring vertex count per regime (`128 × N_sats_in_regime`).
- **Propagator:** unit test `lib/orbit.ts` — ring closure (first point ≈ last point), period correctness for a known LEO.
- **Three.js rendering:** no unit tests; visual verification via `pnpm dev` + browser.

---

## 7. Out of scope

- TLE refresh pipeline (already handled by [update-tle.ts](../../packages/db-schema/src/seed/update-tle.ts)).
- Conjunction generation (handled by [seedConjunctions](../../packages/db-schema/src/seed/conjunctions.ts)).
- Mobile / small-viewport layout.
- Historical playback of past conjunctions.

---

## 8. Implementation plan

Four phases, each independently demo-able.

### Phase 1 — Shared propagator (30 min)

- Extract `satellitePosition` + Kepler solver from [SatelliteField.tsx](../../apps/console/src/modes/ops/SatelliteField.tsx) into [apps/console/src/lib/orbit.ts](../../apps/console/src/lib/orbit.ts).
- Add `orbitRing(s, n=128): Float32Array` returning `n` sampled ECI positions over one period.
- Unit test: ring closure (‖p₀ − p\_{n-1}‖ < 1e-3 units) + period correctness for a known LEO (~90 min).
- Refactor `SatelliteField` to consume the new module. No visual change.

### Phase 2 — OrbitTrails component (45 min)

- New `apps/console/src/modes/ops/OrbitTrails.tsx`:
  - `useMemo` over `(satellites, selectedRegime, mode)` → 4 merged `BufferGeometry` per regime.
  - Tails path: 60-frame ring buffer keyed by satellite id, updated via `useFrame`.
- Wire into [Globe.tsx](../../apps/console/src/modes/ops/Globe.tsx) between `SatelliteField` and `ConjunctionArcs`.
- Extend `RegimeFilter` with tri-state `Trails: off | tails | full`.
- Store trail mode in the existing Zustand/Jotai store (wherever regime filter lives today).

### Phase 3 — Backend `/api/conjunctions` extension (20 min)

- Modify `GET /api/conjunctions` to join `satellite sp` + `satellite ss` on primary/secondary ids.
- Compute `covariance_quality` + `action` derivations inline.
- Add `ConjunctionViewSchema` to [packages/shared/src/](../../packages/shared/src/) for cross-layer type safety.
- Smoke test: curl the endpoint, assert one row has all 10 fields populated.

### Phase 4 — ConjunctionMarkers + info card (60 min)

- New `apps/console/src/modes/ops/ConjunctionMarkers.tsx`:
  - One `THREE.Sprite` instance per conjunction; position cached per TCA (recomputed on epoch change).
  - Opacity = 0 by default; bumped to 1 when `hoveredId === this.id` or `selectedId === this.id`.
- Hover wiring on `ConjunctionArcs` line objects (raycaster setup extension).
- Info card as `<Html>` from `@react-three/drei` (or a React portal) anchored to the projected TCA point with a 500 ms `mouseleave` grace.
- Color ramp + action derivation mirror the server-side classification to avoid divergence.

Total: **2h35 min** end-to-end.

---

## 9. Acceptance criteria

Each must be independently verifiable by the reviewer at the interview demo.

1. **AC-1** — With `Trails: full` and LEO selected, every LEO satellite draws a closed orbit ring in LEO cyan. No rings for MEO / GEO / HEO.
2. **AC-2** — With `Trails: tails`, every satellite has a fading tail that updates in real time. Tails vanish cleanly when regime is filtered out.
3. **AC-3** — FPS ≥ 55 on integrated Intel GPU at `Trails: full` with 1215 sats in the LEO regime.
4. **AC-4** — Hovering a conjunction arc reveals a ✕ marker at TCA and an info card. The card shows all 10 fields from §3.3 populated from the DB row, no placeholders.
5. **AC-5** — `pc ≥ 1e-4` conjunctions render the ✕ in red; `1e-6 ≤ pc < 1e-4` yellow; below green. Colors match server-side `action` classification (no drift).
6. **AC-6** — Clicking a conjunction in `FindingsPanel` selects it: ✕ + card pinned until another selection or ESC.
7. **AC-7** — Missing TLE on either satellite of a conjunction: the arc + ✕ are skipped without crashing; one warn log per session.

---

## 10. Dependencies and prerequisites

- `three` ≥ 0.158 (already in [apps/console/package.json](../../apps/console/package.json)).
- `@react-three/fiber`, `@react-three/drei` (already installed).
- No new npm deps expected.
- Postgres column guarantees: `conjunction_event.probability_of_collision`, `min_range_km`, `relative_velocity_kmps`, `combined_sigma_km`, `pc_method`, `computed_at`, `epoch` must be non-null for rows returned by the API. Enforce with `WHERE` clause in the query — skip any row missing a required field.

---

## 11. Observability

- Log `trails.render.ms` per frame batch (median + p95) to the existing pino ring buffer; surface in `/logs` tail.
- Counter `conjunction_marker_reveal_total{severity}` incremented on each hover-reveal — wired through `step-logger.ts` using a new step `"viz.marker"` added to `STEP_REGISTRY` (frames: 🎯 / 🔍 / 🎯 / 📍, terminal: ✅, error: ⚠️).
- Grafana dashboard in [infra/grafana/dashboards/ssa.json](../../infra/grafana/dashboards/ssa.json) gains a "Frontend viz" panel (P3 integration point).

---

## 12. Migration and rollback

- Feature is additive and behind the `Trails` tri-state toggle — default `tails` is the least invasive; users can fall back to `off` if perf regresses.
- API extension is backward compatible: new fields are additions, existing consumers unaffected.
- Rollback: revert the `OrbitTrails` / `ConjunctionMarkers` mount in `Globe.tsx` — one-line removal. Backend query fall-back via feature flag `env.CONSOLE_API_JOIN_CONJUNCTIONS` (default on; off reverts to legacy shape).

---

## 13. Future extensions (post-interview)

- **Playback slider** — scrub TCA timeline ± 24 h, trails and ✕ animate.
- **Uncertainty ellipsoid** — render combined 1-σ covariance as a wireframe ellipsoid at TCA in addition to the ✕.
- **Server-side propagation cache** — precompute ring vertices in Postgres / Redis when `tle_epoch` changes, push as binary payload; removes browser compute entirely.
- **Heat-map mode** — replace individual ✕ with a 2D density heat-map on the Earth surface for stakeholders who care about regional risk rather than per-event detail.
- **Audit trail linkage** — clicking the info card's `action` field opens the corresponding Sweep suggestion, with reviewer decision history attached.

---

## 14. Risks

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                   |
| -------------------------------------------------------------------- | ---------: | -----: | ---------------------------------------------------------------------------- |
| Ring merge balloons draw-call memory on low-end GPUs                 |        Med |   High | `tails` default keeps geometry small; `full` only activated on demand        |
| Raycaster on 1215 arcs is slow                                       |        Low |    Med | Use `BVH` from `three-mesh-bvh` if >16 ms per frame measured                 |
| Covariance quality derivation diverges from server Pc classification |        Med |    Low | Single derivation in API; frontend consumes verbatim, never recomputes       |
| TCA info card obscures globe on small windows                        |        Low |    Low | Clamp portal position to viewport, auto-flip to opposite side when near edge |
| Tail ring buffer grows unbounded on long sessions                    |        Low |    Med | Fixed-size `Float32Array` per satellite — no allocations after mount         |
