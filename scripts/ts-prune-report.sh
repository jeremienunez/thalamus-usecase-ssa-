#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPORT_DIR=".reports/ts-prune"
RAW_REPORT="$REPORT_DIR/raw.txt"
UNIQUE_REPORT="$REPORT_DIR/unique.txt"
FILTERED_REPORT="$REPORT_DIR/filtered.txt"
MODULE_ONLY_REPORT="$REPORT_DIR/module-only.txt"
PUBLIC_SURFACE_REPORT="$REPORT_DIR/public-surface.txt"
LIKELY_DEAD_REPORT="$REPORT_DIR/likely-dead.txt"
SUMMARY_REPORT="$REPORT_DIR/summary.txt"

mkdir -p "$REPORT_DIR"
: > "$RAW_REPORT"

CONFIGS=(
  "apps/console-api/tsconfig.json"
  "apps/console/tsconfig.json"
  "packages/cli/tsconfig.json"
  "packages/db-schema/tsconfig.json"
  "packages/shared/tsconfig.json"
  "packages/sweep/tsconfig.json"
  "packages/test-kit/tsconfig.json"
  "packages/thalamus/tsconfig.json"
)

IGNORE_PATTERN='(^|/)(tests?|__tests__|fixtures)(/|$)'

for config in "${CONFIGS[@]}"; do
  {
    echo "## $config"
    pnpm exec ts-prune -p "$config" --ignore "$IGNORE_PATTERN" || true
    echo
  } >> "$RAW_REPORT"
done

grep ' - ' "$RAW_REPORT" | sort -u > "$UNIQUE_REPORT" || true
grep '(used in module)' "$UNIQUE_REPORT" > "$MODULE_ONLY_REPORT" || true

# Package entrypoints, shared DTO contracts, adapter/provider contexts, config
# surfaces, and observability registries are deliberate public seams. Keep them
# out of the "likely dead" view so the report focuses on local orphans.
grep -E \
  '(^|/)(src/)?index\.ts:|^apps/console/vite\.config\.ts:|(^|/)(dto|observability|config)/|(^|/)(middleware|providers?)/|(^|/)adapters/.+Context\.tsx:|(^|/)ports/|(^|/)transports/providers/' \
  "$UNIQUE_REPORT" > "$PUBLIC_SURFACE_REPORT" || true

grep -vE \
  '(^|/)(src/)?index\.ts:|^apps/console/vite\.config\.ts:|(^|/)(dto|observability|config)/|(^|/)(middleware|providers?)/|(^|/)adapters/.+Context\.tsx:|(^|/)ports/|(^|/)transports/providers/|used in module' \
  "$UNIQUE_REPORT" > "$LIKELY_DEAD_REPORT" || true

cp "$LIKELY_DEAD_REPORT" "$FILTERED_REPORT"

raw_hits="$(grep -c ' - ' "$UNIQUE_REPORT" || true)"
module_only_hits="$(grep -c ' - ' "$MODULE_ONLY_REPORT" || true)"
public_surface_hits="$(grep -c ' - ' "$PUBLIC_SURFACE_REPORT" || true)"
filtered_hits="$(grep -c ' - ' "$LIKELY_DEAD_REPORT" || true)"
total_exports="$(
  rg -n '^[[:space:]]*export[[:space:]]+' \
    apps packages \
    --glob '!**/*.test.*' \
    --glob '!**/*.spec.*' \
    --glob '!**/tests/**' \
    --glob '!**/__tests__/**' \
    --glob '!**/fixtures/**' \
    | wc -l | tr -d ' '
)"

raw_pct="$(awk -v hits="$raw_hits" -v total="$total_exports" 'BEGIN { if (total == 0) printf "0.00"; else printf "%.2f", (hits / total) * 100 }')"
filtered_pct="$(awk -v hits="$filtered_hits" -v total="$total_exports" 'BEGIN { if (total == 0) printf "0.00"; else printf "%.2f", (hits / total) * 100 }')"

cat > "$SUMMARY_REPORT" <<EOF
ts-prune summary
================
total exported declarations (proxy): $total_exports
raw unique unused-export candidates: $raw_hits
raw candidate ratio: $raw_pct%
module-only exports (visibility cleanup, not dead code): $module_only_hits
public-surface candidates filtered out conservatively: $public_surface_hits
likely-dead internal candidates: $filtered_hits
likely-dead candidate ratio: $filtered_pct%

Reports:
- $RAW_REPORT
- $UNIQUE_REPORT
- $MODULE_ONLY_REPORT
- $PUBLIC_SURFACE_REPORT
- $LIKELY_DEAD_REPORT
EOF

cat "$SUMMARY_REPORT"
