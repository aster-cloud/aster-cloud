---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
---

# ADR-0004 — Glossary contract layer

**Status**: Accepted
**Date**: 2026-05-20
**Deciders**: `@aster/platform`, `@aster/glossary-stewards`
**Plan**: `.claude/plan/glossary-contract.md` (v7)

## Context

Aster ships a hot-pluggable lexicon system (`aster-lang-{en,zh,de}`)
that translates *language keywords* (Module, Rule, has, given …) across
locales. That handles L1 (language keywords) and L2 (LSP / editor UI)
acceptably for the parser.

It does NOT handle L3 — **product / compliance terminology** that
appears in user-facing UI (`aster-cloud/messages/*.json`) and public
docs (`aster-lang-dev/docs/*.md`, `aster-cloud/docs/**.md`). Without
enforcement, this layer drifts:

- "envelope encryption" vs "信封加密" vs "封套加密" (zh drift).
- J5 adds 12 new `messages/*.json` keys; `docs/zh/learn` never updated.
- New locale added; SaaS admin UI + DPA template stay English.

## Decision

Introduce a **single source of truth** for L3 terminology as a published
npm + Maven artifact: `@aster-cloud/glossary` / `io.aster:glossary-contract`.

- Concept-level schema (terms keyed by stable ID, not surface string).
  Homonyms split into distinct concepts with `sense` + `disambiguation`.
- Per-consumer `glossary.config.yaml` declares scanned surfaces;
  scanning is surface-owned not term-owned (catches drift in surfaces
  that don't opt in).
- AST-aware scanner (JSON key-path + Markdown block-ID pairing) with
  Unicode-confusable, ZWSP, RTL, mixed-direction defenses.
- 4-stage remediation flow (inventory → seed → per-surface PRs →
  strict-mode enforcement).
- Released artifacts cross-checked: npm provenance + Maven GPG;
  manifest signed; out-of-band denylist for emergency revocation.

## Alternatives considered

1. **Per-consumer YAML in each repo.** Rejected: same drift problem
   the contract is meant to solve.
2. **Bolt-on to the existing lexicon system.** Rejected: L1 and L3
   have different vocabularies, different contributors, different
   release cadence (lexicons are stable; product terms churn weekly).
3. **Translation-memory tool (Crowdin/Lokalise).** Rejected: those
   help with locale completeness but do not enforce term consistency
   across consumers; v7 §1.4 explicitly requires surface-owned scanning.

## Consequences

- Adding a new product term goes through a glossary PR (review-gated).
- Every consumer repo runs `check:glossary` in CI.
- ~57 engineer-days/year ongoing maintenance for 3 locales (per v7 §12.3).
- New locales become a 1-line `locales.yaml` change + per-surface
  translation work; never a code change to consumers.

## Related ADRs

- ADR-0005 — Locale backbone = en-US.
- ADR-0006 — Enforcement tiers + CODEOWNERS-gated promotion.
