# Test organization

Repo-wide policy lives in [`docs/testing/README.md`](../../../docs/testing/README.md):
tests must prove expected behavior at the correct seam. `todo`, `skip`, and
vague placeholder assertions are CI violations.

Tests follow a classic testing pyramid:

```
          ┌────────────┐
          │    e2e     │   app + transport via globalSetup, real DB + Redis
          ├────────────┤
          │integration │   repo wiring against real Postgres, no HTTP
          ├────────────┤
          │   unit     │   50+ tests — pure functions, no I/O, parallel-safe
          └────────────┘
```

## `tests/unit/` (base — largest, fastest)

Pure-function tests. No database, no network, no server boot.
Convention: `.test.ts` extension.

- `unit/utils/` — server-only helpers (asyncHandler, regex matchers, field whitelists).
- `unit/transformers/` — row → DTO shaping functions. These are the most-tested layer because every service delegates its mapping here.
- `unit/services/` — service-level tests that mock repositories (still pure, no real DB).

## `tests/integration/` (middle — requires infra)

Tests that hit real Postgres (or Redis), but stay below the HTTP layer.
Convention: `.spec.ts` extension. Requires `DATABASE_URL` reachable.

- `integration/repositories/` — repo methods against a live DB (verifies SQL correctness).

For Postgres-backed repository specs, use
`tests/integration/_harness.ts`. It provisions a migrated ephemeral database
per spec file and resets the public schema between tests. Avoid local
hand-crafted temp-table schemas; they drifted from production and were the main
source of false-green integration tests.

## `tests/e2e/` (top — smallest, slowest)

Full HTTP surface via `startServer(0)` on an ephemeral port. Tests the whole stack.
Convention: `.spec.ts` extension.

`setup.ts` is vitest's global setup: it boots the real Fastify app and exposes
the ephemeral port via `CONSOLE_API_URL`. Every e2e spec fetches against that URL.

## Running

```bash
# root layer scripts
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# repo-wide union run
pnpm test
```

`pnpm test:integration` and `pnpm test:e2e` require a live Postgres at
`DATABASE_URL`. `pnpm test:e2e` also requires Redis at `REDIS_URL`.

Apply the test DB migrations before those layers:

```bash
pnpm tsx scripts/test-db-migrate.ts
```
