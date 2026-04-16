# Backup & Restore Runbook

Authoritative procedure for backing up SpaceHarbor state and restoring
it on a new host. Exercise this quarterly — untested backups don't exist.

## What needs to be backed up

1. **VAST Database schema + data** (authoritative persistence when
   `SPACEHARBOR_PERSISTENCE_BACKEND=vast`) — all `spaceharbor/production`
   tables: projects, sequences, shots, versions, version_files, assets,
   checkins, s3_compensation_log, triggers, webhook_endpoints,
   webhook_delivery_log, workflow_definitions, workflow_instances,
   workflow_transitions, custom_field_definitions, custom_field_values,
   dataengine_dispatches, auth_decisions, approval_audit_entries,
   schema_version.
2. **Settings volume** (Docker named volume `settings-data`) —
   `/data/settings.json` with platform settings (S3 endpoints, Kafka
   creds, DataEngine pipeline config). NOT in VAST DB.
3. **VAST S3 buckets** — `sergio-spaceharbor` and `sergio-bucket` —
   these are authoritative for media assets. Backup relies on VAST's
   own snapshot/replication features (outside SpaceHarbor scope) OR
   bucket versioning + periodic cross-region copy.
4. **JWT signing secret + API keys** — `SPACEHARBOR_JWT_SECRET` +
   per-user API keys stored in VAST DB (covered by #1) + env-file
   secrets (should be in a secret manager, not a backup).

## Recovery Time / Point Objectives (target)

| Component       | RPO (data loss tolerance) | RTO (time to restore) |
|-----------------|:-------------------------:|:---------------------:|
| VAST DB         | 15 minutes                | 30 minutes            |
| Settings volume | 1 hour                    | 5 minutes             |
| S3 objects      | 1 hour (bucket versioning) | N/A (rehydrate)      |
| Secrets         | N/A (separate vault)      | N/A (rotate, don't restore) |

## Backup procedure

### 1. Settings volume

Run `deploy/scripts/backup-settings.sh <target-dir>`. The script
creates a tarball of the Docker volume's contents. Store the tarball
in your backup system (S3 Glacier, offsite tape, whatever).

```bash
./deploy/scripts/backup-settings.sh /var/backups/spaceharbor
# → /var/backups/spaceharbor/settings-2026-04-16T213000Z.tar.gz
```

### 2. VAST Database schema

The VAST DB tables are managed by the migrations in
`services/control-plane/src/db/migrations/`. To capture the CURRENT
state of a live cluster, use `vastdb_cli` to export a snapshot:

```bash
./deploy/scripts/backup-vastdb.sh /var/backups/spaceharbor
```

The script invokes `vastdb_cli table list` + per-table row exports
via Trino `COPY TO`. Output is one Parquet file per table. On a dev
cluster with ~100 MB of audit rows, this takes ~30 seconds.

### 3. S3 buckets

Delegate to VAST. Enable bucket versioning via
`aws s3api put-bucket-versioning` at setup time, and set up a
nightly cross-region replication job via `vast-migrate.py`'s S3
replication flag. SpaceHarbor does NOT back up S3 bytes — they're
too large and VAST's own replication is the right tool.

## Restore procedure

Restoring to a fresh host:

### 1. Install SpaceHarbor

```bash
git clone https://github.com/ssotoa70/SpaceHarbor.git ~/SpaceHarbor
cd ~/SpaceHarbor
docker compose pull
```

### 2. Restore settings volume

```bash
./deploy/scripts/restore-settings.sh \
  /var/backups/spaceharbor/settings-2026-04-16T213000Z.tar.gz
```

Verify:

```bash
docker compose run --rm control-plane cat /data/settings.json | jq .
```

### 3. Restore VAST DB

```bash
./deploy/scripts/restore-vastdb.sh \
  /var/backups/spaceharbor/vastdb-2026-04-16T213000Z/
```

The restore script plays migrations 001..N first (in case the target
cluster is empty), then runs `COPY INTO` for each table from the
Parquet files.

### 4. Validate

```bash
./deploy/scripts/post-restore-checks.sh
```

Runs:
  - `SELECT COUNT(*) FROM projects, versions, ...` → compare to pre-backup counts
  - `curl /health/ready` → expects 200
  - `curl /api/v1/admin/audit/verify` (POST) → expects valid=true
  - `curl /metrics | grep spaceharbor_` → expects non-zero request rate

## DR drill checklist (quarterly)

Run this drill against a clean cluster (not production). Record
results in the wiki Release Notes.

1. ☐ Pick a restore target: fresh VM + empty VAST cluster
2. ☐ Copy latest nightly backup artifacts onto the target
3. ☐ Run the restore procedure above end-to-end
4. ☐ Run `post-restore-checks.sh`; capture all outputs
5. ☐ Run a full atomic check-in; confirm it commits + proxy appears
6. ☐ Verify audit chain: `POST /admin/audit/verify` returns `valid: true`
7. ☐ Record total RTO + highlight any manual steps that slowed it

## Troubleshooting

### `settings.json` has VAST credentials but they don't work on the new cluster

Platform settings are cluster-specific. After restore, re-enter S3
endpoints via `/admin/settings` (which overwrites the restored file
with fresh credentials).

### Audit chain verify reports `firstBrokenId` after restore

Expected if the restore didn't preserve row-hash columns (e.g. a
Parquet export that dropped nullable string columns). The chain is
rebuilt going forward; the historical break is permanent and should
be documented in the Release Notes.

### VAST S3 bucket returns 403 after restore

Bucket policies are cluster-scoped. After restore, verify:

```bash
aws --endpoint-url=$SPACEHARBOR_S3_ENDPOINT s3api get-bucket-policy \
  --bucket sergio-spaceharbor
```

If the policy references the old cluster's IAM roles, re-apply your
organization's standard bucket policy.
