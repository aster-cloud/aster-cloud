# ADR-0001: Single source, two distributions via build-time DEPLOYMENT_MODE

- Status: Accepted
- Date: 2026-05-18
- Deciders: aster-cloud platform team

## Context

Aster ships both a **SaaS** product (multi-tenant, Cloudflare Workers,
Stripe billing, self-serve signup) and an **on-prem** product (single-tenant,
customer-deployed, license-key gated, no phone-home). Most code is shared:
auth, policy engine integration, admin UI, i18n. Only specific surfaces
diverge — Stripe / pricing / risk-tier / signup belong to SaaS only; license
management / SSO admin belong to on-prem only.

Three structural choices were available:

1. **Two repos / forks** — copy-paste, drift forever.
2. **Two `*.saas.tsx` / `*.onprem.tsx` files per page** — single repo but
   doubled the surface area for every SaaS-only feature.
3. **Single source, distribution selected by build-time flag** — one set of
   files, mode toggled at build time, dead code physically removed from the
   produced bundle for that mode.

## Decision

Adopt **option 3**: single source code, selected by a build-time environment
variable `DEPLOYMENT_MODE` ∈ `{saas, on-prem}`. Default is `saas` (because
SaaS is the always-running CI happy path). Different bundles are produced
by the same `pnpm build` command; the only difference is the env var at
build invocation:

```bash
pnpm build                            # SaaS
DEPLOYMENT_MODE=on-prem pnpm build    # on-prem
```

Bundle correctness is verified by `pnpm verify:on-prem-bundle` which scans
the produced `.open-next/` artifacts for Stripe / Resend / Mixpanel SDK
symbols + secret env literals — zero matches is the contract.

## Alternatives considered

- **Two repos / forks** — rejected. Drift between SaaS and on-prem features
  is the precise failure mode we're trying to avoid; a security fix in
  shared code must land both places without anyone forgetting.
- **`*.saas.tsx` / `*.onprem.tsx` file splits** — rejected. Surface area
  scales with feature count; merging shared logic later is painful; review
  must compare two near-identical files.
- **Runtime feature flags with everything bundled** — rejected for two
  reasons: (1) on-prem customers cannot have Stripe SDK in their bundle
  (compliance / forensics / supply chain concerns; auditors ask to see the
  bundle and Stripe must literally not be in it), (2) bundle size matters
  for Workers cold-start.

## Consequences

**Good:**
- One file to edit per shared change; one PR to ship a fix to both modes.
- On-prem bundle is provably free of SaaS-only npm packages and secret env
  references — auditable invariant, not a policy promise.
- Both distributions stay on the same Next.js / React version etc., no
  version skew bug class.

**Bad:**
- Every contributor must understand the `IS_SAAS` / `CAN_*` convention or
  they'll silently introduce SaaS code into the on-prem bundle. We mitigate
  with [ADR-0003](./0003-deployment-mode-dce-backstop.md)'s DCE backstop +
  ESLint rule.
- Build matrix doubles on CI (one SaaS build + one on-prem build). Mitigated
  by Turbopack-native caching once it ships (tracked in
  [docs/workstreams/turbopack-migration](../../workstreams/turbopack-migration/README.md)).
- Tests must run under both modes for any code that branches on `IS_SAAS`.
  Solved by [ADR-0002](./0002-deployment-mode-two-tier-capability-surface.md)'s
  Vitest projects setup.

**Re-evaluate when:**
- Distribution count grows beyond 2 (multi-tenant flavors, regional builds).
  At 4+ distributions a runtime config + plugin system becomes cheaper than
  multiplying build matrices.
- Bundle DCE invariant becomes unenforceable (e.g., Vercel removes webpack
  support before Turbopack reaches feature parity — see ADR-0003).

## References

- Plan: `.claude/plan/deployment-mode-flag-v2.md` (the full implementation
  blueprint that this ADR distills)
- Spike report: `.claude/plan/deployment-mode-spike-report.md` (PR-1a
  empirically verified DCE works end-to-end before we committed to this path)
- SaaS-only inventory: `.claude/plan/saas-only-inventory.md` (every file
  that branches on mode)
- PR series: `feat(deployment-mode): PR-1..PR-10` (commits `983a136`..`b029744`)
