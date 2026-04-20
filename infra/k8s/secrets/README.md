# Secrets — Sealed Secrets

## Why this backend

- **Sealed Secrets** (bitnami-labs) — asymmetric crypto, the ciphertext is
  safe to commit. Decryption happens in-cluster by a controller. Zero
  external dependencies.
- Alternatives and why we didn't pick them _here_:
  - **External Secrets Operator + a secrets manager** (AWS SM, Vault, GCP SM):
    cleaner separation of concerns, but requires an external system you
    then have to operate, pay for, and secure. Adopt this when your org
    already standardizes on a secret store.
  - **SOPS** (Mozilla) + age/KMS: great for GitOps (decryption at
    apply-time), but needs every operator to have the decryption key or
    IAM to the KMS. Good for small teams.

Pick one; don't run two. This repo ships Sealed Secrets wiring; swap
`seal.sh` + the install section for your choice and the rest of the infra
stays identical — `console-api-secrets` is consumed by Deployment
`envFrom`, the shape doesn't change.

## Install the controller

```bash
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.27.0/controller.yaml
kubectl -n kube-system rollout status deploy/sealed-secrets-controller --timeout=3m

# CLI (macOS)
brew install kubeseal
# (linux) grab the binary from the release page.
```

## Seal a Secret

```bash
# 1. Write the plain secret on disk (do NOT commit).
cat > /tmp/console-api-secrets.plain.yaml <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: console-api-secrets
  namespace: thalamus
type: Opaque
stringData:
  DATABASE_URL: "postgres://thalamus:REAL@postgres:5432/thalamus"
  REDIS_URL: "redis://redis:6379"
  OPENAI_API_KEY: "sk-..."
  VOYAGE_API_KEY: "pa-..."
  MOONSHOT_API_KEY: ""
  PERPLEXITY_API_KEY: ""
  DEEPSEEK_API_KEY: ""
EOF

# 2. Seal it (public-key crypto — output is safe to commit).
./infra/k8s/secrets/seal.sh console-api-secrets \
  < /tmp/console-api-secrets.plain.yaml \
  > infra/k8s/secrets/console-api-secrets.sealed.yaml

# 3. Delete the plain file.
shred -u /tmp/console-api-secrets.plain.yaml

# 4. Apply.
kubectl apply -f infra/k8s/secrets/console-api-secrets.sealed.yaml
```

## Do the same for the other Secrets

- `postgres-credentials` — StatefulSet env (POSTGRES_USER/PASSWORD/DB).
- `rclone-config` — Postgres backup credentials (see `infra/k8s/backup/`).
- `grafana-admin` — if you flip `kube-prometheus-stack` away from the
  inline password.

## Rotation

```bash
# Re-seal with the latest public key (the controller serves it).
./infra/k8s/secrets/seal.sh console-api-secrets \
  < /tmp/rotated.plain.yaml \
  > infra/k8s/secrets/console-api-secrets.sealed.yaml

kubectl apply -f infra/k8s/secrets/console-api-secrets.sealed.yaml

# The console-api Deployment does NOT auto-reload env from Secret updates.
# Trigger a rollout so pods read the new values:
kubectl -n thalamus rollout restart deploy/console-api
```

## What NOT to do

- Don't commit the plain `Secret` manifest (only the sealed one).
- Don't encrypt against the cluster's TLS key — use `kubeseal` against
  the dedicated sealed-secrets public key.
- Don't share the sealed-secrets controller private key; back it up in a
  password manager / KMS. Losing it means every sealed secret in the
  repo needs re-sealing against a fresh keypair.

## Migration from the template

`infra/k8s/secret.example.yaml` is the legacy template — replace with
the sealed version above and drop `secret.example.yaml` from
`kustomization.yaml` once done.
