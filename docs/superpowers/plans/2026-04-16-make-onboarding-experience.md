# Make Onboarding Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `make` feel like a cockpit: the terminal onboards the reader in 30 seconds, from `make help` through `make up && make seed && make console` with colored, grouped, and self-describing output — Mission Control posture.

**Architecture:** One bash helpers file (`scripts/ui.sh`) provides the shared visual vocabulary (colors, section headers, status glyphs, spinner, satellite logo) for the Makefile. The Makefile's `help`, `up`, `seed`, `demo` targets are rewritten to use those helpers. Console-api's boot banner gains a `System` block fed by a new `healthProbe()` in the container that reports Postgres/Redis/cortices/catalog state.

**Tech Stack:** POSIX bash (no deps) for shell side; Node/Fastify/Vitest/Drizzle for the console-api side (already present).

**Related spec:** [docs/superpowers/specs/2026-04-16-make-onboarding-experience-design.md](../specs/2026-04-16-make-onboarding-experience-design.md)

---

## File Structure

### New files

- `scripts/ui.sh` — shared bash helpers (colors, `section`, `step`, `ok`, `warn`, `fail`, `spinner_until`, `satellite_logo`). Sourced from Makefile recipes. No deps beyond POSIX bash.
- `scripts/test-ui.sh` — a simple bash test harness for `ui.sh`. Sources `ui.sh`, invokes each helper, asserts on captured stdout. No framework (bats would add a dep and this is ~30 lines).
- `apps/console-api/tests/unit/services/health-probe.service.test.ts` — Vitest test for the new `HealthProbeService`.

### New src files

- `apps/console-api/src/services/health-probe.service.ts` — runs the boot-time queries (sat count, regime count, pgvector version, redis ping) behind one method. Isolated from `container.ts` so it's testable.

### Modified files

- `Makefile` — rewrite `help`, `up`, `seed`, `demo` targets to source `scripts/ui.sh` and call its helpers.
- `apps/console-api/src/container.ts` — import and run `HealthProbeService` during build; return its result in `info`.
- `apps/console-api/src/server.ts` — extend `printBanner` with a `System` block fed from `info.probe`.

### Unchanged (do not touch)

- Other Makefile targets (`migrate`, `studio`, `psql`, `redis-cli`, `sweep-run`, `thalamus-cycle`, `console-api`, `console-ui`, `console`, `test`, `typecheck`, `spec-check`, `hooks-install`).
- All repositories, other services, routes, and controllers in `apps/console-api/src`.
- `packages/thalamus`, `packages/sweep`, `packages/db-schema`, `packages/shared`.

---

## Chapter 1 — scripts/ui.sh

### Task 1.1: Create `scripts/ui.sh` with palette + `section` helper and a test harness

**Files:**

- Create: `scripts/ui.sh`
- Create: `scripts/test-ui.sh`

- [ ] **Step 1: Write the failing test** — `scripts/test-ui.sh`

```bash
#!/usr/bin/env bash
# Usage: scripts/test-ui.sh
# Exits 0 on success, non-zero on failure. Prints a summary.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./ui.sh
. "$HERE/ui.sh"

fail_count=0
pass_count=0

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf '  PASS  %s\n' "$label"; pass_count=$((pass_count + 1))
  else
    printf '  FAIL  %s\n    expected to find: %q\n    in: %q\n' "$label" "$needle" "$haystack"
    fail_count=$((fail_count + 1))
  fi
}

# --- palette ---
assert_contains "$C_CYAN"  $'\e[36m' 'C_CYAN is the ANSI cyan code'
assert_contains "$C_RESET" $'\e[0m'  'C_RESET is the ANSI reset code'

# --- section ---
out="$(section 'Infra' 2>&1)"
assert_contains "$out" 'Infra' 'section prints its title'
assert_contains "$out" '─'     'section prints a rule line'

echo
echo "  ${pass_count} passed, ${fail_count} failed"
[[ "$fail_count" -eq 0 ]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `chmod +x scripts/test-ui.sh && scripts/test-ui.sh`
Expected: FAIL — `scripts/ui.sh` does not exist yet, source will error.

- [ ] **Step 3: Write minimal implementation** — `scripts/ui.sh`

```bash
#!/usr/bin/env bash
# Shared visual vocabulary for Makefile recipes and shell scripts.
# Sourced, not executed. Provides colors, section headers, status glyphs,
# a spinner, and the satellite ASCII logo.
#
# All helpers respect TTY: if stdout is not a terminal, colors and motion
# are stripped so piped/redirected output stays clean.

# Guard against double-sourcing.
if [[ -n "${_UI_SH_LOADED:-}" ]]; then return 0; fi
_UI_SH_LOADED=1

# ── Palette ───────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'
  C_BOLD=$'\e[1m'
  C_DIM=$'\e[2m'
  C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'
  C_YELLOW=$'\e[33m'
  C_CYAN=$'\e[36m'
  C_GRAY=$'\e[90m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_CYAN='' C_GRAY=''
fi

# ── section <title> ───────────────────────────────────────────────────────
# Prints a bold cyan title on its own line with a faint rule below it.
section() {
  local title="${1:-}"
  printf '\n%s%s%s%s\n' "$C_BOLD" "$C_CYAN" "$title" "$C_RESET"
  printf '%s%s%s\n' "$C_GRAY" '────────────────────────────────────────' "$C_RESET"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `scripts/test-ui.sh`
Expected: `2 passed, 0 failed` (palette + section assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/ui.sh scripts/test-ui.sh
git commit -m "feat(scripts): add ui.sh palette + section helper with test harness"
```

---

### Task 1.2: Add status helpers (`step`, `ok`, `warn`, `fail`)

**Files:**

- Modify: `scripts/ui.sh` (append)
- Modify: `scripts/test-ui.sh` (append assertions)

- [ ] **Step 1: Write the failing test** — append to `scripts/test-ui.sh` before the summary print

```bash
# --- status helpers ---
out="$(ok 'postgres ready' 2>&1)";    assert_contains "$out" '✓' 'ok uses check glyph'
out="$(ok 'postgres ready' 2>&1)";    assert_contains "$out" 'postgres ready' 'ok carries the message'
out="$(warn 'slow response' 2>&1)";   assert_contains "$out" '⚠' 'warn uses warning glyph'
out="$(fail 'redis down' 2>&1)";      assert_contains "$out" '✗' 'fail uses cross glyph'
out="$(step 'seeding' 2>&1)";         assert_contains "$out" '›' 'step uses chevron glyph'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `scripts/test-ui.sh`
Expected: FAIL — `ok: command not found` (or similar).

- [ ] **Step 3: Write minimal implementation** — append to `scripts/ui.sh`

```bash
# ── Status glyphs ─────────────────────────────────────────────────────────
# step/ok/warn/fail each print one aligned line: "<glyph> <message>".
step() { printf '  %s›%s %s\n' "$C_GRAY"   "$C_RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '  %s✗%s %s\n' "$C_RED"    "$C_RESET" "$*"; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `scripts/test-ui.sh`
Expected: 7 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui.sh scripts/test-ui.sh
git commit -m "feat(scripts): add step/ok/warn/fail status helpers to ui.sh"
```

---

### Task 1.3: Add `spinner_until` helper

**Files:**

- Modify: `scripts/ui.sh` (append)
- Modify: `scripts/test-ui.sh` (append assertion)

Semantics: `spinner_until <predicate-cmd> <label> [timeout-seconds]`. Loops running `<predicate-cmd>`; while it exits non-zero, redraws a spinner character next to `<label>`. When it exits zero, clears the spinner line and prints `ok <label>`. If `timeout-seconds` elapses, prints `warn <label> (timeout)` and returns 1. Default timeout is 60 seconds.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-ui.sh`

```bash
# --- spinner_until ---
# Predicate that succeeds on the 2nd invocation (via counter file).
counter_file="$(mktemp)"
echo 0 > "$counter_file"
pred() {
  local n; n=$(<"$counter_file")
  echo $((n + 1)) > "$counter_file"
  [[ $n -ge 1 ]]
}
out="$(spinner_until pred 'postgres' 5 2>&1)"
rm -f "$counter_file"
assert_contains "$out" 'postgres'       'spinner_until labels its task'
assert_contains "$out" '✓'              'spinner_until finalizes with ok'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `scripts/test-ui.sh`
Expected: FAIL — `spinner_until: command not found`.

- [ ] **Step 3: Write minimal implementation** — append to `scripts/ui.sh`

```bash
# ── spinner_until <predicate> <label> [timeout-sec] ───────────────────────
# Runs <predicate> (command or shell function) repeatedly. While it returns
# non-zero, redraws a spinner glyph next to <label>. When it returns zero,
# replaces the spinner with ok <label>. Returns 1 on timeout (default 60s)
# and prints warn <label> (timeout).
spinner_until() {
  local predicate="$1" label="$2" timeout="${3:-60}"
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0 start elapsed
  start=$(date +%s)
  # Hide cursor on TTY to avoid blinking artifacts.
  [[ -t 1 ]] && printf '\e[?25l'
  while ! "$predicate" 2>/dev/null; do
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= timeout )); then
      [[ -t 1 ]] && printf '\r\e[2K\e[?25h'
      warn "$label (timeout after ${timeout}s)"
      return 1
    fi
    local glyph="${frames:i:1}"
    printf '\r  %s%s%s %s' "$C_CYAN" "$glyph" "$C_RESET" "$label"
    i=$(( (i + 1) % ${#frames} ))
    sleep 0.1
  done
  [[ -t 1 ]] && printf '\r\e[2K\e[?25h'
  ok "$label"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `scripts/test-ui.sh`
Expected: 9 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui.sh scripts/test-ui.sh
git commit -m "feat(scripts): add spinner_until helper to ui.sh"
```

---

### Task 1.4: Add `satellite_logo` helper

**Files:**

- Modify: `scripts/ui.sh` (append)
- Modify: `scripts/test-ui.sh` (append assertion)

- [ ] **Step 1: Write the failing test** — append to `scripts/test-ui.sh`

```bash
# --- satellite_logo ---
out="$(satellite_logo 2>&1)"
assert_contains "$out" '┌──┐'  'satellite_logo draws the solar panels'
assert_contains "$out" '◉'     'satellite_logo draws the body eye'
assert_contains "$out" '╚═╤═╝' 'satellite_logo draws the antenna base'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `scripts/test-ui.sh`
Expected: FAIL — `satellite_logo: command not found`.

- [ ] **Step 3: Write minimal implementation** — append to `scripts/ui.sh`

```bash
# ── satellite_logo ────────────────────────────────────────────────────────
# Prints the 3-line ASCII satellite used as the recurring logo across
# Makefile help, console-api banner, and (stretch) the ssa REPL banner.
satellite_logo() {
  printf '  %s┌──┐%s  %s╔═══╗%s  %s┌──┐%s\n' \
    "$C_YELLOW" "$C_RESET" "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
  printf '  %s│▓▓│%s══%s╣ %s◉%s ╠%s══%s│▓▓│%s\n' \
    "$C_YELLOW" "$C_RESET" "$C_CYAN" "$C_GREEN" "$C_CYAN" "$C_CYAN" "$C_YELLOW" "$C_RESET"
  printf '  %s└──┘%s  %s╚═╤═╝%s  %s└──┘%s\n' \
    "$C_YELLOW" "$C_RESET" "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `scripts/test-ui.sh`
Expected: 12 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui.sh scripts/test-ui.sh
git commit -m "feat(scripts): add satellite_logo helper to ui.sh"
```

---

## Chapter 2 — Makefile

### Task 2.1: Rewrite `help` target to use satellite + quick-start + grouped sections

**Files:**

- Modify: `Makefile` (replace the `help` target at the bottom)

- [ ] **Step 1: Inspect the existing `##@ Section` markers**

Run: `grep -n '^##@' Makefile`
Expected: lines like `##@ Infra`, `##@ Schema`, etc. If any are missing we will add them in the next step before rewriting `help` — but per the spec they are already in place. (If none exist, stop here, add `##@ <Name>` comments above each existing `# ── <Name> ──` block in the file, commit, then resume.)

- [ ] **Step 2: Rewrite the `help` target**

Replace the current `help` target (at the bottom of `Makefile`) with this block:

```makefile
.PHONY: help
help: ## Show this help — grouped targets and quick-start
	@bash -c '. ./scripts/ui.sh; \
	  satellite_logo; \
	  printf "\n  $${C_BOLD}Thalamus + Sweep$${C_RESET}  $${C_GRAY}·$${C_RESET} Space Situational Awareness dev environment\n\n"; \
	  printf "  $${C_BOLD}Quick start$${C_RESET}\n"; \
	  printf "    $${C_CYAN}make up$${C_RESET}        # Postgres + Redis (pgvector)\n"; \
	  printf "    $${C_CYAN}make demo$${C_RESET}      # migrate + seed ~500 satellites\n"; \
	  printf "    $${C_CYAN}make console$${C_RESET}   # UI on :5173, API on :4000\n\n"; \
	  printf "  $${C_BOLD}Targets$${C_RESET}\n"; \
	  awk '\''BEGIN {FS=":.*##"} \
	    /^##@/ { section=substr($$0,5); targets[section]=""; order[++n]=section; next } \
	    /^[a-zA-Z_-]+:.*##/ { \
	      split($$1, a, ":"); \
	      if (section != "") targets[section] = targets[section] " " a[1]; \
	    } \
	    END { \
	      for (i=1; i<=n; i++) { \
	        s=order[i]; \
	        printf "    %s▸%s %-10s%s%s%s\n", "\033[36m", "\033[0m", s, "\033[90m", targets[s], "\033[0m"; \
	      } \
	    }'\'' $(MAKEFILE_LIST); \
	  printf "\n"'
```

- [ ] **Step 3: Verify `##@` markers exist above every section; if not, add them.**

Run: `grep -n '^##@' Makefile`
Expected output: one `##@ <Name>` line per section comment (`Infra`, `Schema`, `Seed`, `Demo`, `Local LLM (Gemma 4 via llama.cpp Vulkan)`, `Console (operator UI)`, `Quality`, `Help`).

If any section is missing a marker, edit the Makefile to add `##@ <Name>` on a line by itself directly above the existing `# ── <Name> ──` comment line.

- [ ] **Step 4: Run `make` (no args) and verify visually**

Run: `make`
Expected: terminal shows satellite logo, `Quick start` block with 3 cyan commands, `Targets` block with one row per section listing each target name inline, trailing blank line. Fits within 80x24 terminal.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "feat(makefile): rewrite help with satellite logo + quick-start + grouped targets"
```

---

### Task 2.2: Convert `up` target to use `spinner_until`

**Files:**

- Modify: `Makefile` (the `up` target)

- [ ] **Step 1: Rewrite the `up` target**

Replace the current `up` recipe with:

```makefile
.PHONY: up
up: ## Start Postgres (pgvector) + Redis in background, wait until healthy
	@bash -c '. ./scripts/ui.sh; \
	  section "Infra"; \
	  docker compose up -d >/dev/null; \
	  spinner_until "docker inspect -f {{.State.Health.Status}} thalamus-postgres 2>/dev/null | grep -q healthy" "postgres (pgvector)" 60; \
	  spinner_until "docker inspect -f {{.State.Health.Status}} thalamus-redis    2>/dev/null | grep -q healthy" "redis" 60'
```

- [ ] **Step 2: Dry-run with fresh containers to verify spinner**

Run: `make nuke && make up`
Expected: `Infra` section header, then a live spinner on `postgres (pgvector)` which becomes `✓ postgres (pgvector)` when healthy, then the same sequence for `redis`.

- [ ] **Step 3: Verify idempotency (spinner collapses immediately on already-healthy)**

Run: `make up` (a second time, with services already up)
Expected: both spinners finalize to `✓` almost instantly.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(makefile): replace silent health waits in up with spinner_until"
```

---

### Task 2.3: Add header + summary to `seed` target

**Files:**

- Modify: `Makefile` (the `seed` target)

- [ ] **Step 1: Rewrite the `seed` target**

Replace the current `seed` recipe with:

```makefile
.PHONY: seed
seed: ## Seed reference tables + ~500 satellites from CelesTrak TLE
	@bash -c '. ./scripts/ui.sh; \
	  section "Seeding catalog"; \
	  step "pnpm --filter @interview/db-schema seed"; \
	  pnpm --filter @interview/db-schema seed; \
	  sats=$$(docker exec thalamus-postgres psql -U thalamus -d thalamus -tAc "select count(*) from satellites" 2>/dev/null || echo "?"); \
	  regimes=$$(docker exec thalamus-postgres psql -U thalamus -d thalamus -tAc "select count(distinct regime_id) from satellites where regime_id is not null" 2>/dev/null || echo "?"); \
	  ok "$${sats} satellites, $${regimes} regimes in catalog"'
```

- [ ] **Step 2: Run and verify**

Run: `make seed`
Expected: `Seeding catalog` section header, then the usual pnpm seed output, then a single green `✓ N satellites, M regimes in catalog` line where N and M are non-zero integers. If the queries fail (e.g., no docker), the line still prints with `?` instead of numbers — non-fatal.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(makefile): add Seeding catalog header + count summary to seed target"
```

---

### Task 2.4: Add epilogue to `demo` target

**Files:**

- Modify: `Makefile` (the `demo` target)

- [ ] **Step 1: Rewrite the `demo` target's trailing `echo` block**

Locate the current `demo` target (which chains `up migrate seed`). Replace the trailing `@echo` lines with:

```makefile
.PHONY: demo
demo: up migrate seed ## Full bring-up: infra → migrations → seeds → stop-ready
	@bash -c '. ./scripts/ui.sh; \
	  section "Next steps"; \
	  step "make console          # UI on :5173, API on :4000"; \
	  step "make thalamus-cycle   # one research cycle against the seeded catalog"; \
	  step "make ssa              # interactive SSA REPL (requires make llm-up)"'
```

- [ ] **Step 2: Run and verify**

Run: `make demo` (after `make nuke` for a clean slate, or after services are already up)
Expected: the existing up/migrate/seed output, then a `Next steps` section with 3 chevron-prefixed commands.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(makefile): add Next steps epilogue to demo target"
```

---

## Chapter 3 — console-api banner System block

### Task 3.1: Add `HealthProbeService` with Vitest coverage

**Files:**

- Create: `apps/console-api/src/services/health-probe.service.ts`
- Create: `apps/console-api/tests/unit/services/health-probe.service.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/console-api/tests/unit/services/health-probe.service.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { HealthProbeService } from "../../../src/services/health-probe.service";

type RowSet<T> = { rows: T[] };

function mockDb(queries: Record<string, unknown[]>) {
  return {
    execute: vi.fn(
      async (sql: {
        sql?: string;
        queryChunks?: Array<{ value: string[] }>;
      }) => {
        // Drizzle's `sql` template returns an object with queryChunks; for this
        // test we key on the raw SQL stored on the chunk.
        const raw =
          (sql as { sql?: string }).sql ??
          (sql.queryChunks ?? []).map((c) => c.value?.[0] ?? "").join(" ");
        const key = Object.keys(queries).find((k) => raw.includes(k));
        if (!key) throw new Error(`no mocked response for SQL: ${raw}`);
        return { rows: queries[key] } as RowSet<unknown>;
      },
    ),
  };
}

function mockRedis(pingResult: "PONG" | Error) {
  return {
    ping: vi.fn(async () => {
      if (pingResult instanceof Error) throw pingResult;
      return pingResult;
    }),
  };
}

describe("HealthProbeService", () => {
  it("returns counts + versions when every probe succeeds", async () => {
    const db = mockDb({
      "count(*)": [{ n: 500 }],
      "count(distinct regime_id)": [{ n: 37 }],
      pg_extension: [{ extversion: "0.8.0" }],
    });
    const redis = mockRedis("PONG");

    const probe = new HealthProbeService(db as never, redis as never, 29);
    const result = await probe.run();

    expect(result.postgres.ok).toBe(true);
    expect(result.postgres.pgvector).toBe("0.8.0");
    expect(result.redis.ok).toBe(true);
    expect(result.cortices).toBe(29);
    expect(result.catalog.satellites).toBe(500);
    expect(result.catalog.regimes).toBe(37);
  });

  it("returns ok=false when postgres queries throw", async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    };
    const redis = mockRedis("PONG");

    const probe = new HealthProbeService(db as never, redis as never, 29);
    const result = await probe.run();

    expect(result.postgres.ok).toBe(false);
    expect(result.catalog.satellites).toBeNull();
    expect(result.catalog.regimes).toBeNull();
    expect(result.postgres.pgvector).toBeNull();
    expect(result.redis.ok).toBe(true);
  });

  it("returns redis ok=false when ping throws", async () => {
    const db = mockDb({
      "count(*)": [{ n: 0 }],
      "count(distinct regime_id)": [{ n: 0 }],
      pg_extension: [{ extversion: "0.8.0" }],
    });
    const redis = mockRedis(new Error("redis down"));

    const probe = new HealthProbeService(db as never, redis as never, 0);
    const result = await probe.run();

    expect(result.redis.ok).toBe(false);
    expect(result.postgres.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @interview/console-api exec vitest run tests/unit/services/health-probe.service.test.ts`
Expected: FAIL — module `../../../src/services/health-probe.service` not found.

- [ ] **Step 3: Write the implementation** — `apps/console-api/src/services/health-probe.service.ts`

```typescript
/**
 * HealthProbeService — boot-time snapshot of infra + catalog state, used by
 * the console-api banner's `System` block. Every probe is wrapped in a
 * try/catch so a single failure (DB not migrated yet, Redis restart) never
 * kills the server boot; the banner falls back to `null` counts + `ok: false`
 * and a warning dot instead of a green one.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Redis from "ioredis";
import { sql } from "drizzle-orm";

export type HealthProbe = {
  postgres: { ok: boolean; pgvector: string | null };
  redis: { ok: boolean };
  cortices: number;
  catalog: { satellites: number | null; regimes: number | null };
};

export class HealthProbeService {
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly redis: Redis,
    private readonly corticesCount: number,
  ) {}

  async run(): Promise<HealthProbe> {
    const [postgres, catalog] = await Promise.all([
      this.probePostgres(),
      this.probeCatalog(),
    ]);
    const redisOk = await this.probeRedis();
    return {
      postgres,
      redis: { ok: redisOk },
      cortices: this.corticesCount,
      catalog,
    };
  }

  private async probePostgres(): Promise<HealthProbe["postgres"]> {
    try {
      const res = await this.db.execute(
        sql`select extversion from pg_extension where extname = 'vector' limit 1`,
      );
      const row = (res as { rows: Array<{ extversion?: string }> }).rows[0];
      return { ok: true, pgvector: row?.extversion ?? null };
    } catch {
      return { ok: false, pgvector: null };
    }
  }

  private async probeCatalog(): Promise<HealthProbe["catalog"]> {
    try {
      const sats = await this.db.execute(
        sql`select count(*)::int as n from satellites`,
      );
      const regs = await this.db.execute(
        sql`select count(distinct regime_id)::int as n from satellites where regime_id is not null`,
      );
      const satRow = (sats as { rows: Array<{ n?: number }> }).rows[0];
      const regRow = (regs as { rows: Array<{ n?: number }> }).rows[0];
      return {
        satellites: satRow?.n ?? null,
        regimes: regRow?.n ?? null,
      };
    } catch {
      return { satellites: null, regimes: null };
    }
  }

  private async probeRedis(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @interview/console-api exec vitest run tests/unit/services/health-probe.service.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @interview/console-api typecheck`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add apps/console-api/src/services/health-probe.service.ts \
        apps/console-api/tests/unit/services/health-probe.service.test.ts
git commit -m "feat(console-api): add HealthProbeService for boot-time system snapshot"
```

---

### Task 3.2: Wire `HealthProbeService` into `buildContainer`'s `info`

**Files:**

- Modify: `apps/console-api/src/container.ts`

- [ ] **Step 1: Import and instantiate the probe**

In `apps/console-api/src/container.ts`, add this import near the other service imports:

```typescript
import {
  HealthProbeService,
  type HealthProbe,
} from "./services/health-probe.service";
```

- [ ] **Step 2: Update the return type of `buildContainer`**

Find the current return type declaration of `buildContainer`:

```typescript
export function buildContainer(logger: FastifyBaseLogger): {
  services: AppServices;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
};
```

Replace with:

```typescript
export function buildContainer(logger: FastifyBaseLogger): {
  services: AppServices;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
  probe: () => Promise<HealthProbe>;
};
```

- [ ] **Step 3: Instantiate the probe and expose it via the return value**

Find the existing `return { services, close, info }` block at the bottom of `buildContainer`. Above it, add:

```typescript
const healthProbe = new HealthProbeService(db, redis, thalamus.registry.size());
```

Then update the return to include `probe`:

```typescript
return {
  services,
  close: async () => {
    await pool.end();
    redis.disconnect();
  },
  info: {
    databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
    redisUrl,
    cortices: thalamus.registry.size(),
  },
  probe: () => healthProbe.run(),
};
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @interview/console-api typecheck`
Expected: exits 0.

- [ ] **Step 5: Run the existing test suite to catch fallout**

Run: `pnpm --filter @interview/console-api test`
Expected: all existing tests pass (no behavioral change to existing paths).

- [ ] **Step 6: Commit**

```bash
git add apps/console-api/src/container.ts
git commit -m "feat(console-api): expose HealthProbeService via container.probe"
```

---

### Task 3.3: Render a `System` block in `printBanner`

**Files:**

- Modify: `apps/console-api/src/server.ts`

- [ ] **Step 1: Extend `AppHandle` to carry the probe result**

In `apps/console-api/src/server.ts`, update the `AppHandle` type:

```typescript
import type { HealthProbe } from "./services/health-probe.service";

export type AppHandle = {
  app: FastifyInstance;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
  probe: HealthProbe;
};
```

- [ ] **Step 2: Update `createApp` to call `container.probe()` and include it in the return**

In `createApp`, find the block:

```typescript
const container = buildContainer(app.log);
registerAllRoutes(app, container.services);
return {
  app,
  info: container.info,
  close: async () => {
    await app.close();
    await container.close();
  },
};
```

Replace with:

```typescript
const container = buildContainer(app.log);
registerAllRoutes(app, container.services);
const probe = await container.probe();
return {
  app,
  info: container.info,
  probe,
  close: async () => {
    await app.close();
    await container.close();
  },
};
```

- [ ] **Step 3: Update `startServer` to pass `probe` to `printBanner`**

In `startServer`:

```typescript
  const { app, close, info, probe } = await createApp();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  printBanner(boundPort, info, probe);
  return { app, port: boundPort, close, info, probe };
}
```

- [ ] **Step 4: Update `ServerHandle` type to include `probe`**

```typescript
export type ServerHandle = AppHandle & { port: number };
```

Already compatible — no change needed.

- [ ] **Step 5: Extend `printBanner` signature + add the System block**

Find the current `printBanner(port, info)` signature:

```typescript
function printBanner(port: number, info: { databaseUrl: string; redisUrl: string; cortices: number }): void {
```

Change to:

```typescript
function printBanner(
  port: number,
  info: { databaseUrl: string; redisUrl: string; cortices: number },
  probe: HealthProbe,
): void {
```

Inside `printBanner`, after the `cfg` array and before the `hints` array, add:

```typescript
const dot = (ok: boolean) => `${ok ? g : C.red}●${r}`;
const pgVer = probe.postgres.pgvector ?? "—";
const sats = probe.catalog.satellites ?? "—";
const regimes = probe.catalog.regimes ?? "—";
const system = [
  `  ${b}System${r}`,
  `    ${dot(probe.postgres.ok)} postgres    ${info.databaseUrl.replace(/^postgres:\/\/[^/]+\//, "").padEnd(22)} ${gr}pgvector ${pgVer}${r}`,
  `    ${dot(probe.redis.ok)} redis       ${info.redisUrl.replace(/^redis:\/\//, "").padEnd(22)}`,
  `    ${dot(true)} cortices    ${String(probe.cortices).padEnd(22)} ${gr}loaded${r}`,
  `    ${dot(probe.postgres.ok)} catalog     ${String(sats).padEnd(22)} ${gr}${regimes} regimes${r}`,
];
```

Then update the final `process.stdout.write` call to include the system block:

```typescript
process.stdout.write(
  header.join("\n") +
    "\n\n" +
    cfg.join("\n") +
    "\n\n" +
    system.join("\n") +
    "\n\n" +
    hints.join("\n") +
    "\n\n",
);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @interview/console-api typecheck`
Expected: exits 0.

- [ ] **Step 7: Smoke-test end to end**

Run, in a terminal where Postgres + Redis are up (e.g., after `make up`):

```
pnpm --filter @interview/console-api dev
```

Expected: animated satellite → banner with `System` block showing `● postgres`, `● redis`, `● cortices`, `● catalog` — all green dots when infra is healthy; curl hints follow.

Run a curl to verify normal request logging still works:

```
curl -s localhost:4000/api/cycles -o /dev/null -w "%{http_code}\n"
```

Expected: `200`, and the server terminal prints `200 GET    /api/cycles <duration>`.

- [ ] **Step 8: Run the full console-api test suite**

Run: `pnpm --filter @interview/console-api test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/console-api/src/server.ts
git commit -m "feat(console-api): render System block in boot banner from HealthProbe"
```

---

## Chapter 4 (stretch) — ssa REPL banner

Execute only if chapters 1-3 passed and there is remaining budget. If skipped, that's fine — the spec flags it as stretch.

### Task 4.1: Locate the ssa REPL entry

**Files:**

- Inspect: `packages/thalamus/src/` (find the file that exports the `ssa` CLI)

- [ ] **Step 1: Find the ssa entry**

Run: `grep -rn '"ssa"' packages/thalamus/package.json`
Then: `cat packages/thalamus/package.json | grep -A1 '"ssa"'`
Expected: identifies the script target (e.g., `tsx src/cli/ssa.ts` or similar).

- [ ] **Step 2: Open the file and confirm it has a clear "startup" section**

Read the identified file. Confirm there is a line where the process starts accepting input (usually a `readline.createInterface` or similar). The banner will print immediately before that line.

Do not commit anything this task — it's pure discovery.

---

### Task 4.2: Print a static banner at ssa REPL startup

**Files:**

- Modify: the file found in Task 4.1 (e.g., `packages/thalamus/src/cli/ssa.ts`).

- [ ] **Step 1: Add a banner function**

In the ssa entry file, add this function near the top (adjust the import path for `C_*` — we mirror the palette inline to keep the package free of the `scripts/ui.sh` dependency):

```typescript
function printSsaBanner(cortices: number): void {
  const y = "\x1b[33m",
    c = "\x1b[36m",
    g = "\x1b[32m",
    gr = "\x1b[90m",
    b = "\x1b[1m",
    r = "\x1b[0m";
  const lines = [
    ``,
    `  ${y}┌──┐${r}  ${c}╔═══╗${r}  ${y}┌──┐${r}`,
    `  ${y}│▓▓│${c}══╣ ${g}◉${c} ╠══${y}│▓▓│${r}   ${b}${c}thalamus ssa${r} ${gr}·${r} ${g}ready${r}`,
    `  ${y}└──┘${r}  ${c}╚═╤═╝${r}  ${y}└──┘${r}   ${gr}${cortices} cortices loaded · type a query or 'help'${r}`,
    ``,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}
```

- [ ] **Step 2: Call `printSsaBanner` just before the REPL input loop starts**

At the point identified in Task 4.1 (immediately before `readline` begins consuming input), insert:

```typescript
printSsaBanner(registry.size());
```

Where `registry` is the cortex registry used by the REPL. If the symbol is named differently (e.g., `cortexRegistry`, `skillRegistry`), adapt.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @interview/thalamus typecheck`
Expected: exits 0.

- [ ] **Step 4: Manual verification**

Run: `make ssa` (or `pnpm --filter @interview/thalamus ssa`)
Expected: satellite banner prints once, REPL prompt appears below it normally. No duplicate prints on subsequent prompts.

- [ ] **Step 5: Commit**

```bash
git add packages/thalamus/src/cli/ssa.ts   # adjust path per Task 4.1 discovery
git commit -m "feat(thalamus): add static satellite banner to ssa REPL"
```

---

## Final checkpoint

- [ ] **Step 1: Full suite**

Run: `pnpm test && pnpm -r typecheck`
Expected: every project's tests green, typecheck clean across the workspace.

- [ ] **Step 2: Visual walkthrough**

Run, in order, in a fresh terminal:

```bash
make nuke
make
make up
make seed
make console-api   # in a second terminal, optional
```

Expected at each step:

- `make` — satellite logo + quick-start + grouped targets, fits 80x24.
- `make up` — `Infra` header, two live spinners that become `✓`.
- `make seed` — `Seeding catalog` header, pnpm seed output, `✓ N satellites, M regimes in catalog`.
- `make console-api` — animated satellite, banner with System block (4 green dots), Try-this hints.

- [ ] **Step 3: Final commit (only if any last touch-ups were made)**

```bash
git add -A
git commit -m "chore: final polish on make onboarding experience"
```
