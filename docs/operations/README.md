# Operations runbooks

Operational procedures for the Aster SaaS + on-prem deployment.

## Glossary Contract (v7)

See `.claude/plan/glossary-contract.md` for the design. Runbooks
below are the per-procedure operational steps.

### Quick links

| Doc | Purpose | Owner |
|---|---|---|
| [`glossary-stakeholders.md`](./glossary-stakeholders.md) | G0 sign-off matrix; required before G1 starts | `@aster/glossary-stewards` |
| [`glossary-prerequisites.md`](./glossary-prerequisites.md) | G0.5 infrastructure checklist (npm, OSSRH, KMS, on-call, ...) | `@aster/platform` |
| [`glossary-topology.md`](./glossary-topology.md) | Architecture overview: repos, services, data classifications, trust boundaries | `@aster/platform` |

### Term lifecycle

| Doc | When to use | Owner |
|---|---|---|
| [`add-term.md`](./add-term.md) | Adding a new term to the glossary | `@aster/glossary-stewards` |
| [`backbone-revision.md`](./backbone-revision.md) | Editing en-US text in place (cosmetic / terminology / semantic / legal) | `@aster/glossary-stewards` |
| [`deprecate-term.md`](./deprecate-term.md) | Retiring a term (30/60/90-day window) | `@aster/glossary-stewards` |
| [`split-term.md`](./split-term.md) | Splitting one concept into multiple (homonym discovery) | `@aster/glossary-stewards` |

### Locale management

| Doc | When to use | Owner |
|---|---|---|
| [`add-locale.md`](./add-locale.md) | Adding a new locale to the glossary (~2 week wall-clock) | `@aster/glossary-stewards` |
| [`coverage-matrix.md`](./coverage-matrix.md) | G7 cross-repo coverage matrix (acceptance artifact for any locale addition) | `@aster/glossary-stewards` |

### Release + recovery

| Doc | When to use | Owner |
|---|---|---|
| [`rc-and-recovery.md`](./rc-and-recovery.md) | Standard release procedure + bad-release recovery (denylist) | `@aster/platform` |
| [`gpg-key-lifecycle.md`](./gpg-key-lifecycle.md) | Annual GPG rotation + emergency rollover | `@aster/platform` |
| [`glossary-oncall.md`](./glossary-oncall.md) | P0 freeze-bypass paging rotation + escalation | `@aster/glossary-stewards` |
| [`cascade-outage.md`](./cascade-outage.md) | Multi-service outage policy (per-service fail-open/closed) | `@aster/platform` |

### Customer-specific (tenant override)

| Doc | When to use | Owner |
|---|---|---|
| [`tenant-overridable-change.md`](./tenant-overridable-change.md) | Customer requests a term be marked overridable (3-of-3 approval) | `@aster/glossary-stewards` |
| [`deal-override-process.md`](./deal-override-process.md) | Public summary of deal-side workflow (canonical procedure is in private `aster-deploy`) | `@aster/deal-desk` |
| [`deal-overrides.schema.yaml`](./deal-overrides.schema.yaml) | Public reference schema; real deal data lives in `aster-deploy/private/` | `@aster/deal-desk` |

## Review cadence

Each runbook has a `last-reviewed-at` frontmatter field and a
`review-cadence` (annual / semi-annual / quarterly). A weekly CI job
`verify-runbook-freshness` (Aster ops; not in this repo) opens a
tracking issue when any runbook's `last-reviewed-at` exceeds its
cadence.
