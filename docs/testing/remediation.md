# Test Remediation Notes

This file records explicit remediation decisions where a test gap is known and
documented, instead of being silently implied by an over-optimistic SP status.

## NanoSwarm

Status: covered.

Decision:
- The old placeholder gap is closed by
  `packages/thalamus/tests/nano-swarm.spec.ts`.
- Coverage now lives under SP-3 because the gap belongs to the explorer slice,
  not to the narrow SP-2 thalamus false-green cleanup.

Reason:
- `NanoSwarm` has a real public API and warranted a dedicated contract once the
  SSA explorer rewrite widened beyond console-api-only unit tests.
- The shipped spec covers decomposition bounds, URL normalization + dedup,
  markdown stripping before extraction, synthetic `nano://` article creation,
  and swarm stats.

## UserFleetRepository

Status: explicitly excluded from SP-4 coverage.

Decision:
- `apps/console-api/src/repositories/user-fleet.repository.ts` is not counted as
  "covered" in SP-4.
- No fake temp-table integration spec was added for it.

Reason:
- The repo depends on `fleet`, `watchlist`, and `safe_mission_window`, none of
  which exist in the migrated production schema.
- It is also not wired into the current runtime route / service graph.
- Adding a fixture-only spec for it would recreate the exact integration-test
  mirage SP-4 removed from the rest of the repository layer.
