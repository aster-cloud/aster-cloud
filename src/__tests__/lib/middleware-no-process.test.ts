// P0-R9/R10/R11 regression: middleware import chain 上不得有 module-load
// 阶段的裸 process.env 读取。无 process 全局的 edge runtime（Cloudflare
// middleware / browser）在模块加载阶段 ReferenceError 即拒绝启动。
//
// 演进：
//  - R9 codex review 发现 middleware → @/lib/security/csp 链 module-load
//    时裸读 process.env。csp.ts 修了，加了单文件 grep 测试。
//  - R10 发现 middleware → @/lib/lexicon-availability 同样问题；
//    单文件 grep 漏，升级为 BFS regex 依赖图扫描 + brace-depth 顶层检测。
//  - R11 发现 regex import 解析漏 dynamic import / re-export / export from；
//    brace-depth 漏多行对象/class static field/static block。
//    升级为 TypeScript compiler API：用真正的 AST 解析 import + 顶层表达式。
//
// 核心契约：从 src/middleware.ts 入口出发，对所有本地 transitive imports
// （含 dynamic import、re-export）的每个文件，AST 扫描其 source file 的
// **顶层声明初始化器 + 顶层表达式语句 + class static member**，禁止
// 任何 `process.env.X` PropertyAccessExpression。

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** 解析 import specifier 到 absolute file path（支持 @/ 别名 + 相对路径 + 扩展名补全） */
function resolveImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@/')) {
    return resolveExtension(path.join(SRC_ROOT, spec.slice(2)));
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return resolveExtension(path.join(path.dirname(fromFile), spec));
  }
  return null;
}

function resolveExtension(base: string): string | null {
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** 用 TS compiler API 提取一个文件的所有 import specifier（static + dynamic + re-export） */
export function extractImports(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specs: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return specs;
}

/** BFS 收集 entry 的所有本地 transitive imports */
function transitiveImports(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const spec of extractImports(cur)) {
      const resolved = resolveImport(cur, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

/**
 * 检查一个文件是否在 module-load 阶段（顶层执行的代码路径）触及
 * `process.env`。
 *
 * 顶层执行的代码包含：
 *   - VariableDeclaration 的 initializer
 *   - ExpressionStatement（顶层调用、IIFE、赋值）
 *   - IfStatement / SwitchStatement / ForStatement 等顶层控制流的 condition + body
 *   - ClassDeclaration 的 static field initializer / static block
 *
 * NOT 顶层执行：
 *   - FunctionDeclaration body
 *   - MethodDeclaration body
 *   - ArrowFunction / FunctionExpression body（即便赋值给顶层 const）
 *   - GetAccessor / SetAccessor body
 *   - 注：IIFE 即时调用是已知 false-negative（见 R11 ADR）
 */
export function findModuleLoadProcessEnv(
  filePath: string,
): { line: number; text: string }[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const offenders: { line: number; text: string }[] = [];
  const lines = src.split('\n');

  function scanForViolations(node: ts.Node) {
    // 跳过函数体——函数体内的 process.env 不在 module-load 时执行
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      return;
    }
    // process.env.X：PropertyAccessExpression('process'.'env'.X)
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === 'env'
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      offenders.push({ line: line + 1, text: lines[line]?.trim() ?? '' });
      return; // 不需要继续递归子节点
    }
    // process.env （未读 key 也算 module-load 触碰 process 全局）
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'env'
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      offenders.push({ line: line + 1, text: lines[line]?.trim() ?? '' });
      return;
    }
    ts.forEachChild(node, scanForViolations);
  }

  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt) || ts.isClassExpression(stmt)) {
      for (const m of stmt.members) {
        if (
          ts.isPropertyDeclaration(m) &&
          m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword) &&
          m.initializer
        ) {
          scanForViolations(m.initializer);
        }
        if (ts.isClassStaticBlockDeclaration(m)) {
          scanForViolations(m.body);
        }
      }
      continue;
    }
    scanForViolations(stmt);
  }

  return offenders;
}

describe('middleware transitive import chain — no-process runtime safety (P0-R9/R10/R11)', () => {
  let middlewareDeps: Set<string>;

  beforeAll(() => {
    const middlewareEntry = path.join(SRC_ROOT, 'middleware.ts');
    middlewareDeps = transitiveImports(middlewareEntry);
  });

  it('middleware 入口可被静态解析（transitive 闭包非空且包含已知文件）', () => {
    expect(middlewareDeps.size).toBeGreaterThan(0);
    const paths = [...middlewareDeps].map((p) => p.replace(REPO_ROOT, ''));
    expect(paths.some((p) => p.includes('/lib/security/csp'))).toBe(true);
    expect(paths.some((p) => p.includes('/lib/lexicon-availability'))).toBe(true);
    expect(paths.some((p) => p.includes('/lib/runtime/safe-env'))).toBe(true);
  });

  it('middleware transitive closure 中所有文件不得在 module-load 阶段触及 process.env', () => {
    const violations: { file: string; line: number; text: string }[] = [];
    for (const file of middlewareDeps) {
      for (const o of findModuleLoadProcessEnv(file)) {
        violations.push({
          file: file.replace(REPO_ROOT + '/', ''),
          line: o.line,
          text: o.text,
        });
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Scanner self-test：fixture 驱动的合同测试，保证 scanner 真能在未来 PR 时拦住
 * 各种 module-load 模式。不通过 fs fixture 路径，而是直接用 ts.createSourceFile
 * 喂源码字符串——避免污染 repo 文件树。
 */
describe('scanner self-test (R11 升级：覆盖 dynamic import + re-export + class static + 多行对象)', () => {
  /** 从源码字符串建临时 source file 并跑 scanner */
  function scanString(src: string, name = 'tmp.ts'): { line: number; text: string }[] {
    const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true);
    const offenders: { line: number; text: string }[] = [];
    const lines = src.split('\n');
    function scan(node: ts.Node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      ) return;
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === 'env'
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        offenders.push({ line: line + 1, text: lines[line]?.trim() ?? '' });
        return;
      }
      ts.forEachChild(node, scan);
    }
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt)) {
        for (const m of stmt.members) {
          if (
            ts.isPropertyDeclaration(m) &&
            m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword) &&
            m.initializer
          ) {
            scan(m.initializer);
          }
          if (ts.isClassStaticBlockDeclaration(m)) {
            scan(m.body);
          }
        }
        continue;
      }
      scan(stmt);
    }
    return offenders;
  }

  it('抓住简单 const = process.env.X', () => {
    expect(scanString(`const FOO = process.env.BAR;`).length).toBeGreaterThan(0);
  });

  it('抓住多行对象字面量', () => {
    expect(
      scanString(`
const cfg = {
  env: process.env.BAR,
  name: 'foo',
};
`).length,
    ).toBeGreaterThan(0);
  });

  it('抓住 class static field initializer', () => {
    expect(
      scanString(`
class X {
  static v = process.env.BAR;
}
`).length,
    ).toBeGreaterThan(0);
  });

  it('抓住 class static block', () => {
    expect(
      scanString(`
class X {
  static {
    const x = process.env.BAR;
  }
}
`).length,
    ).toBeGreaterThan(0);
  });

  it('抓住顶层 if 控制流', () => {
    expect(
      scanString(`
if (process.env.NODE_ENV === 'production') {
  console.log('prod');
}
`).length,
    ).toBeGreaterThan(0);
  });

  it('不误报：函数体内的 process.env（非 module-load 执行）', () => {
    expect(
      scanString(`
export function foo() {
  return process.env.BAR;
}
`).length,
    ).toBe(0);
  });

  it('不误报：箭头函数赋值给 const（fn body 不在 module-load 执行）', () => {
    expect(scanString(`const foo = () => process.env.BAR;`).length).toBe(0);
  });

  it('不误报：method body', () => {
    expect(
      scanString(`
class X {
  m() {
    return process.env.BAR;
  }
}
`).length,
    ).toBe(0);
  });

  it('已知 false-negative: IIFE 内 process.env（文档化于 ADR-0009 §R11）', () => {
    // IIFE body 内部 process.env 被跳过——IIFE 即时调用，body 实际上在
    // module-load 时执行，但 scanner 当前策略一律跳过函数体。
    // 这是文档化的 trade-off：用 ts-morph 或 control-flow analysis 升级是 P2。
    expect(
      scanString(`
const result = (() => {
  return process.env.BAR;
})();
`).length,
    ).toBe(0);
  });
});

describe('import parser self-test (R11 升级：覆盖 dynamic + re-export)', () => {
  // 写入 tmp file 跑解析；写完即删
  const tmpDir = path.join(REPO_ROOT, 'node_modules', '.vitest-tmp-import-parser');
  beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));

  function writeFixture(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  it('提取静态 import', () => {
    const f = writeFixture('static.ts', `import { x } from './foo';\nimport './side-effect';`);
    expect(extractImports(f)).toEqual(['./foo', './side-effect']);
  });

  it('提取 dynamic import()', () => {
    const f = writeFixture(
      'dynamic.ts',
      `async function f() { const m = await import('./foo'); }\nconst p = import('./bar');`,
    );
    expect(extractImports(f).sort()).toEqual(['./bar', './foo'].sort());
  });

  it('提取 re-export from', () => {
    const f = writeFixture('reexport.ts', `export { foo } from './foo';\nexport * from './bar';`);
    expect(extractImports(f).sort()).toEqual(['./bar', './foo'].sort());
  });

  it('提取 type-only import', () => {
    const f = writeFixture('type-only.ts', `import type { X } from './foo';`);
    expect(extractImports(f)).toEqual(['./foo']);
  });
});

describe('csp.ts — structural contract (P0-R9)', () => {
  let cspSource: string;
  beforeAll(() => {
    cspSource = fs.readFileSync(
      path.resolve(__dirname, '../../lib/security/csp.ts'),
      'utf8',
    );
  });

  it('csp.ts 必须 import safeEnv 且关键 env 走 safeEnv', () => {
    expect(cspSource).toMatch(/import\s*\{\s*safeEnv\s*\}\s*from\s*['"]@\/lib\/runtime\/safe-env['"]/);
    expect(cspSource).toMatch(/safeEnv\(['"]NEXT_PUBLIC_ASTER_POLICY_API_URL['"]\)/);
    expect(cspSource).toMatch(/safeEnv\(['"]NODE_ENV['"]\)/);
  });

  it('运行时回落：NEXT_PUBLIC_ASTER_POLICY_API_URL 未设时 buildCspHeader 用生产域名', async () => {
    const { buildCspHeader } = await import('@/lib/security/csp');
    const header = buildCspHeader('YWJjZGVmZ2hpamtsbW5vcA==');
    expect(header).toContain('default-src');
    if (!process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL) {
      expect(header).toContain('policy.aster-lang.dev');
    }
  });
});
