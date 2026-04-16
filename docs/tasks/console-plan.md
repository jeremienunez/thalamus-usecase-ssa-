# Operator Console — Phased Plan

**Goal**: Palantir-style React console for the CortAIx interview demo. Three modes on a shared shell: **OPS** (3D globe + satellites + conjunctions), **THALAMUS** (KG graph), **SWEEP** (dense findings graph).

**Stack**: Vite + React 18 + TypeScript · react-three-fiber + drei (OPS) · sigma.js v3 + graphology (THALAMUS/SWEEP) · shadcn/ui + Tailwind · TanStack Query · TanStack Router.

**Location**: `apps/console/` (new workspace), imports from `@interview/db-schema` and `@interview/shared`.

**Design tokens**: see [design-system/MASTER.md](../design-system/MASTER.md) — Palantir Gotham palette, Inter + JetBrains Mono, translucent panels, no rounded-xl, Lucide icons only.

---

## Phase 0 — Design system persistence (~15 min)

- [ ] Generate + persist master design system to `design-system/MASTER.md`
- [ ] Page overrides: `design-system/pages/{ops,thalamus,sweep}.md`
- [ ] Lock palette, typography, spacing scale, z-index scale in `tailwind.config.ts`

## Phase 1 — Scaffold (~20 min)

- [ ] `apps/console/` Vite + React + TS workspace, wired to pnpm-workspace
- [ ] Tailwind + shadcn init, import Palantir tokens
- [ ] Base fonts (Inter, JetBrains Mono via fontsource)
- [ ] TanStack Router with three routes: `/ops`, `/thalamus`, `/sweep` (default `/ops`)
- [ ] Dev API proxy to a lightweight Fastify read-only endpoint (`apps/console-api/`) that serves: satellites, conjunction_events, research_findings, KG edges

## Phase 2 — Shell chrome (~30 min)

- [ ] `<AppShell>` — top bar (UTC clock, swarm status pill, pending count, mode switcher)
- [ ] Left rail — contextual filters per mode (collapsible, 56px collapsed / 240px expanded)
- [ ] Right drawer — slide-in detail panel (420px, backdrop-blur, closeable)
- [ ] Bottom telemetry strip — monospaced rolling log (shared component, subscribes to event stream)
- [ ] Keyboard: `⌘1/2/3` mode switch, `Esc` close drawer, `/` focus search

## Phase 3 — Data layer (~25 min)

- [ ] `apps/console-api/` Fastify server reading from existing Postgres (read-only)
  - `GET /api/satellites` → paginated, filterable by regime
  - `GET /api/conjunctions?minPc=1e-4` → active events
  - `GET /api/kg/nodes` + `GET /api/kg/edges` → Thalamus KG snapshot
  - `GET /api/findings` + `GET /api/findings/:id` → Sweep inbox
  - `POST /api/findings/:id/decision` → accept/reject/edit (writes audit row)
- [ ] TanStack Query hooks in `apps/console/src/lib/queries/`
- [ ] Zod-validated DTOs, shared types from `@interview/db-schema`

## Phase 4 — OPS mode: 3D globe + conjunctions (~90 min)

- [ ] `<Globe />` — react-three-fiber Earth: Blue Marble day/night textures, atmosphere shader
- [ ] SGP4 client-side propagation (satellite.js) for smooth orbit animation — seed positions from API, tick every 1s
- [ ] `<SatelliteField />` — instanced mesh, 1–2k points, color by orbit regime
- [ ] `<ConjunctionEdges />` — great-circle arcs between conjunction pairs, color = Pc threshold band, opacity = Pc log-scaled
- [ ] Click node → fetch finding → open right drawer (provenance, Pc, TCA, Δv, swarm consensus, accept/reject buttons)
- [ ] Left rail filters: regime (LEO/MEO/GEO), Pc threshold slider, OSINT-only toggle
- [ ] Time controller bottom-center: pause/play/±speed (drives propagation clock)

## Phase 5 — THALAMUS mode: KG graph (~60 min)

- [ ] `<KGGraph />` — sigma.js v3 + graphology, ForceAtlas2 layout (webworker)
- [ ] Nodes by entity class (Satellite / Debris / Operator / Payload / Orbit / ConjunctionEvent / Maneuver) — shape + color per class
- [ ] Edges by relation type, edge width = confidence band, color = source class (OSINT blue / Field purple)
- [ ] Left rail: cortex filter (catalog/observations/conjunction-analysis/correlation/maneuver-planning), entity-class toggle, confidence threshold
- [ ] Node hover → tooltip with key fields; click → drawer with full entity + provenance + incoming/outgoing edges list
- [ ] Search: `/` focuses search → fuzzy match on entity name, camera flies to node
- [ ] Mini-map bottom-right

## Phase 6 — SWEEP mode: findings graph (~75 min)

- [ ] `<FindingsGraph />` — sigma.js v3, dense force-directed (thousands of nodes, WebGL)
- [ ] Node = research_finding or sweep_suggestion; edges = shared entity references (co-citation style)
- [ ] Color scheme: pending (amber), accepted (cyan), rejected (red) — matches reference image
- [ ] Cluster colors by cortex/category
- [ ] Click finding → drawer: full finding detail, swarm consensus distribution (if UC3), accept/reject/edit form with reason
- [ ] Submit decision → optimistic update, POST to API, audit row written, node color transitions
- [ ] Left rail: status filter, cortex filter, date range, priority threshold
- [ ] Top tab bar within mode: `Overview | Map | Stats` (like reference image)
- [ ] Stats view: histogram of Pc distribution, acceptance rate per cortex, latency percentiles

## Phase 7 — Cross-mode polish (~45 min)

- [ ] Bottom telemetry strip wired to a WebSocket from api (fallback polling) — shows swarm activity, last findings, decisions
- [ ] Audit ledger page (`/audit`) — reversible Maneuver rows, monospaced table, row expand shows decision trail
- [ ] System status modal (`⌘K` palette): model health, Postgres latency, pending queue depth
- [ ] Reduced-motion respect (disable orbit animation + force-layout continuous tick)
- [ ] Empty states, loading skeletons (Palantir style: thin shimmer)
- [ ] 4 viewport checks: 1280 / 1440 / 1920 / 2560

## Phase 8 — Demo seeding + docs (~30 min)

- [ ] `scripts/seed-demo.ts` — guarantees visually interesting state: ≥5 conjunctions above threshold, ≥100 KG nodes, ≥500 findings with mixed statuses
- [ ] README snippet with 3 screenshots (OPS / THALAMUS / SWEEP)
- [ ] Makefile targets: `make console`, `make console-api`, `make demo`
- [ ] Walkthrough script for interview: "click this node → drawer opens → here's the provenance" (3 min live demo path)

---

## Exit criteria

- [ ] `pnpm --filter @interview/console dev` boots in <3s, loads globe in <2s
- [ ] Three modes switchable without reload, state preserved
- [ ] 60fps on globe with 1500 satellites, 50fps on KG with 2k nodes, 30fps on Sweep with 5k nodes
- [ ] Accept/reject round-trip writes audit row visible in `/audit`
- [ ] Zero emojis, zero rounded-xl, all numerics monospaced
- [ ] WCAG AA on all chrome (globe canvas exempted)

## Open decisions

- **API surface**: keep read-only `console-api` separate, or expose existing sweep admin routes? → leaning separate, smaller blast radius.
- **KG edge density**: cap at ~5k edges or use edge bundling? → start uncapped with ForceAtlas2, add bundling if frame drops.
- **Sweep clustering**: k-means on embeddings (already exist in `sim_agent_memory`) or Louvain on graph? → Louvain first, cheaper + deterministic.

## Review section

_To be filled after Phase 8._
