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

/** 用 TS compiler API 提取一个文件的所有 import specifier（static + dynamic + re-export + CommonJS require） */
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
    // ES static import: import ... from '...'  /  import '...'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    // ES re-export: export ... from '...'  /  export * from '...'
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    // ES dynamic: import('...')
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push((node.arguments[0] as ts.StringLiteral).text);
    }
    // CommonJS: require('...')  (R12 升级：覆盖 CJS interop)
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
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
/**
 * 共享的"是否触及 process.env"判定 —— scanner 与 self-test fixture 同一逻辑.
 *
 * R12 升级覆盖：
 *   - `process.env.X` (PropertyAccessExpression chain) — 原有
 *   - `process.env`  (未读 key 也算 module-load 触碰 process 全局) — 原有
 *   - `process['env']` / `process['env']['X']` (ElementAccessExpression) — R12 新增
 *   - `process?.env?.X` (optional chain — TS AST 中是 PropertyAccessExpression
 *     带 QuestionDotToken；ts.isPropertyAccessExpression() 仍 true) — 原有 + 验证
 *   - `const { env } = process` (ObjectBindingPattern destructuring) — R12 新增
 *   - `const { env: { X } } = process` (nested destructuring) — R12 新增
 */
function isProcessEnvAccess(node: ts.Node): boolean {
  // process.env.X (链式)
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    ts.isIdentifier(node.expression.name) &&
    node.expression.name.text === 'env'
  ) return true;
  // process.env （单层，无 .X）
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'env'
  ) return true;
  // process['env']  / process['env']['X']  (ElementAccessExpression)
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === 'env'
  ) return true;
  return false;
}

/**
 * 检查 `const { env } = process` / `const { env: alias } = process` 形态
 * 的解构赋值 module-load 时是否访问了 process.env binding.
 *
 * 注意：destructuring 只在初始化器是 `process` identifier 时触发；
 * `const { env } = somethingElse` 不算。
 */
function isProcessEnvDestructuring(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node)) return false;
  if (!node.initializer || !ts.isIdentifier(node.initializer)) return false;
  if (node.initializer.text !== 'process') return false;
  if (!node.name || !ts.isObjectBindingPattern(node.name)) return false;
  // 至少一个 binding element 名为 env
  for (const el of node.name.elements) {
    const propName = el.propertyName ?? el.name;
    if (ts.isIdentifier(propName) && propName.text === 'env') return true;
  }
  return false;
}

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

  function record(node: ts.Node) {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    offenders.push({ line: line + 1, text: lines[line]?.trim() ?? '' });
  }

  function scanForViolations(node: ts.Node) {
    // R12: class expression `const C = class { ... }` 出现在表达式位置时
    // 也要走 scanClassForViolations()，否则 heritage/decorator/computed key
    // 会被下面的 method body skip 漏掉
    if (ts.isClassExpression(node)) {
      scanClassForViolations(node);
      return;
    }
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
    if (isProcessEnvAccess(node)) {
      record(node);
      return;
    }
    if (isProcessEnvDestructuring(node)) {
      record(node);
      return;
    }
    ts.forEachChild(node, scanForViolations);
  }

  /**
   * Class 顶层 module-load 触发点（R12 codex 抓的盲点）：
   *   - heritage clause: `class X extends f(process.env.X) {}` — extends 表达式在 class 定义时求值
   *   - decorator: `@dec(process.env.X)` 装饰器表达式在 class/member 定义时求值
   *   - computed property key: `class X { [process.env.Y]() {} }` 在 class 定义时求值
   *   - static field initializer (已覆盖)
   *   - static block (已覆盖)
   *
   * 不算 module-load 的：method body / accessor body / constructor body
   * （由 scanForViolations 自动跳过）
   */
  function scanClassForViolations(cls: ts.ClassDeclaration | ts.ClassExpression) {
    // heritage clauses (extends + implements 表达式)
    if (cls.heritageClauses) {
      for (const hc of cls.heritageClauses) {
        for (const t of hc.types) {
          scanForViolations(t);
        }
      }
    }
    // class-level decorators (TS 把 decorator 放在 modifiers 里，需筛 Decorator kind)
    if (ts.canHaveDecorators(cls)) {
      const decs = ts.getDecorators(cls);
      if (decs) for (const d of decs) scanForViolations(d.expression);
    }
    for (const m of cls.members) {
      // member decorators
      if (ts.canHaveDecorators(m)) {
        const decs = ts.getDecorators(m);
        if (decs) for (const d of decs) scanForViolations(d.expression);
      }
      // computed property key (`[expr]` 形式)
      if ('name' in m && m.name && ts.isComputedPropertyName(m.name)) {
        scanForViolations(m.name.expression);
      }
      // static field initializer
      if (
        ts.isPropertyDeclaration(m) &&
        m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword) &&
        m.initializer
      ) {
        scanForViolations(m.initializer);
      }
      // static block
      if (ts.isClassStaticBlockDeclaration(m)) {
        scanForViolations(m.body);
      }
    }
  }

  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt)) {
      // class 顶层 statement decorators 也算 module-load
      if (ts.canHaveDecorators(stmt)) {
        const decs = ts.getDecorators(stmt);
        if (decs) for (const d of decs) scanForViolations(d.expression);
      }
      scanClassForViolations(stmt);
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
 * 各种 module-load 模式。写到 tmp 文件路径以复用 findModuleLoadProcessEnv()
 * 的真实实现（避免主代码 / 测试代码再次漂移）。
 */
describe('scanner self-test (R12 升级：class heritage / decorator / computed key / element access / destructuring)', () => {
  const tmpDir = path.join(REPO_ROOT, 'node_modules', '.vitest-tmp-scanner');
  beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));

  let fixtureCounter = 0;
  function scanString(src: string): { line: number; text: string }[] {
    const p = path.join(tmpDir, `fx-${++fixtureCounter}.ts`);
    fs.writeFileSync(p, src);
    return findModuleLoadProcessEnv(p);
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

  // R12 升级：class heritage / decorator / computed key

  it('R12: 抓住 class heritage clause `class X extends f(process.env.X) {}`', () => {
    expect(
      scanString(`
declare function f(s: string | undefined): { new (): {} };
class X extends f(process.env.BAR) {}
`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 class decorator `@dec(process.env.X) class X {}`', () => {
    expect(
      scanString(`
declare function dec(s: string | undefined): ClassDecorator;
@dec(process.env.BAR)
class X {}
`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 member decorator `@dec(process.env.X) method() {}`', () => {
    expect(
      scanString(`
declare function dec(s: string | undefined): MethodDecorator;
class X {
  @dec(process.env.BAR)
  m() {}
}
`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 computed property key `class X { [process.env.Y]() {} }`', () => {
    expect(
      scanString(`
class X {
  [process.env.BAR ?? 'fallback']() {}
}
`).length,
    ).toBeGreaterThan(0);
  });

  // R12 升级：非点号形态的 process.env 触碰

  it("R12: 抓住 element access `process['env'].X`", () => {
    expect(
      scanString(`const FOO = process['env'].BAR;`).length,
    ).toBeGreaterThan(0);
  });

  it("R12: 抓住 element access nested `process['env']['X']`", () => {
    expect(
      scanString(`const FOO = process['env']['BAR'];`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 optional chain `process?.env?.X`', () => {
    expect(
      scanString(`const FOO = process?.env?.BAR;`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 destructuring `const { env } = process`', () => {
    expect(
      scanString(`const { env } = process;`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 抓住 destructuring alias `const { env: e } = process`', () => {
    expect(
      scanString(`const { env: e } = process;`).length,
    ).toBeGreaterThan(0);
  });

  it('R12: 不误报：destructuring with different init `const { env } = somethingElse`', () => {
    expect(
      scanString(`
const somethingElse = { env: {} };
const { env } = somethingElse;
`).length,
    ).toBe(0);
  });

  // R13 微调：class expression 平行覆盖（codex Round 13 Medium 反馈）

  it('R13: 抓住 class expression heritage `const C = class extends f(process.env.X) {}`', () => {
    expect(
      scanString(`
declare function f(s: string | undefined): { new (): {} };
const C = class extends f(process.env.BAR) {};
`).length,
    ).toBeGreaterThan(0);
  });

  it('R13: 抓住 class expression computed key `const C = class { [process.env.Y]() {} }`', () => {
    expect(
      scanString(`
const C = class {
  [process.env.BAR ?? 'fallback']() {}
};
`).length,
    ).toBeGreaterThan(0);
  });

  it('R13: 抓住 class expression static field `const C = class { static v = process.env.X }`', () => {
    expect(
      scanString(`
const C = class {
  static v = process.env.BAR;
};
`).length,
    ).toBeGreaterThan(0);
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

  it('R12: 提取 CommonJS require()', () => {
    const f = writeFixture('cjs.ts', `const x = require('./foo');\nconst y = require('./bar');`);
    expect(extractImports(f).sort()).toEqual(['./bar', './foo'].sort());
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
