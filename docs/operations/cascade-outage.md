---
last-reviewed-at: 2026-05-20
owner: '@aster/platform'
reviewer: '@aster/incident-commander, @aster/glossary-stewards'
review-cadence: quarterly
---

# Runbook — Cascade outage policy

**Plan**: `.claude/plan/glossary-contract.md` v7 §12.4
**Scope**: What to do when one or more external services that the
Glossary Contract depends on goes down.

The contract depends on ~8 external services: npm, Maven Central /
OSSRH, GitHub, GitHub Actions, Cloudflare CDN, Slack, PagerDuty (or
equivalent), KMS provider, Vault.

## Per-service fail-open vs fail-closed

| Service unavailable | Affected check | Default behavior | Override |
|---|---|---|---|
| npm registry | `verify-release-manifest` integrity check | Cached manifest used (≤24h); CI passes | Auto-recover when npm returns |
| Maven Central | Java consumer dep resolution | Gradle uses cached artifact; build proceeds with warning | Steward `--skip-maven-verify` flag with audit trail |
| GitHub raw URL | Manifest source secondary | Falls through to CDN primary | None — CDN must be up |
| Cloudflare CDN | Manifest source primary | Falls through to GitHub raw | None — GitHub must be up |
| **All manifest sources down** | `verify-release-manifest` | Fail-closed if cache stale (>24h); fail-open with warning if cache fresh | Incident-commander manual override (logged in `glossary-incidents/`) |
| **All denylist sources down >1h** | denylist check | **Fail-closed** (refusing to validate against potentially-outdated denylist) | Glossary-steward + security-officer dual override only |
| Slack | Cosmetic-window watcher notifications | Issue still created; Slack ping skipped with log warning | None — issue is the canonical record |
| PagerDuty / on-call provider | P0 bypass page (§4.4) | Falls through to direct steward Slack DM; if also Slack down, IC pages via IC's own provider | Multi-provider failover documented in `glossary-oncall.md` |
| GitHub Actions | Publish workflow | Release cannot proceed; release engineer notifies stakeholders | None — release-pause until restored |
| KMS provider | CI signing key | Manifest signing fails; release blocked at `npm-promoting` | Use Vault-held release-engineer key for emergency signing (audit-logged) |
| Vault | Release-engineer key access | Only emergency manual signing affected; CI signing unaffected | None for routine — KMS handles 99% of signing |

## Two-service-down scenarios

### npm + Maven both down

- Full release blocked.
- Consumers continue running on cached artifacts.
- Acceptable for transient (<4h) outages.
- For longer: release engineer announces glossary-release-pause in
  `#glossary-stewards`.

### CDN + GitHub raw both down

- Consumer CIs fall through to cache.
- If cache is fresh (<24h manifest, <1h denylist), CI warns but passes.
- If cache is stale, CI fails closed.
- Steward override possible only with documented justification in
  `glossary-incidents/`.

### KMS + Vault both down

- Cannot sign anything.
- Emergency case requiring re-establishing key infra.
- Glossary stewards declare a **signing freeze**; no releases until
  restored.

### Slack + PagerDuty both down

- P0 freeze-bypass requests reach the on-call steward via the IC's
  own paging path.
- Cosmetic-window watcher creates GitHub issues but no notification
  goes out; manual triage by stewards at next business-day check-in.

## Override authority

The "Override" column above documents who can manually unblock a
fail-closed check during a verified outage:

- **Steward** — single steward sign-off for non-security-critical
  overrides (e.g., manifest source unreachable, cached version is
  known-good).
- **Steward + Security** — two-person sign-off for denylist
  fail-closed override (denylist propagates revocations; bypassing
  it is a security decision).
- **Incident Commander** — emergency authority during a declared
  incident; documents in `glossary-incidents/` after the fact.

## After a cascade outage

Required post-mortem within 1 week of resolution. File at
`docs/operations/glossary-incidents/<date>-cascade-<svc1>-<svc2>.md`
with:

- Timeline.
- Which checks failed-closed vs fail-open.
- Which overrides were invoked and by whom.
- What we'd change about the policy if we had this incident again.

## Related runbooks

- `glossary-prerequisites.md` — initial setup of each service.
- `rc-and-recovery.md` — release pipeline that uses these services.
- `glossary-oncall.md` — on-call rotation handling page failover.
- `gpg-key-lifecycle.md` — KMS + Vault key procedures.
