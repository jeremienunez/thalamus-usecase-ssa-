# TLS via cert-manager

Single ClusterIssuer pair (LE staging + prod), HTTP-01 challenge through the
nginx Ingress. The Ingress requests its cert via the
`cert-manager.io/cluster-issuer` annotation; cert-manager writes the issued
cert into the Secret named in `tls.secretName` and renews automatically
~30 days before expiry.

## Install

```bash
# 1. cert-manager (CRDs + controller)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager --timeout=3m

# 2. ClusterIssuers (edit the email first)
$EDITOR infra/k8s/tls/cluster-issuer.yaml
kubectl apply -f infra/k8s/tls/cluster-issuer.yaml
```

## Issue the Ingress cert

```bash
# 3. Point your DNS A/AAAA record for thalamus.example.com at the ingress LB
# 4. Make sure Ingress + ClusterIssuer names line up in ingress.yaml
kubectl -n thalamus apply -f infra/k8s/ingress.yaml

# 5. Watch the Order + Challenge + Certificate
kubectl -n thalamus describe certificate thalamus-tls
kubectl -n thalamus get challenges
```

## Debugging flow

- Start with `cert-manager.io/cluster-issuer: letsencrypt-staging` — LE has
  much higher rate limits on staging, and the cert is visibly
  non-trusted, so you notice quickly when something's wrong.
- Flip to `letsencrypt-prod` only after you've seen a staging cert
  issued end-to-end.
- HTTP-01 requires the `thalamus.example.com` DNS to resolve to your
  ingress controller's external IP. DNS-01 is the alternative if you
  can't expose port 80 (e.g. internal clusters).
