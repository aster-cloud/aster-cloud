---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/platform'
review-cadence: quarterly
---

# Runbook — Coverage matrix generation (G7)

**Plan**: `.claude/plan/glossary-contract.md` v7 §10.2
**Scope**: How to produce the CI-generated coverage matrix used as
the G7 acceptance artifact for any add-locale or post-launch
governance review.

## Auth model

The matrix script (`scripts/generate-coverage-matrix.ts` in
`aster-design-system`) uses a GitHub App
(`aster-glossary-matrix-bot`) with scoped permissions:

- `metadata:read` — list installed repos.
- `contents:read` — fetch `glossary.config.yaml` from each.
- `actions:read` — fetch latest CI run + artifact for each.
- `pull-requests:write` — open lockfile-bump PRs (G8b reuse).

Installation IDs stored as secrets in `aster-design-system`:
- `GLOSSARY_BOT_APP_ID`
- `GLOSSARY_BOT_PRIVATE_KEY`
- `GLOSSARY_BOT_INSTALLATION_ID`

Provisioning steps in `glossary-prerequisites.md`.

## Running

```bash
cd aster-design-system
pnpm tsx scripts/generate-coverage-matrix.ts > docs/operations/add-locale-dry-run-<bcp47>.md
# Then in aster-cloud:
git -C ../aster-cloud add docs/operations/add-locale-dry-run-<bcp47>.md
git -C ../aster-cloud commit -m "G7: coverage matrix for <bcp47>"
```

## Matrix shape

```markdown
| Repo | Surface | Locale | Expected? | CI gap reported? | Evidence | Owner sign-off |
|---|---|---|---|---|---|---|
| aster-design-system | terms/*.yaml | ja-JP | yes | yes (38/38 missing) | [CI run](https://...) | @glossary-stewards ✅ |
| aster-cloud | messages | ja-JP | yes | yes (messages/ja.json missing) | [CI run](https://...) | @i18n-cloud ✅ |
...
```

## Missing-config behavior

For repos in `consumers.yaml` without a `glossary.config.yaml`:

- `status: onboarding` rows → emit as `<ONBOARDING-PENDING>`; G7
  reports but doesn't block.
- `status: active` rows missing config → emit as `<MISSING-CONFIG>`;
  **G7 acceptance criterion blocks** until config exists.

## Acceptance gate

G7 passes only when:

1. Every cell of the generated matrix has `CI gap reported = yes`
   AND `Owner sign-off` filled.
2. Zero `<MISSING-CONFIG>` rows.
3. Zero `AUTH-FAILURE` rows.

## Rate limiting

GitHub App limit is 5000 req/h per installation. The matrix touches
N repos × ~3 surfaces × ~3 locales — comfortably under the limit
for any realistic N. Retry-after handling for occasional 403s.

## Failure modes

- Repo inaccessible → matrix row marked `AUTH-FAILURE`; pages
  steward team.
- GitHub App token expired → CI fails fast; rotation per
  `glossary-prerequisites.md`.

## Pre-G0.5 fallback

Until the GitHub App is provisioned (G0.5 prerequisite), the script
falls back to **local repo paths** in `~/IdeaProjects/aster-*`. Useful
for dry-runs during contract development; not appropriate for the
final G7 acceptance artifact (which must reflect actual CI runs).

Switch happens automatically: if all three `GLOSSARY_BOT_*` env vars
are set, use the App; else fall back to local paths and print a
warning that the output is dev-only.

## Related runbooks

- `add-locale.md` — the locale-add procedure G7 validates.
- `glossary-prerequisites.md` — GitHub App provisioning.
