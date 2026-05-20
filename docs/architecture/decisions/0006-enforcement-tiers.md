---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
---

# ADR-0006 — Enforcement tiers + CODEOWNERS-gated promotion

**Status**: Accepted
**Date**: 2026-05-20
**Plan**: `.claude/plan/glossary-contract.md` v7 §1.6 + §8.4

## Context

The glossary contract (ADR-0004) needs to apply to all consumers without
blocking community-contributed locale repos that may have transient
findings during onboarding. A pure "everything blocks CI" policy excludes
the community contribution path the project depends on for new languages.

## Decision

**Two enforcement tiers, declared per-repo in `glossary.config.yaml`:**

| Tier | Scanner exit behavior | CI policy |
|---|---|---|
| `official` | Errors fail CI; warnings fail CI under `--strict` | Hard block on merge |
| `community` | Errors print as warnings; CI passes regardless | Pass + artifact upload |

**The `tier:` field is CODEOWNERS-protected.** Promotion (community →
official) is governed by:

1. Community-tier repo must show **zero shadow-strict errors** for 14
   consecutive days (CI runs strict in shadow mode alongside the
   non-strict gate).
2. Maintainer opens a promotion issue in `aster-design-system` (the
   contract's home repo).
3. `@aster/glossary-stewards` reviews the shadow-run history and the
   linked CI artifacts.
4. On approval, PR flips `tier: community → official`. Both the local
   repo's CODEOWNERS and `aster-design-system`'s issue must approve.
5. Next CI run blocks on errors.

**Demotion** (official → community) requires the same approval flow.
This prevents accidental tier loosening from a single rushed PR.

## Community-repo fallback (v6 fix)

Repos not in the Aster org and lacking `@aster/glossary-stewards` in
their CODEOWNERS use a two-party model:

- Local repo maintainer approves the `tier:` PR.
- An issue in `aster-design-system` (the governance repo) gets a
  separate approval from `@aster/glossary-stewards`.
- Both required before CI honors the flipped tier.

## Alternatives considered

1. **Single tier with `--skip-checks` flag.** Rejected: a per-PR
   bypass is invisible after merge; tier change is a deliberate,
   reviewable, reversible governance event.
2. **N-tier scale (e.g., draft / community / official / locked).**
   Rejected: 2 tiers already cover the use cases; more tiers add
   policy-design overhead without proportionate benefit.

## Consequences

- New locale repos (e.g., `aster-lang-fr` post-launch) onboard at
  `community` tier; CI warns but doesn't block while translations
  catch up.
- Existing `aster-cloud`, `aster-lang-dev`, `aster-lang-{en,zh,de}`
  promote to `official` after their Stage 4 PRs land.
- The 14-day shadow-strict requirement adds latency before promotion;
  this is a deliberate quality gate.

## Related ADRs

- ADR-0004 — Glossary contract layer.
- ADR-0005 — Locale backbone = en-US.
