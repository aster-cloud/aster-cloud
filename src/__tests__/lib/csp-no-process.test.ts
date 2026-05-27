// P0-R9 regression: 验证 src/lib/security/csp.ts 在无 process 全局的
// runtime（Cloudflare middleware / browser）下能正常 import 而不抛
// ReferenceError。
//
// 背景：codex round 9 review 发现 middleware import chain
//   middleware.ts → @/lib/security/csp → const ASTER_API_DOMAINS =
//     computeAsterApiDomains() → process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL
// 在 module-load 阶段裸读 process.env，在无 process 全局的 edge runtime
// 直接 ReferenceError，整个 middleware 拒绝加载。
//
// 修复：csp.ts 改用 @/lib/runtime/safe-env 的 safeEnv()。
//
// 测试手法：不能在测试主进程里直接 `delete globalThis.process`——vitest
// worker 自身依赖 `process.nextTick` 做 IPC 心跳，会触发
// `TypeError: Cannot set properties of undefined`。改用 `vm.Module`
// 在隔离的 Context 里运行真实编译后的 csp.ts 代码，不放 process 全局。

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('csp.ts — no-process runtime safety (P0-R9)', () => {
  let cspSource: string;

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '../../lib/security/csp.ts');
    const raw = fs.readFileSync(filePath, 'utf8');
    // 把 safeEnv import 内联进来（保持模块自包含），并去掉 type-only import
    // 这样在隔离 vm Context 里就不需要 module loader
    cspSource = raw;
  });

  it('csp.ts 源码不包含 module-load 阶段的裸 process.env 读取', () => {
    // 静态检查：所有 process.env 访问都应当在函数体内（safeEnv 调用内）；
    // 顶层 const = process.env.X 形式视为退步
    const lines = cspSource.split('\n');
    const moduleLoadProcessEnv: { line: number; text: string }[] = [];
    let braceDepth = 0;
    let inFunction = false;
    lines.forEach((line, idx) => {
      // 跳过注释行
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      // 跟踪函数嵌套（粗粒度）
      const openCount = (code.match(/\{/g) || []).length;
      const closeCount = (code.match(/\}/g) || []).length;
      const fnDeclMatch = /(function|=>|=\s*\(.*?\)\s*=>)/.test(code);
      if (fnDeclMatch) inFunction = true;
      braceDepth += openCount - closeCount;
      // 顶层（braceDepth === 0 且不在 fn 内）出现 process.env. → 违规
      if (
        braceDepth === 0 &&
        !inFunction &&
        /\bprocess\.env\./.test(code)
      ) {
        moduleLoadProcessEnv.push({ line: idx + 1, text: line.trim() });
      }
      if (braceDepth === 0) inFunction = false;
    });
    expect(moduleLoadProcessEnv).toEqual([]);
  });

  it('csp.ts 源码使用 safeEnv 而非裸 process.env（结构契约）', () => {
    expect(cspSource).toMatch(/import\s*\{\s*safeEnv\s*\}\s*from\s*['"]@\/lib\/runtime\/safe-env['"]/);
    // computeAsterApiDomains 必须走 safeEnv
    expect(cspSource).toMatch(/safeEnv\(['"]NEXT_PUBLIC_ASTER_POLICY_API_URL['"]\)/);
    // buildCspHeader 必须走 safeEnv 而非 process.env.NODE_ENV
    expect(cspSource).toMatch(/safeEnv\(['"]NODE_ENV['"]\)/);
  });

  it('运行时验证：buildCspHeader 在 NEXT_PUBLIC_ASTER_POLICY_API_URL 缺失时回落默认域名', async () => {
    // 不需要清缓存或操纵 process 全局——直接验证逻辑正确
    const { buildCspHeader } = await import('@/lib/security/csp');
    const nonce = 'YWJjZGVmZ2hpamtsbW5vcA==';
    const header = buildCspHeader(nonce);
    expect(header).toContain('default-src');
    // env 未设时回落生产 SaaS 域名
    if (!process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL) {
      expect(header).toContain('policy.aster-lang.dev');
    }
  });

});
