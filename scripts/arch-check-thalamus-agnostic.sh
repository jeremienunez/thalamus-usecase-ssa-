#!/usr/bin/env bash
#
# arch-check-thalamus-agnostic.sh
#
# Fail if SSA-specific vocabulary appears in CODE (not comments) anywhere
# under packages/thalamus/src. Comments (// line, /* block */, and
# /** JSDoc */) are stripped before matching — the kernel may still mention
# SSA as a pedagogical example in docstrings without violating the guard.
#
# The vocabulary list is narrow on purpose. It targets concrete SSA markers
# that can only leak from the app layer (entity types, operator tokens,
# known constellation brand names). Business-generic English nouns like
# "operator" or "fleet" alone are deliberately NOT in this list — see
# memory rule "base agnostique pas absente": the kernel should be
# domain-agnostic without being domain-mute.
#
# Exit codes:
#   0 — clean, no leaks
#   1 — one or more files contain SSA vocabulary in code
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT/packages/thalamus/src"

if [ ! -d "$TARGET_DIR" ]; then
  echo "ERROR: $TARGET_DIR not found" >&2
  exit 2
fi

# SSA vocab regex. \b word boundaries keep "operator_country" from matching
# "operator" alone (we tolerate the generic English noun).
VOCAB='\b(satellite|operator_country|conjunction_analysis|fleet_analyst|NORAD|COSPAR|regime_profiler|opacity_scout|Starlink|Intelsat|OneWeb)\b'

violations=""

while IFS= read -r -d '' file; do
  # Strip block comments (/* ... */, including multi-line JSDoc) then
  # line comments (// ...), then grep on the remaining code.
  stripped="$(awk '
    BEGIN { in_block = 0 }
    {
      line = $0
      out = ""
      while (length(line) > 0) {
        if (in_block) {
          end = index(line, "*/")
          if (end == 0) { line = ""; break }
          line = substr(line, end + 2)
          in_block = 0
        } else {
          start = index(line, "/*")
          if (start == 0) { out = out line; line = "" }
          else {
            out = out substr(line, 1, start - 1)
            line = substr(line, start + 2)
            in_block = 1
          }
        }
      }
      # Strip // line comments on the remaining (non-block) code.
      pos = index(out, "//")
      if (pos > 0) out = substr(out, 1, pos - 1)
      print out
    }
  ' "$file")"

  if echo "$stripped" | grep -Eq "$VOCAB"; then
    hits="$(echo "$stripped" | grep -En "$VOCAB" || true)"
    violations+="${file}:\n${hits}\n\n"
  fi
done < <(find "$TARGET_DIR" -name "*.ts" -print0)

if [ -n "$violations" ]; then
  echo "ERROR: SSA vocabulary found in packages/thalamus/src (code, not comments):" >&2
  printf "%b" "$violations" >&2
  echo "See plan 2026-04-19-thalamus-agnosticity-cleanup.md — kernel stays agnostic." >&2
  exit 1
fi

echo "OK: thalamus-kernel agnosticity clean (no SSA vocabulary in code)"
