# ADR-0002: Two-tier capability surface — compile-time constants + runtime CAPABILITIES

- Status: Accepted
- Date: 2026-05-18
- Deciders: aster-cloud platform team

## Context

[ADR-0001](./0001-single-source-two-distributions.md) commits us to
build-time bundle separation. That requires every "is this feature
enabled" check to be **resolvable at compile time** so the terser pass
can fold dead branches and strip them. But UI also needs a way to read
mode at runtime — `<Sidebar/>` rendering an "Admin / License" link only
on-prem, "Admin / Billing" only on SaaS, etc. These two needs have
opposite optimal shapes:

- **DCE-sensitive code** (hot gates, dynamic imports of SaaS SDKs) wants
  **literal boolean constants** that terser can substitute in-place. Even
  one level of function indirection or object property access defeats DCE
  for the dynamic-import expression inside.
- **UI / runtime code** wants an **object** it can iterate over,
  destructure, pass through context — and is OK with non-DCE behavior
  because it doesn't import heavy SDKs.

The spike (`.claude/plan/deployment-mode-spike-report.md`) confirmed
empirically that `if (IS_SAAS) { await import('stripe') }` does NOT
DCE out the dynamic import on its own — webpack treats dynamic imports
as side-effectful. Only the *literal* `if (__DEPLOYMENT_MODE__ === 'saas')`
form with the macro directly inlined (not through any helper) folds the
branch + drops the chunk reference cleanly.

## Decision

Expose **two surfaces** from `src/lib/deployment-mode.ts`:

1. **Compile-time constants** for any code where DCE matters:

   ```ts
   export const IS_SAAS = _RUNTIME === 'saas';
   export const IS_ONPREM = _RUNTIME === 'on-prem';
   export const CAN_BILLING = IS_SAAS;
   export const CAN_PRICING = IS_SAAS;
   export const CAN_RISKTIER = IS_SAAS;
   export const CAN_LICENSE = IS_ONPREM;
   // ... one CAN_* per capability
   ```

   Used by routes, server actions, anywhere that gates a dynamic import
   or branches on whether SaaS-only code can run.

2. **CAPABILITIES runtime object** for UI:

   ```ts
   export const CAPABILITIES = {
     billing: CAN_BILLING,
     pricing: CAN_PRICING,
     license: CAN_LICENSE,
     // ...
   } as const;
   ```

   Plus `useDeploymentMode()` hook exposing the same shape to client
   components. UI iterates or destructures freely; doesn't need DCE
   because UI doesn't import SaaS-only SDKs directly (the routes those
   UIs call do).

3. **Hot gates** (Stripe wrapper, Resend wrapper, etc.) — files that
   `await import()` a SaaS-only npm package — get a **third treatment**:
   reference the ambient macro `__DEPLOYMENT_MODE__` directly, **not**
   through any import. This is the only form terser can fold completely.
   Each such file must carry an opt-in marker comment and pass the
   ESLint guard (see [ADR-0003](./0003-deployment-mode-dce-backstop.md)).

## Alternatives considered

- **One unified API (only the object)** — rejected by spike: object
  property access (`CAPABILITIES.billing`) survives terser even after
  inlining, leaving the dynamic-import branch alive. We'd ship Stripe
  in on-prem bundles.
- **One unified API (only constants)** — rejected for ergonomics:
  `useDeploymentMode()` UI consumers want to iterate or pass a
  capabilities map; spreading 9 constants every place is noisy.
- **Read `process.env.DEPLOYMENT_MODE` everywhere directly** — rejected.
  Trivially defeats DCE (env access is opaque to terser), defeats type
  safety (string vs enum), and makes mode-conditional logic
  ungreppable. Now caught by the `no-direct-macro` ESLint rule.

## Consequences

**Good:**
- Code authors pick the surface that matches their use case; the type
  signatures keep them honest (`CAN_BILLING: boolean` vs `CAPABILITIES:
  Readonly<{...}>`).
- Adding a new capability is a 1-line edit in `deployment-mode.ts` and
  a corresponding entry in `CAPABILITIES`.
- Hot gates are explicitly marked + ESLint-enforced, so the rare files
  that bypass the helper layer are auditable.

**Bad:**
- Cognitive overhead: "which surface do I use?" is a real question for
  newcomers. Mitigated by the constant naming (`CAN_*` = compile-time
  branch gate; `CAPABILITIES.*` = UI runtime check) and JSDoc on each
  export.
- Three surfaces means three eslint guards (constants, capabilities,
  hot-gate macro). All implemented in `eslint-rules/no-direct-macro.js`
  + `eslint-rules/no-static-saas-only-import.js`.

**Re-evaluate when:**
- Turbopack ships a `define` equivalent that handles object property
  access for DCE (cross-module-constants PR
  [vercel/next.js#90300](https://github.com/vercel/next.js/pull/90300)).
  At that point we may be able to collapse to a single surface.

## References

- ADR-0001 (the build-time separation this elaborates)
- ADR-0003 (the DCE backstop that protects this scheme)
- Plan: `.claude/plan/deployment-mode-flag-v2.md` §2.1-2.4 (architecture)
- Spike report: `.claude/plan/deployment-mode-spike-report.md` §3.1-3.3
  (empirical proof that the two surfaces have different DCE behavior)
- ESLint rule: `eslint-rules/no-direct-macro.js`
- Helper module: `src/lib/deployment-mode.ts`
- Client hook: `src/hooks/use-deployment-mode.ts`
