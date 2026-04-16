# Dependency-cruiser snapshot — 2026-04-14

## Totals
- modules: 247
- orphans: 10
- circular edges: 3

## Orphans
- `apps/console/postcss.config.js`
- `apps/console/src/components/CommandPalette.tsx`
- `apps/console/src/lib/uiStore.ts`
- `apps/console/src/lib/useUtcClock.ts`
- `apps/console/src/routes/index.tsx`
- `apps/console/tailwind.config.ts`
- `packages/db-schema/drizzle.config.ts`
- `packages/sweep/src/types/geojson.d.ts`
- `packages/sweep/src/utils/satellite-entity-patterns.ts`
- `packages/thalamus/src/utils/sql-helpers.ts`

## Cycles
- packages/thalamus/src/transports/llm-chat.ts → packages/thalamus/src/transports/fixture-transport.ts
- packages/thalamus/src/transports/fixture-transport.ts → packages/thalamus/src/transports/llm-chat.ts

## Top fan-in (hubs)
- **75** ← `packages/db-schema/src/index.ts`
- **58** ← `packages/shared/src/observability/index.ts`
- **13** ← `packages/shared/src/enum/index.ts`
- **11** ← `packages/sweep/src/sim/types.ts`
- **10** ← `packages/thalamus/src/cortices/sources/types.ts`
- **9** ← `packages/thalamus/src/cortices/sources/registry.ts`
- **8** ← `@/lib/uiStore`
- **8** ← `packages/shared/src/index.ts`
- **8** ← `packages/thalamus/src/transports/llm-chat.ts`
- **7** ← `@/lib/queries`
- **7** ← `@/lib/api`
- **7** ← `packages/sweep/src/jobs/queues.ts`
- **7** ← `packages/sweep/src/repositories/sweep.repository.ts`
- **7** ← `packages/thalamus/src/index.ts`
- **7** ← `packages/thalamus/src/services/research-graph.service.ts`
- **6** ← `fs`
- **6** ← `packages/sweep/src/repositories/satellite.repository.ts`
- **6** ← `packages/sweep/src/sim/memory.service.ts`
- **6** ← `packages/sweep/src/sim/sim-orchestrator.service.ts`
- **6** ← `packages/sweep/src/sim/swarm.service.ts`

## Top fan-out (god files)
- **56** → `packages/sweep/src/index.ts`
- **24** → `packages/thalamus/src/cortices/sql-helpers.ts`
- **21** → `packages/thalamus/src/index.ts`
- **19** → `packages/sweep/src/config/container.ts`
- **13** → `packages/thalamus/src/cortices/sources/index.ts`
- **12** → `packages/thalamus/src/services/thalamus.service.ts`
- **11** → `packages/sweep/src/sim/turn-runner-sequential.ts`
- **10** → `packages/db-schema/src/schema/index.ts`
- **10** → `packages/sweep/src/services/sweep-resolution.service.ts`
- **10** → `packages/thalamus/src/services/research-graph.service.ts`
- **10** → `packages/sweep/src/sim/turn-runner-dag.ts`
- **10** → `packages/thalamus/src/cortices/executor.ts`
- **10** → `packages/thalamus/src/config/container.ts`
- **8** → `packages/sweep/src/jobs/workers/sim-turn.worker.ts`
- **8** → `packages/sweep/src/jobs/workers/swarm-fish.worker.ts`

## Duplicated basenames (possible parallel implementations)
### `research.enum.ts`
- `packages/db-schema/src/enums/research.enum.ts`
- `packages/shared/src/enum/research.enum.ts`

### `container.ts`
- `packages/sweep/src/config/container.ts`
- `packages/thalamus/src/config/container.ts`

### `sql-helpers.ts`
- `packages/sweep/src/utils/sql-helpers.ts`
- `packages/thalamus/src/cortices/sql-helpers.ts`
- `packages/thalamus/src/utils/sql-helpers.ts`

### `llm-json-parser.ts`
- `packages/thalamus/src/utils/llm-json-parser.ts`
- `packages/sweep/src/utils/llm-json-parser.ts`

### `satellite-entity-patterns.ts`
- `packages/thalamus/src/utils/satellite-entity-patterns.ts`
- `packages/sweep/src/utils/satellite-entity-patterns.ts`