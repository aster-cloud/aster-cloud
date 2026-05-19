/**
 * RuleTester unit tests for eslint-rules/no-direct-macro.
 *
 * 覆盖矩阵：
 *   ALLOWED files:
 *     - src/lib/deployment-mode.ts
 *     - src/hooks/use-deployment-mode.ts
 *     - src/types/deployment-mode.d.ts
 *     - next.config.ts
 *   HOT-GATE (marker comment with reason):
 *     - any file path with valid /* @deployment-mode-hot-gate * marker
 *     - empty `reason:` → reports hotGateEmptyReason
 *     - no marker → reports directMacro
 *   process.env access:
 *     - DEPLOYMENT_MODE / NEXT_PUBLIC_DEPLOYMENT_MODE → reports processEnvAccess
 *     - other env keys (DATABASE_URL etc.) → ignored
 */

import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
// JS plugin — TS resolves it via allowJs (tsconfig.json) and infers
// shape from module.exports. No @ts-expect-error needed.
import rule from '../../../eslint-rules/no-direct-macro.js';

// Use the TypeScript parser so test fixtures can use `declare const` /
// type annotations like the real codebase does.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

// RuleTester registers its own describe/it via the test runner globals
// (vitest provides them). It MUST be called at module top-level — wrapping
// in describe() triggers "Calling the suite function inside test function
// is not allowed" because ruleTester.run itself calls describe internally.
ruleTester.run('no-direct-macro', rule, {
  valid: [
        // ── ALLOWED files: helper itself ─────────────────────────────
        {
          name: 'helper module (deployment-mode.ts)',
          filename: '/abs/proj/src/lib/deployment-mode.ts',
          code: `
            declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';
            export const IS_SAAS = __DEPLOYMENT_MODE__ === 'saas';
            const v = process.env.DEPLOYMENT_MODE;
          `,
        },
        {
          name: 'client hook (use-deployment-mode.ts)',
          filename: '/abs/proj/src/hooks/use-deployment-mode.ts',
          code: `
            const m = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE;
            export function useDeploymentMode() { return m; }
          `,
        },
        {
          name: 'ambient typedef (deployment-mode.d.ts)',
          filename: '/abs/proj/src/types/deployment-mode.d.ts',
          code: `declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';`,
        },
        {
          name: 'next config (must read env to inject macro)',
          filename: '/abs/proj/next.config.ts',
          code: `
            const m = process.env.DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';
            export default { env: { NEXT_PUBLIC_DEPLOYMENT_MODE: m } };
          `,
        },

        // ── HOT-GATE marker with non-empty reason ────────────────────
        {
          name: 'hot-gate file with valid marker — allows direct macro',
          filename: '/abs/proj/src/lib/stripe.ts',
          code: `
            /* @deployment-mode-hot-gate
             * reason: dynamic import of Stripe SDK needs direct macro for DCE
             */
            if (__DEPLOYMENT_MODE__ !== 'saas') {
              throw new Error('not saas');
            }
          `,
        },
        {
          name: 'hot-gate marker on single line still ok',
          filename: '/abs/proj/src/route.ts',
          code: `
            /* @deployment-mode-hot-gate reason: handler needs direct macro */
            export function GET() {
              if (__DEPLOYMENT_MODE__ !== 'saas') return null;
            }
          `,
        },

        // ── Unrelated files (no macro / env access) ──────────────────
        {
          name: 'normal file with no macro use',
          filename: '/abs/proj/src/lib/somelib.ts',
          code: `
            import { IS_SAAS } from '@/lib/deployment-mode';
            export const x = IS_SAAS ? 1 : 2;
          `,
        },
        {
          name: 'process.env access to non-restricted keys is fine',
          filename: '/abs/proj/src/lib/somelib.ts',
          code: `
            const db = process.env.DATABASE_URL;
            const port = process.env.PORT;
          `,
        },
      ],

      invalid: [
        // ── Direct __DEPLOYMENT_MODE__ in non-helper, non-hot-gate ──
        {
          name: 'random file using __DEPLOYMENT_MODE__ → directMacro',
          filename: '/abs/proj/src/components/foo.tsx',
          code: `
            const x = __DEPLOYMENT_MODE__ === 'saas' ? 1 : 2;
          `,
          errors: [{ messageId: 'directMacro' }],
        },
        {
          name: 'multiple macro refs → multiple reports',
          filename: '/abs/proj/src/lib/other.ts',
          code: `
            if (__DEPLOYMENT_MODE__ === 'saas') {}
            const m = __DEPLOYMENT_MODE__;
          `,
          errors: [
            { messageId: 'directMacro' },
            { messageId: 'directMacro' },
          ],
        },

        // ── Hot-gate marker missing `reason:` ───────────────────────
        {
          name: 'hot-gate marker without `reason:` clause → hotGateEmptyReason',
          filename: '/abs/proj/src/lib/foo.ts',
          code: `
            /* @deployment-mode-hot-gate */
            export function f() {
              if (__DEPLOYMENT_MODE__ !== 'saas') return;
            }
          `,
          // Marker present but no `reason:` clause = same audit failure as
          // empty reason. Two-phase detection (codex M3) ensures this case
          // surfaces with a specific, actionable message.
          errors: [{ messageId: 'hotGateEmptyReason' }],
        },
        {
          name: 'hot-gate marker with empty `reason:` → hotGateEmptyReason',
          filename: '/abs/proj/src/lib/bar.ts',
          code: `
            /* @deployment-mode-hot-gate
             * reason:
             */
            export function f() {
              if (__DEPLOYMENT_MODE__ !== 'saas') return;
            }
          `,
          errors: [{ messageId: 'hotGateEmptyReason' }],
        },
        {
          name: 'hot-gate marker with whitespace-only `reason:` → hotGateEmptyReason',
          filename: '/abs/proj/src/lib/baz.ts',
          code: `
            /* @deployment-mode-hot-gate
             * reason:    \t
             */
            export function f() {
              if (__DEPLOYMENT_MODE__ !== 'saas') return;
            }
          `,
          errors: [{ messageId: 'hotGateEmptyReason' }],
        },

        // ── process.env.DEPLOYMENT_MODE access ──────────────────────
        {
          name: 'process.env.DEPLOYMENT_MODE → processEnvAccess',
          filename: '/abs/proj/src/lib/other.ts',
          code: `
            const m = process.env.DEPLOYMENT_MODE;
          `,
          errors: [
            { messageId: 'processEnvAccess', data: { key: 'DEPLOYMENT_MODE' } },
          ],
        },
        {
          name: 'process.env.NEXT_PUBLIC_DEPLOYMENT_MODE → processEnvAccess',
          filename: '/abs/proj/src/components/foo.tsx',
          code: `
            const m = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE;
          `,
          errors: [
            {
              messageId: 'processEnvAccess',
              data: { key: 'NEXT_PUBLIC_DEPLOYMENT_MODE' },
            },
          ],
        },

        // ── Hot-gate files allow direct macro but STILL forbid process.env
        // 这是企业级安全：hot-gate 文件需要 ambient macro 是合理的，但
        // 它们用 process.env 就毫无理由 —— 还是有 helper 可用。
        {
          name: 'hot-gate file using process.env.DEPLOYMENT_MODE → still reports',
          filename: '/abs/proj/src/lib/quux.ts',
          code: `
            /* @deployment-mode-hot-gate reason: dynamic import test */
            const m = process.env.DEPLOYMENT_MODE;
            export function f() {
              if (__DEPLOYMENT_MODE__ !== 'saas') return;
            }
            // reference m to avoid unused-var noise (not part of the rule we test)
            export const x = m;
          `,
          errors: [
            { messageId: 'processEnvAccess', data: { key: 'DEPLOYMENT_MODE' } },
          ],
        },

        // ── codex M2: computed + destructured forms ─────────────────
        {
          name: 'computed access process.env["DEPLOYMENT_MODE"] → processEnvAccess',
          filename: '/abs/proj/src/lib/x.ts',
          code: `
            const m = process.env["DEPLOYMENT_MODE"];
          `,
          errors: [
            { messageId: 'processEnvAccess', data: { key: 'DEPLOYMENT_MODE' } },
          ],
        },
        {
          name: 'computed access process.env["NEXT_PUBLIC_DEPLOYMENT_MODE"] → processEnvAccess',
          filename: '/abs/proj/src/lib/x.ts',
          code: `
            const m = process.env['NEXT_PUBLIC_DEPLOYMENT_MODE'];
          `,
          errors: [
            {
              messageId: 'processEnvAccess',
              data: { key: 'NEXT_PUBLIC_DEPLOYMENT_MODE' },
            },
          ],
        },
        {
          name: 'destructured: const { DEPLOYMENT_MODE } = process.env',
          filename: '/abs/proj/src/lib/x.ts',
          code: `
            const { DEPLOYMENT_MODE } = process.env;
          `,
          errors: [
            { messageId: 'processEnvAccess', data: { key: 'DEPLOYMENT_MODE' } },
          ],
        },
        {
          name: 'destructured w/ rename: const { NEXT_PUBLIC_DEPLOYMENT_MODE: alias } = process.env',
          filename: '/abs/proj/src/lib/x.ts',
          code: `
            const { NEXT_PUBLIC_DEPLOYMENT_MODE: alias } = process.env;
          `,
          errors: [
            {
              messageId: 'processEnvAccess',
              data: { key: 'NEXT_PUBLIC_DEPLOYMENT_MODE' },
            },
          ],
        },
        {
          name: 'destructured multiple keys: 只报受限的那个',
          filename: '/abs/proj/src/lib/x.ts',
          code: `
            const { DATABASE_URL, DEPLOYMENT_MODE, PORT } = process.env;
          `,
          errors: [
            { messageId: 'processEnvAccess', data: { key: 'DEPLOYMENT_MODE' } },
          ],
        },
      ],
});
