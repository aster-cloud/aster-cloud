---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/product, @aster/security'
review-cadence: annual
---

# Runbook — Mark a term `tenant-overridable: true` after the fact

**Plan**: `.claude/plan/glossary-contract.md` v7 §13.1.1
**When**: A customer requests white-label substitution of a term that
**isn't** currently marked `tenant-overridable: true`.

This is a cross-team policy review, not a tactical change. The
default schema posture is `tenant-overridable: false` — making a term
overridable widens the surface where customer-specific runtime
substitutions are permitted.

## Pre-flight

Customer request reaches deal-desk via the §13.1 escalation path. If
the term they want substituted is **already** `tenant-overridable: true`,
deal-desk uses the §13.1.1 `deal-overrides.yaml` flow directly — this
runbook is NOT needed.

If the term is `tenant-overridable: false`, this runbook applies.

## Procedure

1. **Deal-desk files an issue** in `aster-design-system` (public repo).
   - Generic title only, e.g.: `Request to mark "license-key" as tenant-overridable`.
   - NO customer-identifying data in the issue body (those go in
     private `aster-deploy/private/glossary/deal-overrides.yaml`).
   - Body: rationale for why the term concept warrants being
     overridable (not just "X customer asked").

2. **Required approvals** (3-of-3, recorded as PR approvals on the
   eventual schema change):

   | Role | What they review |
   |---|---|
   | `@aster/glossary-stewards` | Technical / contract review. Will this term being overridable break any cross-locale invariants? Does it conflict with regulatory text? |
   | `@aster/product` | Product policy. Is this term concept fundamentally customer-brandable, or is it a core contract that shouldn't be substitutable? Examples: "license key" yes; "GDPR" no. |
   | `@aster/security` | Privacy + audit review. Does enabling override on this term create cross-tenant data-leak risk or undermine audit trail clarity? |

3. **On approval**: PR flips `tenant-overridable: false → true` on the
   term YAML. This is a `lifecycle.backbone-revision` bump.
   `backbone-change-type: terminology` (the term's *governance* changed,
   though its meaning didn't).

4. **Approval record** in the term YAML:
   ```yaml
   lifecycle:
     ...
     backbone-revision: <N+1>
     backbone-change-type: terminology
     backbone-change-approved-by:
       - { role: glossary-steward, actor: alice@aster, at: <ISO> }
       - { role: product, actor: bob@aster, at: <ISO> }
       - { role: security, actor: carol@aster, at: <ISO> }
   ```

5. **After merge**: included in next glossary release.

6. **Deal-desk uses the new state**: once released, the deal-desk
   adds the term to `affected-terms[*]` in
   `aster-deploy/private/glossary/deal-overrides.yaml` per the
   §13.1.1 procedure.

## Refusal path

Either approver can decline. The PR is closed; deal-desk informs
sales the term cannot be made overridable, and the deal proceeds
under one of the §13.1 Decline / Workaround paths instead.

## Anti-patterns

- **Marking many terms overridable to satisfy one deal**: each term is
  reviewed individually; pre-emptive widening is rejected. The schema
  posture is "deny by default; whitelist by deliberate review".
- **Skipping the security review**: not optional. Even "obvious"
  brand terms (e.g., "license key") can carry privacy implications
  in specific customer contexts.
- **Using this runbook for tenant-side runtime substitution**: that's
  a different system (future workstream noted in §13.1). This runbook
  only flips the *schema flag*; the runtime layer doesn't exist yet
  in v1 (CI checks the base glossary only).

## Related runbooks

- `deal-override-process.md` (private, lives in `aster-deploy/private/`)
  — the actual deal-side workflow once the term is overridable.
- `add-term.md` — for adding a brand-new term that's overridable from
  day 1 (set the flag during creation rather than after).
