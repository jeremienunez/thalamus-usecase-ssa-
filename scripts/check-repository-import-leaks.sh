#!/usr/bin/env bash
set -euo pipefail

pattern="from ['\"][^'\"]*repositories?/|import\\(['\"][^'\"]*repositories?/"
status=0

service_hits="$(rg "$pattern" apps packages -g '*service.ts' -g '*/services/*.ts' -n || true)"
if [[ -n "$service_hits" ]]; then
  echo "Service files must depend on ports/types, not repositories:"
  echo "$service_hits"
  status=1
fi

test_hits="$(
  rg "$pattern" apps packages -g '*.{test,spec}.ts' -n \
    | awk -F: '$1 !~ /\/tests\/integration\/repositories\// && $1 !~ /(^|\/)[^\/]*repository[^\/]*\.(test|spec)\.ts$/ { print }' \
    || true
)"
if [[ -n "$test_hits" ]]; then
  echo "Non-repository tests must use ports/types, not concrete repositories:"
  echo "$test_hits"
  status=1
fi

exit "$status"
