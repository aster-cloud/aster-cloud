---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/lang'
review-cadence: annual
---

# Runbook — Add a new locale to the Glossary Contract

**Plan**: `.claude/plan/glossary-contract.md` v7 §3.4 + §10
**Scope**: Adding a locale (e.g., `ja-JP`) to the glossary's
`locales.yaml`, then driving every consumer to translate.

This is a multi-week wall-clock operation. Engineering work is small;
translation throughput is the bottleneck.

## Pre-flight

- Confirm a translator pool is sourced for the new locale.
- Confirm legal review is sourced if any `backbone-change-type: legal`
  terms exist (e.g., GDPR/DSGVO wording differences).
- Confirm steward + product approval for the strategic decision to
  support this locale.

## Step 1 — Open the `localesVersion` bump PR

In `aster-design-system`:

```yaml
# packages/glossary/src/locales.yaml
version: 1
localesVersion: 2          # bumped from 1
locales:
  - id: en-US
    role: backbone
    bcp47: en-US
  - id: zh-CN
    bcp47: zh-Hans-CN
  - id: de-DE
    bcp47: de-DE
  - id: ja-JP
    bcp47: ja-JP            # NEW
```

CI immediately turns red. Expected — every term needs a `ja-JP`
translation that doesn't exist yet. The PR description includes a
worklist link.

## Step 2 — Translation team fills `translations.ja-JP` in every term

Open a single PR per category (telemetry, encryption, compliance,
licensing, cron — see `packages/glossary/src/terms/*.yaml`). For each
term, add the `translations.ja-JP` line. The PR is reviewed by
`@aster/glossary-stewards` + the new locale's reviewer.

## Step 3 — Cut the release

Once every term has a `ja-JP` translation:

1. Glossary stewards run the release pipeline (see `rc-and-recovery.md`).
   - Bump to v1.N.0 (minor API bump because the scanner-input shape
     grows; `localesVersion` becomes 2).
   - RC validation runs against every consumer.
   - Promote.
2. Lockfile-bot opens consumer PRs.

## Step 4 — Consumer-side translation (parallel)

For each consumer repo (`aster-cloud`, `aster-lang-dev`, `aster-lang-*`):

- Translate `messages/ja.json`, `docs/ja/**`, `overlays/*.json`'s
  `ja-JP` equivalents.
- Shadow-strict CI runs the new locale; reports gaps as artifacts.
- Each PR owned by the relevant translator-reviewer.

Until every consumer's `glossary.config.yaml.localesVersion` is
updated to `2`, the scanner runs the new locale in **shadow mode**
(plan v7 §3.4).

## Step 5 — Promote

Once all consumers reach `localesVersion: 2` with zero shadow-strict
errors, stewards merge a final PR documenting global readiness.

## Step 6 — Dry-run validation (G7-equivalent)

For any locale added post-launch, run the coverage matrix script
(see `coverage-matrix.md`) and commit the result to
`docs/operations/add-locale-dry-run-<bcp47>.md`. This is the
acceptance artifact.

## Timeline expectations (per v7 §9.4)

| Phase | Translation team | Lexicon team |
|---|---|---|
| 38 glossary terms | 0.5–1d | — |
| `aster-cloud/messages/<locale>.json` (~700 keys) | 3–5d | — |
| `aster-cloud/docs/on-prem/**.md` (5 files) | 5–7d | — |
| `aster-lang-dev/docs/<locale>/{getting-started,learn,community}` (14 files) | 5–7d | — |
| `aster-lang-<locale>` lexicon + overlays | — | 3–5d |
| **Wall-clock with parallelism** | | **~2 weeks** |

## Related runbooks

- `add-term.md` — adding a single term (one-off, not full locale).
- `rc-and-recovery.md` — RC publish + bad-release procedure.
- `coverage-matrix.md` — G7 coverage matrix generator.
