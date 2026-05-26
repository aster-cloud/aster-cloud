# OCI Autonomous Database — cold-standby DR

The in-cluster CNPG Postgres is the staging primary. For catastrophic cluster failure (region loss, ransomware, bad migration that propagated), we restore from OCI Object Storage WAL backups into an **OCI Autonomous Transaction Processing (ATP)** database. This document captures the link.

This is **cold standby**, not hot replication — accept ~15-30 min RTO. Acceptable for staging; production policy is separate.

## Topology

```
                CNPG (in-cluster)
                    │
                    │ WAL stream (continuous, every 5s)
                    ▼
   OCI Object Storage: bucket-backup/postgres-staging/
                    │
                    │ Daily full snapshot @ 14:00 UTC (ScheduledBackup CR)
                    │ + WAL segments retained 30 days
                    ▼
   Pre-provisioned ATP instance (paused, no compute charges)
                    │
                    │ During DR drill or real incident:
                    │ 1. resume ATP compute
                    │ 2. wallet exchange + connection
                    │ 3. apply latest snapshot
                    │ 4. replay WAL to point-in-time
                    ▼
              Service restored, ~15-30 min RTO
```

## ATP instance specs

| Property | Value |
|---|---|
| Name | `aster-staging-dr` |
| Workload type | Transaction Processing |
| ECPU count | 2 (auto-scale up to 4) |
| Storage | 1 TB (auto-scale) |
| Region | ap-melbourne-1 (same as primary) |
| Compartment | `aster-staging` |
| State | **Stopped** (cost = $0 for compute; storage ~$30/mo) |
| Wallet | downloaded once, stored in 1Password vault `aster-prod-ops` |

## Why ATP, not another K3S Postgres

- ATP is fully managed: no patching, no backup-of-backup loops, automatic encryption.
- Stopped state is free for compute — only storage. ~$30/mo vs ~$200/mo for a hot replica.
- It's intentionally a different platform from the primary: a CNPG bug that corrupts data in cluster Postgres won't replicate to ATP.

## When to use this

1. **Catastrophic primary failure** — entire CNPG cluster lost, can't restore from in-cluster snapshots
2. **Region failure** — ap-melbourne-1 outage; ATP is in same region but separate availability domain
3. **Quarterly DR drill** — practice the restore procedure (see `docs/runbooks/dr-drill.md`)

## Pre-conditions (verify before relying on this)

- [ ] ATP instance exists (`oci db autonomous-database list --compartment-id $OCI_COMPARTMENT_ID | jq '.data[] | select(."db-name"=="asterstagingdr")'`)
- [ ] Wallet present in 1Password vault `aster-prod-ops` (Vault item "ATP staging-dr wallet")
- [ ] WAL backup is current (last archive timestamp < 1 hour old):
  ```bash
  KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging exec postgres-staging-1 -- \
    barman-cloud-backup-list s3://bucket-backup/postgres-staging postgres-staging | tail -5
  ```
- [ ] OCI compartment policy allows the `aster-prod-ops` group to start/stop ATP

## Restore procedure (high-level — full steps in runbook)

```bash
# 1. Start ATP instance (takes ~1 min)
oci db autonomous-database start --autonomous-database-id $ATP_OCID

# 2. Wait for AVAILABLE
oci db autonomous-database get --autonomous-database-id $ATP_OCID \
  --query 'data."lifecycle-state"' --raw-output
# Block until it returns "AVAILABLE"

# 3. Download wallet (one-time, already in 1Password)
oci db autonomous-database generate-wallet --autonomous-database-id $ATP_OCID \
  --password "$WALLET_PASSWORD" --file ./wallet.zip
unzip wallet.zip -d ./atp-wallet

# 4. Use pg_restore + WAL replay tools — see full procedure in
#    docs/runbooks/dr-drill.md (Section 3: "Restoring from OCI Object Storage")

# 5. After verification, update DNS to point to ATP endpoint
#    OR redirect the in-cluster app's DATABASE_URL via ExternalSecret hot-swap
```

## Cost

| Component | Monthly cost |
|---|---|
| ATP storage (1 TB, paused state) | ~$30 |
| OCI Object Storage (WAL + snapshots, ~50 GB) | ~$5 |
| Egress during DR drill (one-time per quarter) | ~$1 |
| **Total steady-state** | **~$35/mo** |
| **During active restore** (4 ECPU running) | additional ~$3/hour |

Acceptable line item for staging-only DR. Production DR uses a separate hot-replica strategy (see prod docs).

## Related runbooks

- `docs/runbooks/dr-drill.md` — quarterly drill procedure (full restore + validate)
- `docs/runbooks/rollback.md` — for non-catastrophic rollback (faster paths first)
- `deploy/staging/postgres/backup.yaml` — the WAL backup config that feeds this
