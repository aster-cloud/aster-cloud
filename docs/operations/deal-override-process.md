---
last-reviewed-at: 2026-05-20
owner: '@aster/deal-desk'
reviewer: '@aster/glossary-stewards'
review-cadence: quarterly
---

# Runbook — Deal override process (public stub)

**Plan**: `.claude/plan/glossary-contract.md` v7 §13.1 + §13.1.1
**This document is a public stub.** The canonical procedure with
deal-identifying data lives at
`aster-deploy/private/glossary/deal-override-process.md` (git-crypt
encrypted; access restricted to `@aster/deal-desk` +
`@aster/glossary-stewards`).

## What this document covers

A high-level summary of how Aster handles enterprise customer
requests for white-label terminology substitution. No customer
identifying data appears here.

## Three paths (per v7 §13.1)

Deal-desk has explicit authority to choose ONE of three paths within
5 business days of a customer request:

1. **Accept-and-commit** — deal value justifies committing to runtime
   work. Deal-desk opens
   `ADR-XXXX-tenant-glossary-runtime` within 1 sprint and schedules
   the runtime implementation.

2. **Decline** — deal value doesn't justify. Sales tells the customer
   "white-label terminology is not supported in v1." Deal proceeds with
   standard terms or doesn't proceed. **No escalation required**;
   sales is empowered.

3. **Workaround** — specific term + specific deal qualify. Deal-desk
   + steward jointly approve a `tenant-override-pending` flag on the
   deal. Customer ships with current terms; revisit at renewal.
   Requires the term to already have `tenant-overridable: true` in the
   schema (else `tenant-overridable-change.md` runbook applies first).

## Data location (private)

`aster-deploy/private/glossary/deal-overrides.yaml`:

- `git-crypt`-encrypted at rest.
- CODEOWNERS gated by `@aster/deal-desk` + `@aster/glossary-stewards`.
- Schema: see `aster-cloud/docs/operations/deal-overrides.schema.yaml`
  (public schema definition; no real data).
- Validated by `aster-deploy` CI on every PR.

## Public schema reference

`aster-cloud/docs/operations/deal-overrides.schema.yaml` (added in
G0/G1; one-shot schema doc). The shape is:

```yaml
pending-overrides:
  - deal-id: <opaque deal id>
    customer: <opaque or redacted>
    requested-at: <ISO>
    approved-by: [...]
    affected-terms: [<glossary-term-id>, ...]    # all MUST be tenant-overridable: true
    requested-substitution:
      en-US: { <term-id>: <substitution string> }
    adr-commitment-deadline: <ISO; ≤ 6 months from requested-at>
    runtime-readiness-status: pending | scheduled | shipped
    revisit-at: <renewal date>
    notes: <free text — DO NOT include sensitive deal financials>
```

## Public-private schema sync check (H2 hardening)

`aster-deploy` CI imports the public schema definition (by checksum)
and rejects any private `deal-overrides.yaml` whose shape diverges.
Catches the case where public schema evolves but private file lags.

## Related runbooks

- `tenant-overridable-change.md` — flipping a term's overridable flag.
- `add-term.md` — for adding a new term that's overridable from day 1.
