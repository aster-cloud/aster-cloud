---
last-reviewed-at: 2026-05-20
owner: '@aster/platform'
reviewer: '@aster/glossary-stewards'
review-cadence: quarterly
---

# Runbook — Release Candidate flow + bad-release recovery

**Plan**: `.claude/plan/glossary-contract.md` v7 §3.2 + §3.6 + §8
**Scope**: Publishing a new `@aster-cloud/glossary` /
`io.aster:glossary-contract` version with dual-artifact atomicity,
and recovering from a bad release.

## Release Candidate (RC) flow

Every release transitions through a state machine
(`packages/glossary/releases/<version>.json`):

```
prepared
  → rc-validating       (RC tags published to npm-staging + OSSRH-staging)
  → rc-validated        (every consumer's glossary-rc-validate workflow green)
  → npm-promoting       (two-person approval gate)
  → npm-published       (npm publish --provenance)
  → maven-releasing     (OSSRH closeAndRelease)
  → maven-released      (Maven Central metadata + checksum verified)
  → promoted            (lockfile-bot fanout PRs opened)
```

## Standard release procedure

1. **Author** bumps version in `packages/glossary/package.json` and
   `packages/glossary/maven/build.gradle.kts`.
2. **CI** runs the release workflow:
   - Build TS → `dist/`.
   - Generate `dist/glossary.export.json`.
   - Build Maven artifact.
   - Run contract + scanner adversarial + integration tests.
   - Publish RC artifacts to staging registries.
   - Trigger every consumer's `glossary-rc-validate` workflow.
3. **Validate** within 24h:
   - All `tests/integration/` green.
   - Java reader loads `glossary.export.json` from OSSRH staging.
   - At least one consumer (`aster-cloud`) full CI green with RC pinned.
4. **Two-person approval gate** (release engineer + glossary steward)
   in the protected `production-publish-*` environments.
5. **Promote**: `npm publish` (with `--provenance`) → OSSRH
   `closeAndRelease` → poll Maven Central metadata (up to 4h timeout)
   → mark `promoted` → trigger lockfile-bot.

## Verification commands (per v7 §8.3)

### npm
```bash
npm view @aster-cloud/glossary@${VERSION} dist.integrity
npm view @aster-cloud/glossary@${VERSION} _attestations
# Install smoke test:
( cd $(mktemp -d) && npm init -y && npm install @aster-cloud/glossary@${VERSION} \
  && node -e "console.log(Object.keys(require('@aster-cloud/glossary').glossary.terms).length)" )
```

### Maven Central
```bash
curl -fsSL "https://repo1.maven.org/maven2/io/aster/glossary-contract/maven-metadata.xml" \
  | grep "<version>${VERSION}</version>"
curl -fsSL "https://repo1.maven.org/maven2/io/aster/glossary-contract/${VERSION}/glossary-contract-${VERSION}.jar.sha256" \
  | grep -q "$EXPECTED_JAR_SHA256"
gradle dependencies --refresh-dependencies | grep "io.aster:glossary-contract:${VERSION}"
```

All three checks must pass before state transitions to `maven-released`.

## Bad-release recovery (out-of-band denylist)

Maven Central is immutable. Recovery is **deprecate-and-replace**, not
unpublish.

### Triage (≤ 4h from detection)

Release engineer evaluates: is this a content fix (typo, wrong
translation) or a structural fix (schema change, breaking Java reader)?

### Deprecate the bad version

1. Edit `releases/denylist.json` in `aster-design-system`:
   ```json
   {
     "version": 1,
     "updated-at": "<ISO timestamp>",
     "signature": "<GPG sig over entries[] by glossary-release-eng-key>",
     "entries": [
       {
         "package-version": "<bad version>",
         "reason": "<concrete description>",
         "replacement": "<next patch version>",
         "denylisted-at": "<ISO>",
         "denylisted-by": "<actor email>"
       }
     ]
   }
   ```
2. Merge triggers `publish-denylist.yml`:
   - Validates GPG signature.
   - Publishes to `https://glossary.aster-lang.cloud/denylist.json` (CDN).
   - Publishes to GitHub raw URL fallback.
   - Bundles into the next package release.
3. Optional: `npm deprecate @aster-cloud/glossary@<bad>` adds an npm
   warning (cosmetic, not enforcement).

### Patch release

1. Fix in source.
2. Bump to next patch (`1.0.0` bad → `1.0.1` good).
3. Full RC flow.
4. Promote.

### Emergency PRs across consumers

Lockfile-bot opens PRs in every consumer repo replacing the
denylisted pin with the patched version. Consumer CI runs
`verify-release-manifest` which now sees the denylist entry and
fails fast on the bad version — gives the consumer maintainer
explicit "your previous pin was deprecated" signal.

### Post-mortem (within 1 week)

Write `docs/operations/glossary-incidents/<date>-<summary>.md`:

- What released, what was wrong, who detected, time-to-detection.
- "What RC test would have caught this?" → harden the RC suite.

## GPG keys used

- `glossary-release-eng-key` (Vault) — signs `denylist.json` + emergency
  manual signing.
- `glossary-ci-signing-key` (KMS via OIDC) — signs release manifests
  during state transitions.

See `gpg-key-lifecycle.md` for rotation procedure.

## Related runbooks

- `glossary-prerequisites.md` — infra setup (npm provenance, OSSRH, KMS).
- `gpg-key-lifecycle.md` — key rotation + emergency rollover.
- `cascade-outage.md` — what to do when external services fail mid-release.
