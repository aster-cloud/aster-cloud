# ADR-0003: DCE backstop — DefinePlugin + webpack alias=false + ESLint guard

- Status: Accepted
- Date: 2026-05-18
- Deciders: aster-cloud platform team

## Context

[ADR-0001](./0001-single-source-two-distributions.md) requires the on-prem
bundle to be free of SaaS-only npm packages (Stripe, Resend,
mixpanel-browser) and their secret env literals (STRIPE_SECRET_KEY,
RESEND_API_KEY, etc.). [ADR-0002](./0002-deployment-mode-two-tier-capability-surface.md)
gives developers the right `CAN_*` constants to gate code by mode. But
none of that is enforced by the compiler — a developer can write
`import Stripe from 'stripe'` at the top of any file and the bundle will
silently grow ~128KB even if every actual usage of `Stripe` sits behind
`if (!IS_SAAS) return 404`.

We need a **defense-in-depth stack**: each layer prevents a different
failure mode. Any single layer can be defeated by accident; together
they make the failure mode loud.

## Decision

Three layers, all required, all verified by CI:

### Layer 1 — Compile-time constant folding (DefinePlugin)

`next.config.ts`'s `webpack: (config, { webpack }) => ...` hook installs a
`DefinePlugin` that substitutes `__DEPLOYMENT_MODE__` with the literal
string `'saas'` or `'on-prem'`. Terser then folds `if (literal !== 'saas')`
to `if (false)` and drops the entire branch — including any
`await import('stripe')` expression inside.

### Layer 2 — Module resolution stub (`webpack.resolve.alias = false`)

When `DEPLOYMENT_MODE === 'on-prem'`, the same webpack hook aliases
`stripe`, `resend`, `mixpanel-browser` to `false`. This causes webpack
to resolve these imports to an empty stub — even if Layer 1 misses a
branch (e.g., terser changes behavior, or a hot-gate file isn't marked
correctly), the actual SDK code physically does not enter the bundle.

```ts
config.resolve.alias = {
  ...(config.resolve.alias || {}),
  stripe: false,
  'mixpanel-browser': false,
  resend: false,
};
```

### Layer 3 — Static-import ESLint guard (`no-static-saas-only-import`)

ESLint forbids `import Foo from 'stripe'` (and the named / namespace /
require / side-effect variants) in production code. The rule allows:

- `import type Foo from 'stripe'` (erased at compile time, zero bundle cost)
- `await import('stripe')` inside a dynamically-loaded wrapper
- Designated wrapper files (`src/lib/stripe.ts`, `resend.ts`,
  `mixpanel.ts`) explicitly allow-listed
- Files with `/* @deployment-mode-hot-gate reason: ... */` marker

This is the **Turbopack-compat backstop**: when (not if) we drop
webpack — Turbopack today has neither DefinePlugin nor
`resolveAlias: false` equivalents
([docs/workstreams/turbopack-migration](../../workstreams/turbopack-migration/README.md))
— Layer 3 is the only thing that survives. It's the locked door even
if the wall comes down.

### Verification

`pnpm verify:on-prem-bundle` (CI gate) greps the produced
`.open-next/` artifacts for:

- SaaS-only npm package source markers (`StripeAPIError`, `Resend`
  constructor, mixpanel rrweb chunks)
- Secret env literal references (`STRIPE_SECRET_KEY`, `RESEND_API_KEY`,
  `MIXPANEL_TOKEN`)

Exit non-zero if any match. The verifier scans the *worker bundle*, not
the intermediate `.next/` output, so we catch leaks that survive
through to deployment.

## Alternatives considered

- **DefinePlugin alone** — rejected: dynamic import expressions
  (`await import('stripe')`) survive Layer 1 alone (webpack treats them
  as side-effectful). Verified empirically by spike report §3.2.
- **`webpack.alias = false` alone** — rejected: doesn't strip the
  *literal* references (`process.env.STRIPE_SECRET_KEY` strings sit in
  route bodies even when the SDK is stubbed). Layer 1 must remove the
  branch so the literal goes with it.
- **ESLint rule alone** — rejected: only catches static imports, not
  references via hot-gate wrappers or branches that *do* use
  `await import()`. Layer 3 prevents *new* leaks but can't reduce
  existing legitimate hot-gate code's bundle footprint without Layer 1.
- **Tightening to "no SaaS-only code in any branch, period"** —
  rejected as too restrictive: hot gates (Stripe webhook handler, Resend
  email sender) are legitimately SaaS-only code that must exist in the
  SaaS bundle. The model is *gated separation*, not *removal*.

## Consequences

**Good:**
- Three independent failure modes (terser regression, webpack alias
  config breakage, developer accidentally adding static import) each
  caught by a different layer.
- Bundle verifier doubles as fail-closed CI gate: if the SaaS-only
  count ever ticks above zero in on-prem, the PR cannot merge.
- The ESLint rule pre-positions us for Turbopack migration: when
  Layers 1+2 must be removed (because Turbopack ships before its
  equivalents), Layer 3 still guards the source surface.

**Bad:**
- Three layers = three places a developer can be confused. Each layer
  has its own ESLint rule (`no-direct-macro`,
  `no-static-saas-only-import`) which is a positive: rules guide
  developers without anyone having to memorize the architecture.
- Locks us to webpack until Turbopack ships PR #90300 + #93331. Tracked
  with explicit `--webpack` flag in build scripts +
  [docs/workstreams/turbopack-migration](../../workstreams/turbopack-migration/README.md)
  for periodic re-evaluation.

**Re-evaluate when:**
- Turbopack ships `define` + `resolveAlias: false` (both PRs merged in
  Vercel main). At that point Layer 1 + Layer 2 can move to Turbopack
  config; Layer 3 (ESLint) stays unchanged. The migration is a one-line
  flag flip in `package.json`, not a re-architecture.
- New SaaS-only npm package added — must be added to the
  `SAAS_ONLY_PACKAGES` set in `eslint-rules/no-static-saas-only-import.js`
  *and* the webpack alias list in `next.config.ts`. The verifier won't
  catch the second omission until production build, so PRs adding new
  SaaS-only deps should bump both in the same commit.

## References

- ADR-0001 (the invariant this protects)
- ADR-0002 (the developer-facing API these layers enforce)
- Workstream: [docs/workstreams/turbopack-migration](../../workstreams/turbopack-migration/README.md)
- Spike report: `.claude/plan/deployment-mode-spike-report.md` §3.2-§3.3
  (empirical evidence for needing both Layer 1 + Layer 2)
- ESLint rules:
  - `eslint-rules/no-direct-macro.js`
  - `eslint-rules/no-static-saas-only-import.js`
- Webpack hook: `next.config.ts` (the `webpack: (config, ...) => ...` block)
- Verifier: `scripts/verify-on-prem-bundle.ts`
- CI gate: `pnpm verify:on-prem` (build + bundle verify + UI smoke)
