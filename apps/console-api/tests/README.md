# Test organization

Tests follow a classic testing pyramid:

```
          ┌────────────┐
          │    e2e     │   4 specs — real HTTP via startServer, real DB + Redis
          ├────────────┤
          │integration │   1 spec  — repos against real Postgres, no HTTP
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

## `tests/e2e/` (top — smallest, slowest)

Full HTTP surface via `startServer(0)` on an ephemeral port. Tests the whole stack.
Convention: `.spec.ts` extension.

`setup.ts` is vitest's global setup: it boots the real Fastify app and exposes
the ephemeral port via `CONSOLE_API_URL`. Every e2e spec fetches against that URL.

## Running

```bash
# all tests (unit + integration + e2e, sequential in a single fork)
pnpm exec vitest run

# just one layer
pnpm exec vitest run tests/unit
pnpm exec vitest run tests/integration
pnpm exec vitest run tests/e2e
```
