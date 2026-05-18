/**
 * verify-on-prem-bundle.ts
 *
 * 企业级守门：扫 `.open-next/` 的所有可部署 JS/MJS 产物，确保 on-prem
 * build 不含 SaaS-only npm SDK 字节码。
 *
 * 设计依据：.claude/plan/deployment-mode-flag-v2.md PR-7 + spike report
 * §10 / §11（codex M4 关于"扫多个目标"的要求）。
 *
 * **使用前提**：调用方已经跑过 `DEPLOYMENT_MODE=on-prem pnpm build`。
 * 脚本只读 `.open-next/`，不触发构建（便于 CI 复用同一份产物给多个
 * verify 脚本）。
 *
 * 三类规则：
 *   - FORBIDDEN_IMPORTS：明确的 ESM/CJS import/require 语句 — 任何一处
 *     命中即 fail。说明编译器没消除整个模块依赖。
 *   - FORBIDDEN_ENV_LITERALS：SaaS-only secret env 字面量出现 — fail。
 *     说明 ENV_CHECKS 或代码路径还在 SaaS 模式分支下编译。
 *   - FORBIDDEN_SDK_SYMBOLS：SDK 内部类/函数符号（如 StripeAPIError）—
 *     fail。第三方包源码已被打入。
 *   - BENIGN_PATTERNS：允许的良性残留（变量名、注释、schema 列名等）。
 *     如果某行匹配 forbidden 但完全也匹配 benign，跳过。
 *
 * 输出退出码：
 *   0 = 干净
 *   1 = 至少一处泄漏（详情打印 violation 列表 + 文件 + 行号 + 模式）
 *   2 = 用法错误（无 .open-next 目录等）
 *
 * 使用：
 *   DEPLOYMENT_MODE=on-prem pnpm build
 *   pnpm tsx scripts/verify-on-prem-bundle.ts
 *
 * 或一步走（package.json 已封装）：
 *   pnpm verify:on-prem
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const OPEN_NEXT_DIR = join(PROJECT_ROOT, '.open-next');

/** 扫描根（相对 .open-next 根）的子目录。
 *
 * 故意排除：
 *   - `cloudflare-templates/` —— OpenNext 模板，build 拷贝出去做基础，
 *     不是最终部署产物；含 SaaS marker 也无害
 *   - `.build/` —— OpenNext 中间产物，不进 Worker
 *   - `node_modules/` —— 应该不出现，但加防御
 *
 * 同时：
 *   - 根目录的 `worker.js` 单独纳入
 *   - `cloudflare/next-env.mjs` 单独排除：Next 编译的 env 快照，
 *     not imported by Worker runtime（grep verified），扫它会因为
 *     dev `.env*` 里的本地 secrets 产生与 deployment-mode 无关的
 *     pre-existing leak 报告。
 */
const SCAN_DIRS: ReadonlyArray<string> = [
  'cloudflare',
  'middleware',
  'server-functions',
  'dynamodb-provider',
];

/** 根目录单独纳入扫描的文件（不是目录递归）。 */
const SCAN_ROOT_FILES: ReadonlyArray<string> = ['worker.js'];

/** 扫描时跳过这些子路径段（包含即跳过）。 */
const IGNORE_PATH_SEGMENTS: ReadonlyArray<string> = [
  '/cloudflare-templates/',
  '/.build/',
  '/node_modules/',
];

/** 扫描时跳过这些具体文件名（basename）。 */
const IGNORE_FILES: ReadonlyArray<string> = ['next-env.mjs'];

export interface Rule {
  /** 规则展示名 */
  name: string;
  /** 匹配模式（regex） */
  pattern: RegExp;
  /** 给操作员看的原因 */
  rationale: string;
}

/**
 * ESM/CJS/dynamic-import 形式的 SaaS-only npm 包引用。
 * 必须覆盖 3 种形态（spike report §3.2 证明 dynamic import 残留是真实风险）：
 *   - `from "stripe"`      (ESM static import)
 *   - `require("stripe")`  (CJS)
 *   - `import("stripe")`   (ESM dynamic import — 最 critical 的一种)
 */
export const FORBIDDEN_IMPORTS: ReadonlyArray<Rule> = [
  {
    name: 'stripe import',
    pattern:
      /(?:from\s+["']stripe["']|require\(["']stripe["']\)|import\(["']stripe["']\))/,
    rationale:
      'stripe SDK must be excluded from on-prem builds (any of static, ' +
      'CJS, or dynamic import form). Check src/lib/stripe.ts hot-gate ' +
      'and next.config.ts resolve.alias.',
  },
  {
    name: 'resend import',
    pattern:
      /(?:from\s+["']resend["']|require\(["']resend["']\)|import\(["']resend["']\))/,
    rationale:
      'resend SDK must be excluded. Check src/lib/resend.ts hot-gate and resolve.alias.',
  },
  {
    name: 'mixpanel-browser import',
    pattern:
      /(?:from\s+["']mixpanel-browser["']|require\(["']mixpanel-browser["']\)|import\(["']mixpanel-browser["']\))/,
    rationale:
      'mixpanel-browser SDK must be excluded. ' +
      'Check src/lib/mixpanel.ts hot-gate and resolve.alias.',
  },
];

/** Secret env var literals — 出现说明对应代码路径仍在 bundle 里。 */
export const FORBIDDEN_ENV_LITERALS: ReadonlyArray<Rule> = [
  {
    name: 'STRIPE_SECRET_KEY literal',
    pattern: /STRIPE_SECRET_KEY/,
    rationale:
      'STRIPE_SECRET_KEY env access leaked. A code path that reads this ' +
      'env is still compiled in.',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET literal',
    pattern: /STRIPE_WEBHOOK_SECRET/,
    rationale: 'STRIPE_WEBHOOK_SECRET env access leaked.',
  },
  {
    name: 'NEXT_PUBLIC_MIXPANEL_TOKEN literal',
    pattern: /NEXT_PUBLIC_MIXPANEL_TOKEN/,
    rationale: 'NEXT_PUBLIC_MIXPANEL_TOKEN env access leaked.',
  },
  {
    name: 'RESEND_API_KEY literal',
    pattern: /RESEND_API_KEY/,
    rationale: 'RESEND_API_KEY env access leaked.',
  },
];

/** SDK 内部符号 — 真正的 npm 包源码被打进 bundle 的强信号。 */
export const FORBIDDEN_SDK_SYMBOLS: ReadonlyArray<Rule> = [
  {
    name: 'Stripe SDK error classes',
    pattern: /StripeAPIError|StripeResource|StripeAuthenticationError/,
    rationale:
      'Stripe SDK source code leaked into the bundle (~128KB). ' +
      'See PR-1a spike report §3.2.',
  },
  {
    name: 'Resend constructor instantiation',
    pattern: /new\s+Resend\s*\(/,
    rationale: 'Resend SDK class is being instantiated in bundle.',
  },
  {
    name: 'Mixpanel SDK behaviour',
    // 'track_pageview' 是 mixpanel.init 的配置项，only in SDK body
    pattern: /track_pageview\s*:\s*true/,
    rationale: 'Mixpanel SDK init configuration leaked.',
  },
];

/**
 * 允许的良性残留 — 在匹配点 ±N 字符 *邻近窗口* 内出现这些模式则视为良性。
 *
 * 关键设计：minified 单行 bundle 上一个 forbidden literal 出现的上下文
 * 才决定它是否危险。整行匹配 BENIGN 太宽松（一行可能有几千行原文压成），
 * 整行不匹配又太严格（少量字符的局部上下文就能区分元数据 vs 实际调用）。
 *
 * 邻近窗口 ±BENIGN_WINDOW 字符内匹配即放行。
 */
const BENIGN_WINDOW = 80;
const BENIGN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /requiredIn\s*:/,
    reason: 'env-validation ENV_CHECKS metadata entry (key name only, no value)',
  },
  {
    pattern: /description\s*:/,
    reason: 'env-validation ENV_CHECKS description string (key name only)',
  },
  {
    // schema 列名 stripeCustomerId 等是 DB 字段，非 SDK 调用
    pattern: /\bstripeCustomerId|\bsubscriptionStatus|\bsubscriptionId/,
    reason: 'database column name (DB schema, not SDK call)',
  },
];

interface Violation {
  rule: Rule;
  file: string;
  line: number;
  excerpt: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 递归收集匹配 .js / .mjs 的文件，跳过 ignore 段 / 文件名。 */
async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    // 跳过含敏感段的路径
    if (IGNORE_PATH_SEGMENTS.some((seg) => full.includes(seg))) continue;
    if (e.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (IGNORE_FILES.includes(e.name)) continue;
    if (!e.name.endsWith('.js') && !e.name.endsWith('.mjs')) continue;
    out.push(full);
  }
}

async function listTargetFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const f of SCAN_ROOT_FILES) {
    const p = join(OPEN_NEXT_DIR, f);
    try {
      const s = await stat(p);
      if (s.isFile()) files.push(p);
    } catch {
      // 文件可能不存在（OpenNext 版本差异）—— 不致命，继续
    }
  }
  for (const d of SCAN_DIRS) {
    await walk(join(OPEN_NEXT_DIR, d), files);
  }
  return files;
}

/**
 * 检查 match 在 ±BENIGN_WINDOW 字符邻近窗口内是否有任何良性模式。
 */
function isBenignNeighborhood(
  content: string,
  matchStart: number,
  matchEnd: number,
): boolean {
  const winStart = Math.max(0, matchStart - BENIGN_WINDOW);
  const winEnd = Math.min(content.length, matchEnd + BENIGN_WINDOW);
  const window = content.slice(winStart, winEnd);
  return BENIGN_PATTERNS.some(({ pattern }) => pattern.test(window));
}

/**
 * 把全局字符偏移转成 1-based 行号。
 */
function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/** Exported for unit tests; not used at script entry. */
export function scanContent(
  content: string,
  filePath: string,
  rules: ReadonlyArray<Rule>,
): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rules) {
    // 重置 lastIndex，跨多次 exec 找出所有匹配
    const pat = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      if (isBenignNeighborhood(content, m.index, m.index + m[0].length)) continue;
      const lineNum = offsetToLine(content, m.index);
      // 提取匹配点周边 200 字符作为可读 excerpt
      const exStart = Math.max(0, m.index - 60);
      const exEnd = Math.min(content.length, m.index + m[0].length + 140);
      const excerpt = content
        .slice(exStart, exEnd)
        .replace(/\s+/g, ' ')
        .trim();
      violations.push({
        rule,
        file: filePath,
        line: lineNum,
        excerpt,
      });
      // 防止无限循环（零宽匹配）
      if (m.index === pat.lastIndex) pat.lastIndex++;
    }
  }
  return violations;
}

function group<T, K extends string>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = out.get(k) ?? [];
    arr.push(it);
    out.set(k, arr);
  }
  return out;
}

function printReport(violations: Violation[], filesScanned: number): void {
  if (violations.length === 0) {
    console.log(
      `\n✓ on-prem bundle clean (${filesScanned} files scanned, no SaaS-only ` +
        `imports / secrets / SDK symbols detected).`,
    );
    return;
  }

  console.error(
    `\n✗ on-prem bundle contains ${violations.length} SaaS-only leak(s) ` +
      `across ${filesScanned} scanned file(s).\n`,
  );

  // 按规则分组打印，操作员更容易定位哪类问题
  const byRule = group(violations, (v) => v.rule.name);
  for (const [ruleName, vs] of byRule) {
    console.error(`── ${ruleName} (${vs.length} occurrence${vs.length > 1 ? 's' : ''})`);
    console.error(`   ${vs[0].rule.rationale}`);
    // 每个规则最多打印前 5 个示例，避免日志爆炸
    const shown = vs.slice(0, 5);
    for (const v of shown) {
      const rel = relative(PROJECT_ROOT, v.file);
      console.error(`     ${rel}:${v.line}`);
      console.error(`       ${v.excerpt}`);
    }
    if (vs.length > shown.length) {
      console.error(`     … and ${vs.length - shown.length} more`);
    }
    console.error('');
  }
}

async function main(): Promise<void> {
  if (!(await exists(OPEN_NEXT_DIR))) {
    console.error(
      `[verify-on-prem-bundle] .open-next/ not found at ${OPEN_NEXT_DIR}. ` +
        `Run \`DEPLOYMENT_MODE=on-prem pnpm build\` first.`,
    );
    process.exit(2);
  }

  const files = await listTargetFiles();
  if (files.length === 0) {
    console.error(
      `[verify-on-prem-bundle] no JS/MJS files matched scan globs under ` +
        `${OPEN_NEXT_DIR}. Build may be incomplete.`,
    );
    process.exit(2);
  }

  const allRules: ReadonlyArray<Rule> = [
    ...FORBIDDEN_IMPORTS,
    ...FORBIDDEN_ENV_LITERALS,
    ...FORBIDDEN_SDK_SYMBOLS,
  ];

  const violations: Violation[] = [];
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    violations.push(...scanContent(content, f, allRules));
  }

  printReport(violations, files.length);
  process.exit(violations.length === 0 ? 0 : 1);
}

// 仅当作为脚本直接运行时触发 main()，让单元测试可以 import 工具函数
// 而不副作用执行扫描。
// import.meta.url 解析方式：node CLI 把 `tsx scripts/x.ts` 的 url
// 设成与 process.argv[1] 解析后路径一致。
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[verify-on-prem-bundle] unexpected error:', err);
    process.exit(2);
  });
}
