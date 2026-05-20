---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/legal'
review-cadence: semi-annual
---

# Runbook — Backbone (en-US) text revision

**Plan**: `.claude/plan/glossary-contract.md` v7 §7.3
**When**: The en-US text of an existing term needs editing — typo,
clarification, brand-tone fix, or compliance-mandated wording change.

NOT the same as adding a new term or splitting a homonym.

## The four change types (controls CI strictness + approval gates)

| Type | When | Approval required | CI behavior |
|---|---|---|---|
| `cosmetic` | Whitespace, punctuation, typo with no meaning change | Author self-declares + 7-day no-objection window (any steward can object) | Batch-ack notice; no per-locale PR needed |
| `terminology` | Word choice, brand-tone | `@aster/glossary-stewards` approval on the PR | Strict error in official consumers; per-locale reviewer must update `reviewed-backbone-revision[locale]` |
| `semantic` | The term's *meaning* changed | `@aster/glossary-stewards` + each active locale's reviewer | Strict error; reviewer must re-translate (no "confirm no change") |
| `legal` | Compliance text required by regulator | `@aster/glossary-stewards` + `@aster/legal` | Strict error + audit entry in `docs/operations/glossary-incidents/<date>-legal-change.md`; legal team approval required on every locale's translation PR |

**Author misclassification**: a `cosmetic` PR can be objected during
the 7-day window by any steward; on objection the PR author must
re-classify and re-submit. Repeated misclassification triggers
governance review of contribution privileges.

## Procedure

1. Open PR in `aster-design-system` editing the term's
   `translations.en-US`.
2. Bump `lifecycle.backbone-revision: N → N+1`.
3. Set `lifecycle.backbone-change-type: cosmetic | terminology | semantic | legal`.
4. Add `lifecycle.backbone-change-approved-by:` entry per the approval
   table above (one record per required approver):
   ```yaml
   backbone-change-approved-by:
     - role: glossary-steward
       actor: alice@aster
       at: 2026-05-20T10:00:00Z
   ```
5. Schema invariant rejects PRs that don't update this field correctly.

## Per-locale review

For `terminology | semantic | legal`:

- Strict CI in official-tier consumers goes red until each locale's
  `reviewed-backbone-revision[locale]` is bumped to N+1.
- Per-locale reviewer either:
  - Confirms current translation still applies → bumps the field
    without text change.
  - Re-translates → bumps the field with text change.

For `cosmetic`:

- A GitHub Action (`glossary-cosmetic-window-tracker`) opens a tracking
  issue + Slack ping + auto-ack at 7 days unless any steward objects.
- After auto-ack, a bot PR bumps every locale's
  `reviewed-backbone-revision[locale]` in one shot.

## Cosmetic-window automation

- Issue is assigned to the current on-call glossary steward (per
  `glossary-oncall.md` PagerDuty schedule).
- Slack notification posts to `#glossary-stewards` via webhook.
- Daily scheduled action sweeps expired windows + auto-acks unobjected ones.
- Objection comment matching `/^OBJECT:/m` from a steward triggers
  re-classification — author must open a new PR with a stricter
  change-type.

## Related runbooks

- `add-term.md` — adding new terms (use this for "did you mean to
  split?" cases instead).
- `deprecate-term.md` — for retiring rather than editing.
- `glossary-oncall.md` — steward rotation that handles the 7-day window.
