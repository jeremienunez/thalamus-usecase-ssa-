#!/usr/bin/env bash
# Usage: scripts/test-ui.sh
# Exits 0 on success, non-zero on failure. Prints a summary.
set -u

# Force color so assertions are testable in non-TTY CI / tool environments.
export FORCE_COLOR=1

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

# --- status helpers ---
out="$(ok 'postgres ready' 2>&1)";    assert_contains "$out" '✓' 'ok uses check glyph'
out="$(ok 'postgres ready' 2>&1)";    assert_contains "$out" 'postgres ready' 'ok carries the message'
out="$(warn 'slow response' 2>&1)";   assert_contains "$out" '⚠' 'warn uses warning glyph'
out="$(fail 'redis down' 2>&1)";      assert_contains "$out" '✗' 'fail uses cross glyph'
out="$(step 'seeding' 2>&1)";         assert_contains "$out" '›' 'step uses chevron glyph'

echo
echo "  ${pass_count} passed, ${fail_count} failed"
[[ "$fail_count" -eq 0 ]]
