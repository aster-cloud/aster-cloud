---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
---

# ADR-0005 — Locale backbone = en-US

**Status**: Accepted
**Date**: 2026-05-20
**Plan**: `.claude/plan/glossary-contract.md` v7 §1.3

## Context

The glossary contract (ADR-0004) needs exactly one locale designated
as the **backbone** — the one against which all others are compared
for completeness, the one that owns "canonical meaning" of each term,
the one whose text changes trigger backbone-revision review across
other locales.

## Decision

**`en-US` is the backbone.** Every other locale is a downstream consumer.

This is encoded in `locales.yaml` via `role: backbone` and validated
by the loader (must be exactly one).

## Rationale

1. Aster's source code, code comments, ADRs, code review discussions,
   and developer documentation are all in English. The cost of
   *creating* a new term in en-US is near-zero (it's the language the
   author already thinks in).
2. The translator pool for English → {zh, de, ja, …} is large.
   The pool for, say, zh → de or de → ja is much smaller.
3. Source-language drift is the most expensive to fix (forces every
   target locale to re-translate). Anchoring on en-US minimizes drift
   in the language closest to the source.

## Alternatives considered

1. **No backbone (all locales equal).** Rejected: every term change
   would require N-way consistency review where N=locale count;
   intractable at >3 locales.
2. **Backbone selected per-customer (white-label).** Rejected: each
   customer pinning a different backbone fragments the contract. The
   white-label runtime layer (future) operates on `tenant-overridable`
   terms only, not the backbone choice itself.

## Consequences

- New terms are created in en-US first; translations land later in
  Stage 3 PRs.
- `backbone-revision` bumps trigger per-locale `reviewed-backbone-revision`
  acknowledgement (v7 §1.2 + §7.3).
- A future en-US-impaired ops team would face friction; this is
  accepted given Aster's current org composition.

## Related ADRs

- ADR-0004 — Glossary contract layer.
- ADR-0006 — Enforcement tiers + CODEOWNERS-gated promotion.
