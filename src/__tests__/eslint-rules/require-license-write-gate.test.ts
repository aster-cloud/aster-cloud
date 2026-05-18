/**
 * RuleTester for require-license-write-gate。
 *
 * 覆盖矩阵：
 *   VALID:
 *     - 非 admin route 文件路径 → 跳过
 *     - GET handler → 不要求 gate
 *     - POST + requireLicenseWriteOk 调用 → OK
 *     - POST + if (!IS_SAAS) return ... → OK（SaaS-only endpoint 自动豁免）
 *     - 顶部含 @license-write-gate-exempt reason: <非空> → 跳过
 *   INVALID:
 *     - POST 无 gate 也无 IS_SAAS guard → missingGate
 *     - PUT/PATCH/DELETE 同上 → missingGate
 *     - @license-write-gate-exempt 但 reason 为空 → exemptEmptyReason
 */

import { RuleTester, type Rule } from 'eslint';
import tsParser from '@typescript-eslint/parser';
// JS plugin without types — 强制 cast 到 ESLint Rule 形状
import ruleRaw from '../../../eslint-rules/require-license-write-gate.js';

const rule = ruleRaw as unknown as Rule.RuleModule;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

ruleTester.run('require-license-write-gate', rule, {
  valid: [
    {
      name: '非 admin route 文件路径完全跳过',
      filename: '/abs/proj/src/app/api/policies/route.ts',
      code: `
        export async function POST(req: Request) {
          return Response.json({ ok: true });
        }
      `,
    },
    {
      name: 'GET handler 不要求 gate',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        export async function GET() {
          return Response.json({ ok: true });
        }
      `,
    },
    {
      name: 'POST + requireLicenseWriteOk',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        import { requireLicenseWriteOk } from '@/lib/license-write-gate';
        export async function POST(req: Request) {
          const gate = await requireLicenseWriteOk();
          if (gate) return gate;
          return Response.json({ ok: true });
        }
      `,
    },
    {
      name: 'POST + if (!IS_SAAS) return 404 守门',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        import { IS_SAAS } from '@/lib/deployment-mode';
        export async function POST(req: Request) {
          if (!IS_SAAS) return new Response(null, { status: 404 });
          return Response.json({ ok: true });
        }
      `,
    },
    {
      name: '顶部 @license-write-gate-exempt + 非空 reason',
      filename: '/abs/proj/src/app/api/admin/bar/route.ts',
      code: `
        /* @license-write-gate-exempt
         * reason: bootstrap endpoint must work even in read-only mode
         */
        export async function POST(req: Request) {
          return Response.json({ ok: true });
        }
      `,
    },
  ],
  invalid: [
    {
      name: 'POST 无 gate 无 IS_SAAS guard → missingGate',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        export async function POST(req: Request) {
          return Response.json({ ok: true });
        }
      `,
      errors: [{ messageId: 'missingGate', data: { method: 'POST' } }],
    },
    {
      name: 'DELETE 无 gate → missingGate',
      filename: '/abs/proj/src/app/api/admin/foo/[id]/route.ts',
      code: `
        export async function DELETE(req: Request) {
          return Response.json({ ok: true });
        }
      `,
      errors: [{ messageId: 'missingGate', data: { method: 'DELETE' } }],
    },
    {
      name: 'PUT 无 gate → missingGate',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        export async function PUT(req: Request) {
          return Response.json({ ok: true });
        }
      `,
      errors: [{ messageId: 'missingGate', data: { method: 'PUT' } }],
    },
    {
      name: 'PATCH 无 gate → missingGate',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        export async function PATCH(req: Request) {
          return Response.json({ ok: true });
        }
      `,
      errors: [{ messageId: 'missingGate', data: { method: 'PATCH' } }],
    },
    {
      name: '@license-write-gate-exempt 但 reason 为空 → exemptEmptyReason',
      filename: '/abs/proj/src/app/api/admin/foo/route.ts',
      code: `
        /* @license-write-gate-exempt
         * reason:
         */
        export async function POST(req: Request) {
          return Response.json({ ok: true });
        }
      `,
      errors: [{ messageId: 'exemptEmptyReason' }],
    },
  ],
});
