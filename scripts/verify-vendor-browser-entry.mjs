#!/usr/bin/env node
/**
 * P0-R16: consumer-side artifact-level browser entry verification.
 *
 * Mirrors `aster-lang-ts/scripts/verify-browser-entry.mjs` but runs from the
 * **consumer perspective** (aster-cloud), scanning the installed vendor
 * tarball's `package/dist/src/browser.js` transitive closure.
 *
 * Why this is independent of aster-lang-ts CI:
 *   - aster-lang-ts CI scans **its own** dist/ before pack — guarantees the
 *     freshly-built dist is clean.
 *   - aster-cloud install resolves `file:vendor/aster-cloud-aster-lang-ts-*.tgz`.
 *     If someone replaces the tarball with an older/different one, lang-ts CI
 *     can't see it. Consumer-side scan catches **what aster-cloud actually
 *     installed**, closing the supply chain loop.
 *
 * R15 codex round 15 Low: "aster-cloud tarball SLA 只查 typecheck-pii.js 的
 * alias import; 更强做法是在 cloud CI 解包 vendor tarball 后复用
 * verify-browser-entry 思路扫 package/dist/src/browser.js". This script
 * is that closure.
 *
 * 用法:
 *   pnpm install        # 先解压 vendor tarball 到 node_modules
 *   node scripts/verify-vendor-browser-entry.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VENDOR_PKG = path.join(
  REPO_ROOT,
  'node_modules',
  '@aster-cloud',
  'aster-lang-ts',
);
const ENTRY = path.join(VENDOR_PKG, 'dist', 'src', 'browser.js');

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'test', 'timers', 'timers/promises', 'tls',
  'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

function isNodeBuiltinSpec(spec) {
  if (spec.startsWith('node:')) return { violation: true, reason: 'node: scheme' };
  if (NODE_BUILTINS.has(spec)) return { violation: true, reason: 'bare Node builtin' };
  return { violation: false };
}

if (!fs.existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} not found.`);
  console.error('Run "pnpm install" first to resolve vendor tarball.');
  process.exit(1);
}

/**
 * 解析 import 路径到 absolute file path. 与 lang-ts 版本相同——只解析相对
 * 路径; 第三方包 / Node builtin 留给 isNodeBuiltinSpec 判定.
 */
function resolveLocal(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const baseAbs = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    baseAbs,
    baseAbs + '.js',
    path.join(baseAbs, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * AST-based import extraction (same logic as aster-lang-ts verifier).
 */
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
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.add(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) specs.add(arg0.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
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
        violations.push({
          file: cur.replace(VENDOR_PKG + '/', ''),
          spec,
          reason: check.reason,
        });
        continue;
      }
      const resolved = resolveLocal(cur, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { visited, violations };
}

console.log(`Scanning vendor browser entry transitive closure:`);
console.log(`  package: ${VENDOR_PKG.replace(REPO_ROOT + '/', '')}`);
console.log(`  entry: dist/src/browser.js`);
console.log(`  parser: TypeScript compiler API (AST)`);
console.log(`  deny: node:* scheme + bare Node builtin (${NODE_BUILTINS.size} modules)`);
const { visited, violations } = transitiveClosure(ENTRY);
console.log(`  files in closure: ${visited.size}`);

if (violations.length > 0) {
  console.error('');
  console.error(`ERROR: ${violations.length} Node builtin import(s) found in vendor browser entry:`);
  for (const v of violations) {
    console.error(`  ${v.file} imports '${v.spec}' (${v.reason})`);
  }
  console.error('');
  console.error('aster-cloud webpack edge build will throw UnhandledSchemeError.');
  console.error('Check that the vendor tarball was built from a clean aster-lang-ts state');
  console.error('(aster-lang-ts CI runs scripts/verify-browser-entry.mjs as a gate).');
  process.exit(1);
}

console.log('OK: vendor browser entry closure is free of Node builtin imports');
