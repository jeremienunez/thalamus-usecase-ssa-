# Conversational CLI (`@interview/cli`) — Design

**Status:** DRAFT
**Date:** 2026-04-14
**Target:** technical interview demo
**Scope:** Priority 1 of the TODO "Next up" section — foundation for subsequent fish quick-wins (Pc estimator, maneuver Pareto, Why button).

## 1. Goal

An interactive REPL that makes Thalamus + Sweep usable by a non-technical reviewer in 5–7 minutes. Natural-language input → multi-agent research → editorial-tight briefing, with explicit commands for telemetry, logs, graph traversal, acceptance, and provenance. Live cost and confidence surfaced continuously.

## 2. Positioning

- **New package** `@interview/cli` at `packages/cli/`. Depends on `@interview/thalamus`, `@interview/sweep`, `@interview/shared`, `@interview/db-schema`. Zero reverse coupling — the CLI orchestrates; it is not orchestrated.
- Entry point `pnpm run ssa` → boots the container/registry (reusing existing bootstrap from `thalamus/src/index.ts`) and drops into the REPL.
- Rendering via **Ink** (React-for-terminal), inspired by chenglou's pretext editorial typography: tight multi-line layout, inline `code` spans, quote bubbles for briefings, checkbox lists for pending suggestions, a persistent footer status bar (session cost / token budget / active sessionId).

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Ink App (packages/cli/src/app.tsx)                                │
│  ┌──────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │ <ScrollView> │  │ <Prompt> (text input)│  │ <StatusFooter>  │  │
│  └──────────────┘  └──────────────────────┘  └─────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
             │                        │
             ▼                        ▼
┌─────────────────────────┐   ┌─────────────────────────────────────┐
│ Renderers               │   │ Turn controller                     │
│  briefing.tsx           │   │  - appendUser(input)                │
│  telemetry.tsx          │   │  - routeTurn(input, ctx)            │
│  logTail.tsx            │   │  - dispatch(step, ctx)              │
│  graphTree.tsx          │   │  - render(result)                   │
│  whyTree.tsx            │   └─────────────────────────────────────┘
└─────────────────────────┘                │
                                           ▼
                 ┌──────────────────────────────────────────────┐
                 │ Two-lane router                              │
                 │  Lane 1: parseExplicitCommand (grammar)      │
                 │  Lane 2: interpreter cortex (Zod plan)       │
                 └──────────────────────────────────────────────┘
                                           │
                                           ▼
                 ┌──────────────────────────────────────────────┐
                 │ Adapters (packages/cli/src/adapters/)        │
                 │  thalamusAdapter.runCycle(q, ctx)            │
                 │  telemetryAdapter.startSwarm(satId)          │
                 │  logsAdapter.tail({level, service, sinceMs}) │
                 │  graphAdapter.neighbourhood(entity)          │
                 │  resolutionAdapter.accept(suggestionId)      │
                 │  whyAdapter.trace(findingId)                 │
                 └──────────────────────────────────────────────┘
                                           │
                                           ▼
                 ┌──────────────────────────────────────────────┐
                 │ Conversation memory                          │
                 │  in-proc buffer (full replay until 200k tok) │
                 │  → memory palace (embed + HNSW retrieval     │
                 │    via existing sim_agent_memory table)      │
                 └──────────────────────────────────────────────┘
```

## 4. Two-lane router

**Design accepted from codex:** explicit grammar first, cortex second, both emit the same `RouterPlan` shape.

```ts
// packages/cli/src/router/schema.ts
export const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("query"), q: z.string().min(1) }),
  z.object({ action: z.literal("telemetry"), satId: z.string().min(1) }),
  z.object({
    action: z.literal("logs"),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    service: z.string().optional(),
    sinceMs: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("graph"), entity: z.string().min(1) }),
  z.object({ action: z.literal("accept"), suggestionId: z.string().min(1) }),
  z.object({ action: z.literal("explain"), findingId: z.string().min(1) }),
  z.object({
    action: z.literal("clarify"),
    question: z.string(),
    options: z
      .array(
        z.enum(["query", "telemetry", "logs", "graph", "accept", "explain"]),
      )
      .min(2),
  }),
]);

export const RouterPlanSchema = z.object({
  steps: z.array(StepSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
});
```

Dispatch loop:

```ts
async function routeTurn(input: string, ctx: ConversationCtx) {
  const direct = parseExplicitCommand(input); // /telemetry 3099, etc.
  const plan =
    direct ??
    RouterPlanSchema.parse(await interpreterCortex.run({ input, ctx }));

  if (plan.confidence < 0.6) return askClarify(plan);

  for (const step of plan.steps) {
    if (step.action === "clarify") return askClarify(step);
    const result = await dispatch(step, ctx);
    ctx = appendTurnState(ctx, step, result);
    ui.render(result);
  }
}
```

**Invariants:**

- `temperature: 0` for the interpreter cortex — deterministic under replay.
- `parseExplicitCommand` uses a small handwritten grammar (6 verbs + optional flags); unit-testable without an LLM.
- `clarify` is a first-class step, never a string — the UI renders it as a multiple-choice prompt.

## 5. Commands

| Input                            | Lane    | Effect                                                            |
| -------------------------------- | ------- | ----------------------------------------------------------------- |
| `<free text>`                    | cortex  | `interpreter` emits plan; one or more dispatches                  |
| `/query <q>`                     | grammar | full `thalamusService.runCycle(q)` → `analyst_briefing` render    |
| `/telemetry <satId>`             | grammar | `startTelemetrySwarm({ satelliteId })` → distribution render      |
| `/logs [level=info] [service=*]` | grammar | pino ring-buffer tail for last 30 s                               |
| `/graph <entity>`                | grammar | `research_edge` neighbourhood traversal (depth 2)                 |
| `/accept <suggestionId>`         | grammar | `sweepResolutionService.resolve()` + delta render                 |
| `/explain <findingId>`           | grammar | provenance trace via `research_edge` → source_item + skill sha256 |
| `/quit`, `/help`, `/session`     | grammar | local-only                                                        |

Hybrid wins: testable fast path for demos + natural language for the "feels agent-y" moments.

## 6. Cortex skills added

1. **`interpreter.md`** (`thalamus/src/cortices/skills/`) — consumes `{ input, recentTurns, availableEntityIds }`, emits `RouterPlan`. System prompt specifies the 6 actions, when to `clarify`, how to set `confidence`.
2. **`analyst_briefing.md`** — consumes a completed `runCycle` result (findings + source items), emits:
   - executive summary (≤ 3 lines)
   - bullet findings with evidence refs and source_class tags
   - recommended action(s)
   - suggested follow-up prompts (up to 3)
     Output is pure structured JSON; Ink renders it.

Both skills follow the existing skills-as-files pattern (SPEC-TH-031) — markdown file + Zod schema + sha256 captured in `research_edge`.

## 7. Conversation memory

- **Lane A — full replay** while `tokens(messages) < 200_000`. Stored in-process as a ring list of `{ role, content, toolCalls?, toolResults? }`.
- **Lane B — memory palace** once the threshold trips. Older turns embedded via the existing `sim_agent_memory` + pgvector/HNSW path; retrieved by semantic similarity against the current input before the interpreter call.
- `sessionId` identifies a REPL session; persists across reconnects if the user passes `--resume <sessionId>`.

No SQL schema changes — `sim_agent_memory` already carries the right columns. A thin adapter maps CLI turns to `sim_agent_memory` rows tagged `scope: "cli_session"`.

## 8. Rendering — editorial-tight, pretext-flavored

- **Inline code** spans via `picocolors` `cyanBg` on single-word tokens in briefings.
- **Quote bubble** for briefing executive summary: left border `│`, 2-space indent, dim-white text.
- **Checkbox list** for pending suggestions: `[ ]` / `[x]` prefix, `accept <id>` hint on focus.
- **Confidence bars** rendered as `█▇▆▅▄▃▂▁` mapped to `[0..1]`, colored by source_class:
  - FIELD → green (`#3fb950`)
  - OSINT → yellow (`#d29922`)
  - SIM → dim gray (`#6e7681`)
- **Status footer** (always visible):
  ```
  session 8f3a · tokens 12.4k/400k · cost $0.083 · last: query (2.4s)
  ```
- **Cost dial**: session total = Σ cycle costs (thalamus + sweep + cli cortices); per-turn delta shown as `+ $0.014`.
- **Satellite loader** — an ASCII pet that animates while long ops run (`runCycle`, `startTelemetrySwarm`, swarm aggregation). Default sprite is a small satellite orbiting a dot; additional sprites picked per action (dish scanning for `/query`, antenna blinking for `/telemetry`, radar sweep for `/graph`). ~10 fps via an Ink `useInterval`, cleaned up on step completion. The sprite also carries the current cortex name as a subtitle so the reviewer sees _what_ the system is doing, not just _that_ it's busy.

  ```
       .·°·.
      ·     ·
     ·   ●   ·     ← running: conjunction-analysis  ($0.012 so far)
      · ─┼─ ·
       ·─┴─·
  ```

  Sprite frames live in `packages/cli/src/components/SatelliteLoader/frames.ts`. New sprites are pure strings — zero runtime cost to add (e.g. a "pokemon-caught" celebratory frame on `/accept`).

- **Approximate ETA** — the loader subtitle also carries a live time-to-finish estimate, updated every tick. Source of truth: a small rolling-window store `util/etaStore.ts` keyed by `{ kind, subject }` (e.g. `cortex:conjunction-analysis`, `swarm:telemetry-inference`, `swarm:pc-estimator`) with p50 and p95 durations from the last N=20 completed runs, persisted to `~/.cache/ssa-cli/eta.json` so estimates survive restarts.

  Rendering rule:
  - `elapsed < p50` → `~ Xs remaining` where `X = p50 - elapsed` (green)
  - `p50 ≤ elapsed < p95` → `~ Ys remaining, slower than usual` (yellow)
  - `elapsed ≥ p95` → `running long — p95 was Zs` (red, no countdown)
  - First run for a given `{ kind, subject }` with no history → `~ estimating…` (gray)

  Display inside the loader block, below the cortex name:

  ```
       .·°·.
      ·     ·
     ·   ●   ·     running: conjunction-analysis
      · ─┼─ ·       ~ 3s remaining  ·  $0.012 so far
       ·─┴─·
  ```

  The ETA store is updated by a tiny hook at the log pipeline: every `cortex.done` / `swarm.done` event carries `durationMs`; the renderer appends it to the rolling window. No additional instrumentation — reuses the emoji-tagged lifecycle events from §8bis.

  **Non-goal:** ETA precision. This is a reassurance cue, not an SLA — we show it to keep the reviewer's eye engaged during 10–15 s waits.

## 8bis. Emoji-tagged lifecycle logs

Thalamus and sweep emit pino events at every step. The `/logs` tail renderer
becomes readable at a glance when each event carries an **animated** emoji
prefix — the bullet cycles through a small frame set while the step is in
progress, and freezes on a terminal emoji once the step completes.

**Two states per step:**

- `inProgress` — renders a frame cycle at ~6 fps (cadence shared with the
  satellite loader). The cycle is a list of related emoji, not a spinner.
- `done` / `error` — renders a single terminal emoji, stable.

The emoji frames are a structured field on the log event
(`{ step, phase: "start"|"done"|"error", frames?: string[], terminal?: string, msg, ... }`)
— not a string hack. Existing pino consumers ignore the animation fields
and see the `terminal` emoji or the first `frames[0]`. The CLI renderer
owns the animation loop.

**Thalamus (per cycle):**

| Step             | Animated frames (in-progress) | Terminal (done) | Terminal (error) |
| ---------------- | ----------------------------- | --------------- | ---------------- |
| cycle            | 🧠 💭 🧠 💫                   | 🏁              | 💥               |
| planner          | 🗺️ 🧭 🗺️ 📐                   | 📍              | ⚠️               |
| cortex           | 🧩 ⚙️ 🧩 🔩                   | ✅              | ❌               |
| nano.call        | 💭 💬 💭 🗯️                   | ✨              | 💔               |
| fetch.osint      | 🛰️ 📶 🛰️ 🌐                   | 📥              | 🕳️               |
| fetch.field      | 📡 ⚡ 📡 🔭                   | 📥              | 🕳️               |
| curator.dedup    | 🧹 🧽 🧹 ✂️                   | 🧴              | ⚠️               |
| kg.write         | 📝 ✍️ 📝 🖋️                   | 📚              | ❌               |
| guardrail.breach | —                             | 🚧              | —                |
| reflexion        | 🔁 🌀 🔁 ♻️                   | 🪞              | ⚠️               |

**Sweep fish (per turn):**

| Step              | Animated frames (in-progress) | Terminal (done) | Terminal (error) |
| ----------------- | ----------------------------- | --------------- | ---------------- |
| swarm             | 🐟 🐠 🐡 🦈                   | 🏆              | 🚨               |
| fish.spawn        | 🐠 🫧 🐠 💦                   | 🐟              | —                |
| fish.perturb      | 🎲 🌪️ 🎲 ⚡                   | 🎯              | —                |
| fish.turn         | 💧 🌊 💧 🫧                   | 🎣              | 💔               |
| fish.memory.read  | 🧠 🔍 🧠 📖                   | 📚              | —                |
| fish.memory.write | 🫧 💾 🫧 📥                   | 💽              | —                |
| aggregator        | 🕸️ 🧬 🕸️ 🔬                   | 🎯              | ⚠️               |
| suggestion.emit   | —                             | 💡              | —                |
| swarm.fail-soft   | —                             | 🚨              | —                |

Guidelines for frame sets:

- 3–5 frames per animated step, looped. Theme them so the sequence reads
  like the action (water ripples for fish, gears for cortex, radio waves
  for field).
- Terminal emoji is visually distinct from any frame in the loop — the
  reader's eye catches the state change.
- Instantaneous steps (e.g. `guardrail.breach`, `suggestion.emit`,
  `swarm.fail-soft`) have no animation — just the terminal.

**Implementation:**

- Shared helper `packages/shared/src/observability/step-logger.ts` exporting
  `stepLog(logger, step, extra?)`. Looks the emoji up in a frozen map keyed by
  `step`; unknown steps log with a `❔` and a dev-mode warning.
- Thalamus and sweep services replace their existing ad-hoc `logger.info("...")`
  at lifecycle boundaries with `stepLog(logger, "cortex.start", { cortex })`.
- CLI `logTail.tsx` groups consecutive events by `cycleId` / `swarmId`,
  renders them as an indented timeline with the emoji as the bullet.
- The emoji map is the single source of truth — updating it updates CLI
  rendering and any future Grafana/Prometheus label automatically.

Unit tests in `packages/shared/tests/step-logger.spec.ts` assert the map
is exhaustive (every `Step` union member has an emoji) and that unknown
steps fall back to `❔`.

## 9. Testing

Per-AC tests in `packages/cli/tests/`:

- `router/parser.spec.ts` — every slash grammar variant, including malformed input → `null`.
- `router/interpreter.spec.ts` — with a mocked `nano-caller`, verify ambiguous inputs produce `clarify`, multi-step inputs produce ordered plans, low-confidence plans trigger the gate.
- `adapters/*.spec.ts` — each adapter mocks its downstream service and asserts correct arguments.
- `memory/palace.spec.ts` — threshold crossover swaps from full replay to embedding retrieval; embeddings write to `sim_agent_memory` with correct scope tag.
- `render/briefing.spec.tsx` — snapshot tests via `ink-testing-library` covering confidence-bar colors, source-class tags, executive-summary bubble.
- `e2e/repl.spec.ts` — full loop: `/telemetry 25544` → render → `/accept <id>` → DB row + audit row (all in-memory/redis-mock).

Coverage target: 80% line / 100% on `router/parser.ts` (it's pure).

## 10. Non-goals (explicit)

- No web UI. Terminal-only for this milestone (web is a separate P3 / Grafana task).
- No authentication. Single-user local session.
- No persistence of the REPL history between sessions beyond `sim_agent_memory` (user can `--resume`, not "load by date").
- No streaming of cortex tokens into Ink — renders are per-step-complete. Streaming is nice-to-have, post-interview.

## 11. File layout

```
packages/cli/
  package.json          # "ssa" bin → dist/index.js
  tsconfig.json
  src/
    index.ts            # boot container + spawn Ink app
    app.tsx             # Ink root
    components/
      Prompt.tsx
      StatusFooter.tsx
      ScrollView.tsx
    renderers/
      briefing.tsx
      telemetry.tsx
      logTail.tsx
      graphTree.tsx
      whyTree.tsx
      clarify.tsx
    router/
      parser.ts         # slash grammar
      schema.ts         # Zod StepSchema / RouterPlanSchema
      interpreter.ts    # cortex adapter
      dispatch.ts       # dispatch(step, ctx)
    adapters/
      thalamus.ts
      telemetry.ts
      logs.ts
      graph.ts
      resolution.ts
      why.ts
    memory/
      buffer.ts         # full-replay ring
      palace.ts         # HNSW adapter over sim_agent_memory
      tokens.ts         # tiktoken-based counter
    util/
      colors.ts         # source-class palette
      costMeter.ts      # per-turn + session totals
  tests/
    ...
```

## 12. Risks & mitigations

| Risk                                                  | Mitigation                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Interpreter hallucinates a nonexistent `suggestionId` | Dispatch resolves against DB; unknown id → structured error rendered, not thrown                                                  |
| Live demo latency on `runCycle`                       | Cost dial + spinner; `/query` supports `--fast` flag routing to a stub fixture if the mission-critical happy path is pre-recorded |
| Ink + pino log tail race                              | `logsAdapter` reads from a bounded ring buffer populated by a pino transport; no direct stdout contention                         |
| 200k-token threshold flaps                            | Hysteresis: fall back to memory palace at 200k, only return to full replay when total < 150k                                      |

## 13. Success criteria (demo-facing)

- `pnpm run ssa` boots in ≤ 3 s on the laptop used for the interview.
- Free-text "give me the riskiest conjunction this week" → briefing in ≤ 15 s, with at least one FIELD-tagged finding and one OSINT-tagged finding.
- `/explain <findingId>` renders an ASCII provenance tree in ≤ 500 ms from warm state.
- `/accept <id>` persists a `sweep_resolution` row and shows the audit delta in-place.
- Session footer shows live token + cost counters at all times.

## 14. Out-of-scope (defers to next specs)

- Pc estimator cortex and swarm (own spec, Priority 2 item #1).
- Maneuver Pareto (own spec, Priority 2 item #2).
- `/explain` depth > 3, cycle detection beyond MVP.
- Grafana / Prometheus instrumentation (Priority 3).
