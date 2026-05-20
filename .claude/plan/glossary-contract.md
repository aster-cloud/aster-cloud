# Glossary Contract — Implementation Plan (v7)

**Status**: Draft v7 — ready to execute (production-grade). Score trajectory v1=47, v2=64, v3=72, v4=79, v5=84, v6=87. v7 incorporates all v6 codex findings including 1 Critical.

**Scope**: Production-grade enforcement of cross-locale terminology across the Aster ecosystem (`aster-cloud`, `aster-lang-dev`, `aster-lang-{en,zh,de,...}`, `aster-lang-core`).

**Non-goals**: Replace hot-pluggable lexicons; auto-translate; ship per-tenant runtime overrides in v1 (schema shape reserved + handoff trigger documented).

**v7 changes (addressing v6 findings)**:

- §13.1.1 **Critical fix**: `deal-overrides.yaml` **relocated to private storage** (`aster-deploy/private/glossary/deal-overrides.yaml` — git-crypt encrypted; CRM-system-of-record alternative documented). `aster-cloud/docs/operations/` keeps only the field-schema definition + redacted example, no real deal data.
- §3.6 + §8.7 — denylist cache TTL reduced from 24h to **1h, fail-closed**; multi-source mandatory (`cdn,github,internal-mirror`) tested via failover acceptance criterion.
- §1.7.1 — PagerDuty (or equivalent OpsGenie/Slack-paging) is **explicit G0.5 prerequisite**; provider-agnostic on-call interface so non-PagerDuty teams still satisfy the SLO.
- §1.7.2 — CI signing key migrates from **GitHub Actions secret** to **GitHub OIDC → KMS** (no exportable private key in Actions); the release-engineer key remains in Vault for manual signing.
- §13.1.1 — new runbook `tenant-overridable-change.md` (steward + product + security approval) for marking an existing term `tenant-overridable: true` after a customer request.
- §10.2.1 — `consumers.yaml` adds `status: onboarding | active`; G7 acceptance criterion blocks `active` consumers with missing config, reports `onboarding` separately with deadline tracking.
- §12.3 — quarterly metric review **assigned owner** (`@aster/glossary-stewards`) with explicit trigger to open a "contract simplification" ADR.
- §1.5.1 — block ID pattern updated to `<file-slug>-<heading-slug>-<node-type>-<seq>` (file namespace eliminates cross-file collisions).
- §8.7 — `.glossary/cache/` is **gitignored**; CI-populated only; deterministic state lives in `glossary.config.yaml` + lockfiles.
- §11 G5 acceptance: **9 runbooks** (was stale "7"); G4 acceptance: **4.5 days** (was stale "4"); engineer-day total **45** (was stale "44" in summary line).
- §12.4 NEW — **cascade outage policy**: which checks fail-closed, which allow cached operation, who can override during multi-service outage.
- Inherited from v6: configurable manifest URL + cache, fmt.config.yaml rules, glossary-fmt move-file, out-of-band denylist, consumers.yaml, on-call + GPG runbooks, cosmetic watcher, runbook owners, OSSRH evidence capture, maintenance tax quantified, deal-override schema linkage.

---

## 0. Why this exists

| Layer | What | Current enforcement | Drift risk |
|---|---|---|---|
| L1 — language keywords | `aster-lang-{locale}/.../lexicons/*.json` | `LexiconContributorValidator` (Java) | ✅ Low |
| L2 — LSP / editor UI | `aster-lang-{locale}/.../overlays/*.json` | **None** — `aster-lang-de` missing 3 of 5 overlay files | 🔴 High (proven) |
| L3 — product / compliance UI | `aster-cloud/messages/{en,zh,de}.json` | `scripts/check-locales.ts` enforces *key parity*, not *term consistency* | 🟠 Medium-High |
| L3 — public docs | `aster-lang-dev/docs/{,zh,de}/...` | **None**; zh/de cover only 14/36 English files | 🔴 High |
| L4 — industry vocabularies | `aster-lang-{locale}/.../vocabularies/*.json` | None | 🟡 Medium |

### 0.1 Stakeholder / ownership matrix (G0 pre-execution gate)

| Repo | Maintainer team | Required for | Sign-off |
|---|---|---|---|
| `aster-design-system` | `@aster/platform` | G1, G8a/b infra | required |
| `aster-cloud` | `@aster/cloud` | G2, ADRs, runbooks, G7 evidence | required |
| `aster-lang-dev` | `@aster/docs` | G3 | required |
| `aster-lang-core` | `@aster/lang` | G4, G6 | required |
| `aster-lang-en` | `@aster/lang` (official) | G4, G6 | required |
| `aster-lang-zh` | `@aster/lang` (official) | G4, G6 | required |
| `aster-lang-de` | `@aster/lang` + community | G4 backfill | required |
| `@aster/glossary-stewards` | governance role | tier promotion, change-type approval | ≥ 2 members staffed |
| Per-locale translation reviewers | per-locale ownership | Stage 3 PRs, backbone-change ack | one per active locale |
| `@aster/legal` | compliance role | `backbone-change-type: legal` approval | required if compliance-affecting terms exist |
| `@aster/deal-desk` | sales role | tenant-override deal escalation (§13.1) | required for enterprise SKU |

**G0 gate**: PR adds this matrix to `aster-cloud/docs/operations/glossary-stakeholders.md` with `Acked-by:` trailers. No G1 commit lands before this PR merges.

### 0.2 G0.5 — Infrastructure prerequisites (NEW pre-G1)

Documented as `docs/operations/glossary-prerequisites.md`. G1 preflight check validates each:

1. **npm trusted publishing** configured for `@aster-cloud/glossary` + `@aster-cloud/glossary-fmt`. Provenance enabled (`--provenance` flag in CI). Test: `npm view <existing-package>@latest _attestations` returns a record.
2. **OSSRH credentials** for `io.aster` group. GPG signing key in CI secrets. Test: dry-run publish to OSSRH staging from a no-op artifact succeeds.
3. **GitHub App `aster-glossary-matrix-bot`** installed in the Aster org with permissions: `contents:read` (for all consumer repos), `metadata:read`, `pull-requests:write` (for lockfile PRs in §8.4). Installation IDs recorded in `aster-design-system` repo secrets.
4. **CODEOWNERS team `@aster/glossary-stewards`** exists with ≥ 2 members; team has write access to relevant paths in every consumer repo.
5. **Protected GitHub Environments** `production-publish-npm`, `production-publish-maven` defined in `aster-design-system` with two-reviewer approval rule.

Estimate: 0.5d wall-clock if all credentials/teams already exist; up to 2d if any need IT/legal procurement. Tracked as part of G0 budget.

### 0.3 Execution-hardening checklist (v7 review residuals)

Carried forward from v7 codex review as G0/G1 hardening items. None block plan acceptance (v7 reached 91/100 READY); all must be **closed before strict-mode flip** in §4.4 Stage 4.

| # | Item | Resolve at | Owner |
|---|---|---|---|
| H1 | KMS IAM binding change-control separation: IAM admin role distinct from release-engineer role; binding changes require platform + security approval | G0.5 (prereqs setup) | `@aster/platform` + `@aster/security` |
| H2 | Public/private deal schema drift detector: `aster-deploy` CI imports public `deal-overrides.schema.yaml` by checksum and fails on divergence | G1 (when private validator written) | `@aster/deal-desk` |
| H3 | Document the 1h denylist cache window as **accepted residual risk** in §12.1 | G0 (now) | `@aster/glossary-stewards` |
| H4 | Multi-source denylist consistency: consumer fetches all configured sources and prefers highest valid signed `updated-at` | G8a (denylist fetcher impl) | `@aster/platform` |
| H5 | G5 acceptance wording: replace "12 runbooks ... or 11 if deferred" with explicit "12 runbooks merged" (or split required vs deferred list) | G5 (writing) | `@aster/glossary-stewards` |
| H6 | Architecture topology diagram: one page mapping artifact / canonical repo / access level / owner / CI validator | G5 (alongside ADRs) | `@aster/platform` |
| H7 | G5 budget realism: track writing time (current 2.5d) separately from cross-team review latency in wall-clock plan | G5 (scheduling) | `@aster/glossary-stewards` |

These are not gates on starting G0 — they're tracked so they aren't lost between now and the Stage 4 strict-mode flip.

---

## 1. Architecture

### 1.1 Where the glossary lives

```
aster-design-system/
└── packages/
    ├── tokens/                       # existing
    ├── ui/                           # existing
    ├── glossary/                     # NEW — single source of truth
    │   ├── package.json              # @aster-cloud/glossary
    │   ├── src/
    │   │   ├── locales.yaml          # locale registry + localesVersion
    │   │   ├── terms/                # YAML per term family
    │   │   ├── index.ts
    │   │   ├── loader.ts
    │   │   ├── scanner.ts            # exported as ./scanner
    │   │   ├── manifest.ts           # release manifest reader + verifier (§8.1, §8.7)
    │   │   ├── denylist.ts           # bad-version denylist (§3.6)
    │   │   └── schema.ts
    │   ├── releases/                 # release manifests (§8.1, archived per §8.8)
    │   ├── dist/
    │   ├── maven/                    # Maven Central artifact
    │   └── tests/                    # contract + scanner adversarial + RC
    ├── glossary-fmt/                 # NEW — block-id formatter/linter
    │   ├── package.json              # @aster-cloud/glossary-fmt
    │   └── src/                      # remark plugin + CLI + block-map.json reader
    └── glossary-matrix-bot/          # NEW — GitHub App handler (§10.2)
        └── src/                      # used by G7 coverage matrix
```

**Distribution** (unchanged from v4):
1. npm: `@aster-cloud/glossary` + `@aster-cloud/glossary-fmt`.
2. Maven Central: `io.aster:glossary-contract`.

### 1.2 Term schema

(Unchanged from v4 §1.2; included for reference.)

```yaml
terms:
  envelope-encryption:
    id: envelope-encryption           # stable, kebab-case, immutable
    category: encryption
    sense: encryption.wrapping
    part-of-speech: noun
    disambiguation: >
      Product security feature wrapping HMAC secrets under a KEK.
      NOT a mailing envelope; NOT a legal envelope; NOT a UI container.
    definition: >
      AES-256-GCM wrapping of per-license HMAC verification secrets
      under a KEK held in our secrets manager.
    legal-basis: GDPR Art 32
    introduced-in: J3
    user-facing: true
    lifecycle:
      status: active
      since-version: 1
      backbone-revision: 1
      backbone-change-type: terminology   # cosmetic | terminology | semantic | legal
      backbone-change-approved-by:        # NEW v5: gate per §7.3
        - role: glossary-steward
          actor: alice@aster
          at: 2026-05-15T10:00:00Z
      reviewed-backbone-revision:
        zh-CN: 1
        de-DE: 1
    translations:
      en-US: envelope encryption
      zh-CN: 信封加密
      de-DE: Umhüllungsverschlüsselung
    match:
      mode: phrase
      case-sensitive: false
      boundary: unicode-word
      normalize: [case, width, punctuation, whitespace]
    forbidden-aliases:
      zh-CN:
        - { text: 封套加密, match: { mode: phrase, case-sensitive: false } }
        - { text: 包络加密, match: { mode: phrase, case-sensitive: false } }
    applies-to:
      - aster-cloud:messages
      - aster-lang-dev:docs
      - aster-cloud:docs/on-prem
    tenant-overridable: false
    do-not-translate: false
```

Schema invariants (Zod) — added in v5:
- `lifecycle.backbone-change-approved-by` is **required** when `lifecycle.backbone-revision > 1`. The approval shape is checked against `backbone-change-type` per §7.3 table.
- Approval `actor` must be a member of the role's CODEOWNERS team at the time of merge (validated by GitHub Action `check-glossary-approvals`).

### 1.3 `locales.yaml` + `localesVersion`

(Unchanged from v4.)

```yaml
version: 1
localesVersion: 3                    # bumped on locale add/remove
locales:
  - id: en-US
    role: backbone
    bcp47: en-US
  - id: zh-CN
    bcp47: zh-Hans-CN
  - id: de-DE
    bcp47: de-DE
```

### 1.4 Consumer model — surface-owned scanning

(Unchanged from v4. `applies-to` is reporting-only; never excludes a surface.)

```yaml
# <consumer>/glossary.config.yaml
version: 1
tier: official                       # official | community
localesVersion: 3
glossary-pin:                        # NEW v5: pinned package version + checksum
  version: 1.0.0
  npm-integrity: sha512-...
  maven-sha256: ...
surfaces:
  messages:
    type: json
    paths: [messages/en.json, messages/zh.json, messages/de.json]
    backbone-locale: en-US
    locale-from-filename: true
  docs-onprem:
    type: markdown
    paths: docs/on-prem/**/*.md
    locale-from-frontmatter: true
    fallback-locale: en-US
    alignment: block-id
    block-map: .glossary/block-map.json     # NEW v5: sidecar (§1.5)
ignored-surfaces:
  - path: docs/architecture/decisions/**/*.md
    reason: ADRs are en-only by policy
    expires: never
untranslated-tokens: [Aster, Stripe, Resend, Cloudflare, GDPR]
overlay-classification:
  unmanaged-policy: error
```

### 1.5 Block-ID alignment — insert-once + persistent sidecar (v5 fix)

(Closes v4-codex finding #3: deterministic hash unstable on edits.)

**v4 strategy** (deprecated): IDs derived from `hash(file-path + heading-trail + first-N-tokens)`. Problem: any heading rename or sentence edit changed the hash → block-pair broken.

**v5 strategy**: IDs are **assigned once at insertion time** and persisted in a sidecar:

```
docs/on-prem/
├── telemetry.md
├── zh/telemetry.md
├── de/telemetry.md
└── .glossary/
    └── block-map.json              # source of truth for block IDs in this tree
```

`block-map.json` content:

```json
{
  "version": 1,
  "blocks": {
    "telemetry-opt-in-paragraph": {
      "created-at": "2026-05-20T10:00:00Z",
      "created-by": "glossary-fmt v1.0.0",
      "occurrences": {
        "telemetry.md":     { "line-hint": 14 },
        "zh/telemetry.md":  { "line-hint": 15 },
        "de/telemetry.md":  { "line-hint": 14 }
      },
      "alias-of": null              # for renamed blocks: points to canonical id
    }
  }
}
```

In each `.md` file, the marker is just:

```markdown
<!-- glossary:block id=telemetry-opt-in-paragraph -->
The on-prem deployment sends a weekly batch of aggregate counters.
<!-- /glossary:block -->
```

The ID is **independent of file content**. Headings rename freely; prose rewrites freely; block-id stays the same. The line-hint in the map is advisory (used by `glossary-fmt lint` to detect blocks that wandered far from their hint, indicating a possible structural break worth a human review).

`glossary-fmt` CLI:

- `glossary-fmt insert <doc-tree>` — first-time annotation. Detects paragraph blocks per `fmt.config.yaml` rules, generates **collision-resistant unique IDs** by combining a short slug from the heading + a sequence number scoped to the file (`telemetry-opt-in-paragraph-1`, `telemetry-opt-in-paragraph-2`). Writes both the markers and the sidecar `block-map.json`.
- `glossary-fmt sync <en-file> <target-file>` — scaffolds matching marker pairs in target-locale file with the SAME IDs as backbone. Updates `block-map.json.occurrences`.
- `glossary-fmt lint <doc-tree>` — validates: every marker in any `.md` has a corresponding entry in `block-map.json`; every entry in `block-map.json.occurrences` corresponds to an actual marker; no duplicate IDs in one file; no orphan markers.
- `glossary-fmt rename-block <old-id> <new-id>` — atomic rewrite of every occurrence in every locale file + updates `block-map.json`. Creates `alias-of: <old-id>` entry for 30-day deprecation window.

**Recover from accidental ID deletion**: if a marker is hand-deleted, `glossary-fmt lint` flags the orphaned `block-map.json` entry. Human re-inserts the marker around the right block (the line-hint helps locate where it used to be). No silent breakage.

Scanner behavior with sidecar:

| Situation | Behavior |
|---|---|
| Marker in `.md`, no `block-map.json` entry | Error: "orphan marker `<id>`" |
| `block-map.json` entry, no marker in any `.md` | Error: "missing marker for id `<id>`" |
| Same id in en and zh but text completely diverged (heuristic detection) | Warning: "block `<id>` content diverged > 70% — verify alignment" |
| Block paired by `alias-of` during deprecation | Allowed; warning if deprecation window past 30 days |

This makes blocks **stable under any edit** that doesn't deliberately rename them.

#### 1.5.1 Formatter block-detection rules (v6 NEW)

(Closes v5-codex #9: "detects paragraph blocks per `fmt.config.yaml` rules" was unspecified.)

`glossary-fmt insert` block-detection is **fully deterministic**. Two engineers running it on the same file produce the same IDs and block boundaries.

Default `fmt.config.yaml` shipped with `@aster-cloud/glossary-fmt`:

```yaml
version: 1
node-rules:
  # Each rule: AST node-type → block boundary policy.
  paragraph:        { boundary: include, min-length-chars: 40 }   # skip ultra-short paragraphs (likely a stub)
  list:             { boundary: include, granularity: per-item }   # one block per list item
  table:            { boundary: include, granularity: per-row }   # one block per data row (skip header)
  blockquote:       { boundary: include, treat-as: paragraph }
  admonition:       { boundary: include, types: [note, warning, tip, caution, danger] }
  code:             { boundary: exclude }                          # fenced + inline code never get markers
  link-reference:   { boundary: exclude }
  link-url:         { boundary: exclude }
  inline-code:      { boundary: exclude }
  frontmatter:      { boundary: exclude }
  html-block:       { boundary: exclude }
  mdx-expression:   { boundary: exclude }
  mdx-jsx:          { boundary: exclude }
  thematic-break:   { boundary: exclude }                          # `---` separators
  heading:          { boundary: exclude }                          # headings are anchors, not scanned blocks
id-generation:
  pattern: "<file-slug>-<heading-slug>-<node-type>-<seq>"
  # file-slug: kebab-cased slug from the .md filename (without extension); guarantees file namespace (v7 — closes v6-codex #9).
  # heading-slug: kebab-cased slug from the nearest preceding `##` heading (or "intro" if none).
  # node-type: paragraph | list-item | table-row | admonition-{kind} | blockquote
  # seq: 1-based counter within (file × heading × node-type)
  intro-block-handling: prefix-with-intro    # blocks before any heading get `<file-slug>-intro-<node-type>-<seq>`
  collision-handling: append-discriminator   # if generated id already in block-map.json, append "-2", "-3", ...
overrides:
  # Per-file override via inline directive: <!-- glossary-fmt: skip-block --> on the line above any node
  per-file: docs/**/*.fmt.yaml                                    # optional override file per doc
```

Override directives in `.md`:

- `<!-- glossary-fmt: skip-block -->` on the line above a node → that node is excluded even if rule says include.
- `<!-- glossary-fmt: force-block -->` → include even if rule says exclude (e.g., wrap a code-fence as a block when the prose IS the code example).
- `<!-- glossary-fmt: block-id=custom-id -->` → use this exact ID instead of the generated one (collision-checked).

These rules are versioned: `fmt.config.yaml.version` field; bumping requires `@aster/glossary-stewards` approval; all existing block-maps then carry a `fmt-config-version: N` field to track which rule version produced them.

#### 1.5.2 File move operation (v6 NEW)

(Closes v5-codex #2: file moves break path-based sidecar occurrences.)

`glossary-fmt move-file <old-path> <new-path>` is a first-class command:

1. Validates `<old-path>` exists in `block-map.json.blocks[*].occurrences`.
2. Validates `<new-path>` doesn't already exist as an occurrence (collision check).
3. Updates every `block-map.json` entry's `occurrences` map: rename key `<old-path>` → `<new-path>`.
4. Renames the actual file in git (`git mv`).
5. Updates any sibling-locale equivalents (e.g., moving `docs/on-prem/foo.md` automatically updates `docs/on-prem/zh/foo.md` if configured under the same `alignment: block-id` surface).
6. Re-runs `glossary-fmt lint` on the moved tree.

`glossary-fmt move-file --dry-run` lists every block-map change before applying.

Common patterns:
- Reorganization: `glossary-fmt move-file docs/on-prem/old/foo.md docs/on-prem/new/foo.md`.
- Cross-tree move: `glossary-fmt move-file docs/on-prem/foo.md docs/saas/foo.md --reparent-block-map`. The `--reparent-block-map` flag moves entries from one tree's sidecar to another's (handles cross-sidecar moves explicitly).

CI gate: every PR that touches a `.md` path under a block-id alignment surface MUST either (a) leave block-map.json untouched, or (b) include a `glossary-fmt move-file` invocation in the PR description. The `check:glossary` CI step detects mismatched paths between `.md` files and `block-map.json` and fails the PR with a remediation hint.

### 1.6 Single config file: `glossary.config.yaml` + CODEOWNERS

(Unchanged from v4.) Tier mechanism + community fallback per ADR-0006.

### 1.7 Glossary prerequisites doc (v5 NEW)

`aster-cloud/docs/operations/glossary-prerequisites.md` lists every infrastructure dependency:

- npm trusted publishing setup procedure (link to npm docs).
- OSSRH (Sonatype) account + GPG key generation steps.
- GitHub App creation + installation procedure for `aster-glossary-matrix-bot`.
- Protected GitHub Environment setup for two-reviewer publish approval.
- Secret rotation cadence for OSSRH password (every 365 days).
- **P0 steward on-call rotation** — see `glossary-oncall.md` (§1.7.1).
- **GPG key lifecycle** — see `gpg-key-lifecycle.md` (§1.7.2).
- **On-call paging provider** (v7 — closes v6-codex #4): explicit choice between **PagerDuty** (default), **OpsGenie**, or **Slack-with-paging-bot**. Provider integration credentials added to repo secrets. The `verify-oncall-roster` preflight asserts a configured schedule + at least 2 active responders; provider-agnostic via a thin abstraction layer in `glossary-oncall.md`.
- **KMS-backed CI signing** (v7 — closes v6-codex #5): the `glossary-ci-signing-key` is provisioned as a **GitHub-OIDC-backed KMS key** (e.g., GCP KMS or AWS KMS), NOT a raw private key in GitHub Actions secret. The release workflow uses OIDC short-lived tokens to call `kms:sign`; the private key never leaves KMS. The `verify-ci-signing-kms` preflight asserts the OIDC binding exists and `kms:sign` permission is scoped to the release workflow only.

G1 has a preflight job that validates every prerequisite. Job names: `verify-npm-provenance-configured`, `verify-ossrh-credentials`, `verify-github-app-installed`, `verify-codeowners-teams`, `verify-oncall-roster`, `verify-gpg-trust-store`, `verify-ci-signing-kms`, `verify-paging-provider`. Any prerequisite missing → G1 blocked.

#### 1.7.1 P0 steward on-call rotation (v6 NEW — closes v5-codex #7)

`glossary-oncall.md` documents:

- **Roster**: glossary stewards rotate weekly through PagerDuty schedule `glossary-p0-steward`. Minimum 2 stewards in rotation (already required by §0.1 staffing).
- **Coverage**: 24×7 for P0 triggers (`Glossary-Freeze-Bypass:` trailer in a PR description against `aster-cloud` or `aster-lang-dev`). Business-hours-only for §7.3 cosmetic-window watcher (it's not a P0).
- **SLO**: 4h response time for P0 bypass request (§4.4). The PagerDuty page fires automatically when GitHub Actions detects the trailer.
- **Escalation**: if no steward responds within 4h, page goes to `@aster/incident-commander` who has emergency authority to merge the P0 bypass; glossary steward team is notified asynchronously. This handles "P0 incident overnight, no glossary steward awake".
- **Practice rotation**: quarterly dry-run page exercises the SLO.

#### 1.7.2 GPG key lifecycle (v6 NEW — closes v5-codex #10)

`gpg-key-lifecycle.md` documents:

- **Two distinct keys**:
  - `glossary-release-eng-key` — signs `releases/denylist.json` and emergency manual signing operations. Held in Vault, accessible to release-engineer role via Vault role binding.
  - `glossary-ci-signing-key` — signs release manifests (`releases/<version>.json`) during state machine transitions. (v7 — closes v6-codex #5) **Backed by cloud KMS** (GCP KMS or AWS KMS), invoked from the publish workflow via GitHub OIDC short-lived tokens. The private key never enters a GitHub Actions secret or any workflow runner; only `kms:sign` API calls cross the boundary. Audit log of every `kms:sign` call retained in CloudTrail/Cloud Audit Logs for 1 year. This means a GitHub admin who exfiltrates Actions secrets cannot sign manifests — they would also need to compromise the KMS IAM binding.
- **Key ownership**:
  - Release-engineer key: owned by `@aster/glossary-stewards`; loss/compromise triggers immediate rollover.
  - CI signing key: owned by `@aster/platform`; rotated annually as part of CI secret hygiene.
- **Rotation cadence**: annual scheduled rotation; emergency rotation within 24h on suspected compromise.
- **Departure procedure**: when a release engineer leaves, their key is revoked from the trust store within 24h; a new key issued to the replacement engineer; consumers' trust stores updated via the next `@aster-cloud/glossary` release (or out-of-band denylist push if urgent).
- **Trust store distribution**: public keys bundled in the `@aster-cloud/glossary` npm package and Maven artifact; consumers verify against the bundled set, not a remote keyserver (avoids keyserver-availability risk).
- **Emergency rollover**: if a key is suspected compromised mid-release-cycle, the recovery procedure is to publish an out-of-band signed denylist (§3.6) deny-listing any release signed by the compromised key since the suspected compromise time.

---

## 2. Workstream breakdown (v6 — final)

| ID | Title | Days | Depends on |
|---|---|---|---|
| **G0** | Stakeholder matrix + infra prerequisites (§0.1 + §0.2 + on-call roster + GPG keys) | **1.5** | — |
| **G1** | `@aster-cloud/glossary` + `@aster-cloud/glossary-fmt` + Java reader: schema + loader + 38 seed terms + scanner + formatter + block-map sidecar + move-file op + block-detection rules | **7** | G0 |
| **G2** | aster-cloud enforcement: AST scanner + 4-stage remediation + block-id annotation + branch strategy + freeze coordination | **8** | G1, G8a |
| **G3** | aster-lang-dev: new CI workflow + 4-stage remediation + block-id annotation | **5** | G1, G2, G8a |
| **G4** | Lexicon overlay parity: validator extension + classify ~99 overlay keys + **`aster-lang-de` backfill (~100 translations, 1.5d translation throughput buffer)** | **4.5** | G1 |
| **G5** | ADRs (0004/0005/0006) + 12 ops runbooks (v6 originals + v7 NEW `tenant-overridable-change.md`, `deal-override-process.md`, `cascade-outage.md`) | **2.5** | G1, G4, G8a |
| **G6** | Java consumer: Maven Central dep + reader + cross-check + Gradle tier wiring + denylist enforcement | **4** | G1, G4, G8a |
| **G7** | Add-locale dry-run (ja-JP); CI-generated coverage matrix; cross-team signoffs; revert | **5** | G1–G6, G8b |
| **G8a** | Release sequencing **bootstrap**: dual-publish atomicity + RC flow + registry verification + manifest state machine + out-of-band denylist publisher + recovery + OSSRH evidence capture | **4** | G1 (lockstep) |
| **G8b** | Release sequencing **consumer fanout**: lockfile-bot + `verify-release-manifest` consumer CI check + configurable manifest URL + auto-discovery of consumer repos + automated PR workflow | **4** | G8a, G2, G3, G6 |

**Total: 45.5 engineer-days. Wall-clock with parallelism: 28–32 working days.**

Order:

```
G0 (1.5d) → G1 ∥ G8a (7d, 4d, lockstep) → (G2 ∥ G3 ∥ G4.5) → G6 → G8b → G5 → G7
```

G8 split into G8a (bootstrap) + G8b (consumer fanout) resolves v4's circular dependency: G8a doesn't need consumer CI; G8b runs after G2/G3/G6 have instrumented consumers with `verify-release-manifest`.

---

## 3. G1 — glossary package

### 3.1 Deliverables

- `aster-design-system/packages/glossary/` — full source per §1.1.
- `aster-design-system/packages/glossary-fmt/` — formatter/linter with block-map sidecar support.
- `aster-design-system/packages/glossary-matrix-bot/` — GitHub App handler (used by G7).
- `src/schema.ts` — Zod for `TermSchema`, `LocaleSchema`, `GlossarySchema`, `MatchSchema`, `LifecycleSchema`, `ForbiddenAliasSchema`, `ReleaseManifestSchema`, `BlockMapSchema`, `BackboneApprovalSchema`.
- `src/loader.ts`, `src/scanner.ts`, `src/manifest.ts`, `src/denylist.ts`, `src/index.ts`.
- `src/terms/*.yaml` — 38 seed terms.
- `src/locales.yaml` — en-US + zh-CN + de-DE; `localesVersion: 3`.
- `dist/glossary.export.json` — flat key-value map.
- `maven/build.gradle.kts` — Maven Central artifact with generated Java reader.
- `tests/contract/` + `tests/scanner/` + `tests/integration/` per §3.3.

### 3.2 Dual publish with RC + atomicity guarantee

Same two-phase release as v4 §3.2 with v5's additions:

- npm provenance is enforced (G0.5 preflight; release CI fails if `--provenance` flag absent).
- Maven OSSRH stage closes before npm publishes (closes v4-codex finding #11 by reordering: Maven staging done first, npm publish only if Maven staged OK; npm publishes after the 4-hour Maven sync window starts, so the visible "half-state" minimizes).
- Release manifest reaches `npm-published` ONLY after Maven `closeAndRelease` returns success (synced or syncing).
- Lockfile PRs blocked until `promoted`. Consumer-side `verify-release-manifest` (§8.7) catches manual bumps.

### 3.3 Tests

**Contract** (`tests/contract/`):
- Schema rejection cases per §1.2 + v5 additions (`backbone-change-approved-by` required when revision > 1; approver actor must be in role's CODEOWNERS team).
- Cross-cutting completeness, cycle/dangling alias, homonym integrity, match-mode validity, lifecycle transition validity.
- Block-map sidecar: every marker has a map entry; every entry has a marker; no orphans.

**Scanner adversarial** (`tests/scanner/`):
- Unicode confusables, RTL marks, ZWSP, mixed-direction, emoji in compound terms, ICU placeholders, fenced/inline code, link URLs, frontmatter, HTML blocks, translated headings via block IDs.
- **Block-id stability tests**: rename a heading in a fixture file → assert block-id unchanged; rewrite first sentence → assert block-id unchanged; delete a marker → assert orphan detection.

**Integration** (`tests/integration/`):
- Local verdaccio (npm) + local Maven repo: build → install → load → query. Byte-equivalence between npm `glossary.export.json` and Maven artifact.
- **RC pipeline rehearsal**: publish to local registries → simulate consumer validation → promote.
- **Bad-release recovery rehearsal**: publish `0.0.0-bad-test` to **local verdaccio + OSSRH staging only** (NOT public Maven Central per v4-codex #11). Test denylist mechanism: add `0.0.0-bad-test` to denylist; assert scanner + Java reader both reject; assert lockfile-bot opens emergency PRs.
- Corruption resistance: mutate `glossary.export.json` byte → reader rejects on SHA mismatch.
- **Manifest tampering**: rewrite a `releases/*.json` to fake `promoted` state → assert manifest signature check fails (manifests are signed by CI).

Semver discipline unchanged from v4 §3.2.

### 3.4 Locale addition via `localesVersion`

(Unchanged from v4 §3.4. `localesVersion` bump + API minor; consumers run shadow mode until their config acks the new `localesVersion`.)

### 3.5 Seed term inventory

(Unchanged: 38 terms.)

### 3.6 Bad-release recovery via out-of-band signed denylist (v6 fix)

(Closes v4-codex finding #6 AND v5-codex finding #3.)

**v4 design** (deprecated): publish a metadata-only `deprecated.json` artifact. Problem: Maven Central has no deprecation protocol; consumers don't see this signal.

**v5 design** (deprecated): denylist bundled into the **next** released glossary version. Problem: if next release is 3 weeks away, bad version stays active for 3 weeks.

**v6 design**: denylist is published **out-of-band** to a stable URL, refreshed on every consumer CI run regardless of glossary release cadence.

Mechanism:

1. Bad version detected (e.g., `1.2.0` shipped a wrong translation).
2. Release engineer adds `1.2.0` to `releases/denylist.json` in `aster-design-system` and commits:
   ```json
   {
     "version": 1,
     "updated-at": "2026-05-20T15:00:00Z",
     "signature": "<GPG sig from release-engineer key over the entries array>",
     "entries": [
       {
         "package-version": "1.2.0",
         "reason": "Wrong zh-CN translation of 'envelope-encryption'",
         "replacement": "1.2.1",
         "denylisted-at": "2026-05-20T15:00:00Z",
         "denylisted-by": "alice@aster"
       }
     ]
   }
   ```
3. The merge to `aster-design-system/main` triggers a `publish-denylist.yml` workflow that:
   - Validates the GPG signature against the trust store bundled in the most recent `@aster-cloud/glossary` release.
   - Publishes `denylist.json` to **three mutually-independent sources** (v7 — multi-source mandatory, closes v6-codex #3):
     - **Primary**: `https://glossary.aster-lang.cloud/denylist.json` (Cloudflare Pages, backed by `aster-design-system` git).
     - **Secondary**: `https://raw.githubusercontent.com/aster-cloud/aster-design-system/main/packages/glossary/denylist.json` (GitHub raw).
     - **Tertiary**: bundled into the next `@aster-cloud/glossary` npm + Maven release as `denylist.json` (for air-gapped consumers).
   - Workflow fails if any of the three sources fails to publish, ensuring no partial-publish state.
4. **Consumer fetch on every CI run** (§8.7): `verify-release-manifest` fetches the denylist from all configured sources in order. Failure on one source falls through to the next; only when all configured sources fail does the local cache come into play.
5. **Local cache** (v7 — TTL reduced from 24h to **1h, fail-closed**, closes v6-codex #2):
   - Cache at `<repo>/.glossary/cache/denylist.json` with a 1-hour TTL.
   - On fetch failure with cache fresh (< 1h old): warning printed but CI passes using cache.
   - On fetch failure with cache stale (≥ 1h old): **CI fails** with "denylist source unreachable for >1h; cache stale; refusing to validate against potentially-outdated denylist".
   - This guarantees: a bad version denylisted now is rejected by any consumer CI run starting >1h after the denylist publish (vs v6's 24h window where consumers could keep using a bad version for nearly a full day).
   - The manifest's cache TTL stays at 24h (manifests don't change retroactively; only versions get added).
6. **Lockfile-bot fanout**: when the denylist publish workflow runs, lockfile-bot also opens emergency PRs in every consumer repo bumping past the denylisted version.

Trust model:
- Denylist is signed by the **`glossary-release-eng-key`** (§1.7.2). Tampering with the URL contents requires forging GPG — same bar as the rest of the system.
- Public key bundled in the npm package; consumers verify offline without contacting a keyserver.

This decouples denylist propagation from glossary release cadence. A bad version is denylisted within minutes of detection; consumers see it on next CI run starting >1h after publish.

---

## 4. G2 — aster-cloud enforcement

### 4.1 Scanner architecture

(Unchanged from v4 §4.1.)

### 4.2 Checks performed

(Unchanged from v4 §4.2 with v5 addition: backbone-change-type gating per §7.3.)

### 4.3 Overlay classification policy + 99-key budget

(Unchanged from v4 §4.3.)

### 4.4 4-stage remediation + branch strategy + P0 freeze exception (v5 fix)

(Closes v4-codex finding #7 — content freeze blocks P0 hotfix.)

Stages 1-4 same as v4 §4.4.

Branch strategy same as v4 (`glossary/baseline`, `glossary/remediation/*`, `glossary/integration`).

**P0 emergency bypass (NEW v5)**:

A P0 hotfix is a production incident requiring change to `messages/*.json` or `docs/{on-prem,saas}/**/*.md` during the active glossary freeze. Procedure:

1. P0 PR opened against `main` (not the freeze branches).
2. Author tags `@aster/glossary-stewards` in PR description with `Glossary-Freeze-Bypass: <P0-incident-id>` trailer.
3. Steward reviews within **4 hours SLO**. Approves bypass if the change is genuinely P0 (production outage, legal/compliance demand, security CVE).
4. PR merges to `main` with bypass approval recorded.
5. **Same day**: glossary stewards rebase `glossary/baseline` and all `glossary/remediation/*` branches onto the new `main`. Run scanner against the rebased state; any new findings get added to the appropriate Stage 3 branch.
6. If the P0 change touched a `messages/*.json` key that affects glossary scanning, an additional Stage 3 micro-PR adds the corresponding term to the glossary (or marks it `untranslated-tokens` if it's a brand/product name).

Freeze duration extension: each P0 bypass extends the freeze by up to 1 day for rebase work. Stewards track cumulative extension; if > 5 cumulative days of extension, governance escalates to consider abandoning the rollout window and re-planning.

### 4.5 CI wiring

(Unchanged from v4 §4.5.)

**Additionally**: every consumer repo's CI runs `pnpm run verify:release-manifest` (defined in §8.7) before any glossary check, to ensure the pinned version is `promoted` and not denylisted.

---

## 5. G3 — aster-lang-dev enforcement

(Unchanged from v4 §5. Same 4-stage remediation + branch strategy + P0 bypass rules.)

---

## 6. G4 — lexicon overlay parity (v5 budget fix)

### 6.1 Extension to `LexiconContributorValidator`

(Unchanged from v4 §6.1.)

### 6.2 `aster-lang-de` overlay backfill

(v4 estimated G4 at 3 days but didn't budget the ~100-translation backfill. v5 corrects.)

3 files × ~100 keys (19 lsp-ui-texts + ~30 diagnostic-help + ~50 diagnostic-messages). Human translation review required. **Budget: 1.5 dedicated days for translation team (throughput buffer per v5-codex #10), in addition to G4's other 3 days = G4 total 4.5 days.**

### 6.3 CI

(Unchanged from v4.)

### 6.4 Stage 1 overlay classification

(Unchanged from v4 §6.4.)

---

## 7. G5 — ADRs + ops runbooks

### 7.1 ADRs

- ADR-0004 — Glossary contract layer.
- ADR-0005 — Locale backbone = en-US.
- ADR-0006 — Enforcement tiers + CODEOWNERS-gated promotion + community fallback (§1.6).

### 7.2 Runbooks with named owners (v6)

In `aster-cloud/docs/operations/`. Each runbook has a primary owner, secondary reviewer, and review cadence (closes v5-codex #11):

| Runbook | Primary owner | Secondary reviewer | Review cadence |
|---|---|---|---|
| `add-locale.md` | `@aster/glossary-stewards` | `@aster/lang` | annual |
| `add-term.md` | `@aster/glossary-stewards` | `@aster/docs` | annual |
| `deprecate-term.md` | `@aster/glossary-stewards` | per-locale reviewers | annual |
| `split-term.md` | `@aster/glossary-stewards` | `@aster/lang` | annual |
| `backbone-revision.md` (§7.3) | `@aster/glossary-stewards` | `@aster/legal` | semi-annual (legal sensitivity) |
| `rc-and-recovery.md` (§3.6 + §8) | `@aster/platform` | `@aster/glossary-stewards` | quarterly (CI infra changes) |
| `glossary-prerequisites.md` (§1.7) | `@aster/platform` | `@aster/glossary-stewards` | quarterly |
| `glossary-oncall.md` (§1.7.1) | `@aster/glossary-stewards` | `@aster/incident-commander` | quarterly |
| `gpg-key-lifecycle.md` (§1.7.2) | `@aster/platform` | `@aster/glossary-stewards` | semi-annual |
| `tenant-overridable-change.md` (§13.1.1, v7 NEW) | `@aster/glossary-stewards` | `@aster/product` + `@aster/security` | annual |
| `deal-override-process.md` (§13.1.1, v7 NEW; lives in `aster-deploy` private) | `@aster/deal-desk` | `@aster/glossary-stewards` | quarterly |
| `cascade-outage.md` (§12.4, v7 NEW) | `@aster/platform` | `@aster/incident-commander` + `@aster/glossary-stewards` | quarterly |

Every runbook has a `last-reviewed-at: <date>` frontmatter field. CI job `verify-runbook-freshness` (runs weekly) opens a tracking issue when any runbook's `last-reviewed-at` exceeds its cadence.

### 7.3 `backbone-revision.md` — change-type approval gates (v5 fix)

(Closes v4-codex finding #4 — author self-declares change type without reviewer gate.)

When the en-US text of a term needs editing, `lifecycle.backbone-change-type` controls both CI behavior **and required approvals**:

| Change type | Approval required | CI behavior in official consumers |
|---|---|---|
| `cosmetic` (whitespace, punctuation, typo with no meaning change) | Author self-declares + 7-day no-objection window (any steward can object) | Batch-ack notice; no PR required to ack per-locale |
| `terminology` (word choice, brand-tone) | **`@aster/glossary-stewards` approval** on the PR (CODEOWNERS-gated) | Strict error; per-locale reviewer must update `reviewed-backbone-revision[locale]` |
| `semantic` (term meaning changed) | **`@aster/glossary-stewards` + each active locale's reviewer** approve the PR | Strict error + auto-deprecate signal; reviewer must re-translate (no "confirm no change" path) |
| `legal` (compliance text required by regulator) | **`@aster/glossary-stewards` + `@aster/legal`** approve the PR; audit entry in `docs/operations/glossary-incidents/<date>-legal-change.md` | Strict error + legal team approval required on every locale's translation PR |

`backbone-change-approved-by` field in the term YAML records every approval (role, actor, timestamp). Schema invariant: required when `backbone-revision > 1`; CI rejects PRs that don't update this field correctly.

`cosmetic` abuse prevention: stewards can object during the 7-day window and force re-classification. Repeated misclassification by an author triggers `@aster/glossary-stewards` review of contribution privileges (governance issue, not blocking individual PRs).

#### 7.3.1 Cosmetic-window watcher automation (v6 NEW — closes v5-codex #6)

The 7-day no-objection window needs an operator. v6 wires automation:

1. Merging a `backbone-change-type: cosmetic` term YAML edit triggers a GitHub Action `glossary-cosmetic-window-tracker`.
2. The action **opens a tracking issue** in `aster-design-system` with:
   - Title: `cosmetic backbone-revision: <term-id> @ rev N+1`
   - Body: diff of the term YAML, change author, link to merged PR, **due-date 7 calendar days from merge**.
   - Labels: `glossary`, `cosmetic-window`.
   - Assignee: current on-call glossary steward (resolved from §1.7.1 PagerDuty rotation).
3. The action **posts a Slack notification** to `#glossary-stewards` channel via incoming webhook (`GLOSSARY_SLACK_WEBHOOK` secret, scoped to glossary-stewards).
4. A scheduled action (`cosmetic-window-expire`) runs daily; when an open `cosmetic-window` issue passes its due-date with no objection comment:
   - Auto-applies label `auto-acked`.
   - Auto-posts a bot comment with the batch-ack confirmation.
   - Closes the issue.
   - Bumps every locale's `reviewed-backbone-revision[locale]` for the affected term in a follow-up PR (small, auto-mergeable after CI green).
5. Steward objection during the window: any comment from an `@aster/glossary-stewards` member with text matching `/^OBJECT:/m` triggers re-classification — the PR author must open a new PR with `backbone-change-type: terminology | semantic | legal` and the appropriate approval gate runs.

This converts the 7-day window from "stewards remember to check daily" to "GitHub remembers; steward gets paged on Slack at merge and on objection".

---

## 8. G8 — Release sequencing (split into G8a + G8b)

### 8.1 Release manifest state machine (G8a)

Every release of `@aster-cloud/glossary` / `io.aster:glossary-contract` is tracked by a release manifest in `aster-design-system/packages/glossary/releases/<version>.json`:

```json
{
  "version": "1.0.0",
  "localesVersion": 3,
  "state": "promoted",
  "transitions": [
    { "to": "prepared",      "at": "2026-05-20T10:00:00Z", "by": "ci-build-123" },
    { "to": "rc-validating", "at": "2026-05-20T10:30:00Z", "by": "ci-build-123" },
    { "to": "rc-validated",  "at": "2026-05-20T12:00:00Z", "by": "ci-build-123" },
    { "to": "npm-promoting", "at": "2026-05-20T13:00:00Z", "by": "alice@aster,bob@aster" },
    { "to": "npm-published", "at": "2026-05-20T13:05:00Z", "by": "ci-build-123" },
    { "to": "maven-releasing","at": "2026-05-20T13:06:00Z","by": "ci-build-123" },
    { "to": "maven-released","at": "2026-05-20T15:30:00Z", "by": "ci-build-123" },
    { "to": "promoted",      "at": "2026-05-20T16:00:00Z", "by": "ci-build-123" }
  ],
  "checksums": {
    "npm-integrity":  "sha512-...",
    "maven-jar-sha256":"<sha256>",
    "glossary-export-sha256": "<sha256>"
  },
  "signature": "<GPG sig from CI signing key>",
  "consumers": [
    { "repo": "aster-cloud",     "tier": "official", "lockfile-pr": "https://github.com/.../pull/123", "merged-at": "2026-05-20T17:00:00Z" },
    { "repo": "aster-lang-dev",  "tier": "official", "lockfile-pr": "https://github.com/.../pull/45",  "merged-at": "2026-05-20T17:15:00Z" },
    { "repo": "aster-lang-core", "tier": "official", "lockfile-pr": "https://github.com/.../pull/78",  "merged-at": "2026-05-20T17:30:00Z" }
  ]
}
```

State machine + atomicity discipline unchanged from v4 §8.1-§8.2.

**Signature**: every state transition appends to `transitions[]` and re-signs the manifest. Tampering (e.g., adding a fake `promoted` transition) breaks the GPG signature; the consumer-side `verify-release-manifest` check (§8.7) rejects unsigned/wrongly-signed manifests.

### 8.2 Dual publish atomicity

(Same as v4 §8.2.)

### 8.3 Registry verification commands

(Same as v4 §8.3.)

### 8.4 Lockfile PR automation (G8b)

(Same as v4 §8.4.) `glossary-lockfile-bot` opens lockfile PRs in every consumer repo via the GitHub App permissions established in G0.5.

### 8.5 Promotion gate

(Same as v4 §8.5.)

### 8.6 Bad-release recovery via denylist (NEW v5)

See §3.6. Triggered when state machine reaches `failed` after `npm-published`, OR when monitoring detects a bad release post-`promoted`.

### 8.7 Consumer-side `verify-release-manifest` CI check (v6 — configurable URL + cache)

(Closes v5-codex finding #1: GitHub raw URL was hard external dependency.)

Every consumer repo's CI runs:

```yaml
- name: Verify glossary release manifest
  run: pnpm run verify:release-manifest
```

The `verify:release-manifest` script (provided by `@aster-cloud/glossary`):

1. Reads `glossary.config.yaml.glossary-pin.version` and `glossary.config.yaml.manifest-source` (the **configurable URL prefix**; default is the CDN `https://glossary.aster-lang.cloud/releases/`; consumers may pin to an internal mirror).
2. Fetches `<manifest-source>/<version>.json` with:
   - **Timeout**: 10s connect, 30s read.
   - **Retries**: 3× exponential backoff.
   - **Fallback**: on network failure, reads `<repo>/.glossary/cache/last-good-manifest-<version>.json`. Cache TTL is 24h; if expired AND remote unreachable, fails with explicit "manifest unreachable + cache stale" error rather than silently passing.
3. Same logic for denylist: fetches `<manifest-source>/denylist.json` with same retry/cache behavior. Cache file: `<repo>/.glossary/cache/last-good-denylist.json`.
4. Verifies GPG signature against the public key bundled in the consumer's npm copy of `@aster-cloud/glossary` (key rotation handled via package update + offline trust store, no keyserver dependency).
5. Asserts manifest `state == "promoted"`.
6. Asserts the version is NOT in the denylist.
7. Asserts `glossary-pin.npm-integrity` matches the integrity hash in the manifest.

**Distribution sources** (v7 — multi-source mandatory; default `manifest-source: cdn,github`; consumers may pin different order):

1. **Primary CDN**: `https://glossary.aster-lang.cloud/releases/` — Cloudflare Pages backed by `aster-design-system`'s `packages/glossary/releases/` directory; sub-100ms global; survives GitHub outage.
2. **Secondary**: `https://raw.githubusercontent.com/aster-cloud/aster-design-system/main/packages/glossary/releases/` — kept in sync with the CDN.
3. **Tertiary / air-gapped**: enterprise customers (on-prem deployments) may host an internal mirror; `manifest-source` config supports any URL prefix returning JSON. Internal mirror is a 3rd entry, not a replacement for CDN+GitHub.

**Multi-source policy** (v7 — closes v6-codex #3): the default `manifest-source: cdn,github` is enforced as **at least two independent sources**. Schema validates the config; a single-source `manifest-source: cdn` is rejected unless `tier: community` (where individual repos accept the risk). Acceptance test in G8b exercises failover by mocking CDN-down + GitHub-up.

**Cache TTLs** (v7 — differentiated by data type):
- Manifest cache: 24h (manifests never retroactively change once `promoted`).
- Denylist cache: 1h (must reflect new bad-version listings quickly).
- Both caches at `<repo>/.glossary/cache/`; directory is **gitignored** (v7 — closes v6-codex #10). CI populates from network; never committed.

**Failure modes**:
- Manifest state anything except `promoted` → fail with "glossary version <v> not yet promoted; manual bump bypasses release gating".
- Manifest signature invalid → fail with "manifest tampered or wrong key".
- Version in denylist → fail with "glossary version <v> denylisted: <reason>; upgrade to <replacement>".
- All configured manifest sources unreachable + cache fresh (<24h) → warning; CI passes.
- All configured manifest sources unreachable + cache stale → fail with "manifest source unreachable for <duration>; cache expired".
- All configured denylist sources unreachable + cache fresh (<1h) → warning; CI passes.
- All configured denylist sources unreachable + cache stale (≥1h) → **fail** with "denylist source unreachable for >1h; refusing to validate against potentially-outdated denylist" (v7 fail-closed).

This closes both the Critical (manual bump bypass) AND the operational risks: cascade outage handled by multi-source; deny-list latency bounded to 1h; consumer maintainers can pin internal mirrors for air-gapped environments.

### 8.8 Release manifest archival (v5 — closes Minor)

`releases/` directory hygiene:

- **Last 60 days**: each release manifest as `releases/<version>.json`.
- **Older than 60 days**: archived monthly into `releases/_archive/<year>/<quarter>.tar.zst` (compressed; signed).
- **`releases/index.json`**: master index listing every version and its location (live file vs archive path).
- **`verify-release-manifest`** can fetch from either location via `index.json` lookup.
- **Archive rotation cron**: monthly job in `aster-design-system` CI.

At 30 releases/year × 5 years = 150 manifests, the active `releases/` directory holds at most ~30 files; the rest are compressed.

---

## 9. G6 — Java consumer

(Unchanged from v4 §9. Maven Central dependency + Java reader + overlay cross-check + Gradle tier wiring.)

Additionally (v5): Java reader implements the equivalent of §8.7's verification — at validator init, checks the bundled manifest signature and rejects denylisted versions.

---

## 10. G7 — Add-locale dry-run

### 10.1 Procedure

(Unchanged from v4 §10.1.)

### 10.2 CI-generated coverage matrix via GitHub App (v5 fix)

(Closes v4-codex finding #5 — cross-repo auth model missing.)

**v5 auth model**: `aster-glossary-matrix-bot` GitHub App with these permissions (configured in G0.5):

- `metadata:read` — list repos
- `contents:read` — fetch `glossary.config.yaml` from each repo
- `actions:read` — fetch latest CI run for each repo
- Installation IDs stored in `aster-design-system/.github/secrets`.

`scripts/generate-coverage-matrix.ts` runs in `aster-design-system` CI:

```ts
const app = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.GLOSSARY_BOT_APP_ID,
    privateKey: process.env.GLOSSARY_BOT_PRIVATE_KEY,
    installationId: process.env.GLOSSARY_BOT_INSTALLATION_ID,
  },
});

// v6: repo list is loaded from aster-design-system/.glossary/consumers.yaml
// (see §10.2.1), not hardcoded. Adding aster-lang-{fr,ja,...} requires
// editing only that file.
const repos = await loadConsumerRepos();

const locales = loadLocales();
const matrix = [];

for (const repo of repos) {
  let config;
  try {
    const { data } = await app.repos.getContent({
      owner: 'aster-cloud',
      repo,
      path: 'glossary.config.yaml',
    });
    config = parseYaml(Buffer.from(data.content, 'base64').toString());
  } catch (err) {
    if (err.status === 404) {
      // Repo doesn't yet have glossary.config.yaml. Explicit blocking row.
      matrix.push({
        repo, surface: '<MISSING-CONFIG>', locale: '*',
        expected: '?', ciReportedGap: '?',
        evidence: null, signoff: null,
        blocks: 'G7 blocked: repo has no glossary.config.yaml',
      });
      continue;
    }
    if (err.status === 403) {
      // Rate limit or auth failure. Retry with exponential backoff.
      await retryWithBackoff(...);
    }
    throw err;
  }
  for (const surface of config.surfaces) {
    for (const locale of locales) {
      const expected = surfaceExpectsLocale(surface, locale);
      const ciStatus = await fetchLatestCiRun(app, repo);
      matrix.push({...});
    }
  }
}
emitMarkdown(matrix);
```

**Missing-config behavior** (closes v4-codex finding #10): when a consumer repo doesn't yet have `glossary.config.yaml`, the matrix emits an explicit `<MISSING-CONFIG>` row tagged "G7 blocked". The G7 acceptance criterion requires zero such rows — meaning every listed consumer must have a config before G7 can complete.

**Rate-limiting**: GitHub App limit is 5000 req/h per installation. The matrix touches 6 repos × ~3 surfaces × ~3 locales = ~54 API calls per run; well under the limit. Retry-after handling for occasional 403s.

**Failure modes**:
- Repo inaccessible → matrix row marked "AUTH-FAILURE" with the steward team paged.
- GitHub App token expired → CI fails fast at the very first call; rotation runbook in `glossary-prerequisites.md`.

#### 10.2.1 Consumer auto-discovery via `consumers.yaml` (v6 NEW)

(Closes v5-codex finding #4: hardcoded repo list.)

`aster-design-system/.glossary/consumers.yaml`:

```yaml
version: 1
consumers:
  - org: aster-cloud
    repo: aster-cloud
    tier: official
    status: active                  # v7: active | onboarding
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [messages, docs-onprem, docs-saas]
  - org: aster-cloud
    repo: aster-lang-dev
    tier: official
    status: active
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [docs]
  - org: aster-cloud
    repo: aster-lang-core
    tier: official
    status: active
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [overlays]
  - org: aster-cloud
    repo: aster-lang-en
    tier: official
    status: active
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [overlays, vocabularies]
  - org: aster-cloud
    repo: aster-lang-zh
    tier: official
    status: active
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [overlays, vocabularies]
  - org: aster-cloud
    repo: aster-lang-de
    tier: official
    status: active
    glossary-config-path: glossary.config.yaml
    expected-surfaces: [overlays, vocabularies]
  # Example onboarding row (post-launch, when adding aster-lang-fr):
  # - org: aster-cloud
  #   repo: aster-lang-fr
  #   tier: official
  #   status: onboarding             # G7 reports separately, not blocking
  #   onboarded-at: 2026-10-15
  #   active-by: 2026-11-14          # 30 days from onboarded-at
  #   glossary-config-path: glossary.config.yaml
  #   expected-surfaces: [overlays, vocabularies]
```

Schema invariants (Zod):
- `org/repo` pairs are unique.
- `tier` is `official | community`.
- **`status` is `active | onboarding`** (v7 NEW — closes v6-codex #7).
- `expected-surfaces` must be non-empty.
- `onboarding` rows must include `onboarded-at` and `active-by` (≤ 30 days from `onboarded-at`).
- File is CODEOWNERS-protected by `@aster/glossary-stewards`; adding/removing a consumer requires steward approval.

**G7 acceptance interaction** (v7 — closes v6-codex #7): the matrix generator (§10.2) emits:
- For `status: active` consumers: `<MISSING-CONFIG>` rows block G7 (same as v6).
- For `status: onboarding` consumers: missing-config rows are reported separately as `<ONBOARDING-PENDING>`; do NOT block G7. After `active-by` deadline passes, the matrix promotes any still-missing config to `<MISSING-CONFIG>` and G7 starts blocking.

Adding `aster-lang-fr` after launch:
1. PR adds entry with `status: onboarding`, `onboarded-at: <today>`, `active-by: <today+30d>`.
2. `@aster/glossary-stewards` approves.
3. Next G7 run includes the new repo automatically; matrix shows `<ONBOARDING-PENDING>` rows; G7 not blocked.
4. Within 30 days, the new repo team writes `glossary.config.yaml` + completes Stage 3 remediation.
5. When ready, PR flips `status: active`; G7 now strictly validates.
6. If 30 days pass without `glossary.config.yaml`, the auto-filed governance issue (per v6 §10.2.1) escalates to deal-desk + glossary-stewards.

This decouples "supporting a new language" from "editing the matrix-generator script" — both `localesVersion` bumps (§3.4) and consumer-repo additions (§10.2.1) are one-line config changes.

### 10.3 Coverage acceptance criterion (objective)

G7 passes only when:
1. Every cell of the generated matrix has `CI gap reported = yes` AND `Owner sign-off` filled.
2. Zero `<MISSING-CONFIG>` rows.
3. Zero `AUTH-FAILURE` rows.
4. Matrix file's CI workflow exits 0.

### 10.4 Time-to-launch estimate (post-contract)

(Unchanged from v4 §10.4.)

---

## 11. Acceptance criteria (measurable)

| ID | Criterion |
|---|---|
| G0 | `aster-cloud/docs/operations/glossary-stakeholders.md` exists with every team's `Acked-by:` trailer; G0.5 prerequisite checks all pass |
| G1 | `@aster-cloud/glossary@1.0.0` on npm with provenance attestation visible via `npm view ... _attestations`; `io.aster:glossary-contract:1.0.0` on Maven Central; release manifest in `promoted` state with valid GPG signature; contract + scanner adversarial + RC + bad-release rehearsal + manifest tampering tests green; block-id stability tests green |
| G2 | `pnpm check:glossary:strict` green on aster-cloud `main`; `glossary.config.yaml` `tier: official`; zero-warning baseline confirmed by 7 consecutive CI runs; `pnpm verify:release-manifest` green; P0 bypass procedure exercised at least once in a rehearsal scenario |
| G3 | aster-lang-dev: new CI workflow + 4-stage remediation complete; `check:glossary:strict` + `check:locale-parity` + `verify:release-manifest` green; `glossary.config.yaml` `tier: official` |
| G4 | `LexiconContributorValidator` rejects a fixture pack with `overlays/diagnostic-help.json` deleted; `aster-lang-de` overlay backfill present (~100 keys with human-review trailer); 99-key classification CSV signed off |
| G5 | ADR-0004/0005/0006 merged; **9 runbooks** merged (`add-locale.md`, `add-term.md`, `deprecate-term.md`, `split-term.md`, `backbone-revision.md`, `rc-and-recovery.md`, `glossary-prerequisites.md`, `glossary-oncall.md`, `gpg-key-lifecycle.md`, plus v7 NEW `tenant-overridable-change.md` and `deal-override-process.md` for a total of 11 if those land in G5 vs deferred); `backbone-revision.md` includes the change-type approval-gate matrix; each runbook has `last-reviewed-at` frontmatter |
| G6 | `aster-lang-core` builds against Maven Central artifact; test fixture (bad value in `lsp-ui-texts.json.moduleDeclaration` for zh) fails the validator with message `glossary-overlay-mismatch: term=function-definition expected="函数定义" got="<bad>"`; denylist rejection test passes |
| G7 | CI-generated coverage matrix committed at `docs/operations/add-locale-dry-run-ja-JP.md`; zero `<MISSING-CONFIG>` rows; zero `AUTH-FAILURE` rows; every cell signed off; throwaway branch reverted |
| G8a | Release-sequencing rehearsal in local registry: a no-op version bump traverses `prepared → … → promoted`; bad-release rehearsal (`0.0.0-bad-test`) exercises denylist in **OSSRH staging only** (NOT public Maven Central). **Evidence captured before OSSRH staging TTL expires** (v6 — closes v5-codex #5): committed to `docs/operations/glossary-incidents/<date>-rehearsal/` — (a) OSSRH staging repository ID, (b) generated POM + JAR SHA-256, (c) `mvn-stage-list` output (verbatim), (d) CI transcript (gzipped), (e) screenshots of OSSRH UI before close, (f) timestamps proving capture preceded TTL expiry, (g) denylist rejection test output proving consumer-side fail-fast on the test version. Manifest of evidence files signed with the `glossary-ci-signing-key` |
| G8b | Lockfile-bot fanout rehearsal: dummy version bump in `aster-design-system` triggers PRs in all consumer repos; PRs CI green; manifest's `consumers[].lockfile-pr` field populated correctly; `verify-release-manifest` CI check exercises the "version not yet promoted" failure path with a test fixture |

---

## 12. Failure modes + split threat model

### 12.1 Operational failure modes

| Mode | Mitigation |
|---|---|
| Glossary as dumping ground | `user-facing: true` gate |
| Homonymy collision | Concept IDs + `sense` + `disambiguation` |
| Term renamed | `id` immutable; `split-term.md` |
| Term split | `lifecycle.replaces/superseded-by` + Stage 3 |
| Backbone edited in place | `backbone-change-type` + approval gates (§7.3) |
| npm publish race | §8.2 release manifest state machine |
| Maven publish race | Same; §8.3 sync polling with 4h timeout |
| Half-published state | §8.7 consumer-side `verify-release-manifest` (catches manual bumps) |
| Bad release | §3.6 + §8.6 denylist mechanism. **Accepted residual risk** (v7 H3): up to 1h between denylist publish and consumer detection due to cache window — bounded by 1h denylist cache TTL |
| External community repos drift | Tier system + community fallback (§1.6) |
| Scanner false positives | Stage 1 inventory; `untranslated-tokens` |
| Block-id drift | §1.5 insert-once sidecar; `glossary-fmt lint` pre-commit |
| Locale addition consumer outage | `localesVersion` + shadow mode |
| Surface glob typo | Empty-match = error in official tier |
| Unmanaged overlay strings | `overlay-classification` policy |
| **P0 hotfix during freeze** | §4.4 emergency bypass with 4h steward SLO |
| **Stale release manifest file accumulation** | §8.8 archival + index |
| **Cross-repo auth failure during matrix generation** | §10.2 GitHub App with documented retry + on-call escalation |
| **Manifest tampering** | GPG signature on every transition; `verify-release-manifest` rejects unsigned |
| **Author misclassifies backbone change as cosmetic** | §7.3 7-day no-objection window; steward review of repeated misclassification |
| **Tenant override pressure during enterprise sales** | §13.1 deal-desk policy: sales explicitly empowered to decline white-label, OR escalate to ADR commitment |

### 12.2 Security threat model

(Unchanged from v4 §12.2.) Five threat surfaces: registry-token, CI workflow, source, release-manifest, compromised translator. Two-person approval at `npm-promoting` is the linchpin.

### 12.3 Ongoing maintenance tax (v6 NEW — closes v5-codex #12)

The contract has a non-zero steady-state cost. Quantified so the project isn't perceived as "done" at launch:

| Event | Frequency | Cost per event | Annual cost (3 locales) |
|---|---|---|---|
| Patch release (translation fix, new term) | ~2/month | 0.5d incl. RC, lockfile fanout, review | ~12d/year |
| Minor release (new term + new locale or 2+ terms) | ~quarterly | 1d incl. RC + cross-team review | ~4d/year |
| Major release (schema change) | ~annually | 2d incl. ADR + migration | ~2d/year |
| `backbone-revision: cosmetic` | ~10/quarter | 0 engineering (auto-watcher §7.3.1) | ~0d/year |
| `backbone-revision: terminology/semantic` | ~5/quarter | 0.5–2d coordination per term × locales | ~12d/year |
| `backbone-revision: legal` | ~2/year | 2d incl. legal review | ~4d/year |
| Locale add | ~1/year | 2–4 weeks elapsed; ~10d focused engineer-time | ~10d/year |
| Bad-release recovery (denylist) | ~1/year (target zero) | 0.5d emergency + post-mortem | ~0.5d/year |
| Runbook reviews (quarterly + annual cadences) | per §7.2 | 0.5d/runbook × 9 runbooks | ~4d/year |
| GitHub App + GPG key rotation | 1/year + emergency | 1d scheduled, 0.5d emergency | ~1d/year |
| Quarterly upkeep (false positives, allowlist tuning, CI infra) | every quarter | 2d | ~8d/year |
| **Total steady-state** | | | **~57 engineer-days/year ≈ 0.25 FTE** |

Per-locale-added scaling: each new locale adds ~5–8 engineer-days/year to the steady-state (translation review, backbone-revision per-locale ack, locale-specific runbook updates). Adding a 4th locale moves steady-state to ~0.3 FTE; 5th to ~0.35 FTE.

This is **proportionate to the problem at 3-5 locales** (the customer base Aster will plausibly serve in the next 3 years). At 10+ locales, the per-locale tax becomes the dominant cost and the team should revisit whether some pieces (e.g., backbone-revision per-locale ack) should be relaxed for `cosmetic` changes — already done in v6 §7.3.

Recovery: at any point if maintenance tax exceeds 0.5 FTE, governance opens a "contract simplification" workstream to trim runbook surface area or automate more.

**Quarterly metric review** (v7 — closes v6-codex #8): `@aster/glossary-stewards` owns a recurring quarterly review of the actual maintenance cost. Process:

1. **Owner**: `@aster/glossary-stewards` (specifically the on-call lead, rotating quarterly so review-fatigue doesn't cluster).
2. **Cadence**: first business week of each quarter; calendar event auto-created at G0 setup.
3. **Inputs**: actual time logged against glossary-related work (from existing engineering time-tracking) + governance issues opened/closed + denylist incidents + locale-add events.
4. **Output**: `docs/operations/glossary-quarterly-review-<YYYY>-Q<n>.md` with measured costs vs §12.3 baseline.
5. **Triggers**:
   - Measured annual cost > 1.5× §12.3 baseline → open "contract simplification" ADR.
   - Measured per-locale tax > 10 engineer-days/year → open ADR to relax some per-locale strictness.
   - >2 consecutive quarters showing locale-add wall-clock > 3 weeks → open ADR to streamline `add-locale.md` runbook.
6. **Visibility**: review summaries posted to `#glossary-stewards` Slack + linked from the runbook index in `docs/operations/README.md`.

### 12.4 Cascade outage policy (v7 NEW — closes v6 operational realism)

The contract depends on ~8 external services: npm, Maven Central/OSSRH, GitHub, GitHub Actions, Cloudflare/CDN, Slack, on-call provider (PagerDuty/OpsGenie), KMS provider, Vault. v7 documents which checks fail-closed during outages and who can override.

| Service unavailable | Affected check | Default behavior | Override |
|---|---|---|---|
| npm registry | `verify-release-manifest` integrity check | Cached manifest used (≤24h); CI passes | Auto-recover when npm returns |
| Maven Central | Java consumer dep resolution | Gradle uses cached artifact; build proceeds; warning logged | Steward `--skip-maven-verify` flag with audit trail |
| GitHub (raw URL) | Manifest source secondary | Falls through to CDN primary | None — CDN must be up |
| Cloudflare CDN (`glossary.aster-lang.cloud`) | Manifest source primary | Falls through to GitHub raw | None — GitHub must be up |
| **All manifest sources down** | `verify-release-manifest` | Fail-closed if cache stale (>24h); fail-open with warning if cache fresh | Incident-commander manual override (logged in `glossary-incidents/`) |
| **All denylist sources down >1h** | denylist check | **Fail-closed** (refusing to validate against potentially-outdated denylist) | Glossary-steward + security-officer dual override only |
| Slack | Cosmetic-window watcher notifications | Issue still created; Slack ping skipped with log warning | None — issue is the canonical record |
| PagerDuty/OpsGenie | P0 bypass page (§4.4) | Falls through to direct steward Slack DM via webhook; if also Slack down, incident-commander pages via IC's own provider | Multi-provider failover documented in `glossary-oncall.md` |
| GitHub Actions | Publish workflow | Release cannot proceed; release engineer notifies stakeholders | None — release-pause until restored |
| KMS (GCP/AWS) | CI signing key | Manifest signing fails; release blocked in `npm-promoting` state | Use Vault-held release-engineer key for emergency signing (audit-logged) |
| Vault | Release-engineer key access | Only emergency manual signing affected; CI signing unaffected | None for routine — KMS handles 99% of signing |

**Two-service-down scenarios** explicitly considered:
- npm + Maven both down: full release blocked; consumers continue running on cached artifacts. Acceptable for transient (<4h) outages; for longer, release engineer announces glossary-release-pause in `#glossary-stewards`.
- CDN + GitHub raw both down: consumer CIs fall through to cache. If cache stale, CI fails (denylist) or warns (manifest). Steward override possible only with documented justification.
- KMS + Vault both down: cannot sign anything; emergency case requires re-establishing key infra. Glossary stewards declare "signing freeze"; no releases until restored.

Cascade outages are tracked in `docs/operations/glossary-incidents/<date>-cascade-<svc1>-<svc2>.md` with post-mortem within 1 week of resolution.

---

## 13. Out of scope (with handoff triggers)

### 13.1 Tenant override / white-label deal-desk policy (v5 fix)

(Closes v4-codex finding #8 — refusal path may not survive sales pressure.)

`tenant-overridable: true` is reserved in schema. v1 CI checks base glossary only. When customer pressure arrives:

**Trigger scenarios**:
1. Enterprise customer files a feature request for branded terminology.
2. Sales identifies a deal blocked on white-label terminology.
3. Compliance flags a regulatory requirement for customer-specific term substitution.

**Deal-desk authority (NEW v5)**:

- Sales rep encounters a deal where white-label terminology is a **stated closing condition**.
- Sales rep escalates to `@aster/deal-desk`.
- Deal-desk has **explicit authority** to choose ONE of three paths within 5 business days:

| Path | When | Effect |
|---|---|---|
| **Accept-and-commit** | Deal value justifies commitment | Deal-desk opens ADR-XXXX-tenant-glossary-runtime within 1 sprint; runtime implementation scheduled; customer informed of timeline |
| **Decline** | Deal value doesn't justify | Sales tells customer "white-label terminology is not supported in v1"; deal proceeds with standard terms or doesn't proceed |
| **Workaround** | Specific term and deal qualify | One-time exception: deal-desk + steward jointly approve a `tenant-override-pending` flag on the deal; customer ships with current terms; revisit at renewal |

The `Accept-and-commit` path requires:
1. Deal-desk approval (revenue impact estimate).
2. `@aster/glossary-stewards` approval (technical feasibility).
3. `@aster/platform` approval (runtime engineering capacity).

The `Decline` path requires no approval beyond the rep + deal-desk. Sales is empowered, not blocked.

The base contract enforces base terminology regardless of customer status; until tenant runtime ships, the contract is canonical.

#### 13.1.1 `deal-overrides.yaml` schema linkage (v7 — Critical fix: private storage)

(v6-codex Critical: storing deal data in a public docs/operations path is a confidentiality problem. v7 relocates and redacts.)

The `Workaround` path's `tenant-override-pending` flag must be linked to glossary schema so that drift between "deals with pending workarounds" and "terms marked tenant-overridable" is auditable. But the linkage record contains deal IDs, customer names, revenue context, and renewal dates — confidential data that **must not live in `aster-cloud`** (a public GitHub repo).

**Storage location** (v7 decision): primary canonical store is `aster-deploy/private/glossary/deal-overrides.yaml`.

- `aster-deploy` is the **private** Aster ops repo (already used for Vault/secrets/license-signing-api private materials; same access controls).
- File is `git-crypt`-encrypted at rest (consistent with existing aster-deploy convention for customer-touching data).
- CODEOWNERS protected by `@aster/deal-desk` + `@aster/glossary-stewards`.

**Alternative canonical store**: if Aster ops decides CRM (e.g., Salesforce) is the better system-of-record for deal-override metadata, the schema below can map 1:1 to a CRM custom object. A small synchroniser in `aster-deploy` would export the relevant fields into the encrypted yaml so CI validation can run without granting CI access to the CRM. The plan does not mandate one approach; the runbook (`docs/operations/deal-override-process.md`) names the chosen store.

**What lives in `aster-cloud/docs/operations/`** (public repo) is **only the schema definition and a redacted example**:

```yaml
# aster-cloud/docs/operations/deal-overrides.schema.yaml — PUBLIC reference;
# NO real deal data; values are illustrative redactions.
version: 1
pending-overrides:
  - deal-id: <DEAL-ID-redacted>
    customer: <CUSTOMER-redacted>
    requested-at: <ISO date>
    approved-by:
      - role: deal-desk
        actor: <actor email>
      - role: glossary-steward
        actor: <actor email>
    affected-terms:
      - <glossary-term-id>            # MUST have tenant-overridable: true
    requested-substitution:
      en-US:
        <glossary-term-id>: <substitution string>
    adr-commitment-deadline: <ISO date or quarter>   # ≤ 6 months from requested-at
    runtime-readiness-status: pending | scheduled | shipped
    revisit-at: <ISO date>             # renewal date
    notes: <free text>
```

**CI validation** runs in two places:

1. **Private validation** (in `aster-deploy` CI, against the real encrypted yaml after decrypt):
   - Every `affected-terms[*]` must reference a term with `tenant-overridable: true` in the latest released glossary; fail with "term `<id>` not tenant-overridable in glossary; cannot grant override".
   - Every `pending-overrides` entry has `adr-commitment-deadline` ≤ 6 months from `requested-at`.
   - When deadline reached AND `runtime-readiness-status: pending`, weekly governance issue auto-filed: "deal <id> override pending past deadline".

2. **Public validation** (in `aster-cloud` CI): the public `deal-overrides.schema.yaml` is shape-checked but contains no real data; this catches schema drift between the public reference and the private canonical store.

**Process for marking a term `tenant-overridable: true` after the fact** (closes v6-codex #6):

When a customer requests a workaround for a term that isn't currently `tenant-overridable`, the new runbook `tenant-overridable-change.md` (§7.2 v7 NEW) defines the procedure:

1. Deal-desk files an issue against `aster-design-system` (public repo, no customer data): "Request to mark `<term-id>` as tenant-overridable; rationale: <generic>".
2. Required approvals:
   - `@aster/glossary-stewards` (technical/contract review).
   - `@aster/product` (product policy review — does this term concept actually warrant being overridable?).
   - `@aster/security` (privacy/audit review — does enabling override on this term create cross-tenant data leak risk?).
3. On approval, PR flips `tenant-overridable: false → true` on the term YAML. This is a `lifecycle.backbone-revision` bump (`backbone-change-type: terminology` — affects how the term is governed, not its meaning).
4. Once merged + released, the deal-desk can then add the term to `affected-terms[*]` in the private `deal-overrides.yaml`.

This adds a known-cost gate: marking a term overridable is a deliberate cross-team review, not a side-effect of a single deal closing.

### 13.2 Other out-of-scope

- **Auto-translation**. No MT services.
- **Runtime language switching beyond next-intl**.
- **Historical drift audit (pre-v1)**. Stage 3 fixes drift; no separate audit.

---

## 14. SESSION_IDs

- CODEX_SESSION (reviewer): `019e448a-ec07-73b1-a0f0-d20c7eac59f2`
- BACKEND_SESSION: _to be allocated on /ccg:execute run_

---

## 15. Execution order

```
G0 (1.5d) — stakeholder matrix + G0.5 infra prerequisites (incl. on-call + GPG)
   ↓
G1 (7d) ∥ G8a (4d)   [lockstep — G8a needs manifest schema from G1; G8a includes out-of-band denylist publisher]
   ↓
(G2 (8d) ∥ G3 (5d) ∥ G4 (4.5d))     [parallel after G1+G8a]
   ↓
G6 (4d) — Java consumer (after G4 closes overlay parity)
   ↓
G8b (4d) — lockfile-bot + verify-release-manifest + configurable URL + consumers.yaml auto-discovery
   ↓
G5 (2.5d) — ADRs + 12 runbooks (incl. v7 NEW tenant-overridable-change.md, deal-override-process.md, cascade-outage.md)
   ↓
G7 (5d) — ja-JP dry-run + CI matrix + cross-team signoffs + revert
```

**Total engineer-days: 45.5. Wall-clock with parallelism: 28–32 working days.**

Steady-state maintenance: ~57 engineer-days/year (≈ 0.25 FTE for 3 locales). See §12.3 for breakdown.

---

## Appendix A — v6 codex finding traceability (v7 fixes)

| v6 finding | v7 section |
|---|---|
| **Critical**: `deal-overrides.yaml` in public docs | §13.1.1 relocated to `aster-deploy/private/glossary/` (git-crypt); `aster-cloud` keeps only redacted schema + process |
| #2 24h denylist cache masks new denylist | §3.6 + §8.7 denylist cache reduced to **1h, fail-closed**; manifest cache stays at 24h |
| #3 CDN single point of failure | §3.6 + §8.7 multi-source mandatory (`cdn,github,internal-mirror`); failover acceptance test in G8b |
| #4 PagerDuty assumption not in prereqs | §1.7 verify-paging-provider preflight; provider-agnostic on-call interface |
| #5 CI signing key weaker than Vault | §1.7.2 OIDC + KMS for CI signing; private key never enters Actions runner |
| #6 No path to mark term tenant-overridable after request | §13.1.1 new runbook `tenant-overridable-change.md` (steward + product + security) |
| #7 30d onboarding vs G7 zero-missing-config conflict | §10.2.1 `status: onboarding | active` field; G7 only blocks active consumers |
| #8 Scaling threshold no owner/trigger | §12.3 quarterly metric review owned by `@aster/glossary-stewards`; triggers ADR at 1.5× baseline |
| #9 ID generation collisions across files | §1.5.1 ID pattern updated to `<file-slug>-<heading-slug>-<node-type>-<seq>` |
| #10 Cache directory policy absent | §8.7 `.glossary/cache/` is gitignored; CI-populated only |
| Internal: stale "44 engineer-days" | §2 + §15 reconciled to 45.5 (G5 +0.5d for 3 v7 new runbooks) |
| Internal: stale "7 runbooks" | §11 G5 acceptance now lists 12 runbooks |
| Internal: stale "G4 4 days" | §6.2 now states 4.5 days |
| **NEW**: cascade outage policy | §12.4 cascade outage policy with per-service fail-closed vs fail-open table + override authorities |

## Appendix B — v5 codex finding traceability (v6 fixes)

| v5 finding | v6 section |
|---|---|
| #1 Manifest fetch hard external dependency | §8.7 configurable `manifest-source` URL + 24h local cache + CDN primary + GitHub raw fallback |
| #2 File move workflow missing | §1.5.2 `glossary-fmt move-file` + cross-tree `--reparent-block-map` |
| #3 Denylist not out-of-band | §3.6 v6 redesign: signed `denylist.json` at stable CDN URL, refreshed every consumer CI run |
| #4 Consumer repo list hardcoded | §10.2.1 `consumers.yaml` auto-discovery |
| #5 OSSRH staging evidence expires | §11 G8a row: capture spec (staging repo ID, POM/JAR SHA, CI transcript, screenshots, signed manifest) before TTL |
| #6 Cosmetic no-objection process lacks operator | §7.3.1 GitHub Action `glossary-cosmetic-window-tracker` + Slack notification + auto-ack on expiry |
| #7 4h P0 SLO lacks coverage model | §1.7.1 `glossary-oncall.md` with PagerDuty roster + 4h SLO + incident-commander escalation |
| #8 Tenant workaround disconnected from implementation | §13.1.1 `deal-overrides.yaml` linking deal-id → glossary term-ids; 6-month ADR deadline enforcement |
| #9 Formatter block-detection rules unspecified | §1.5.1 full `fmt.config.yaml` spec with node-rules, id-generation, override directives |
| #10 GPG key lifecycle incomplete | §1.7.2 `gpg-key-lifecycle.md` with two-key model, rotation cadence, departure procedure |
| #11 Runbook ownership missing | §7.2 named owner/reviewer/cadence per runbook + `last-reviewed-at` CI check |
| #12 Ongoing maintenance not quantified | §12.3 quantified ~57 engineer-days/year breakdown |

## Appendix C — v4 codex finding traceability

| v4 finding | v5 section |
|---|---|
| Critical: Manual consumer bump bypass | §8.7 consumer-side `verify-release-manifest` |
| #2 npm provenance assumed | §0.2 + §1.7 prerequisites doc + G1 preflight |
| #3 block-id hash unstable | §1.5 insert-once + sidecar |
| #4 backbone change-type misclassification | §7.3 approval gates + 7-day no-objection window |
| #5 matrix cross-repo auth missing | §10.2 GitHub App `aster-glossary-matrix-bot` + scoped permissions + missing-config handling |
| #6 Maven deprecation non-standard | §3.6 + §8.6 signed denylist; scanner + Java reader reject denylisted versions |
| #7 P0 freeze exception | §4.4 emergency bypass with 4h SLO |
| #8 Tenant override refusal weak | §13.1 deal-desk authority + 3-path policy |
| #9 G8 circular dependency | §2 G8 split into G8a (bootstrap) + G8b (consumer fanout) |
| #10 Matrix behavior pre-config | §10.2 explicit `<MISSING-CONFIG>` row blocking G7 |
| Critical: Public Maven bad-release rehearsal | §3.3 + §11 G8a rehearsal uses **OSSRH staging only**, never Maven Central |
| Minor: release manifest archival | §8.8 60-day live + archive to `_archive/<year>/<quarter>.tar.zst` |
| Internal: totals inconsistent | §2 reconciled to 41.5 |
| Internal: G8/consumer-CI circular | G8a/G8b split |
| Internal: G4 budget under | §6.2 +1d for ~100 translations |
| Time estimates | §2 G2 +1d (freeze coordination), G7 +1d (signoff coordination), G8 +1d (split) |

## Appendix D — v3 codex finding traceability

| v3 finding | v5 section |
|---|---|
| #1 Block-ID maintenance | §1.5 (now stable under edits) |
| #2 G8 missing | §8 (G8a + G8b full sections) |
| #3 Tier mechanism | §1.6 |
| #4 lang-dev remediation | §5 (carried forward) |
| #5 applies-to | §1.4 |
| #6 Backbone too blunt | §7.3 |
| #7 Test coverage | §3.3 (bad-release rehearsal corrected per v4-#11) |
| #8 Locale semver | §3.4 |
| #9 Empty globs | §4.2 |
| #10 99 keys budget | §6.2 (G4 +1d) |
| #11 Coverage matrix | §10.2 (GitHub App) |
| #12 Scanner export | §1.1 |

## Appendix E — v2 codex finding traceability

| v2 finding | v5 section |
|---|---|
| #1 Markdown unimplementable | §1.5 |
| #2 Homonymy | §1.2 |
| #3 Unsafe substring | §1.2 |
| #4 npm-Gradle bridge | §1.1 + §3.2 |
| #5 Term-owned consumers | §1.4 |
| #6 Publish race | §8 |
| #7 Term split | §1.2 + §7 |
| #8 Warn-only | §1.6 |
| #9 Dry-run evidence | §10.2 |
| #10 Remediation vague | §4.4 + §5.5 |
| #11 Enterprise out-of-scope | §13.1 |
| #12 13-day estimate | §2 (now 41.5d) |
| #13 Exit code | §4.2 |

## Appendix F — v1 codex finding traceability

(Same as v3 Appendix A.)
