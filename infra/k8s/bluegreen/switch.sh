#!/usr/bin/env bash
# Blue/green cutover helper.
#
#   ./switch.sh status              # show which color is live / idle
#   ./switch.sh prepare green v1.9  # scale green up on the new image, wait ready
#   ./switch.sh smoke green         # run smoke test against the preview Service
#   ./switch.sh cutover green       # flip live Service selector -> green
#   ./switch.sh finalize blue       # scale the *old* color down once stable
#   ./switch.sh rollback            # read previous color from annotation, flip back
#
# Assumes kubectl is configured for the right cluster/namespace.
set -euo pipefail

NS="${NS:-thalamus}"
APP="${APP:-console-api}"
LIVE_SVC="$APP"
PREVIEW_SVC="${APP}-preview"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
  echo "error: $*" >&2
  exit 1
}

current_color() {
  kubectl -n "$NS" get svc "$LIVE_SVC" -o jsonpath='{.spec.selector.color}'
}

other_color() {
  case "$1" in blue) echo green ;; green) echo blue ;; *) die "bad color $1" ;; esac
}

image_tag_for() {
  local color="$1" deploy="${APP}-${color}"
  kubectl -n "$NS" get deploy "$deploy" -o jsonpath='{.spec.template.spec.containers[0].image}'
}

cmd_status() {
  local live idle
  live="$(current_color)"
  idle="$(other_color "$live")"
  echo "live   : $live ($(image_tag_for "$live"))"
  echo "idle   : $idle ($(image_tag_for "$idle"))"
  echo
  kubectl -n "$NS" get deploy -l app="$APP" -o wide
}

cmd_prepare() {
  local color="${1:?usage: prepare <color> [image-tag]}" tag="${2:-}"
  local deploy="${APP}-${color}"
  if [[ -n "$tag" ]]; then
    kubectl -n "$NS" set image "deploy/$deploy" "api=ghcr.io/thalamus/$APP:$tag"
  fi
  kubectl -n "$NS" scale "deploy/$deploy" --replicas=2
  kubectl -n "$NS" rollout status "deploy/$deploy" --timeout=5m
  echo "✓ $deploy ready at $(image_tag_for "$color")"
}

cmd_smoke() {
  local color="${1:?usage: smoke <color>}"
  # Run smoke via a temporary pod against the preview Service (always idle).
  local target
  if [[ "$color" == "$(current_color)" ]]; then
    target="$LIVE_SVC"
  else
    target="$PREVIEW_SVC"
  fi
  echo "smoke target: $target ($color)"
  kubectl -n "$NS" run "k6-smoke-$RANDOM" --rm -i --restart=Never \
    --image=grafana/k6:0.54.0 \
    --overrides='{"spec":{"containers":[{"name":"k6","image":"grafana/k6:0.54.0","stdin":true,"tty":false,"args":["run","-"]}]}}' \
    --env="BASE_URL=http://${target}:4000" \
    <"${SCRIPTS_DIR}/../../k6/scripts/smoke.js"
}

cmd_cutover() {
  local to="${1:?usage: cutover <color>}"
  local from
  from="$(current_color)"
  [[ "$to" != "$from" ]] || die "already live on $to"
  # Annotate so rollback knows where to go back.
  kubectl -n "$NS" annotate svc "$LIVE_SVC" \
    bluegreen.thalamus/previous-color="$from" \
    bluegreen.thalamus/cutover-at="$(date -Iseconds)" --overwrite
  kubectl -n "$NS" patch svc "$LIVE_SVC" --type=merge \
    -p "{\"spec\":{\"selector\":{\"app\":\"$APP\",\"color\":\"$to\"}}}"
  kubectl -n "$NS" patch svc "$PREVIEW_SVC" --type=merge \
    -p "{\"spec\":{\"selector\":{\"app\":\"$APP\",\"color\":\"$from\"}}}"
  echo "✓ cutover $from -> $to"
}

cmd_finalize() {
  local old="${1:?usage: finalize <old-color>}"
  [[ "$old" != "$(current_color)" ]] || die "$old is still live; refusing to scale down"
  kubectl -n "$NS" scale "deploy/${APP}-${old}" --replicas=0
  echo "✓ ${APP}-${old} scaled to 0"
}

cmd_rollback() {
  local prev
  prev="$(kubectl -n "$NS" get svc "$LIVE_SVC" -o jsonpath='{.metadata.annotations.bluegreen\.thalamus/previous-color}' 2>/dev/null || true)"
  [[ -n "$prev" ]] || die "no previous-color annotation; nothing to roll back to"
  cmd_prepare "$prev" # ensure the old color is running before we flip
  cmd_cutover "$prev"
}

main() {
  local cmd="${1:-status}"
  shift || true
  case "$cmd" in
    status) cmd_status "$@" ;;
    prepare) cmd_prepare "$@" ;;
    smoke) cmd_smoke "$@" ;;
    cutover) cmd_cutover "$@" ;;
    finalize) cmd_finalize "$@" ;;
    rollback) cmd_rollback "$@" ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
