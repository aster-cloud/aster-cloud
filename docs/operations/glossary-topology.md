---
last-reviewed-at: 2026-05-20
owner: '@aster/platform'
reviewer: '@aster/glossary-stewards'
review-cadence: annual
---

# Glossary Contract — Architecture topology

**Plan**: `.claude/plan/glossary-contract.md` v7 H6 (hardening)
**Scope**: One-page map of who owns what across repos, external
services, access levels, and CI validators.

## Repos

```
   aster-design-system  (PUBLIC, source of truth)
   │
   ├── packages/glossary           ← @aster-cloud/glossary (npm)
   │   │                           ← io.aster:glossary-contract (Maven Central)
   │   ├── src/locales.yaml        — backbone=en-US, localesVersion
   │   ├── src/terms/*.yaml        — 38 seed concepts
   │   ├── src/scanner.ts          — exported via @aster-cloud/glossary/scanner
   │   ├── releases/<v>.json       — signed manifests, GPG `glossary-ci-signing-key`
   │   └── releases/denylist.json  — out-of-band, signed by `glossary-release-eng-key`
   │
   └── packages/glossary-fmt       ← @aster-cloud/glossary-fmt (npm)
       └── block-id formatter / sync / lint

   aster-cloud                                aster-lang-dev                   aster-lang-{en,zh,de}
   (PUBLIC)                                   (PUBLIC)                         (PUBLIC, contributor-friendly)
   │                                          │                                │
   ├── glossary.config.yaml                   ├── glossary.config.yaml         ├── overlays/*.json
   ├── messages/{en,zh,de}.json               ├── docs/{en,zh,de}/**.md        │     (G4 validator-checked)
   ├── docs/on-prem/.glossary/                ├── docs/.glossary/              └── lexicons/<bcp47>.json
   ├── docs/saas/.glossary/                   └── .github/workflows/ci.yml
   └── scripts/check-glossary.ts

   aster-deploy/private/glossary  (PRIVATE, git-crypt)
   └── deal-overrides.yaml         — REAL customer deal data only here

   aster-lang-core                 (PUBLIC)
   └── OverlayValidator.java       — cross-locale overlay parity for L2
```

## External services

| Service | Used for | Access | Owner |
|---|---|---|---|
| npm registry | Publish `@aster-cloud/glossary` + `@aster-cloud/glossary-fmt` | Trusted publishing via GitHub OIDC | `@aster/platform` |
| Maven Central (OSSRH) | Publish `io.aster:glossary-contract` | Sonatype account + GPG signing | `@aster/platform` |
| Cloudflare Pages CDN | Serve `releases/*.json` + `denylist.json` at `glossary.aster-lang.cloud` | Auto-deploy from `aster-design-system/main` | `@aster/platform` |
| GitHub raw URL | Backup manifest source | Read-only public | (GitHub) |
| GitHub App (`aster-glossary-matrix-bot`) | G7 coverage matrix; G8b lockfile-bot fanout | scoped permissions per `glossary-prerequisites.md` | `@aster/platform` |
| Vault | `glossary-release-eng-key` storage | Vault role `@aster/glossary-stewards` | `@aster/platform` |
| Cloud KMS (GCP or AWS) | `glossary-ci-signing-key` host | OIDC binding to `production-publish-*` env | `@aster/platform` |
| PagerDuty (or OpsGenie / Slack) | P0 freeze-bypass paging | PagerDuty service `glossary-p0-steward` | `@aster/glossary-stewards` |
| Slack | Cosmetic-window watcher notifications | Webhook to `#glossary-stewards` | `@aster/glossary-stewards` |

## Data classifications

| Data | Where | Sensitivity |
|---|---|---|
| Term definitions, translations, match rules | `aster-design-system/packages/glossary/src/terms/*.yaml` | Public |
| Release manifests | `aster-design-system/packages/glossary/releases/*.json` | Public |
| Denylist | `aster-design-system/packages/glossary/releases/denylist.json` + CDN | Public (signed) |
| Glossary config per consumer | `<consumer>/glossary.config.yaml` | Public |
| Block-id sidecars | `<consumer>/<doc-tree>/.glossary/block-map.json` | Public |
| **Deal-override records** | `aster-deploy/private/glossary/deal-overrides.yaml` | **Private (git-crypt)** |
| GPG public keys | Bundled in npm + Maven artifacts | Public |
| GPG private keys | Vault + KMS | Restricted (steward role) |
| CI signing key private | KMS only (never extractable) | Restricted (OIDC-bound only) |

## CI validators

| Validator | Where | Validates |
|---|---|---|
| `check-glossary` | `aster-cloud`, `aster-lang-dev` | Surface scan: forbidden-alias + term-mention parity + block-pair |
| `check-locale-parity` | `aster-lang-dev` | Every backbone `.md` has zh + de mirrors |
| `OverlayValidator` | `aster-lang-core` (Gradle) | Overlay-file presence + key parity vs backbone |
| `verify-release-manifest` | every consumer | Pinned glossary version is `promoted`, signed, not denylisted |
| `glossary-fmt lint` | every consumer (pre-commit + CI) | Every marker has block-map entry; no orphans |
| Schema-sync (H2) | `aster-deploy` CI | Private `deal-overrides.yaml` matches public schema |
| Coverage matrix | `aster-design-system` CI (G7) | Cross-repo (repo × surface × locale) coverage |

## Trust boundaries

- **GitHub admin** can modify workflows + secrets in any Aster-owned
  repo. Cannot extract the CI signing key from KMS (OIDC-bound).
  Mitigation: two-person approval at `npm-promoting` per v7 §8.2.
- **npm token compromise** alone cannot poison Maven consumers (and
  vice versa) — dual artifact + GPG signing.
- **Steward role compromise** can override fail-closed denylist gate.
  Mitigation: two-person sign-off (steward + security officer) required
  per v7 §12.4 override authority table.
- **Source compromise** (someone with merge rights to
  `aster-design-system`) is the hardest to mitigate. Signed commits +
  CODEOWNERS reviews are the controls.

## Cross-references

- `glossary-prerequisites.md` — provisioning each service.
- `gpg-key-lifecycle.md` — key rotation.
- `cascade-outage.md` — what happens when services fail.
- `rc-and-recovery.md` — release pipeline that integrates all the above.
- `.claude/plan/glossary-contract.md` — full design (v7).
