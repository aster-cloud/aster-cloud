/**
 * ESLint rule: require-license-write-gate
 *
 * 强制 `src/app/api/admin/**\/route.ts` 中所有 POST/PUT/PATCH/DELETE handler
 * 调用 `requireLicenseWriteOk()`。防止未来新增 on-prem-reachable admin mutate
 * endpoint 忘了集成 read-only 软降级。
 *
 * Allowlist（豁免文件）：
 *   1. SaaS-only routes（顶部有 `if (!IS_SAAS) return ...`）—— SaaS 永远不 gate
 *   2. 文件顶部注释含 `@license-write-gate-exempt reason: <...>`—— 显式豁免
 *      （e.g. license-revoke 自身：撤销 endpoint 在 read-only 时仍需可用）
 *
 * 检查策略：
 *   - 文件路径形如 `src/app/api/admin/.../route.ts`
 *   - 找 `export async function POST|PUT|PATCH|DELETE`
 *   - body 中必须出现 `requireLicenseWriteOk(` 调用 OR `IS_SAAS` 守门检查
 *
 * Severity: error（默认）。配置 `{ severity: 'warn' }` 可降级。
 *
 * Source: .claude/plan/license-system-v2.md PR-L4 + 生产化 follow-up。
 */

'use strict';

const ADMIN_MUTATE_PATH_RE = /\/src\/app\/api\/admin\/.+\/route\.ts$/;
const MUTATE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT_MARKER_RE = /@license-write-gate-exempt/;
const REASON_RE = /reason\s*:\s*([^\n*]*)/;

function isExempt(sourceCode) {
  const allComments = sourceCode.getAllComments ? sourceCode.getAllComments() : [];
  for (const c of allComments) {
    if (c.type !== 'Block') continue;
    if (c.loc && c.loc.start.line > 50) break;
    if (!EXEMPT_MARKER_RE.test(c.value)) continue;
    const match = REASON_RE.exec(c.value);
    if (!match) return { ok: false, emptyReason: false };
    const reason = match[1].trim();
    if (reason.length === 0) return { ok: false, emptyReason: true };
    return { ok: true };
  }
  return { ok: false };
}

function isApplicableFile(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, '/');
  return ADMIN_MUTATE_PATH_RE.test(normalized);
}

/**
 * 严格 gate 检查（codex 审查 Major-1：避免易绕过）。
 *
 * 必须满足：
 *   1. handler body 的 **顶层 statements** 中（前 12 个，避免读不必要内容）
 *   2. 找到 `if (!IS_SAAS) return ...`（early return）OR
 *   3. 找到 `const x = await requireLicenseWriteOk(...)` 后跟 `if (x) return x`
 *      （或 await call 后 if 判断）
 *   4. **不递归进 nested function** — 防止 gate 调用藏在不会执行的 callback 里
 *   5. 不接受局部 shadow 同名变量赋值 — 仅识别 CallExpression
 */
function bodyContainsGateCall(body) {
  if (!body || !body.body || !Array.isArray(body.body)) return false;
  const statements = body.body.slice(0, 12); // 只看 handler 顶部
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // pattern 1: if (!IS_SAAS) return ... — 必须 early return（next-i 之前）
    if (isIsSaasEarlyReturn(stmt)) return true;
    // pattern 2: VariableDeclaration `const X = await requireLicenseWriteOk(...)`
    //           followed by `if (X) return X` in next statements
    const gateVar = isAwaitGateAssignment(stmt);
    if (gateVar) {
      // 之后任意 statement 检查 `if (gateVar) return gateVar`
      for (let j = i + 1; j < statements.length; j++) {
        if (isReturnIfTruthy(statements[j], gateVar)) return true;
      }
    }
    // pattern 3: 直接 `await requireLicenseWriteOk()` 然后立刻 if (前一行变量)
    // 上面 pattern 2 已覆盖。
  }
  return false;
}

function isIsSaasEarlyReturn(stmt) {
  if (!stmt || stmt.type !== 'IfStatement') return false;
  const t = stmt.test;
  if (
    !t ||
    t.type !== 'UnaryExpression' ||
    t.operator !== '!' ||
    !t.argument ||
    t.argument.type !== 'Identifier' ||
    t.argument.name !== 'IS_SAAS'
  ) {
    return false;
  }
  // consequent 必须含 ReturnStatement
  const c = stmt.consequent;
  if (!c) return false;
  if (c.type === 'ReturnStatement') return true;
  if (c.type === 'BlockStatement') {
    return c.body.some((s) => s.type === 'ReturnStatement');
  }
  return false;
}

function isAwaitGateAssignment(stmt) {
  if (!stmt || stmt.type !== 'VariableDeclaration') return null;
  if (!stmt.declarations || stmt.declarations.length !== 1) return null;
  const d = stmt.declarations[0];
  if (!d.init) return null;
  // 形如 `const x = await requireLicenseWriteOk(...)`
  if (d.init.type !== 'AwaitExpression') return null;
  const call = d.init.argument;
  if (
    !call ||
    call.type !== 'CallExpression' ||
    !call.callee ||
    call.callee.type !== 'Identifier' ||
    call.callee.name !== 'requireLicenseWriteOk'
  ) {
    return null;
  }
  if (!d.id || d.id.type !== 'Identifier') return null;
  return d.id.name;
}

function isReturnIfTruthy(stmt, varName) {
  if (!stmt || stmt.type !== 'IfStatement') return false;
  if (!stmt.test || stmt.test.type !== 'Identifier' || stmt.test.name !== varName) {
    return false;
  }
  const c = stmt.consequent;
  if (!c) return false;
  if (c.type === 'ReturnStatement') return true;
  if (c.type === 'BlockStatement') {
    return c.body.some((s) => s.type === 'ReturnStatement');
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'admin mutate routes (POST/PUT/PATCH/DELETE) must call requireLicenseWriteOk() or guard with !IS_SAAS',
    },
    messages: {
      missingGate:
        'admin mutate handler `{{method}}` must call `await requireLicenseWriteOk()` (top-level + early return on truthy) or guard with `if (!IS_SAAS) return ...`. Mark file with `@license-write-gate-exempt reason: <why>` to opt out.',
      shadowedGate:
        'admin mutate handler `{{method}}` uses `requireLicenseWriteOk()` but no `from "@/lib/license-write-gate"` import found. Local shadows bypass the gate.',
      exemptEmptyReason:
        '`@license-write-gate-exempt` marker is missing a non-empty `reason:` justification.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!isApplicableFile(filename)) return {};

    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const exempt = isExempt(sourceCode);
    if (exempt.ok) return {};

    // codex 审查 Major-1：要求 requireLicenseWriteOk 必须从官方 path import，
    // 防止本地 shadow 同名变量绕过 gate。
    const text = sourceCode.getText();
    const hasOfficialImport = /from\s+['"]@\/lib\/license-write-gate['"]/.test(text);
    if (exempt.emptyReason) {
      context.report({
        loc: { line: 1, column: 0 },
        messageId: 'exemptEmptyReason',
      });
      return {};
    }

    return {
      ExportNamedDeclaration(node) {
        const decl = node.declaration;
        if (!decl) return;
        if (decl.type !== 'FunctionDeclaration') return;
        if (!decl.id || !MUTATE_METHODS.has(decl.id.name)) return;
        if (!decl.async) return;
        const passed = bodyContainsGateCall(decl.body);
        if (!passed) {
          context.report({
            node: decl,
            messageId: 'missingGate',
            data: { method: decl.id.name },
          });
          return;
        }
        // gate 通过但若用 await pattern，必须有官方 import；
        // !IS_SAAS early return 不需要 license-write-gate import
        const usesAwaitGate = /\brequireLicenseWriteOk\s*\(/.test(text);
        if (usesAwaitGate && !hasOfficialImport) {
          context.report({
            node: decl,
            messageId: 'shadowedGate',
            data: { method: decl.id.name },
          });
        }
      },
    };
  },
};
