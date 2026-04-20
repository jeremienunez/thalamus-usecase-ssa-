#!/usr/bin/env bash
# Thin wrapper around `kubeseal` for this repo.
#
#   ./seal.sh console-api-secrets < plain-secret.yaml > sealed-secret.yaml
#   ./seal.sh rclone-config       < plain-secret.yaml > sealed-rclone.yaml
#
# Prereqs:
#   - sealed-secrets controller installed in kube-system (see README.md)
#   - `kubeseal` CLI on your PATH
#
# Flow: you write a normal `Secret` on disk (never committed), pipe through
# kubeseal, and commit the resulting `SealedSecret` — which only the
# in-cluster controller can decrypt. Rotation = re-seal against the fresh
# public key.
set -euo pipefail

NAME="${1:?usage: seal.sh <secret-name> < plain.yaml > sealed.yaml}"
NS="${NS:-thalamus}"
CONTROLLER_NS="${CONTROLLER_NS:-kube-system}"
CONTROLLER_NAME="${CONTROLLER_NAME:-sealed-secrets-controller}"

exec kubeseal \
  --controller-namespace="$CONTROLLER_NS" \
  --controller-name="$CONTROLLER_NAME" \
  --format yaml \
  --namespace "$NS" \
  --name "$NAME"
