# Kubernetes manifests

Plain YAML + a top-level `kustomization.yaml`. No overlays yet — add
`overlays/{dev,prod}/` when you need per-env differences.

## Layout

| File                  | Role                                                |
| --------------------- | --------------------------------------------------- |
| `namespace.yaml`      | `thalamus` namespace                                |
| `configmap.yaml`      | Non-secret env for `console-api`                    |
| `secret.example.yaml` | Secret template (DB URL, LLM keys) — copy, fill     |
| `postgres.yaml`       | `pgvector/pgvector:pg16` StatefulSet + headless svc |
| `redis.yaml`          | Redis 7 StatefulSet + headless svc                  |
| `console-api.yaml`    | Fastify API Deployment + Service + HPA + PDB        |
| `console.yaml`        | Vite → nginx SPA Deployment + Service               |
| `ingress.yaml`        | nginx Ingress — `/api` → api, `/` → console         |
| `networkpolicy.yaml`  | Default-deny + allowlist between tiers              |
| `k6-job.yaml`         | In-cluster load test Job (reads `k6-scripts` CM)    |

## Build images

```bash
# api
docker build -t ghcr.io/thalamus/console-api:$(git rev-parse --short HEAD) \
  -f infra/docker/console-api.Dockerfile .

# console (SPA)
docker build -t ghcr.io/thalamus/console:$(git rev-parse --short HEAD) \
  -f infra/docker/console.Dockerfile .
```

Then pin the tag via `kustomize edit set image` or edit `kustomization.yaml`.

## Deploy

```bash
# one-time: real secret
cp infra/k8s/secret.example.yaml infra/k8s/secret.yaml
$EDITOR infra/k8s/secret.yaml

# one-time: pg init SQL
kubectl create ns thalamus --dry-run=client -o yaml | kubectl apply -f -
kubectl -n thalamus create configmap postgres-init \
  --from-file=init.sql=infra/postgres/init.sql \
  --dry-run=client -o yaml | kubectl apply -f -

# apply everything
kubectl apply -k infra/k8s

# watch rollout
kubectl -n thalamus rollout status deploy/console-api
kubectl -n thalamus rollout status deploy/console
```

## Load-test the cluster

```bash
kubectl -n thalamus create configmap k6-scripts \
  --from-file=infra/k6/scripts/ \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n thalamus apply -f infra/k8s/k6-job.yaml
kubectl -n thalamus logs -f job/k6-load
```

## Production hardening to add when needed

- Swap `secret.example.yaml` for External Secrets / Sealed Secrets / SOPS.
- Add cert-manager + TLS block in `ingress.yaml`.
- Add `ServiceMonitor` (Prometheus Operator) targeting port `9464`.
- Replace the single Postgres StatefulSet with CloudNativePG / an RDS
  reference, and drop the in-cluster `postgres.yaml`.
- Add `PriorityClass` + anti-affinity rules once the cluster has >1 node.
