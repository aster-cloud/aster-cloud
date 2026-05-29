# ADR-0013: East-West Traffic on Plain TCP (No Service Mesh)

**Status**: Accepted (2026-05-29, R31 audit closeout)
**Context**: aster-api, aster-cloud, otel-collector, and supporting services communicate via Kubernetes ClusterIP services inside the k3s cluster. The R30+ audit asked whether this east-west traffic should run over mTLS.
**Supersedes**: implicit "cluster-internal traffic is fine over plain TCP" stance, now made explicit.

## Context

Three audit rounds (R30+ → R31) raised the same question about east-west
TLS: should pod-to-pod calls inside the cluster encrypt their traffic?
The specific call-out was OTel collector → Tempo where the exporter is
configured `tls.insecure: true`.

Four options were on the table:

| Option | Pros | Cons |
|---|---|---|
| **A**: Istio service mesh | Automatic mTLS, traffic policies, sidecar observability | New control plane (~500 MB RAM, ~3 CPU cores at idle), sidecar in every pod, learning curve, ARM64 quirks |
| **B**: Linkerd | Lighter than Istio (~200 MB ctrl plane), simpler config | Smaller ecosystem, sidecar still required, more YAML per app |
| **C**: cert-manager + manual sidecar | No mesh, fine-grained control | Per-app config, ongoing maintenance burden, cert rotation script complexity |
| **D**: Stay plain TCP, document the trust boundary | Zero engineering work, zero runtime cost | "True" mTLS deferred; cluster compromise gives east-west sniffing |

## Decision

**Adopt Option D — stay on plain TCP for east-west traffic.**

The trust boundary for cluster-internal traffic is:
1. **NetworkPolicy** restricts which pods can talk to which (incident on
   2026-05-29 17:30 NZST showed this is enforced at the kube-router
   layer; misconfig breaks production immediately, which is paradoxically
   evidence that the layer works).
2. **RBAC + ImagePullPolicy** prevent unauthorized images from running
   in the cluster, so the set of pods that *could* sniff traffic is
   already constrained.
3. **Kubernetes Secrets** carry the high-value tokens (HMAC keys, plan-
   gate secrets, Turnstile secrets); these never traverse east-west on
   the wire — pods read them from mounted envFrom/secretKeyRef.

What plain TCP exposes if an attacker already has cluster RCE:
- Trace data flowing OTel → Tempo (low value)
- Internal HTTP requests aster-api → aster-cloud BFF (also low value,
  the payloads are policy evaluation results not credentials)

What plain TCP does **not** expose:
- TLS-terminated traffic from the public edge (Cloudflare → Traefik via
  cloudflared tunnel is encrypted)
- Vault → ESO → K8s Secrets pipeline (already mTLS via ESO's
  authentication)
- Database connections (Postgres uses TLS already, configured in JDBC URL)

## Why not Istio/Linkerd

- **Resource cost**: this is a 6 GiB / 1 OCPU single-node k3s. Istio
  control plane alone is roughly 1/12 of the cluster's RAM budget.
  Sidecars would add ~100 MB per pod × ~15 pods = ~1.5 GiB. Half the
  cluster gone to mesh overhead.
- **ARM64 compatibility**: cluster runs ARM (Apple silicon). Istio's
  ARM64 story has improved but isn't first-class.
- **Operational complexity**: this is a one-operator deploy. Adding a
  service mesh doubles the day-2 surface (mesh upgrades, certificate
  rotation, traffic policy debugging).
- **Risk concentration**: meshes have outsize blast radius when their
  control plane fails. The 2026-05-29 NetworkPolicy incident already
  showed how a single platform-layer manifest can take down everything;
  a mesh layer adds another such failure mode.

## What we do instead

- **NetworkPolicy** on every namespace that hosts a stateful workload
  (Postgres, Redis, aster-api). Default-deny ingress where the workload
  is outbound-only (cloudflare-tunnel after the R31 fix).
- **Explicit `tls.insecure: true` annotations** on the OTel exporters
  and any other cluster-internal TLS-bypass config, with the trust
  boundary rationale in-line so the next operator doesn't think it's
  an oversight.
- **Audit pipeline catches violations**: the workspace audit cycle
  (R28→R31) already inspects every NetworkPolicy and TLS config; this
  ADR makes the "plain TCP is intentional" decision visible to those
  audits so they don't keep flagging it as P2/P3.

## Migration trigger

Re-open this decision when **any** of these hits:
1. Workload count exceeds 30 pods (mesh overhead becomes proportionally smaller).
2. A second cluster operator joins (mesh's day-2 tooling pays off with team scale).
3. Compliance requirement appears that explicitly mandates in-cluster encryption (PCI-DSS, FedRAMP, HIPAA's "in transit" interpretation).
4. A real east-west traffic sniffing incident occurs (the audit threat model proves wrong).

Until then, the operator energy is better spent on:
- Hardening the public edge (R31-4 Turnstile, R28→R30 trial chain).
- NetworkPolicy hygiene (R31 incident reinforced this).
- Secrets pipeline (Vault + ESO are already mTLS).

## Consequences

### Positive
- Closes a 3-round-recurring audit item with explicit rationale.
- No engineering or runtime cost.
- Trust boundary now visible in code + docs, not implicit.

### Negative
- An attacker with cluster RCE can sniff east-west traces and internal
  HTTP. The threat-model assessment ("this leakage is acceptable given
  the data shape") must be re-validated when the workload's data
  sensitivity changes.

### Operational
- Audit tooling should treat `tls.insecure: true` on cluster-internal
  exporters as "acknowledged" rather than "P2 finding", as long as the
  annotation references this ADR.
- New cluster-internal services should default to plain TCP and
  reference this ADR if they go to audit.

## Related

- R31-6 audit follow-up that flagged OTel `tls.insecure: true`
- 2026-05-29 cloudflare-tunnel NetworkPolicy incident — see commit
  `4b64fb5` in k3s repo for postmortem-in-commit-message
- ADR-0012 (Turnstile) — orthogonal but contemporaneous
- ADR-0011 (lexicon hotplug) — sibling R31 ADR
