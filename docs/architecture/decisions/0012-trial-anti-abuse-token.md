# ADR-0012: Anti-abuse Token for the Public Trial Endpoint

**Status**: Accepted — backend implemented (R31, 2026-05-29). Frontend wiring deferred to Cloudflare key provisioning.
**Context**: aster-api `/api/v1/policies/evaluate-source` is publicly reachable as the marketing-tier playground.
**Supersedes**: implicit "Origin allowlist + per-IP rate limit is enough" stance.

## Context

After R28→R29++ the trial chain is correctly path/property/tenant gated
end-to-end, and Codex R29++ audit scored **96/100 — enterprise
production-ready**. The single remaining "nice-to-have" item flagged
across three audit passes is the lack of a real anti-abuse signal on
the public trial endpoint:

> `trial` 仍只有成本控制，没有真实 anti-abuse token. 对 marketing demo
> 可接受；对企业级公开端点不够硬。非浏览器可伪造 Origin，只剩 IP 限流。

Concretely:

- `Origin: https://aster-lang.dev` is trivially forgeable by `curl` /
  any non-browser client (it's not enforced by anything other than our
  own filter).
- The per-IP minute/hour/concurrent limits in `TrialEndpointGuard`
  bound *cost per source IP*, but don't bound *cost per real human*.
- A residential-proxy attacker can rotate IPs indefinitely and run the
  Truffle interpreter on our compute for free.

This is not a security bug — the trial endpoint is intentionally
public, evaluation is sandboxed, and PlanGate ensures no quota
contamination. It is a **cost / abuse** concern.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| **A**: Cloudflare Turnstile (invisible CAPTCHA) | Free, runs on our own cf zone, no UX hit on first paint, defeats >95% of headless/script abuse | Requires frontend integration; one external dependency (cf.com); doesn't defeat human-driven abuse |
| **B**: Short-lived JWT issued by aster-cloud BFF | No third-party dep; pairs cleanly with the HMAC infrastructure we already have | aster-cloud must serve the JWT issuance route; the JWT itself needs an anti-replay store; UX is one extra round-trip on cold start |
| **C**: Proof-of-Work (e.g. HashCash) in browser before submit | Zero infra deps; defeats trivial bots | UX penalty visible; defeated by anyone willing to spend a few ms of CPU; widely seen as user-hostile |
| **D**: Status quo (Origin + per-IP) | Zero work | Doesn't move the needle on the audit finding |

## Decision

**Adopt Option A (Cloudflare Turnstile)** for the marketing trial
playground, gated behind a feature flag so non-prod environments stay
script-friendly.

Rationale:

- Cloudflare is already in front of `aster-lang.dev` (per
  ADR-0011-context: "Cloudflare proxies `policy.aster-lang.dev` → K3S
  ingress"). Turnstile keys are obtainable in the existing cf account
  with no new vendor onboarding.
- Invisible mode means most users never see a checkbox; the UX hit is
  the script tag and ~150ms of background work, which on the cold
  Truffle path is dominated by JIT warmup anyway.
- Option B duplicates anti-replay infrastructure we'd have to
  re-implement (we already have HMAC nonce store, but it's keyed on
  the production HMAC secret which is the wrong trust boundary for
  anonymous traffic).
- Option C is rejected on UX grounds — the playground is a marketing
  surface, friction kills conversions.

## Implementation Status (R31)

**Backend landed (commits 443e2f1, TurnstileVerifier + TrialEndpointGuard wire-in):**

- `io.aster.policy.security.TurnstileVerifier` (SHA-256 cache, 60s TTL,
  10k cache cap with LRU-ish shrink, fail-closed on missing secret /
  cf network error)
- Injected into `TrialEndpointGuard` between body-size + per-IP gates
- Env vars wired:
  - `ASTER_SECURITY_TRIAL_TURNSTILE_ENABLED` (default `false`)
  - `ASTER_SECURITY_TRIAL_TURNSTILE_SECRET` (Optional, no startup
    failure when missing)
  - `ASTER_SECURITY_TRIAL_TURNSTILE_TIMEOUT_MS` (default `3000`)
- `TurnstileVerifierTest` covers the fail-closed paths (5 cases)

**Still required to flip on:**

1. Cloudflare Turnstile widget provisioning for `aster-lang.dev`
2. Vault secret `secret/apps/aster-api-trial-turnstile` + ExternalSecret
3. aster-cloud playground: render widget + attach
   `X-Trial-Turnstile-Token` header
4. Set `ASTER_SECURITY_TRIAL_TURNSTILE_ENABLED=true` in prod
   environment (dev / podman stays unset → 100% backward-compatible)

## Implementation Plan

**Phase 1 (Q3 2026, scoped)**:

1. **Cloudflare config**:
   - Create a Turnstile widget for `aster-lang.dev` in the existing cf
     dashboard.
   - Store the site-key + secret-key in Vault under
     `secret/apps/aster-api-trial-turnstile`.
   - Wire ExternalSecret in k3s manifests.

2. **aster-cloud frontend**:
   - Add the Turnstile widget to the playground in
     `aster-cloud/src/components/policy/playground/PolicyPlayground.tsx`.
   - On submit, attach the token as `X-Trial-Turnstile-Token` header.
   - Feature flag: `NEXT_PUBLIC_TRIAL_TURNSTILE_ENABLED=true` in prod
     env, false everywhere else (so podman / local dev stays
     script-friendly).

3. **aster-api backend**:
   - New env vars:
     - `ASTER_SECURITY_TRIAL_TURNSTILE_ENABLED` (default false)
     - `ASTER_SECURITY_TRIAL_TURNSTILE_SECRET` (from Vault)
   - In `TrialEndpointGuard.checkRequest`, after the Origin allowlist
     check and before the per-IP limit, verify the token by calling
     `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
   - Cache positive verifications by token hash for 60s to avoid
     re-verifying within a single user session.
   - On `enabled=false`, skip the check entirely — keeps dev/podman
     workflows unchanged.

4. **Tests**:
   - Unit test on the verification client (mock cf endpoint).
   - Add a podman E2E case to the existing test runner:
     `enabled=false` → 200 (current behavior); `enabled=true` + no
     token → 403; `enabled=true` + mocked-pass token → 200.

**Phase 2 (only if needed)**:

- If automated abuse persists post-Turnstile, add a per-Turnstile-token
  rate limit (a token is roughly a human, so this would bound real
  human abuse).
- Consider promoting to a `Trial-Subscription` JWT issued by
  aster-cloud BFF (Option B) for logged-in users who want higher
  trial limits.

## Consequences

### Positive
- Removes the last item flagged across R29→R29++ audits.
- Future enterprise/SOC2 audit conversations can point to a concrete
  anti-abuse signal beyond IP.
- Does not affect the in-process security model — Truffle sandbox +
  PlanGate carveout + reserved-tenant denylist all remain authoritative.

### Negative
- Adds one external dependency to the trial path (Cloudflare).
- ~150ms extra latency on the first trial call per session.
- New Vault secret + ExternalSecret to maintain.

### Operational
- Trial guard now has a hard dependency on cf reachability when
  enabled; fallback policy: if cf siteverify fails open (timeout,
  network error), we fail **closed** — the trial endpoint returns 503
  with a documented retry message rather than waving requests through.
- Token verification cache reduces hot-path latency to one cf call
  per ~60s per token.

## Related

- ADR-0010 (Truffle polyglot sandbox) — the in-process defense layer
- ADR-0011 (lexicon hotplug strategy) — sibling R22 audit decision
- R28→R29++ audit cycle: `aster-api` commits 5e15ec8, 5d004e2, 2a28b28,
  06b478b, plus the R30 follow-ups (reserved-tenant denylist,
  `TrialBypassPredicate`).
- Codex R29++ final audit (score 96/100) — see in-tree session notes
  under `.context/` (private).
