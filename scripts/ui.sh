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
  while ! eval "$predicate" >/dev/null 2>&1; do
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

# ── satellite_logo ────────────────────────────────────────────────────────
# Prints the 3-line ASCII satellite logo. The raw glyph layout lives in
# scripts/ui/satellite.txt (shared single source of truth with the
# console-api banner) — this function reads it and applies colors:
#   yellow for the solar panels (┌──┐, │▓▓│, └──┘)
#   cyan for the bus and antenna (╔═══╗, ╣…╠, ╚═╤═╝)
#   green for the body eye (◉)
satellite_logo() {
  local here file
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  file="$here/ui/satellite.txt"
  # sed applies per-glyph colors. Order matters: color ◉ before coloring ╣/╠.
  sed \
    -e "s/◉/${C_GREEN}◉${C_CYAN}/g" \
    -e "s/┌──┐/${C_YELLOW}┌──┐${C_RESET}/g" \
    -e "s/└──┘/${C_YELLOW}└──┘${C_RESET}/g" \
    -e "s/│▓▓│/${C_YELLOW}│▓▓│${C_RESET}/g" \
    -e "s/╔═══╗/${C_CYAN}╔═══╗${C_RESET}/g" \
    -e "s/╚═╤═╝/${C_CYAN}╚═╤═╝${C_RESET}/g" \
    -e "s/╣/${C_CYAN}╣/g; s/╠/╠${C_RESET}/g" \
    -e "s/^/  /" \
    "$file"
}
