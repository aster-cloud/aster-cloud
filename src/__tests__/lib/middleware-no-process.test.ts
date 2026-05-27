// P0-R9/R10 regression: middleware import chain 上不得有 module-load 阶段
// 的裸 process.env 读取。无 process 全局的 edge runtime（Cloudflare
// middleware / browser）在模块加载时 ReferenceError 即拒绝启动。
//
// 背景：
//  - Round 9 codex review 发现 `middleware.ts → @/lib/security/csp` 链
//    `const ASTER_API_DOMAINS = computeAsterApiDomains()` module-load
//    时裸读 process.env。csp.ts 修了。
//  - Round 10 codex review 发现 `middleware.ts → @/lib/lexicon-availability`
//    同样问题：`const ASTER_API_BASE = process.env.X` module-load 阶段。
//
// 修复策略：把"middleware entrypoint 的整条 transitive import 链上
// 不得 module-load 裸读 process.env"做成静态契约测试，从单文件 grep
// 升级为依赖图扫描。

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** 项目根（test 文件位于 src/__tests__/lib/ → 上溯三级到 repo root） */
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** 把 `@/lib/foo` / `./bar` / `../baz` 解析为文件 absolute path */
function resolveImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@/')) {
    return resolveExtension(path.join(SRC_ROOT, spec.slice(2)));
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return resolveExtension(path.join(path.dirname(fromFile), spec));
  }
  // 外部包（next, drizzle-orm 等）—— 不进入扫描
  return null;
}

/** 尝试 .ts / .tsx / index.ts 后缀解析 */
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

/** 提取一个文件的所有本地 import specifier（仅 @/ 和 相对路径） */
function extractLocalImports(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const specs: string[] = [];
  // ES import：import ... from '...'  /  import '...'  /  import('...')
  const re = /\bimport\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith('@/') || spec.startsWith('./') || spec.startsWith('../')) {
      specs.push(spec);
    }
  }
  return specs;
}

/** 从入口 BFS 遍历本地 transitive imports，返回所有访问过的文件 absolute path 集合 */
function transitiveLocalImports(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const specs = extractLocalImports(cur);
    for (const s of specs) {
      const resolved = resolveImport(cur, s);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return visited;
}

/**
 * 检查给定文件的源码是否含 module-load 阶段（顶层、非函数体内）的裸
 * `process.env.X` 读取。返回违规位置数组。
 *
 * 实现：用 brace-depth tracker 粗粒度判断"是否在函数体内"。考虑到
 * Type-only / comment 等噪音，先做了基本清洗。这不是完美 AST 分析，
 * 但已经足够精准抓住 `const FOO = process.env.X` 这类典型模式。
 */
function findModuleLoadProcessEnv(filePath: string): { line: number; text: string }[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const out: { line: number; text: string }[] = [];

  // 粗略 brace-depth + 函数检测
  let braceDepth = 0;
  let inMultilineComment = false;
  lines.forEach((rawLine, idx) => {
    let line = rawLine;
    // 处理多行注释跨行
    if (inMultilineComment) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inMultilineComment = false;
    }
    // 去除单行尾注释
    line = line.replace(/\/\/.*$/, '');
    // 去除行内 /* ... */
    line = line.replace(/\/\*[^]*?\*\//g, '');
    // 检测未闭合的 /* ...
    const openIdx = line.indexOf('/*');
    if (openIdx >= 0) {
      inMultilineComment = true;
      line = line.slice(0, openIdx);
    }
    // 去除字符串字面量（防止注释字符串里的 process.env 误报）
    line = line.replace(/'([^'\\]|\\.)*'/g, "''")
               .replace(/"([^"\\]|\\.)*"/g, '""')
               .replace(/`([^`\\]|\\.)*`/g, '``');

    const open = (line.match(/\{/g) || []).length;
    const close = (line.match(/\}/g) || []).length;

    // 当前行在进入 { 之前的 depth 决定是否算 module-load 顶层
    const depthAtLineStart = braceDepth;
    braceDepth += open - close;
    if (braceDepth < 0) braceDepth = 0;

    if (depthAtLineStart === 0 && /\bprocess\.env\b/.test(line)) {
      out.push({ line: idx + 1, text: rawLine.trim() });
    }
  });

  return out;
}

describe('middleware transitive import chain — no-process runtime safety (P0-R9/R10)', () => {
  let middlewareDeps: Set<string>;

  beforeAll(() => {
    const middlewareEntry = path.join(SRC_ROOT, 'middleware.ts');
    middlewareDeps = transitiveLocalImports(middlewareEntry);
  });

  it('middleware 入口可被静态解析（transitive 闭包非空）', () => {
    expect(middlewareDeps.size).toBeGreaterThan(0);
    // sanity: 至少包含 csp.ts 和 lexicon-availability.ts
    const paths = [...middlewareDeps].map((p) => p.replace(REPO_ROOT, ''));
    expect(paths.some((p) => p.includes('/lib/security/csp'))).toBe(true);
    expect(paths.some((p) => p.includes('/lib/lexicon-availability'))).toBe(true);
  });

  it('middleware transitive closure 中所有文件不得在 module-load 阶段裸读 process.env', () => {
    const violations: { file: string; line: number; text: string }[] = [];
    for (const file of middlewareDeps) {
      const offenders = findModuleLoadProcessEnv(file);
      for (const o of offenders) {
        violations.push({
          file: file.replace(REPO_ROOT + '/', ''),
          line: o.line,
          text: o.text,
        });
      }
    }
    // 失败时 Vitest 会把 violations 数组打印出来，方便定位
    expect(violations).toEqual([]);
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
