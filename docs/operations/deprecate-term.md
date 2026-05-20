---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: 'per-locale reviewers'
review-cadence: annual
---

# Runbook — Deprecate a glossary term

**Plan**: `.claude/plan/glossary-contract.md` v7 §1.2 (lifecycle)
**Scope**: Retiring a term that's no longer used by any consumer surface.

NOT the same as splitting a term (homonym discovery) — see
`split-term.md` for that.

## 30 / 60 / 90 day deprecation window

| Day | What happens | Owner |
|---|---|---|
| **Day 0** | PR sets `lifecycle.status: active → deprecated`. Changelog announces. | stewards |
| **Day 30** | Both old usage + new usage still accepted by scanner. Slack reminder. | stewards |
| **Day 60** | Steward reviews: any consumer still emitting the term? If yes, file Stage-3-style PRs to migrate. | stewards |
| **Day 90** | PR sets `lifecycle.status: deprecated → superseded`. Old translation moves to `forbidden-aliases`. Scanner now hard-flags any remaining usage. | stewards |

## Inputs required

- Reason for deprecation (the changelog needs it).
- Replacement term ID (or "no replacement" — the concept is going away
  entirely).
- Confirmation no consumer surface still emits the term (use coverage
  matrix to verify).

## Day-0 PR shape

```yaml
old-term-id:
  ...existing fields...
  lifecycle:
    status: deprecated         # was: active
    since-version: <unchanged>
    backbone-revision: <unchanged>
    deprecated-at: 2026-XX-XX
    superseded-by: <new-term-id>  # if applicable
```

## Day-90 PR shape

```yaml
old-term-id:
  ...existing fields...
  lifecycle:
    status: superseded
    superseded-at: 2026-YY-YY
    superseded-by: <new-term-id>
  # The translations stay (read-only audit trail).
  # Add forbidden-aliases so scanners reject any new usage.
  forbidden-aliases:
    en-US: [{text: <old en-US translation>, match: {mode: phrase}}]
    zh-CN: [{text: <old zh translation>, match: {mode: phrase}}]
    de-DE: [{text: <old de translation>, match: {mode: phrase}}]
```

## What if a consumer can't migrate within 90 days?

Open an exemption issue against the deprecation. Steward either:

- Extends the window for that consumer (issue stays open, term stays
  in `deprecated`).
- Helps the consumer migrate via Stage-3-style PR.

If repeated extensions accumulate (>2 consumers blocked), reconsider
the deprecation decision.

## Related runbooks

- `split-term.md` — for cases where the term needs to split into multiple concepts.
- `backbone-revision.md` — for in-place text changes that aren't deprecation.
