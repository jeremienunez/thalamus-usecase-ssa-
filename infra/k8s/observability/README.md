# Observability

Stack: **Prometheus + Alertmanager + Grafana + Loki + Promtail**, via two Helm
charts. Everything lives in the `monitoring` namespace and scrapes
`thalamus/console-api` through a `ServiceMonitor`.

## Install

```bash
kubectl create ns monitoring

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana              https://grafana.github.io/helm-charts
helm repo update

helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f infra/k8s/observability/kube-prometheus-stack.values.yaml

helm upgrade --install loki grafana/loki-stack \
  -n monitoring \
  -f infra/k8s/observability/loki-stack.values.yaml

kubectl apply -f infra/k8s/observability/servicemonitor.yaml
kubectl apply -f infra/k8s/observability/grafana-dashboard.yaml
```

`metrics-server` for HPA is bundled inside `kube-prometheus-stack` via
`kube-state-metrics` / `nodeExporter`; if your distro doesn't ship one,
`kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`.

## What gets scraped

`console-api` exposes Prometheus metrics on **the same port as the HTTP
surface** (`4000/metrics`). Minimal wiring in
[apps/console-api/src/server.ts](../../../apps/console-api/src/server.ts):

- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds{method,route,status}` — histogram
- `app_*` default Node process metrics (CPU, memory, event-loop, GC)

The ServiceMonitor (`release: kube-prometheus-stack` label) is auto-selected
by the operator and defines a 30 s scrape.

## Alerts

See `servicemonitor.yaml` — three starter `PrometheusRule`s:

- `ConsoleApiHigh5xxRate` — 5xx > 2 % for 10 min (warning)
- `ConsoleApiSlowP99` — p99 > 2 s for 10 min (warning)
- `ConsoleApiFrequentRestarts` — > 3 restarts in 15 min (critical)

Receivers are stubbed in the Helm values (`pager` route). Wire a real
webhook (Slack / PagerDuty / OpsGenie) before shipping.

## Dashboards

`grafana-dashboard.yaml` provisions one starter dashboard via the sidecar
pattern. Add more by creating ConfigMaps with label `grafana_dashboard=1` in
any namespace.

## Access

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
# → http://localhost:3000  (admin / admin, change in the values file)
```

## Ties into the rest of the infra

- `PrometheusRule` 5xx-rate → used by Argo Rollouts `AnalysisTemplate` in
  `infra/k8s/bluegreen/rollout.argo.yaml` to gate blue/green promotions.
- `NetworkPolicy` `api-allow-console-and-ingress` whitelists the
  `monitoring` namespace, so scrapes can reach port 4000 despite
  default-deny.
- `HPA` (`console-api`) reads from `metrics-server` — ensure it's installed.
