---
last-reviewed-at: 2026-05-26
owner: '@aster/license-stewards'
---

# ADR-0007 — Per-tenant license keys (proposed)

**Status**: Proposed (not yet accepted)
**Date**: 2026-05-26
**Supersedes**: nothing
**Plan**: GA-readiness Phase 6 (`docs/GA-CHECKLIST.md`)

## Context

The current on-prem license model uses **one Ed25519 trust bundle baked
into the binary** (see `aster-cloud/src/lib/license/`). Each customer's
`LICENSE_KEY` env var is a single signed token containing:

- Customer org slug
- Plan (free / pro / enterprise)
- Expiry timestamp
- Allowed feature flags (`aiAssistant: true`, `customConnectors: false`, ...)

This works for the **first 10-20 customers** but has known limits:

### Single-tenant deployments (current case)
Each customer's K8s cluster runs a single license. Revocation requires
the customer to redeploy with a new env var. Acceptable for trusted
enterprise customers.

### Multi-tenant SaaS hosting (future case — drives this ADR)
Cloudflare Workers SaaS (`aster-lang.cloud`) hosts hundreds of tenants
under one deploy. Today, all tenants implicitly share the **single
"SaaS" license** baked into Worker secrets. Limits:

1. **No per-tenant quotas enforced cryptographically** — a tenant on
   "free" can call enterprise-only endpoints if a backend bug allows it;
   we rely on application-layer checks. Cryptographic gating would
   prevent the bug class entirely.
2. **No instant revocation** — to lock a tenant out, we update the DB
   row. A long-lived JWT session can still hit the API until the next
   middleware refresh (~5 min). Cryptographic license invalidation
   would be reflected in <100 ms (next request).
3. **No offline-trust path for self-hosted users** — a customer who
   moves from SaaS to on-prem must regenerate their license. A unified
   model would let the same per-tenant token work across both.

## Decision (proposed)

Adopt a **two-level license hierarchy** without changing the existing
ADR-0001 single-source approach:

```
                Trust bundle (baked into binary)
                 ├─ ROOT pubkey ────────┐
                 │                      │
                 │  signs                │  signs
                 ▼                      ▼
       SaaS deploy license          On-prem deploy license
       (long-lived, allowlists      (long-lived, allowlists
        "we run the SaaS")          "this customer's cluster")
                 │                      │
                 │  signs (short-lived)  │  signs (short-lived)
                 ▼                      ▼
      Per-tenant SaaS tokens       Per-user on-prem tokens
      (8h TTL, 1 per active        (optional; org admin can
       org)                         enable for fine-grained
                                    audit)
```

### Concrete shape

- **Root key**: lives in OCI Vault, used only once per quarter to sign
  deploy licenses
- **Deploy license**: 1-year TTL, contains a `subKey` field — the
  public key of a per-deploy signer that's allowed to mint short-lived
  tenant tokens
- **Tenant tokens**: 8h TTL, regenerated on login + every 4h via
  refresh, contain `{ orgId, plan, quotas, feats, exp, jti }`
- **Revocation**: revoking a tenant token (e.g., when admin disables a
  user) hits a CRL endpoint on the SaaS; on-prem clients receive
  pushed CRL updates via the existing license-revocation cron

### Why two levels, not one

A single level (each tenant signs requests with a tenant-issued key)
breaks the on-prem story — customers can't reach our CRL endpoint
from air-gapped clusters. The two-level scheme lets us keep the
existing offline trust path (deploy license validates locally, no
network call) while adding **online enforcement** for the SaaS tier.

### Library + algorithm choice

- **Algorithm**: Ed25519 (already in use; battle-tested)
- **Token format**: signed JSON (NOT JWT — JWT's algorithm-confusion
  history is a known footgun for our use case; see ADR-0006-style
  precedent for explicit simplicity)
- **Library**: `@noble/ed25519` (already in use)

## Consequences

### Positive
- Cryptographic enforcement of per-tenant plans → eliminates a bug
  class
- Sub-second revocation (next API call enforces; no DB lookup needed
  in hot path)
- Unified SaaS + on-prem trust path (the same library serves both)
- Auditable: every token has a `jti`; we can correlate any API call to
  the issuing token

### Negative
- **Complexity**: adds a refresh loop to client SDKs, a CRL endpoint, a
  short-lived key rotation procedure. Estimate: +1500 LoC across
  aster-cloud + aster-api + on-prem SDK.
- **Migration cost**: existing on-prem customers' licenses must be
  re-issued (one-time, scriptable, ~1 hour per customer with the
  ceremony rehearsed in `docs/runbooks/license-key-ceremony-rehearsal.md`)
- **Refresh failure mode**: if the deploy license signer is unreachable
  during refresh, clients must fall back to last-known-good token until
  expiry. We need a grace window — same 7-day grace as current
  on-prem flow (ADR-0003 backstop applies).
- **New attack surface**: the deploy signer key, if leaked, lets an
  attacker mint arbitrary tenant tokens. Mitigation: keep it in OCI
  Vault Transit; never extract; use HSM for production deploy signer.

### Neutral
- The existing single-key on-prem license format remains valid for
  customers who don't need per-user audit. Two-level is opt-in.

## Open questions

1. **How long should tenant tokens live?**
   8h vs 24h is a tradeoff: shorter = faster revocation but more refresh
   load. 8h matches a normal workday and aligns with NextAuth session.

2. **How do we handle clock skew across customer clusters?**
   Current license code has a 60s skew tolerance. Same applies here.

3. **CRL distribution mechanism on-prem?**
   Reuse the existing `/api/cron/license-revocation-refresh` cron. Each
   on-prem cluster pulls CRL from our public endpoint every 6h.

4. **Pricing model implications?**
   If we expose "per-active-user audit" as a premium feature, we need
   product/business buy-in. Out of scope for this ADR; defer to
   pricing review.

## Alternatives considered

### A. Keep single-level licenses
- Pros: simplest; no new code
- Cons: doesn't address the bug class (#1) or revocation latency (#2)
- Verdict: rejected — the bug class is real (we caught one in the
  May 2026 security review around the BYOK access path)

### B. Move to a standard licensing service (e.g., Keygen, LicenseSpring)
- Pros: someone else maintains the crypto
- Cons: vendor lock-in; per-token cost ($0.05 each at scale → $5k/mo
  at 100k DAU); doesn't fit our on-prem offline-trust requirement
- Verdict: rejected — economics + the offline path

### C. Use JWT with standard libraries
- Pros: ubiquitous tooling
- Cons: documented algorithm-confusion vulnerabilities; "none" alg
  attacks; we'd need to harden the library choice anyway
- Verdict: rejected — Ed25519 signed JSON is simpler and safer for
  our use case

## Implementation note

**This ADR is proposed, not implemented.** Acceptance requires:

1. Plan reviewed by `@aster/license-stewards` + `@aster/security`
2. Migration script written + rehearsed against staging (see
   `docs/runbooks/license-key-ceremony-rehearsal.md`)
3. CRL endpoint specified separately (open PR)
4. Customer comms drafted (the migration is opt-in but we want to
   announce direction)

Estimated effort: **8 engineer-weeks** spanning core, SDK, comms.
Target: after first 10 SaaS customers are stable (Q3 2026).

## Related

- ADR-0001 — Single source, two distributions (basis for unified trust)
- ADR-0003 — Deployment-mode DCE backstop (compile-time fallback)
- `docs/runbooks/license-key-ceremony-rehearsal.md` — the procedure
  this would extend
- `aster-cloud/src/lib/license/` — current single-level implementation
