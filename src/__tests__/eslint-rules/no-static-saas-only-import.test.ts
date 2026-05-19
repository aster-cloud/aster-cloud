/**
 * RuleTester unit tests for eslint-rules/no-static-saas-only-import.
 *
 * 覆盖矩阵：
 *   ALLOWED files (wrapper allowlist):
 *     - src/lib/stripe.ts / resend.ts / mixpanel.ts
 *   HOT-GATE marker：
 *     - 同 no-direct-macro 的 @deployment-mode-hot-gate marker，reason 必填
 *   Type-only imports：
 *     - `import type X from 'stripe'`  → allowed
 *     - `import { type X } from 'stripe'`  → allowed
 *   Subpath imports：
 *     - `import 'stripe/lib/foo'`  → triggers（仍然进 bundle）
 *   Dynamic imports：
 *     - `await import('stripe')`  → allowed（这是我们鼓励的形式）
 *   require() form：
 *     - `require('stripe')`  → triggers
 *   Side-effect import：
 *     - `import 'stripe'`  → triggers，专用 messageId
 *   Non-SaaS-only packages：
 *     - `import x from 'react'`  → ignored
 */

import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
// JS plugin — TS resolves it via allowJs (tsconfig.json) and infers
// shape from module.exports. No @ts-expect-error needed.
import rule from '../../../eslint-rules/no-static-saas-only-import.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

ruleTester.run('no-static-saas-only-import', rule, {
  valid: [
    // ── ALLOWED files: wrapper modules ──────────────────────────────
    {
      name: 'stripe wrapper (src/lib/stripe.ts) — type + dynamic import',
      filename: '/abs/proj/src/lib/stripe.ts',
      code: `
        import type Stripe from 'stripe';
        async function load() {
          return (await import('stripe')).default;
        }
        load();
      `,
    },
    {
      name: 'resend wrapper',
      filename: '/abs/proj/src/lib/resend.ts',
      code: `
        import type { Resend } from 'resend';
        async function load() { return (await import('resend')).Resend; }
        load();
      `,
    },
    {
      name: 'mixpanel wrapper',
      filename: '/abs/proj/src/lib/mixpanel.ts',
      code: `
        import type mp from 'mixpanel-browser';
        async function load() { return await import('mixpanel-browser'); }
        load();
      `,
    },

    // ── HOT-GATE marker with reason ─────────────────────────────────
    {
      name: 'arbitrary file with valid hot-gate marker',
      filename: '/abs/proj/src/app/api/stripe/webhook/handlers/_shared.ts',
      code: `
        /* @deployment-mode-hot-gate
         * reason: webhook handler needs Stripe Event type at the boundary.
         */
        import Stripe from 'stripe';
        export type Event = Stripe.Event;
      `,
    },

    // ── Type-only imports (no marker needed) ────────────────────────
    {
      name: 'import type from stripe',
      filename: '/abs/proj/src/lib/billing-types.ts',
      code: `import type Stripe from 'stripe'; export type X = Stripe.Customer;`,
    },
    {
      name: 'import { type X } mixed type spec — all type → allowed',
      filename: '/abs/proj/src/lib/billing-types.ts',
      code: `import { type Resend } from 'resend'; export type R = Resend;`,
    },

    // ── Dynamic imports ─────────────────────────────────────────────
    {
      name: 'await import() of stripe',
      filename: '/abs/proj/src/app/api/some-route/route.ts',
      code: `
        export async function POST() {
          const s = await import('stripe');
          return new Response(JSON.stringify(typeof s));
        }
      `,
    },

    // ── Non-SaaS packages should never trigger ──────────────────────
    {
      name: 'import from react is ignored',
      filename: '/abs/proj/src/components/x.tsx',
      code: `import { useState } from 'react'; export const X = () => { const [s] = useState(0); return s; };`,
    },
    {
      name: 'package name that contains "stripe" as substring is ignored',
      filename: '/abs/proj/src/x.ts',
      code: `import x from 'stripe-mock-server-fake'; export { x };`,
    },
  ],

  invalid: [
    // ── Static default value import ─────────────────────────────────
    {
      name: 'default value import of stripe → staticImport',
      filename: '/abs/proj/src/app/some/route.ts',
      code: `import Stripe from 'stripe'; const s = new Stripe('');`,
      errors: [{ messageId: 'staticImport', data: { name: 'stripe', wrapperHint: 'stripe' } }],
    },
    {
      name: 'named value import of resend',
      filename: '/abs/proj/src/lib/email.ts',
      code: `import { Resend } from 'resend'; export const r = new Resend('');`,
      errors: [{ messageId: 'staticImport' }],
    },
    {
      name: 'namespace import of mixpanel-browser',
      filename: '/abs/proj/src/lib/analytics.ts',
      code: `import * as mp from 'mixpanel-browser'; export { mp };`,
      errors: [{ messageId: 'staticImport' }],
    },

    // ── Subpath imports still trigger ───────────────────────────────
    {
      name: 'subpath of stripe (stripe/lib/X) still triggers',
      filename: '/abs/proj/src/x.ts',
      code: `import { foo } from 'stripe/lib/foo'; export { foo };`,
      errors: [{ messageId: 'staticImport', data: { name: 'stripe', wrapperHint: 'stripe' } }],
    },

    // ── Side-effect import has its own messageId ────────────────────
    {
      name: 'bare side-effect import',
      filename: '/abs/proj/src/x.ts',
      code: `import 'stripe';`,
      errors: [{ messageId: 'sideEffectImport', data: { name: 'stripe' } }],
    },

    // ── require() form ──────────────────────────────────────────────
    {
      name: 'require("stripe") fails',
      filename: '/abs/proj/src/legacy/x.ts',
      code: `const Stripe = require('stripe'); export { Stripe };`,
      errors: [{ messageId: 'requireCall', data: { name: 'stripe' } }],
    },

    // ── Empty hot-gate reason ───────────────────────────────────────
    {
      name: 'hot-gate marker with empty reason → reports once',
      filename: '/abs/proj/src/x.ts',
      code: `/* @deployment-mode-hot-gate\n * reason:\n */\nimport Stripe from 'stripe';`,
      errors: [{ messageId: 'hotGateEmptyReason' }],
    },
  ],
});
