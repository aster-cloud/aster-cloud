/**
 * ESLint rule: no-static-saas-only-import
 *
 * 禁止生产代码 **静态** value-import SaaS-only npm 包（stripe / resend /
 * mixpanel-browser）。这些包只能在 SaaS bundle 出现 —— on-prem bundle 必须
 * 完全不含其代码与 secret env 引用。
 *
 * 允许的形式：
 *   1. `import type X from 'stripe'`             —— TS 编译期擦除，零 runtime 影响
 *   2. `await import('stripe')`                  —— dynamic import，可被
 *                                                     __DEPLOYMENT_MODE__ 死分支消除
 *   3. 默认 wrapper 文件 `src/lib/{stripe,resend,mixpanel}.ts`（allowlist）
 *   4. 显式 hot-gate marker 文件（同 no-direct-macro 的机制）：
 *        /* @deployment-mode-hot-gate
 *         * reason: <为什么这个文件需要直接 dynamic import SaaS SDK>
 *         *\/
 *
 * 禁止的形式：
 *   - `import Stripe from 'stripe'`              —— webpack/turbopack 视为顶层模块
 *                                                     依赖，必然进 bundle
 *   - `import { Resend } from 'resend'`
 *   - `import * as mp from 'mixpanel-browser'`
 *   - `const x = require('stripe')`              —— CJS 同等
 *
 * 检测策略：
 *   - ImportDeclaration：检查 source 字符串 + importKind/specifier kind
 *     `import type` 在 TS parser 里 importKind === 'type'，或所有
 *     ImportSpecifier 的 importKind === 'type'，都视为纯类型导入放行
 *   - CallExpression：`require('stripe')` 顶层值调用 → 报错
 *   - dynamic `import('stripe')` 表达式（ImportExpression）→ 允许（这才是
 *     我们鼓励的形式）
 *
 * Severity: error（默认）。配置 `{ severity: 'warn' }` 可降级。
 *
 * Source: .claude/plan/deployment-mode-flag-v2.md PR-9 follow-up（Turbopack
 *         迁移路径的静态分析守卫）。
 */

'use strict';

const SAAS_ONLY_PACKAGES = new Set([
  'stripe',
  'resend',
  'mixpanel-browser',
]);

// 默认 wrapper 文件 —— 这些是官方的 dynamic-import 入口，本身需要
// `import type` + `await import()` 配合，放行整个文件的静态 import。
// 路径以 `/src/lib/` 为锚定，跨平台规范化。
const ALLOWED_FILE_SUFFIXES = [
  '/src/lib/stripe.ts',
  '/src/lib/resend.ts',
  '/src/lib/mixpanel.ts',
];

const HAS_MARKER_RE = /@deployment-mode-hot-gate/;
const REASON_RE = /reason\s*:\s*([^\n*]*)/;

function isAllowedFile(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, '/');
  return ALLOWED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * 与 no-direct-macro 共用同一种 hot-gate marker 检测；语义上"这个文件需要
 * 直接 SaaS-only import"和"这个文件需要直接 macro"基本一致（都是 DCE 关键
 * 路径），共用 marker 避免开发者记多套例外机制。
 */
function hasHotGateMarker(sourceCode) {
  const allComments = sourceCode.getAllComments
    ? sourceCode.getAllComments()
    : [];
  for (const c of allComments) {
    if (c.type !== 'Block') continue;
    if (c.loc && c.loc.start.line > 50) break;
    if (!HAS_MARKER_RE.test(c.value)) continue;
    const reasonMatch = REASON_RE.exec(c.value);
    if (!reasonMatch) return { ok: false, emptyReason: true };
    const reason = reasonMatch[1].trim();
    if (reason.length === 0) return { ok: false, emptyReason: true };
    return { ok: true };
  }
  return { ok: false };
}

/**
 * `import type X from 'stripe'`  → importKind === 'type'
 * `import { type X } from 'stripe'` → 所有 specifier 都是 importKind === 'type'
 * 两种 type-only 形式都对 runtime bundle 完全无影响，可放行。
 */
function isTypeOnlyImport(node) {
  if (node.importKind === 'type') return true;
  if (!node.specifiers || node.specifiers.length === 0) {
    // `import 'stripe'` 副作用 import —— 永远不该出现
    return false;
  }
  return node.specifiers.every((spec) => spec.importKind === 'type');
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid static value import of SaaS-only npm packages (stripe/resend/mixpanel-browser); use the lib/* wrapper that does `await import()` behind a __DEPLOYMENT_MODE__ guard.',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['error', 'warn'] },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      staticImport:
        "Static value-import of SaaS-only package `{{name}}` is forbidden — it will be eagerly bundled even in on-prem builds. " +
        "Use the wrapper at `@/lib/{{wrapperHint}}` (which `await import()`s behind a __DEPLOYMENT_MODE__ guard), or change this to `import type ... from '{{name}}'` if you only need the type.",
      sideEffectImport:
        "Side-effect import `import '{{name}}'` is forbidden for SaaS-only packages — it bundles the entire SDK with no way to tree-shake. Use the lib/* wrapper.",
      requireCall:
        "`require('{{name}}')` is forbidden — SaaS-only packages must be loaded via `await import()` inside a SaaS-gated branch (see lib/* wrappers).",
      hotGateEmptyReason:
        '`@deployment-mode-hot-gate` marker is missing a non-empty `reason:` justification.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAllowedFile(filename)) return {};

    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const markerCheck = hasHotGateMarker(sourceCode);
    if (markerCheck.emptyReason) {
      // 一致地把空 reason 报为 Program 级别的 error；不再检查具体 import。
      return {
        Program(node) {
          context.report({ node, messageId: 'hotGateEmptyReason' });
        },
      };
    }
    if (markerCheck.ok) return {};

    function packageNameFromSource(sourceValue) {
      if (typeof sourceValue !== 'string') return null;
      // stripe 的所有子路径 (`stripe/lib/*`) 都视同 stripe；其他包同理。
      for (const pkg of SAAS_ONLY_PACKAGES) {
        if (sourceValue === pkg || sourceValue.startsWith(pkg + '/')) return pkg;
      }
      return null;
    }

    /** Pkg → wrapper basename hint for error message */
    function wrapperHint(pkg) {
      if (pkg === 'stripe') return 'stripe';
      if (pkg === 'resend') return 'resend';
      if (pkg === 'mixpanel-browser') return 'mixpanel';
      return pkg;
    }

    return {
      ImportDeclaration(node) {
        const pkg = packageNameFromSource(node.source && node.source.value);
        if (!pkg) return;
        if (isTypeOnlyImport(node)) return; // type-only OK
        // 副作用 import 单独报错信息（更明确指引）
        if (!node.specifiers || node.specifiers.length === 0) {
          context.report({
            node,
            messageId: 'sideEffectImport',
            data: { name: pkg },
          });
          return;
        }
        context.report({
          node,
          messageId: 'staticImport',
          data: { name: pkg, wrapperHint: wrapperHint(pkg) },
        });
      },

      CallExpression(node) {
        // `require('stripe')` 形态
        if (
          !node.callee ||
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'require' ||
          !node.arguments ||
          node.arguments.length !== 1
        ) {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') {
          return;
        }
        const pkg = packageNameFromSource(arg.value);
        if (!pkg) return;
        context.report({
          node,
          messageId: 'requireCall',
          data: { name: pkg },
        });
      },
    };
  },
};
