# Glossary Contract — Infrastructure Prerequisites (G0.5)

**Plan reference**: `.claude/plan/glossary-contract.md` §0.2, §1.7
**Status**: Draft — checklist for ops to provision
**Last reviewed**: 2026-05-20
**Owner**: `@aster/platform`
**Reviewer**: `@aster/glossary-stewards`
**Review cadence**: quarterly

Every prerequisite must be provisioned and verified before `G1` can produce
its first release candidate. Each item below has a corresponding G1 preflight
CI job that asserts the prerequisite exists; G1 fails fast if any check is red.

## Provisioning checklist

### 1. npm trusted publishing

- [ ] **What**: GitHub OIDC → npm trusted publishing for `@aster-cloud/glossary` and `@aster-cloud/glossary-fmt` packages.
- [ ] **How**:
  1. Reserve npm package names `@aster-cloud/glossary` and `@aster-cloud/glossary-fmt`.
  2. In npm.com → Package settings → Publishing access → Add trusted publisher → GitHub Actions.
  3. Configure repository `aster-cloud/aster-design-system`, workflow file `.github/workflows/publish-glossary.yml`.
  4. Enforce `--provenance` in the publish workflow.
- [ ] **Verify**: `npm view <existing-package>@latest _attestations` returns a provenance record.
- [ ] **CI preflight job**: `verify-npm-provenance-configured`.

### 2. OSSRH (Sonatype) credentials for Maven Central

- [ ] **What**: OSSRH account + GPG signing key for `io.aster:glossary-contract`.
- [ ] **How**:
  1. Confirm `io.aster` group is registered with OSSRH (Aster already publishes Java artifacts under this group; reuse existing setup).
  2. Generate dedicated GPG key for glossary releases (NOT the same as existing aster-lang-core release key).
  3. Store GPG private key in CI secret `OSSRH_GPG_KEY`; GPG passphrase in `OSSRH_GPG_PASSPHRASE`.
  4. Store OSSRH credentials in `OSSRH_USERNAME` / `OSSRH_PASSWORD`.
  5. Test: dry-run publish to OSSRH staging from a no-op artifact.
- [ ] **Verify**: OSSRH staging publish from CI succeeds against a test `0.0.0-prereq-test` artifact (this artifact is dropped, NOT released to Maven Central).
- [ ] **CI preflight job**: `verify-ossrh-credentials`.
- [ ] **Secret rotation**: OSSRH password every 365 days; GPG key per `gpg-key-lifecycle.md`.

### 3. GitHub App `aster-glossary-matrix-bot`

- [ ] **What**: GitHub App for cross-repo coverage matrix generation (§10.2.1).
- [ ] **How**:
  1. Create GitHub App in Aster org at https://github.com/organizations/aster-cloud/settings/apps.
  2. Permissions: `metadata:read`, `contents:read`, `actions:read`, `pull-requests:write`.
  3. Install in all consumer repos listed in `aster-design-system/.glossary/consumers.yaml`.
  4. Generate private key; store in `aster-design-system` repo secrets as `GLOSSARY_BOT_PRIVATE_KEY`, `GLOSSARY_BOT_APP_ID`, `GLOSSARY_BOT_INSTALLATION_ID`.
- [ ] **Verify**: App can list installed repos and read `glossary.config.yaml` from each.
- [ ] **CI preflight job**: `verify-github-app-installed`.

### 4. CODEOWNERS teams

- [ ] **What**: `@aster/glossary-stewards` team with ≥ 2 members; write access to relevant paths.
- [ ] **How**:
  1. Create GitHub team `@aster/glossary-stewards` in Aster org.
  2. Add ≥ 2 members per §0.1 stakeholder matrix sign-off.
  3. Configure write access to the following paths across all consumer repos:
     - `glossary.config.yaml`
     - `.glossary/**`
     - `docs/operations/glossary-*.md`
     - `messages/**` (for backbone term enforcement)
  4. Add CODEOWNERS file entries in each consumer repo (template in `aster-design-system/.glossary/CODEOWNERS.template`).
- [ ] **Verify**: PR touching `glossary.config.yaml` in any consumer repo requires `@aster/glossary-stewards` review.
- [ ] **CI preflight job**: `verify-codeowners-teams`.

### 5. Protected GitHub Environments

- [ ] **What**: Protected environments `production-publish-npm` and `production-publish-maven` in `aster-design-system` with two-reviewer approval rule.
- [ ] **How**:
  1. In `aster-design-system` repo → Settings → Environments → New environment.
  2. Create `production-publish-npm`: required reviewers = 2; reviewers from `@aster/platform` + `@aster/glossary-stewards`; deployment branches = `main` only.
  3. Repeat for `production-publish-maven`.
  4. Bind secrets `NPM_TOKEN`, `OSSRH_USERNAME`, `OSSRH_PASSWORD`, `OSSRH_GPG_KEY`, `OSSRH_GPG_PASSPHRASE` to these environments.
- [ ] **Verify**: Test publish workflow against environments requires explicit human approval before running.
- [ ] **CI preflight job**: `verify-protected-environments`.

### 6. P0 steward on-call rotation

- [ ] **What**: 24×7 on-call rotation for P0 freeze-bypass requests (§4.4) with 4h response SLO.
- [ ] **How**:
  1. **Choose provider** (Aster decision): PagerDuty / OpsGenie / Slack-with-paging-bot.
  2. Create on-call schedule `glossary-p0-steward` rotating weekly through `@aster/glossary-stewards` members.
  3. Configure PR-trigger automation: when a PR description contains `Glossary-Freeze-Bypass:` trailer, fire a page to the on-call schedule.
  4. Quarterly practice page exercise to verify SLO.
- [ ] **Verify**: Manual test page reaches on-call within 4h.
- [ ] **CI preflight job**: `verify-paging-provider`, `verify-oncall-roster`.

### 7. GPG key lifecycle (two keys)

- [ ] **What**: `glossary-release-eng-key` (Vault-held) + `glossary-ci-signing-key` (KMS-backed via OIDC).
- [ ] **How**:
  1. **Release engineer key**: Generate GPG key in Vault under path `kv/glossary/release-eng-key`; bind to `@aster/glossary-stewards` Vault role.
  2. **CI signing key (KMS)**: Provision KMS asymmetric key (GCP KMS or AWS KMS — Aster ops decision).
     - Create OIDC binding between `aster-design-system` GitHub repo and KMS `sign` permission, scoped to `production-publish-*` environments only.
     - **H1 separation of duties** (v7 hardening): IAM admin role MUST be distinct from release-engineer role; IAM binding changes require platform + security joint approval.
  3. Publish public keys: bundle both public keys in the `@aster-cloud/glossary` npm package + Maven artifact (offline trust store; no keyserver dependency).
- [ ] **Verify**: Test `kms:sign` call from the publish workflow succeeds; manual GPG sign with the Vault key succeeds.
- [ ] **CI preflight job**: `verify-gpg-trust-store`, `verify-ci-signing-kms`.

### 8. CDN for manifest + denylist distribution

- [ ] **What**: Public CDN at `glossary.aster-lang.cloud` serving release manifests and denylist.
- [ ] **How**:
  1. Cloudflare Pages site backed by `aster-design-system` repo, deployed from `packages/glossary/releases/` and `packages/glossary/denylist.json`.
  2. CNAME `glossary.aster-lang.cloud` → Cloudflare Pages.
  3. Configure cache headers: manifests `max-age=86400` (24h), denylist `max-age=300` (5min — denylist must propagate fast).
  4. CDN write access scoped to Cloudflare Pages auto-deploy; no human direct write.
- [ ] **Verify**: HTTP GET to `https://glossary.aster-lang.cloud/releases/0.0.0-prereq-test.json` returns the test manifest.
- [ ] **CI preflight job**: `verify-cdn-reachable`.

### 9. `aster-deploy` private storage for deal-overrides

- [ ] **What**: Encrypted `aster-deploy/private/glossary/deal-overrides.yaml` with git-crypt or equivalent.
- [ ] **How**:
  1. Confirm `aster-deploy` is private and uses git-crypt for sensitive files (existing convention).
  2. Create directory `aster-deploy/private/glossary/`.
  3. Add `deal-overrides.yaml` to `.gitattributes` for git-crypt encryption.
  4. CODEOWNERS gate the path to `@aster/deal-desk` + `@aster/glossary-stewards`.
  5. Add `aster-deploy` CI validator that imports public schema from `aster-cloud/docs/operations/deal-overrides.schema.yaml` by checksum (H2).
- [ ] **Verify**: Test deal-override entry passes private validator; same entry copied to public repo fails the public shape check (deliberate — public should reject real data).
- [ ] **CI preflight job**: N/A (private repo; verified during G1).

## Estimated wall-clock

- **0.5d**: if all credentials/teams already exist (npm package names reserved; OSSRH account active; GitHub teams exist; PagerDuty configured).
- **2d**: if any item requires IT/legal procurement (new GitHub App, new KMS key, new on-call provider).
- **Up to 5d**: if PagerDuty or OSSRH need new vendor procurement.

Track procurement blockers as `[glossary-G0.5] procurement: <item>` GitHub issues in `aster-cloud`.

## Once verified

After every checklist item has a verified ✅:

- This document's `Last reviewed` is bumped.
- The `verify-*` preflight CI jobs all green against the `aster-design-system` repo.
- `G1` engineering work can begin.

## Audit trail

PR provisioning each item: _track via issue list_
KMS key fingerprints: _populate when KMS keys provisioned_
GPG key fingerprints: _populate when keys generated_
GitHub App ID: _populate after creation_
Cloudflare Pages project ID: _populate after creation_
