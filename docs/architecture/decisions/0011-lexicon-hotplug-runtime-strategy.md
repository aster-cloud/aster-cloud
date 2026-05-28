# ADR-0011: Lexicon Hotplug Runtime Strategy in Multi-Replica K8s

**Status**: Accepted (2026-05-29, R22 audit closeout)
**Context**: aster-api k8s deployment is scaled to ≥2 replicas (R21).
**Supersedes**: implicit single-replica assumption of `HotPlugLexiconLoader`.

## Context

The lexicon hot-plug mechanism (uploaded `.jar` files under
`/var/aster/lexicons/jars`, watched by `HotPlugLexiconLoader`) was designed
for single-pod operation. After R21 scaled `aster-api` to `replicas: 2` plus
HPA `[2..6]`, the underlying volume is `emptyDir` (per-pod, not shared).

This creates a state-divergence window:

1. Operator `POST /api/v1/admin/lexicons` → request routes to pod-A → jar
   lands on pod-A's `emptyDir`.
2. Subsequent policy evaluations on pod-B do not see the new lexicon
   until the operator repeats the upload, the pod restarts and pulls
   a refreshed image, or the load-balancer happens to send the next
   request to pod-A.

The R21 audit (Codex Round 22) flagged this as a "silent-regression risk
for Fortune 500 readiness."

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| **A**: Shared `PersistentVolume` (RWX) for `/var/aster/lexicons/jars` | All pods see same jars; live upload semantics preserved | Adds storage class dependency (NFS / Longhorn); RWX volumes on k3s are non-trivial; backup story unclear |
| **B**: Image-baked lexicons (no runtime hotplug) | Immutable, auditable, reproducible; SHA digest = lexicon version; rollback = redeploy | Lexicon updates require image rebuild + ArgoCD sync (~minutes, not seconds); ops loses live-edit |
| **C**: Object storage (S3-compatible) + per-pod sync | Single source of truth; pods pull at boot + on event | Adds infra (MinIO / S3); needs eventual-consistency UX; consistency lag visible to operators |
| **D**: Single-replica + disable hotplug on multi-replica | Simplest; no architectural change | Forfeits HA; defeats R21 scaling |

## Decision

**Adopt B (image-baked lexicons) as the production posture; keep current
emptyDir + per-pod replay as the documented operational reality until
B lands.**

Rationale:

- Lexicons change rarely (en/de/zh + customer-specific packs) — image
  rebuild cadence (~weekly) matches actual edit cadence.
- Operations team prefers immutable + git-tracked artifacts over live
  cluster state for compliance audit (SOC 2, ISO 27001 controls require
  change provenance).
- Option A (shared PV) doubles infrastructure (longhorn + backup) for
  marginal UX win.
- Option C is overkill at current scale.

## Migration Path

Phase 1 (current — accepted):
- `replicas: 2`, emptyDir per-pod.
- Operators upload via `/api/v1/admin/lexicons` once per pod, OR rely
  on session affinity (out-of-scope here).
- `docs/runbooks/lexicon-recovery.md` documents the operator procedure.

Phase 2 (Q3 2026, planned):
- Move lexicon `.jar` files into the `wontlost/aster-api` container image
  at `/opt/aster/lexicons/`.
- `HotPlugLexiconLoader` retains the watcher for **local dev** (`task
  local:dev`), but production K8s sets `aster.lexicon.hotplug.enabled=false`.
- Lexicon updates become a normal CI/CD path: edit lexicon repo → publish
  jar → bump version in aster-api image manifest → ArgoCD syncs.

Phase 3 (only if needed):
- If a customer requires sub-minute lexicon updates without redeploy,
  revisit Option A (shared PV) or C (S3-backed). No customer demand to
  date; ADR will be amended at that point.

## Consequences

### Positive
- Multi-replica HA (R21) preserved.
- Lexicon provenance auditable (git SHA → image digest).
- No runtime infrastructure additions.

### Negative
- Lexicon changes have an image-rebuild latency (minutes vs seconds).
- Phase 2 requires deployment pipeline update.
- Customers expecting "live customer-specific lexicon edits via the
  admin API" need a different product (not currently planned).

### Operational
- Until Phase 2: operators MUST upload to each pod individually OR use
  session affinity. Documented in `docs/runbooks/lexicon-recovery.md`.
- Code retains `HotPlugLexiconLoader` since local dev workflows depend
  on it.

## Related

- R21 audit batch (replicas 1→2, HPA, PDB) in `k3s/apps/aster-lang/cloud/`
- `docs/runbooks/lexicon-recovery.md` for current operator workflow
- ADR-0010 (sandbox lockdown) — orthogonal but contemporaneous
