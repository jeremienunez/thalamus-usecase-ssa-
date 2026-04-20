# Postgres backups

Daily logical backup (`pg_dump --format=custom`) pushed to object storage via
rclone, with a companion restore Job. The restore path is documented and
periodically rehearsed — **an untested backup is not a backup**.

## Not this repo's job

For real prod, consider promoting to:

- **CloudNativePG** (CNPG) — declarative Postgres operator with backup,
  PITR, failover.
- **pgBackRest** / **WAL-G** — dedicated tools with continuous WAL shipping
  (required for PITR).

This CronJob covers the nightly-snapshot case: cheap, simple, recovers
to yesterday at worst. Upgrade when RPO < 24h matters.

## Install

```bash
# 1. Author an rclone remote for your object storage
rclone config  # create a remote named `s3` targeting your bucket
# or, manually:
cat > rclone.conf <<EOF
[s3]
type = s3
provider = AWS              # or Cloudflare, MinIO, ...
access_key_id = AKIA...
secret_access_key = ...
region = eu-west-3
EOF

# 2. Ship it as a Secret (never commit)
kubectl -n thalamus create secret generic rclone-config \
  --from-file=rclone.conf=./rclone.conf

# 3. Apply the CronJob
kubectl apply -f infra/k8s/backup/pg-backup.yaml
```

## Trigger an ad-hoc backup

```bash
kubectl -n thalamus create job pg-backup-manual --from=cronjob/pg-backup
kubectl -n thalamus logs -f job/pg-backup-manual
```

## Restore

```bash
# 1. Point at a DIFFERENT database (staging / restore target) — not prod.
kubectl -n thalamus create secret generic restore-target \
  --from-literal=url='postgres://thalamus:...@postgres:5432/thalamus_restore'

# 2. Edit the BACKUP_FILE env in restore-job.yaml to the dump you want.
$EDITOR infra/k8s/backup/restore-job.yaml

# 3. Apply + watch + clean up.
kubectl -n thalamus apply -f infra/k8s/backup/restore-job.yaml
kubectl -n thalamus logs -f job/pg-restore
kubectl -n thalamus delete job/pg-restore
```

## Retention

Put lifecycle rules on the bucket itself — e.g. transition to Glacier
after 30 days, delete after 365 days. Don't manage retention in-cluster;
the bucket lifecycle is the source of truth.
