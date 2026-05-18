/**
 * verify-on-prem-ui.ts
 *
 * 企业级守门：扫 on-prem build 产物，确保不出现指向 SaaS-only 路由的
 * 客户端 URL（href="/billing"、href="/pricing"、href="/signup"、
 * router.push('/billing') 等）。
 *
 * 设计依据：codex PR-5 audit suggestion #1 —— PR-5 已经把所有已知 UI
 * 出口加了 CLIENT_CAPABILITIES gate，但人工漏改的风险一直存在。本脚本
 * 是 grep-based regression guard：如果未来有人加了一个新 SaaS-only
 * link 又没 gate，CI 直接 fail。
 *
 * 与 verify-on-prem-bundle.ts 互补：
 *   - bundle 脚本扫 *server-side* SDK / secret leak
 *   - 本脚本扫 *client-side* dead route links（编译进 client chunks）
 *
 * **使用前提**：DEPLOYMENT_MODE=on-prem pnpm build 已跑过。
 *
 * 退出码：
 *   0 = 干净
 *   1 = 发现 forbidden link 残留
 *   2 = 用法错误
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const OPEN_NEXT_DIR = join(PROJECT_ROOT, '.open-next');

/** 仅扫 client-side bundle 目录 —— server chunks 已由 verify-on-prem-bundle 处理。
 *
 * Next.js 把客户端 JS 输出到 .open-next/server-functions/default/.next/static/
 * (静态资源) 和 .open-next/assets/。bundle 扫描会包含 server 路径的
 * client-reference manifests，这里要更聚焦：扫 .next/static/chunks 与
 * .next/server/app（后者含 server-rendered HTML 的 stringified JSX
 * 串，含 hrefs）。 */
const SCAN_DIRS: ReadonlyArray<string> = [
  'server-functions/default/.next/static',
  'server-functions/default/.next/server/app',
  // assets/_next 是另一个静态资源位置（视 OpenNext 版本而定）
  'assets',
];

const IGNORE_PATH_SEGMENTS: ReadonlyArray<string> = [
  '/cloudflare-templates/',
  '/.build/',
  '/node_modules/',
  // 这些路由本身在 on-prem 已经返回 404（PR-4 batch C），用户永远
  // 加载不到对应的 client chunks。其内部 link 到 SaaS-only 路由是
  // 期望行为（pricing page 自己链接 /signup 是正常的）。CI gate
  // 不该把死代码 chunks 当问题。
  '/app/[locale]/pricing/',
  '/app/[locale]/(dashboard)/billing/',
  '/app/[locale]/(auth)/signup/',
];

export interface UrlRule {
  /** 显示用规则名 */
  name: string;
  /** 匹配模式 */
  pattern: RegExp;
  /** 解释为何不应出现在 on-prem bundle */
  rationale: string;
}

/**
 * 严格禁用模式 —— 这些是 SaaS-only 路由的直接 URL 字面量。
 *
 * 注意 regex 设计：用 quote-delimited matching（"X" 或 'X'）避免误命中
 * 注释/document/路径前缀。例如 `/billing/cancel` 和 `/api/billing` 都
 * 不该 trigger，只匹配恰好以 `/billing` 结尾的 URL（quote 之前）。
 */
export const FORBIDDEN_URLS: ReadonlyArray<UrlRule> = [
  {
    name: 'href to /billing',
    // 匹配 href="/billing", href="/billing/...", href="/billing?..." etc
    // 但不匹配 href="/api/billing/..."（不同语义）
    pattern: /["'](?:\/[a-z]{2})?\/billing(?:[\/?"#'])/,
    rationale:
      'On-prem build must not link to /billing (route returns 404). ' +
      'Wrap the Link/anchor with CLIENT_CAPABILITIES.billing.',
  },
  {
    name: 'href to /pricing',
    pattern: /["'](?:\/[a-z]{2})?\/pricing(?:[\/?"#'])/,
    rationale:
      'On-prem build must not link to /pricing. ' +
      'Use CLIENT_CAPABILITIES.pricing gate or MarketingPrimaryCta helper.',
  },
  {
    name: 'href to /signup',
    pattern: /["'](?:\/[a-z]{2})?\/signup(?:[\/?"#'])/,
    rationale:
      'On-prem build must not link to /signup (admin-invite only). ' +
      'Wrap with CLIENT_CAPABILITIES.signup or use MarketingPrimaryCta.',
  },
  {
    // codex Minor: extend router rules to /pricing /signup, locale-prefixed,
    // and destructured `push(...)` (e.g. `const {push}=router; push("/billing")`).
    name: 'router navigation to SaaS-only route',
    pattern:
      /(?:router|navigate|history)\.(?:push|replace)\(["'](?:\/[a-z]{2})?\/(?:billing|pricing|signup)(?:[\/?"#'])/,
    rationale:
      'On-prem must not programmatically navigate to /billing, /pricing, /signup. ' +
      'Gate behind CLIENT_CAPABILITIES.X or set inline error.',
  },
];

/**
 * 良性放行 —— 编译后的客户端 chunks 中，运行时 gate 表达式 + href 字面量
 * 共存是 *预期行为*（PR-5 的 CLIENT_CAPABILITIES.X && <Link href="/X" />
 * 模式）。terser 不会消除 client-side dead JSX，但 runtime 永不渲染
 * （CLIENT_CAPABILITIES.X 是 build-time 字面量 false，整个分支不执行）。
 *
 * 接受以下两类 minified 表达式：
 *   - `<ident>.T.<cap>&&(...,href:"/X"`  —— `&&` 守护链接
 *   - `<ident>.T.<cap>?(...,href:"/X"`   —— 三元运算
 *
 * `T` 是 minified `CLIENT_CAPABILITIES`（统一字段名）。`<cap>` 是
 * `billing`/`pricing`/`signup` 等键名（未被 minify，因为它们是对象字面量键）。
 *
 * 匹配窗口设 320 字符 —— 经实测 minified 客户端 JSX 中，gate 与 href
 * 之间常隔 80-200 字符（含 children JSX 元素、props、tag 名）。320
 * 字符兼顾召回率与精度。
 */
const BENIGN_WINDOW = 320;

/** Minified gate pattern. CLIENT_CAPABILITIES is renamed by terser to a
 *  short property like `.T.`; capability keys (billing/pricing/...) are
 *  preserved (object literal keys). Common context after the capability
 *  expression:
 *    `.T.billing&&` — logical AND guard
 *    `.T.billing?`  — ternary guard
 *    `.T.billing)`  — inside `if()` condition close
 *    `.T.billing,`  — separator (rare)
 */
const GATE_PATTERN =
  /\.[A-Za-z_$][\w$]?\.(billing|pricing|signup|dunning|riskTier|license|sso|mixpanel|resend)\s*[?&)|]/;

/** IS_SAAS-based gate. `IS_SAAS` becomes a build-time `false` literal in
 *  on-prem, so the test condition is `false?...:` 三元 or `false&&...`
 *  pattern, which terser folds. But minified pre-fold form can still
 *  exist when IS_SAAS is imported and inlined into a single boolean
 *  property of an object (e.g. MarketingPrimaryCta's `g.cm?...:...`
 *  where `g.cm` is the imported IS_SAAS reexport). Allowlisting these
 *  ternary patterns where the false branch is taken on on-prem.
 *
 *  Pattern: `<ident>.[a-z][a-z]?` (a minified property access of 1-2 letters)
 *  followed by `?` (ternary) within the window of a SaaS href.
 *  This is somewhat loose but rejects real ungated cases. */
const IS_SAAS_TERNARY_GATE =
  /[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]?\?\(/;

/**
 * Dead-code false positive: `<PricingPreview>` (marketing home) is wrapped
 * in `{IS_SAAS && <PricingPreview .../>}` at the call site. terser eliminates
 * the call but keeps the function declaration (top-level decl, hoisted).
 * The body has `cta: { href: '/signup' }` object literals for 3 tiers,
 * none of which can actually render in on-prem because the function
 * is never invoked.
 *
 * codex M3：原本广义 `cta:{` 模式太宽，新组件如 onboarding 用同模式可能
 * 静默放行真实 leak。把签名收紧为：
 *   `features:` (PricingCard props 模式特有)  + `cta:{href:"/...signup`
 * — features: 与 cta:{ 在同一对象字面量里出现是 PricingCard 调用的指纹
 *
 * 并且只在 marketing home chunk (`app/[locale]/page.js`) 文件作用域内允许；
 * 其它文件出现仍然报。
 */
const DEAD_PRICING_PREVIEW_CTA = /features\s*:\s*[\w.[\]]+\s*,\s*cta\s*:\s*\{/;

/** 文件路径敏感型 BENIGN —— 仅在 marketing home chunk 内允许此模式。 */
const FILE_SCOPED_BENIGN: ReadonlyArray<{
  filePathFragment: string;
  pattern: RegExp;
}> = [
  {
    filePathFragment: '/app/[locale]/page.',
    pattern: DEAD_PRICING_PREVIEW_CTA,
  },
];

const BENIGN_PATTERNS: ReadonlyArray<RegExp> = [
  GATE_PATTERN,
  IS_SAAS_TERNARY_GATE,
];

interface Violation {
  rule: UrlRule;
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
    if (IGNORE_PATH_SEGMENTS.some((seg) => full.includes(seg))) continue;
    if (e.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    // 只扫 client-shipped JS（包括 next.js 客户端 chunks 和 server
    // RSC payloads，后者含 stringified href props）
    if (!e.name.endsWith('.js') && !e.name.endsWith('.mjs')) continue;
    out.push(full);
  }
}

async function listTargetFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const d of SCAN_DIRS) {
    await walk(join(OPEN_NEXT_DIR, d), files);
  }
  return files;
}

function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function scanContent(
  content: string,
  filePath: string,
  rules: ReadonlyArray<UrlRule>,
): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rules) {
    const pat = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g',
    );
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      // Benign 检查：在 forbidden 命中点 *之前* BENIGN_WINDOW 字符内
      // 寻找 CLIENT_CAPABILITIES gate。客户端编译产物中 gate 永远先于
      // href 字面量出现（`X.T.billing && <Link href="/billing">`）。
      const benignWinStart = Math.max(0, m.index - BENIGN_WINDOW);
      const benignWindow = content.slice(benignWinStart, m.index);
      if (BENIGN_PATTERNS.some((b) => b.test(benignWindow))) {
        if (m.index === pat.lastIndex) pat.lastIndex++;
        continue;
      }
      // 文件路径敏感的 benign：仅在特定文件中允许某些模式（避免广义
      // allowlist 在其它文件被误用）。
      const fileScoped = FILE_SCOPED_BENIGN.some(
        ({ filePathFragment, pattern }) =>
          filePath.includes(filePathFragment) && pattern.test(benignWindow),
      );
      if (fileScoped) {
        if (m.index === pat.lastIndex) pat.lastIndex++;
        continue;
      }

      const exStart = Math.max(0, m.index - 60);
      const exEnd = Math.min(content.length, m.index + m[0].length + 100);
      const excerpt = content.slice(exStart, exEnd).replace(/\s+/g, ' ').trim();
      const lineNum = offsetToLine(content, m.index);
      violations.push({
        rule,
        file: filePath,
        line: lineNum,
        excerpt,
      });
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
      `\n✓ on-prem UI clean (${filesScanned} client files scanned, no ` +
        `SaaS-only route links detected).`,
    );
    return;
  }
  console.error(
    `\n✗ on-prem UI contains ${violations.length} SaaS-only route link(s) ` +
      `across ${filesScanned} scanned file(s).\n`,
  );
  const byRule = group(violations, (v) => v.rule.name);
  for (const [ruleName, vs] of byRule) {
    console.error(`── ${ruleName} (${vs.length} occurrence${vs.length > 1 ? 's' : ''})`);
    console.error(`   ${vs[0].rule.rationale}`);
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
      `[verify-on-prem-ui] .open-next/ not found at ${OPEN_NEXT_DIR}. ` +
        `Run \`DEPLOYMENT_MODE=on-prem pnpm build\` first.`,
    );
    process.exit(2);
  }

  const files = await listTargetFiles();
  if (files.length === 0) {
    console.error(
      `[verify-on-prem-ui] no JS/MJS files matched scan dirs under ` +
        `${OPEN_NEXT_DIR}. Build may be incomplete.`,
    );
    process.exit(2);
  }

  const violations: Violation[] = [];
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    violations.push(...scanContent(content, f, FORBIDDEN_URLS));
  }

  printReport(violations, files.length);
  process.exit(violations.length === 0 ? 0 : 1);
}

// 仅作为脚本直接运行时触发 main()。
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[verify-on-prem-ui] unexpected error:', err);
    process.exit(2);
  });
}
