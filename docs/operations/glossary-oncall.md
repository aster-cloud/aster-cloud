---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/incident-commander'
review-cadence: quarterly
---

# Runbook — Glossary steward on-call rotation

**Plan**: `.claude/plan/glossary-contract.md` v7 §1.7.1 + §4.4
**Scope**: The on-call rotation handling P0 freeze-bypass requests and
cosmetic-window watcher escalations.

## Provider

Aster has chosen **PagerDuty** as the primary paging provider. The
glossary-prerequisites.md preflight (`verify-paging-provider`)
validates the integration before G1 can ship.

**If your org uses OpsGenie / Slack-with-paging-bot / something else**:
the schedule + webhook integration follows the same shape; only the
provider-specific config differs. The G0.5 preflight is
provider-agnostic.

## Roster

- Minimum **2 stewards** in the rotation (per stakeholder matrix
  §0.1 staffing requirement).
- Rotation: **weekly**, Monday 00:00 UTC handoff.
- Schedule lives at PagerDuty service `glossary-p0-steward` (or
  equivalent).

## SLO

- **P0 freeze-bypass request**: 4 hours response time.
- **Cosmetic-window objection**: business-hours-only; 7-day automated
  window auto-acks at expiry unless objected.

## Triggers

| Trigger | How it fires | Action |
|---|---|---|
| PR with `Glossary-Freeze-Bypass:` trailer | GitHub Actions detects on PR description | Pages on-call steward immediately |
| Backbone-revision `cosmetic` issue auto-created | `glossary-cosmetic-window-tracker` Action | Issue assigned to on-call; Slack post to `#glossary-stewards` |
| RC validation failure | Release pipeline state machine reaches `failed` | Pages release engineer + on-call steward |
| Denylist publish failure | `publish-denylist.yml` workflow exits non-zero | Pages release engineer + on-call steward |

## Escalation

If no steward responds to a P0 page within 4h:

1. Page automatically routes to `@aster/incident-commander`.
2. IC has emergency authority to merge the P0 bypass (per §4.4 bypass
   procedure).
3. The full glossary steward team is notified asynchronously for
   awareness; no individual person is blamed for being asleep.

## Practice rotation

A quarterly dry-run page validates the SLO:

1. Schedule a synthetic test page (label `[GLOSSARY-DRILL]`).
2. Confirm the on-call steward receives the page.
3. Confirm escalation to IC if no response within 4h.
4. Confirm the schedule rotates correctly to the next steward.

Failed drill → fix the integration before the next real P0.

## Related runbooks

- `glossary-prerequisites.md` — on-call provider setup.
- `backbone-revision.md` — cosmetic-window automation that this on-call rotation handles.
