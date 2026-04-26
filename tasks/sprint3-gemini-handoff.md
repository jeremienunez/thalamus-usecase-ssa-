# Sprint 3 Gemini Handoff - 3D Fish Operator UI

Goal: let Gemini focus on the R3F spatial/murmuration layer without guessing
repo contracts or crossing architecture boundaries.

## Non-negotiables from CLAUDE.md

- The UI must consume `console-api` HTTP/SSE routes only.
- Do not import `apps/console-api/src/*` from `apps/console` or `packages/*`.
- Do not add a second in-process contract or private helper for sim data.
- Shared DTO shape comes from `@interview/shared/dto`, surfaced in console via
  `apps/console/src/dto/http/sim.dto.ts`.

## Backend routes already available

Use the adapter in `apps/console/src/adapters/api/sim-operator.ts`; do not call
these URLs by hand in components.

- `GET /api/sim/operator/swarms?status=&kind=&limit=&cursor=`
- `GET /api/sim/operator/swarms/:id/status`
- `GET /api/sim/operator/swarms/:id/events`
- `GET /api/sim/operator/swarms/:id/fish/:fishIndex/timeline`
- `GET /api/sim/operator/swarms/:id/clusters`
- `GET /api/sim/operator/swarms/:id/fish/:fishIndex/trace`
- `POST /api/sim/operator/swarms/:id/qa`
- `GET /api/sim/operator/swarms/:id/evidence`

Named SSE events are parsed through
`apps/console/src/adapters/sse/sim-operator.ts`:

- `status`
- `aggregate`
- `terminals`
- `done`
- `error`

## New frontend surface prepared

- API port: `apps/console/src/adapters/api/sim-operator.ts`
- React Query hooks:
  - `useOperatorSwarmsQuery`
  - `useOperatorSwarmStatusQuery`
  - `useOperatorSwarmClustersQuery`
  - `useOperatorFishTimelineQuery`
  - `useSimReviewEvidenceQuery`
  - `useSimReviewQuestionMutation`
- Pure scene model: `apps/console/src/features/fish-operator/fish-scene-model.ts`
- Bundle guard: `apps/console/manual-chunks.ts` is wired from
  `apps/console/vite.config.ts` for `vendor-3d`, `vendor-graph`, and
  `vendor-shell`.

## Logic to reuse

- Full-bleed canvas shell: `apps/console/src/features/ops/OpsScene.tsx`
- Instanced and pickable objects: `apps/console/src/features/ops/SatelliteField.tsx`
- Hover/select marker pattern: `apps/console/src/features/ops/ConjunctionMarkers.tsx`
- Camera focus pattern: `apps/console/src/features/ops/CameraFocus.tsx`
- Organic 3D grouping style: `apps/console/src/features/thalamus/kg-scene-3d/*`
- HUD chrome: `apps/console/src/shared/ui/HudPanel.tsx`
- Existing DOM-first R3F test harness: `apps/console/src/features/ops/ops-3d.test.tsx`

## Scene model contract

`buildFishSceneModel()` returns stable, pickable fish nodes from operator API
data. Gemini should consume this instead of recomputing API semantics in the
R3F component.

Each `FishSceneNode` includes:

- `fishIndex`
- `status`
- `clusterIndex` / `clusterLabel`
- `terminalActionKind`
- `selected`
- `color`
- deterministic `position`
- `pickableId`

Tests lock:

- terminal rows override inferred status
- clusters support `memberFishIndexes`, `fishIndexes`, or member objects with
  `fishIndex`
- filters preserve the full node list
- 200-fish projection is deterministic

## Suggested Gemini implementation path

1. Add a `FishOperatorEntry` under `apps/console/src/features/fish-operator/`.
2. Pick the newest/running swarm from `useOperatorSwarmsQuery`, with an explicit
   selector panel for older swarms.
3. Subscribe to live events with `subscribeSimOperatorEvents`; update local
   status/cluster/terminal overlays and invalidate relevant React Query keys.
4. Render a full-bleed R3F scene using `buildFishSceneModel`.
5. Use instanced meshes or points for fish. Picking must map instance id back to
   `FishSceneNode.fishIndex`.
6. Add camera controls and a timeline scrubber. Scrubber should use the selected
   fish timeline turns, not mutate backend state.
7. Add an interrogation panel:
   - swarm scope: `{ scope: "swarm", question }`
   - fish scope: `{ scope: "fish", fishIndex, question }`
   - cluster scope: `{ scope: "cluster", clusterLabel or clusterIndex, question }`
8. Persisted Q&A is review evidence only. Do not write fish memory from the UI.
9. Wire route/navigation only after the feature has a mounting smoke test.

## Tests already added

Run:

```bash
pnpm exec vitest run --project console \
  apps/console/src/adapters/api/sim-operator.test.ts \
  apps/console/src/adapters/sse/client.test.ts \
  apps/console/src/adapters/sse/sim-operator.test.ts \
  apps/console/src/features/fish-operator/fish-scene-model.test.ts \
  apps/console/tests/vite-manual-chunks.test.ts
```

Sprint 3 still needs true browser/WebGL checks from the TODO exit criteria:
desktop/mobile screenshots, nonblank canvas pixel check, picking test, camera
control test, and a 200-fish performance check. Playwright is not currently in
`apps/console/package.json`, so add it deliberately if those checks become
automated in this sprint.
