# Blue/Green deployment

Two full stacks of `console-api` (`blue` + `green`) live side by side. A
single Service (`console-api`) picks the live one via `selector.color`.
Cutover = `kubectl patch` on that selector — instant, reversible.

## Files

| File                     | Role                                                     |
| ------------------------ | -------------------------------------------------------- |
| `services.yaml`          | Live + preview Services (color selector is the "switch") |
| `console-api-blue.yaml`  | Blue Deployment + PDB                                    |
| `console-api-green.yaml` | Green Deployment + PDB (replicas=0 while idle)           |
| `switch.sh`              | Status / prepare / smoke / cutover / finalize / rollback |
| `rollout.argo.yaml`      | Optional: Argo Rollouts variant with automated analysis  |
| `canary-ingress.yaml`    | Optional: ingress-nginx weighted canary                  |
| `kustomization.yaml`     | Overlay that swaps the root console-api for blue/green   |

## Apply

```bash
# replaces the single console-api Deployment/Service with the pair.
# --load-restrictor=LoadRestrictionsNone is required because the overlay
# pulls sibling files from ../ — kustomize forbids this by default.
kubectl kustomize --load-restrictor=LoadRestrictionsNone infra/k8s/bluegreen \
  | kubectl apply -f -
```

## Release procedure

```bash
cd infra/k8s/bluegreen

./switch.sh status                    # which color is live?
./switch.sh prepare green v1.9.0      # pull the new image into the idle color

# Apply schema migrations BEFORE smoke — green will hit the new schema.
# Idempotent; safe to re-run on retries.
kubectl -n thalamus delete job/migrate-schema --ignore-not-found
sed "s|:latest|:v1.9.0|" ../migration-job.yaml | kubectl apply -f -
kubectl -n thalamus wait --for=condition=complete job/migrate-schema --timeout=10m

./switch.sh smoke   green             # k6 smoke against console-api-preview
./switch.sh cutover green             # flip live Service selector -> green
./switch.sh finalize blue             # scale blue to 0 once green is stable
# ...or if something went wrong after cutover:
./switch.sh rollback                  # reads annotation, flips back
```

`cutover` writes `bluegreen.thalamus/previous-color` +
`bluegreen.thalamus/cutover-at` annotations on the live Service, so
`rollback` is deterministic.

## What's handled

- Zero-downtime flip (selector patch is atomic from the Service's view).
- Pre-cutover validation against the idle pool via `console-api-preview`.
- Instant rollback while the old pool is still warm.
- PDB on both colors so node drains don't kill the live pool.
- HPA: inherited from the root `console-api.yaml` — note it targets the
  parent `console-api` Deployment name, so if you use _this_ overlay you
  should either remove that HPA or duplicate it per color.

## What you still have to handle at the app layer

1. **DB migrations must be expand/contract.** Green must run against the
   blue-shaped schema. Add columns/tables first, deploy, backfill, then
   drop old columns in a _later_ release. `drizzle-kit` migrations should
   never be breaking within a single cutover window.
2. **In-flight SSE / LLM streams** keep their existing connection on the
   old color until it closes — that's expected; clients reconnect to the
   new color. Make sure the UI handles reconnect.
3. **Redis keys** used by both colors must stay backward-compatible for
   one release. Version the keys when the shape changes.
4. **Queue consumers** (sim jobs, ingestion) — make sure the old color
   drains before `finalize`. `kubectl -n thalamus wait --for=condition=...`
   on your in-flight-jobs metric before scaling to 0.

## Progressive delivery upgrade path

- `rollout.argo.yaml` — swap to Argo Rollouts when you want automatic
  promotion gated on Prometheus success-rate analysis. Same topology,
  just managed by the controller. Install:
  ```bash
  kubectl create ns argo-rollouts
  kubectl apply -n argo-rollouts \
    -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
  ```
- `canary-ingress.yaml` — ingress-nginx weighted shift (10 → 25 → 50 → 100)
  as a lighter alternative when blue/green is overkill.
       docker-compose.ym…)
  ⎿     2 |