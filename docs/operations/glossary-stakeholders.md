# Glossary Contract — Stakeholder & Ownership Matrix (G0)

**Plan reference**: `.claude/plan/glossary-contract.md` §0.1
**Status**: Draft — awaiting team sign-offs
**Last reviewed**: 2026-05-20

This document records every team whose sign-off is required before
`G1 — glossary package implementation` may begin. The Glossary
Contract (v7) is the source of truth for what each team is committing to.

No `G1` commit may land in any repo before this document is fully
signed and merged into `aster-cloud/main`.

## Sign-off matrix

Each team adds an `Acked-by:` trailer to the PR that merges this file.
A team's sign-off acknowledges:

- Awareness of the team's required role across G0–G8.
- Capacity to staff that role (or surface a gap before G1 begins).
- Authority delegated to the named primary contact.

| Repo / responsibility | Maintainer team | Primary contact | Required for | Sign-off |
|---|---|---|---|---|
| `aster-design-system` | `@aster/platform` | _TBD_ | G1, G8a, G8b infra | `Acked-by:` _pending_ |
| `aster-cloud` (this repo) | `@aster/cloud` | _TBD_ | G2, ADRs, runbooks, G7 evidence | `Acked-by:` _pending_ |
| `aster-lang-dev` | `@aster/docs` | _TBD_ | G3 | `Acked-by:` _pending_ |
| `aster-lang-core` | `@aster/lang` | _TBD_ | G4, G6 | `Acked-by:` _pending_ |
| `aster-lang-en` | `@aster/lang` (official) | _TBD_ | G4, G6 | `Acked-by:` _pending_ |
| `aster-lang-zh` | `@aster/lang` (official) | _TBD_ | G4, G6 | `Acked-by:` _pending_ |
| `aster-lang-de` | `@aster/lang` + community | _TBD_ | G4 overlay backfill | `Acked-by:` _pending_ |
| `aster-deploy` (private) | `@aster/platform` | _TBD_ | Private `deal-overrides.yaml` (§13.1.1); git-crypt; Vault keys | `Acked-by:` _pending_ |
| `@aster/glossary-stewards` (governance role) | governance | _TBD_ — staff ≥ 2 members | Tier promotion, change-type approval, on-call rotation | `Acked-by:` _pending_ |
| Per-locale translation reviewers | per-locale | en-US: _TBD_<br>zh-CN: _TBD_<br>de-DE: _TBD_ | Stage 3 PRs, backbone-change ack | `Acked-by:` _pending per locale_ |
| `@aster/legal` | compliance | _TBD_ | `backbone-change-type: legal` approvals | `Acked-by:` _pending_ |
| `@aster/deal-desk` | sales | _TBD_ | Tenant-override deal escalation (§13.1) | `Acked-by:` _pending_ |
| `@aster/product` | product | _TBD_ | `tenant-overridable-change.md` approvals | `Acked-by:` _pending_ |
| `@aster/security` | security | _TBD_ | KMS IAM binding control (H1); `tenant-overridable-change.md` review | `Acked-by:` _pending_ |
| `@aster/incident-commander` | IR rotation | _TBD_ — confirm coverage | P0 freeze-bypass escalation (§1.7.1, §12.4); cascade outage override | `Acked-by:` _pending_ |

## How to sign

1. The repo/role owner reviews the relevant sections of `.claude/plan/glossary-contract.md`:
   - `aster-cloud`: §4 (G2), §11 acceptance criteria.
   - `aster-lang-dev`: §5 (G3).
   - `aster-lang-{en,zh,de}`: §6 (G4), §9 (G6).
   - `aster-deploy`: §13.1.1 (deal-overrides), §1.7.2 (GPG lifecycle).
   - Governance / on-call / legal / deal-desk / product / security: §1.6, §1.7.1, §7.3, §13.1, §13.1.1.
2. Owner identifies their primary contact and adds them above (PR edit).
3. Owner adds `Acked-by: <Team Name> <name@aster>` trailer to the PR commit message.
4. PR is merged only when **every row** has a non-pending sign-off.

## Capacity gap escalation

If any team identifies a capacity gap (e.g., `@aster/glossary-stewards` cannot
staff 2 members; `@aster/deal-desk` has no available escalation contact):

1. Owner files an issue with title `[glossary-G0] capacity gap: <team>` against
   `aster-cloud` repo, labels `glossary`, `blocking-G1`.
2. Issue triggers a 5-business-day SLO for governance to resolve (re-staffing,
   role delegation, or formally scoping the gap out of v1).
3. G1 cannot start until all `blocking-G1` issues are closed.

## Once signed

After this document merges with every row complete:

- G0 task is marked done in the plan's task tracker.
- G0.5 (`glossary-prerequisites.md` infrastructure setup) may proceed in parallel
  with G1 engineering work, but G1 cannot reach "ready to release" without G0.5
  closure.

## Audit trail

PR with sign-offs: _TBD on merge_
Plan version at sign-off: v7
Plan reviewed by: _TBD on merge_
