# Make Onboarding Experience — Design

**Status:** Draft
**Date:** 2026-04-16
**Owner:** Jeremie Nunez
**Target audience of the artifact:** a senior technical reviewer running `make` for the first time after `git clone`.

## 1. Intent

The repo should onboard its own reader. When someone types `make` they should, within 30 seconds, understand:

- what the system is (Thalamus + Sweep, SSA domain)
- what commands exist and in what order to run them
- what services are running and on what ports
- what to curl next to see something real happen

No README reading required. The terminal is the documentation.

## 2. Success criteria

A reviewer who has never seen the repo should be able to:

1. Run `make` → see a compact cockpit with a quick-start and grouped targets (no scrolling).
2. Run `make up && make seed` → watch Postgres + Redis come up with live feedback (no silent sleeps) and finish with a count of what was seeded.
3. Run `make console` → get a "System" banner showing postgres / redis / cortex / catalog / tests all as one glance, plus 4 copy-paste curl examples.
4. Run one of the suggested curls → the request is logged back in the same visual language as the banner (colored status, method, duration).

Non-goals: animated transitions between targets, rewriting the seed script to emit progress, modifying business logic of thalamus or sweep packages.

## 3. Design posture

**Mission Control** aesthetic — dense, calm, cockpit-like. Single accent color (cyan), grayscale body, status indicators via colored dots (`●`). Box-drawing chars for structure. Motion reserved for the one moment that already has it (satellite charge-up on console-api boot). No cuteness, no narration, no progress that isn't truthful.

Cohérence thématique: the satellite ASCII is the recurring "logo" across surfaces so the 5+ commands feel like one tool.

## 4. Architecture

### 4.1 Shared visual toolkit — `scripts/ui.sh`

A ~80-line bash file, sourced by Makefile targets. No dependencies beyond POSIX bash + standard terminal. Exposes:

- **Palette**: `C_RESET`, `C_BOLD`, `C_CYAN`, `C_GREEN`, `C_YELLOW`, `C_RED`, `C_GRAY`.
- **`satellite_logo`**: prints the 3-line static satellite ASCII (same glyphs as the console-api animated version, but without animation).
- **`section <title>`**: prints a section header with a faint rule line.
- **`step <msg>` / `ok <msg>` / `warn <msg>` / `fail <msg>`**: one-line status primitives with `›`, `✓`, `⚠`, `✗` glyphs in the right color.
- **`spinner_until <cmd> <label>`**: runs `<cmd>` (predicate) in a `while !`; draws a spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` next to `<label>`; replaces itself with `ok <label>` when `<cmd>` succeeds.

**Why bash, not node**: Makefile already uses bash shell. A node helper would fork per step and add latency/noise. Bash keeps it ~instant and dep-free.

**Why separate from the Makefile**: sourced once, reusable from any future shell script (e.g., a `scripts/setup.sh` wrapper), and keeps the Makefile focused on targets.

### 4.2 Makefile

Rewrites limited to 4 targets. All other targets remain unchanged.

#### 4.2.1 `help` (the default target)

Current: `awk` one-liner that prints all targets in a flat list.

New: bash recipe that prints, in order:

1. `satellite_logo`
2. Bold title + tagline (`Thalamus + Sweep · Space Situational Awareness · dev environment`)
3. **Quick start** block (3 ordered commands with short comments)
4. **Targets** block — same `awk` parsing of `##@ Section` markers already in the file, but formatted with colored arrows and one line per section showing all targets in that section inline (so the help fits on one screen).

The existing `##@ Infra`, `##@ Schema`, etc. markers already exist — we just use them.

#### 4.2.2 `up`

Current: `until [ "$(docker inspect ...)" = "healthy" ]; do sleep 1; done` — silent loop.

New: `spinner_until 'docker inspect -f "{{.State.Health.Status}}" thalamus-postgres | grep -q healthy' 'postgres'` — draws live spinner, turns into `✓ postgres (pgvector 0.8)` when ready. Same for redis.

#### 4.2.3 `seed`

Current: `pnpm --filter @interview/db-schema seed` — raw output.

New:

- Before: `section "Seeding catalog"`
- Run seed as-is.
- After: read counts from Postgres (`docker exec ... psql -tc 'select count(*) from satellites'`, same for regimes) and print `ok "500 satellites, 37 regimes seeded"`.

**No progress bar** — the seed script doesn't emit progress, and modifying it is out of scope.

#### 4.2.4 `demo`

Append an epilogue after existing steps: a small `section "Next steps"` with the 3 most useful follow-up commands.

### 4.3 console-api banner enrichment

Already wired (satellite animation, header, config, "Try this") in `apps/console-api/src/server.ts`. This chapter adds one new **System** block between config and "Try this".

Queries executed in `buildContainer` (one-shot, at boot, behind a try/catch so a DB hiccup doesn't kill the boot):

- `SELECT count(*)::int AS n FROM satellites` → `catalog`
- `SELECT count(DISTINCT regime_id)::int AS n FROM satellites WHERE regime_id IS NOT NULL` → `regimes`
- Postgres version from `SHOW server_version_num` (or infer from connection info)
- pgvector version from `SELECT extversion FROM pg_extension WHERE extname='vector'` (already required by schema)

Thalamus cortex count is already available via `thalamus.registry.size()`.

Test count: **skipped** in v1. Rationale: reading `.vitest-cache` or re-running tests at boot both have failure modes worse than just not showing it. If we want this later, we write a count file from a `posttest` hook. For now, the banner shows what's actually verifiable at boot.

New banner line format:

```
System
  ● postgres     localhost:5433          pgvector 0.8
  ● redis        localhost:6380          7.2
  ● cortices     29 loaded               briefing, traffic-spotter, …
  ● catalog      500 sats                37 regimes
```

Dots are green when the corresponding resource responds at boot, red otherwise (measured during buildContainer's own connection attempts).

### 4.4 ssa REPL banner (stretch)

Only executed if chapters 1-3 are done and there is budget. Plan: add a banner print in the thalamus `ssa` REPL entry (wherever `pnpm --filter @interview/thalamus ssa` boots) using the same satellite + "connected to postgres · 29 cortices" pattern.

Explicit descope: not touching the REPL's input loop, prompt styling, or command parsing.

## 5. Out of scope (decided)

- Real progress bar during `make seed` — would require modifying the seed script.
- Animated satellite inside Makefile targets — bash terminal motion reads poorly vs Node's ANSI control. Animation stays in console-api only.
- Combined banner merging console-api + console UI into one — they run as two separate pnpm processes, merging their stdouts requires a process supervisor, too invasive.
- tsx-watch reload separator — low impact, noisy.
- Rewriting other targets (`migrate`, `studio`, `psql`, `redis-cli`, `sweep-run`, `thalamus-cycle`, `test`, `typecheck`) — they're already fine.

## 6. Risks & mitigations

- **Risk**: `docker inspect` returning unexpected strings on some docker versions breaks `spinner_until`. **Mitigation**: keep a 60s cap on the spinner; print `warn` if the predicate hasn't flipped by then and let the user see the raw output.
- **Risk**: Postgres count queries fail (schema not migrated yet). **Mitigation**: wrap in try/catch in `buildContainer`; show `—` instead of the count. Banner renders, just with one less data point.
- **Risk**: `pino-pretty` reflowing the new `process.stdout.write` banner lines. **Mitigation**: banner is already written via `process.stdout.write` outside the logger's stream (see existing code path). Verified when current banner was added.
- **Risk**: ANSI color codes leaking into non-TTY output (CI logs, piped output). **Mitigation**: `ui.sh` and the console-api code both gate color on `process.stdout.isTTY` (code side) / `test -t 1` (bash side).

## 7. Acceptance tests

Each chapter has a manual verification step; automation not required for terminal UX.

1. **Chapter 1**: source `scripts/ui.sh` in a scratch shell, call each helper, confirm no leakage, no color bleed on redirect.
2. **Chapter 2 / help**: `make` with fresh clone, help fits in a standard 80x24 terminal, sections are visually distinct, quick-start is above the fold.
3. **Chapter 2 / up**: `make nuke && make up`, watch spinners draw, each resolves to a green check with version info.
4. **Chapter 2 / seed**: `make seed`, final line reports actual DB row counts (not hardcoded).
5. **Chapter 3**: `make console-api`, banner shows the 4 System rows (postgres, redis, cortices, catalog) with green dots when healthy and `—` in place of counts if a query fails.
6. **Chapter 4 (if done)**: `make ssa`, banner appears once, REPL enters normally.

## 8. Files touched

- `scripts/ui.sh` — new, ~80 lines
- `Makefile` — ~40 lines changed across `help`, `up`, `seed`, `demo`
- `apps/console-api/src/server.ts` — extend `printBanner` with System block
- `apps/console-api/src/container.ts` — add a `healthProbe()` that returns the counts + versions for the banner
- (stretch) `packages/thalamus/src/cli/ssa.ts` (or wherever the REPL entry lives) — add banner call

Everything else is untouched.
