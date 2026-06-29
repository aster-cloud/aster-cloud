#!/usr/bin/env node
/**
 * 消费侧（aster-cloud）对**实际安装的** @aster-cloud/aster-lang-ts npm 包做契约验证。
 *
 * 信任边界：aster-lang-ts 自己的 CI（pre-pack verify-browser-entry）证明的是「发布源
 * 当时构建产物合格」；本脚本证明的是「aster-cloud 当前装进 node_modules 的包合格」——
 * 不同边界。精确 pin + lockfile 防无意漂移，但挡不住 PR 把依赖改/回退到不含 ADR-0009
 * PII 修复的旧版本——本脚本 fail-closed 挡这一类（ADR-0009 消费侧 artifact 合同）。
 *
 * 历史：曾验 vendor/aster-cloud-aster-lang-ts-*.tgz（npm 发布凭证缺失期的应急 file:vendor
 * 依赖）。npm 1.0.6 起 vendor tarball 退役、依赖改 npm 精确 pin，本脚本随之 retarget 到
 * node_modules 安装的 npm 包，并把原 ci.yml「Vendor tarball SLA enforcement」的 PII 内容
 * 契约合并进来（一个 consumer-side verifier 同时查两件事）。
 *
 * 两类断言：
 *   1) Edge bundle 安全：browser.js 传递闭包（仅本地相对路径）无 node:* / bare Node builtin
 *      （否则 webpack edge target / Next.js browser bundle 炸 UnhandledSchemeError）。
 *   2) ADR-0009 PII 跨运行时契约：browser.js 含 PII 守卫符号 + call-site；typecheck-pii.js
 *      只从纯 leaf ./typecheck/alias.js import（不拉 typecheck.js / typecheck/utils.js
 *      的 node: 依赖进 edge bundle）。防包被降级到无 PII 守卫的旧版本。
 *
 * ⚠ 已知 limitation（codex round 17/18）：闭包不递归进第三方 npm 包。当前 browser entry
 *   零 runtime 第三方依赖故无影响；若未来引入 runtime npm package，aster-lang-ts CI 的
 *   verify-browser-entry 也要同步评估，webpack edge build 是终极兜底。
 *
 * 用法：
 *   pnpm install
 *   node scripts/verify-aster-lang-browser-artifact.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin, builtinModules } from 'node:module';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PKG = path.join(REPO_ROOT, 'node_modules', '@aster-cloud', 'aster-lang-ts');
const ENTRY = path.join(PKG, 'dist', 'src', 'browser.js');
// PII 跨运行时守卫所在（与 browser entry 同一编译产物根）。
const PII_BROWSER = path.join(PKG, 'dist', 'src', 'typecheck', 'browser.js');
const PII_MODULE = path.join(PKG, 'dist', 'src', 'typecheck-pii.js');

/**
 * R17：权威源用 `node:module.isBuiltin()`，不手维护 deny list。
 */
function isNodeBuiltinSpec(spec) {
  if (!isBuiltin(spec)) return { violation: false };
  return {
    violation: true,
    reason: spec.startsWith('node:') ? 'node: scheme' : 'bare Node builtin',
  };
}

if (!fs.existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} not found.`);
  console.error('Run "pnpm install" first to install @aster-cloud/aster-lang-ts.');
  process.exit(1);
}

/** 解析 import 路径到 absolute file path（只解析相对路径；第三方/builtin 留给判定）。 */
function resolveLocal(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const baseAbs = path.resolve(path.dirname(fromFile), spec);
  const candidates = [baseAbs, baseAbs + '.js', path.join(baseAbs, 'index.js')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** AST-based import extraction（同 aster-lang-ts verifier 逻辑）。 */
function extractImports(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
  const specs = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.add(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) specs.add(arg0.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) specs.add(arg0.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...specs];
}

function transitiveClosure(entry) {
  const visited = new Set();
  const queue = [entry];
  const violations = [];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const spec of extractImports(cur)) {
      const check = isNodeBuiltinSpec(spec);
      if (check.violation) {
        violations.push({ file: cur.replace(PKG + '/', ''), spec, reason: check.reason });
        continue;
      }
      const resolved = resolveLocal(cur, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { visited, violations };
}

// ── 断言 1：Edge bundle 安全（browser entry 闭包无 Node builtin） ──────────
console.log('Scanning installed @aster-cloud/aster-lang-ts browser entry closure:');
console.log(`  package: ${PKG.replace(REPO_ROOT + '/', '')}`);
console.log(`  entry: dist/src/browser.js`);
console.log(`  deny: node:* + bare Node builtin (Node ${process.versions.node}, ${builtinModules.length} modules)`);
const { visited, violations } = transitiveClosure(ENTRY);
console.log(`  files in closure: ${visited.size}`);
if (violations.length > 0) {
  console.error(`\nERROR: ${violations.length} Node builtin import(s) in browser entry closure:`);
  for (const v of violations) console.error(`  ${v.file} imports '${v.spec}' (${v.reason})`);
  console.error('\naster-cloud webpack edge build will throw UnhandledSchemeError.');
  console.error('依赖被改/回退到不干净的 aster-lang-ts 版本？检查 package.json pin。');
  process.exit(1);
}
console.log('OK: browser entry closure free of Node builtin imports');

// ── 断言 2：ADR-0009 PII 跨运行时契约（防降级到无守卫旧版本） ──────────────
console.log('\nVerifying ADR-0009 PII cross-runtime contract on installed package:');
const errors = [];

if (!fs.existsSync(PII_BROWSER)) {
  errors.push(`missing ${path.relative(PKG, PII_BROWSER)} (PII typecheck browser entry absent)`);
} else {
  const bjs = fs.readFileSync(PII_BROWSER, 'utf8');
  // (a) 关键守卫符号在场
  for (const sym of ['isProductionRuntime', '__setPiiCheckerForTest', '__isProductionRuntimeForTest']) {
    if (!bjs.includes(sym)) errors.push(`browser.js missing '${sym}' (R6 cross-runtime PII guard regression)`);
  }
  // (b) production guard 真在 __setPiiCheckerForTest 函数体内被调用（call-site，非仅定义）
  const setterIdx = bjs.indexOf('function __setPiiCheckerForTest');
  if (setterIdx >= 0) {
    let depth = 0, i = bjs.indexOf('{', setterIdx), end = -1;
    for (; i < bjs.length; i++) {
      if (bjs[i] === '{') depth++;
      else if (bjs[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = end > setterIdx ? bjs.slice(setterIdx, end + 1) : '';
    if (!body.includes('isProductionRuntime()')) {
      errors.push('__setPiiCheckerForTest body missing isProductionRuntime() call (guard inert)');
    }
  }
  // (c) catch 路径错误码编译进 bundle
  if (!bjs.includes('PII_ANALYZER_FAILED')) errors.push('browser.js missing PII_ANALYZER_FAILED (E404 catch path regression)');
  if (!bjs.includes('"E404"') && !bjs.includes("'E404'")) errors.push('browser.js missing E404 literal (catch path emit regression)');
  // (d) PII 流程真实入口在场（没被注释成 no-op）
  if (!/checkModulePII|defaultCheckModulePII|PiiTypeChecker/.test(bjs)) {
    errors.push('browser.js missing PII checker entry (PII flow analysis disabled)');
  }
}

// (e) R14/R15：typecheck-pii.js 只从纯 leaf alias.js import，不拉 node: 依赖进 edge bundle
if (!fs.existsSync(PII_MODULE)) {
  errors.push(`missing ${path.relative(PKG, PII_MODULE)} (PII module absent)`);
} else {
  const pii = fs.readFileSync(PII_MODULE, 'utf8');
  if (/from\s+['"]\.\/typecheck\.js['"]/.test(pii)) {
    errors.push("typecheck-pii.js imports server-side typecheck.js — pulls node:fs/perf_hooks into edge bundle");
  }
  if (/from\s+['"]\.\/typecheck\/utils\.js['"]/.test(pii)) {
    errors.push("typecheck-pii.js imports typecheck/utils.js (require('node:module')); use typecheck/alias.js (pure leaf)");
  }
  if (!/from\s+['"]\.\/typecheck\/alias\.js['"]/.test(pii)) {
    errors.push("typecheck-pii.js must import resolveAlias from './typecheck/alias.js' (pure leaf, R15)");
  }
}

if (errors.length > 0) {
  console.error(`\nERROR: ${errors.length} ADR-0009 PII contract violation(s) on installed package:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\n安装的 @aster-cloud/aster-lang-ts 可能被降级到无 PII 跨运行时守卫的旧版本。');
  process.exit(1);
}
console.log('OK: ADR-0009 PII cross-runtime contract satisfied (guard symbols + call-site + edge-safe alias)');
