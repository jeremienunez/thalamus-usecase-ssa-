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

if [[ -t 1 || "${FORCE_COLOR:-0}" == "1" ]]; then
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

# ── Status glyphs ─────────────────────────────────────────────────────────
# step/ok/warn/fail each print one aligned line: "<glyph> <message>".
step() { printf '  %s›%s %s\n' "$C_GRAY"   "$C_RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '  %s✗%s %s\n' "$C_RED"    "$C_RESET" "$*"; }
