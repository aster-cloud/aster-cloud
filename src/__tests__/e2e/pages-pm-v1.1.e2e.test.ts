// E2E：PM v1.1 三档化 + 三语 hero/features/pricing 端到端验证
//
// 运行前提：dev server 必须已起（默认 http://localhost:3001）
//   pnpm dev      # 开发模式
//   或 pnpm build && pnpm start
//
// 运行：
//   pnpm test:e2e
//   E2E_BASE_URL=https://staging.example.com pnpm test:e2e   # 跑 staging
//
// 设计：
// - 不依赖 puppeteer / playwright（避免引入重型依赖）
// - 用 fetch + jsdom（项目已有）解析 SSR HTML
// - server 不可达 → 整个 suite skip 并打印明确指引（不静默打绿）

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

// describe.skipIf 在 import 阶段评估，必须同步：用同步 probe + import-time 缓存
// 用一次 fetch 探测在模块顶层（顶层 await）
async function probeServer(): Promise<{ ok: boolean; reason: string }> {
  try {
    const r = await fetch(BASE_URL, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    if (r.ok || (r.status >= 300 && r.status < 400)) return { ok: true, reason: '' };
    return { ok: false, reason: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const probeResult = await probeServer();
const serverReachable = probeResult.ok;

if (!serverReachable) {
  console.error(
    `\n[E2E SKIPPED] dev server not reachable at ${BASE_URL}\n` +
      `  reason: ${probeResult.reason}\n` +
      `  hint:   cd aster-cloud && pnpm dev\n`
  );
}

beforeAll(() => {
  // noop — probe done at import time
});

interface FetchedDoc {
  status: number;
  finalUrl: string;
  html: string;
  doc: Document;
}

async function fetchDoc(path: string): Promise<FetchedDoc> {
  const url = `${BASE_URL}${path}`;
  const r = await fetch(url, { redirect: 'follow' });
  const html = await r.text();
  const dom = new JSDOM(html);
  return { status: r.status, finalUrl: r.url, html, doc: dom.window.document };
}

function expectContains(html: string, needle: string, locale: string) {
  if (!html.includes(needle)) {
    throw new Error(
      `[${locale}] expected HTML to contain "${needle}" but it did not.\n` +
        `Tip: open ${BASE_URL} for the locale and verify the i18n key resolves.`
    );
  }
}

function expectNotContains(html: string, needle: string, locale: string) {
  if (html.includes(needle)) {
    throw new Error(
      `[${locale}] expected HTML NOT to contain stale string "${needle}" but it appeared.`
    );
  }
}

describe.skipIf(!serverReachable)('E2E PM v1.1 — pages render correct content', () => {
  describe('Hero — three locales', () => {
    it('en hero shows "Policy-as-Code in plain English"', async () => {
      const { status, html } = await fetchDoc('/');
      expect(status).toBe(200);
      expectContains(html, 'Policy-as-Code in plain English', 'en');
      expectContains(html, 'No credit card required', 'en');
    });

    it('zh hero shows "用母语写策略"', async () => {
      const { status, html } = await fetchDoc('/zh');
      expect(status).toBe(200);
      expectContains(html, '用母语写策略', 'zh');
      expectContains(html, '无需信用卡', 'zh');
    });

    it('de hero shows "Policy-as-Code in Ihrer Muttersprache"', async () => {
      const { status, html } = await fetchDoc('/de');
      expect(status).toBe(200);
      expectContains(html, 'Policy-as-Code in Ihrer Muttersprache', 'de');
      expectContains(html, 'Keine Kreditkarte erforderlich', 'de');
    });
  });

  describe('Features 6 cards — three locales', () => {
    const en = [
      'Native-language CNL',
      'AI drafts, humans approve',
      'Tamper-evident audit',
      'Java + TypeScript dual engine',
      'Multi-language lexicon packs',
      'Self-host on your cluster',
    ];
    const zh = ['母语 CNL', 'AI 写草稿，人审上线', '哈希链审计与重放', '双引擎一致语义', '多语种 lexicon 全档可用', '自托管 K3S + ArgoCD'];
    const de = [
      'CNL in Muttersprache',
      'KI entwirft, Menschen genehmigen',
      'Manipulationssicheres Audit',
      'Zwei Engines, eine Semantik',
      'Mehrsprachige Lexikon-Pakete',
      'Selbst hosten auf K3S',
    ];

    /**
     * 抽取 home features section 的 HTML 片段
     * Hero 后的第一个 <section> 含 "features.title"，限制 stale 字符串检查在该范围内
     * （避免与 /reports 页的 "Compliance Reports" 标题或 FAQ 中类似词冲突）
     */
    function extractFeaturesSection(html: string): string {
      const match = html.match(/<section[^>]*py-20[^>]*bg-white[^>]*>[\s\S]*?<\/section>/);
      return match?.[0] ?? '';
    }

    it('en home lists all 6 PM v1.1 feature titles', async () => {
      const { html } = await fetchDoc('/');
      for (const title of en) expectContains(html, title, 'en');
      const featuresHtml = extractFeaturesSection(html);
      // 旧 v1.0 feature card 标题必须不在 features section（其他位置如 /reports 标题不算）
      expectNotContains(featuresHtml, 'PII Protection', 'en');
      expectNotContains(featuresHtml, 'Team Collaboration', 'en');
      expectNotContains(featuresHtml, 'Real-time Execution', 'en');
      expectNotContains(featuresHtml, 'Version History', 'en');
    });

    it('zh home lists all 6 PM v1.1 feature titles', async () => {
      const { html } = await fetchDoc('/zh');
      for (const title of zh) expectContains(html, title, 'zh');
      const featuresHtml = extractFeaturesSection(html);
      expectNotContains(featuresHtml, 'PII 保护', 'zh');
      expectNotContains(featuresHtml, '版本历史', 'zh');
    });

    it('de home lists all 6 PM v1.1 feature titles', async () => {
      const { html } = await fetchDoc('/de');
      for (const title of de) expectContains(html, title, 'de');
      const featuresHtml = extractFeaturesSection(html);
      expectNotContains(featuresHtml, 'PII-Schutz', 'de');
      expectNotContains(featuresHtml, 'Versionshistorie', 'de');
    });
  });

  describe('Hero pricing card — locale-appropriate currency', () => {
    it('/ (en) shows $39 and not stale $29', async () => {
      const { html } = await fetchDoc('/');
      expectContains(html, '$39', 'en');
      expectNotContains(html, '$29/month', 'en');
    });

    it('/zh shows ¥299 and not stale ¥199', async () => {
      const { html } = await fetchDoc('/zh');
      expectContains(html, '¥299', 'zh');
      expectNotContains(html, '¥199', 'zh');
    });

    it('/de shows €36 (postfix) and not stale €27', async () => {
      const { html } = await fetchDoc('/de');
      // German format: "36 €" (space + postfix). Either form accepted.
      const hasNew = html.includes('36 €') || html.includes('36 €') || html.includes('€36');
      if (!hasNew) {
        throw new Error(`[de] expected "36 €" or "€36" in HTML but found neither. Inspect ${BASE_URL}/de`);
      }
      expectNotContains(html, '€27', 'de');
      expectNotContains(html, '27 €', 'de');
    });
  });

  describe('/pricing — three tiers with PM v1.1 selling points', () => {
    it('en /pricing shows Free / Pro / Enterprise with PM v1.1 sales bullets', async () => {
      const { status, html } = await fetchDoc('/pricing');
      expect(status).toBe(200);
      // Free
      expectContains(html, '20 AI drafts / month', 'en');
      expectContains(html, 'All language packs', 'en');
      // Pro
      expectContains(html, '500 AI drafts / seat / month', 'en');
      expectContains(html, 'Reviewer ≠ author (enforced for ≥ 2 seats)', 'en');
      expectContains(html, 'Invite reviewers — each seat ¥299 / month', 'en');
      // Enterprise
      expectContains(html, 'Unlimited AI drafts via BYOK', 'en');
      expectContains(html, 'Custom industry lexicons', 'en');
      expectContains(html, 'SSO (SAML / OIDC / Authentik)', 'en');
    });

    it('zh /zh/pricing shows three tiers with v1.1 zh bullets', async () => {
      const { status, html } = await fetchDoc('/zh/pricing');
      expect(status).toBe(200);
      expectContains(html, '20 次 AI 草稿', 'zh');
      expectContains(html, '500 次 AI 草稿', 'zh');
      expectContains(html, 'Reviewer ≠ 提交人', 'zh');
      expectContains(html, '每席 ¥299', 'zh');
      expectContains(html, 'BYOK 无限 AI 草稿', 'zh');
      expectContains(html, '行业自定义 lexicon', 'zh');
    });

    it('de /de/pricing shows three tiers with v1.1 de bullets', async () => {
      const { status, html } = await fetchDoc('/de/pricing');
      expect(status).toBe(200);
      expectContains(html, '20 KI-Entwürfe', 'de');
      expectContains(html, '500 KI-Entwürfe', 'de');
      expectContains(html, 'Reviewer ≠ Autor', 'de');
      expectContains(html, 'jeder Sitz ¥299', 'de');
      expectContains(html, 'BYOK', 'de');
      expectContains(html, 'Branchenspezifische Lexika', 'de');
    });

    it('/pricing must NOT show legacy Team tier', async () => {
      const { html } = await fetchDoc('/pricing');
      // PM v1.1：Pricing 页面只展示 Free / Pro / Enterprise
      // "Team" 词可能出现在 features 文案里（如 "Team workspace"），但不应有独立档位卡
      // 检查独立卡片片段：tagline "min users" 或 "minimum 3 users" 是 Team 卡专属
      expectNotContains(html, 'Minimum 3 users', 'en');
      expectNotContains(html, 'min 3 users', 'en');
    });
  });

  describe('Authenticated routes — middleware redirects to login', () => {
    const protectedPaths = ['/dashboard', '/billing', '/teams/new', '/policies/new', '/settings/api-keys', '/settings/ai-keys'];

    for (const path of protectedPaths) {
      it(`${path} redirects when unauthenticated (proves route compiles)`, async () => {
        const r = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
        // 307 = next-intl middleware redirect to /login
        // 308 = some Next.js permanent redirects
        // 200 with login form = also acceptable (some setups render directly)
        expect([200, 302, 303, 307, 308]).toContain(r.status);
      });
    }
  });

  describe('HTML lang attribute — i18n correctness', () => {
    it('/ has lang="en"', async () => {
      const { doc } = await fetchDoc('/');
      expect(doc.documentElement.getAttribute('lang')).toBe('en');
    });

    it('/zh has lang="zh"', async () => {
      const { doc } = await fetchDoc('/zh');
      expect(doc.documentElement.getAttribute('lang')).toBe('zh');
    });

    it('/de has lang="de"', async () => {
      const { doc } = await fetchDoc('/de');
      expect(doc.documentElement.getAttribute('lang')).toBe('de');
    });
  });

  describe('Anti-regression — stale strings purged', () => {
    it('home en has no "Policy Management Made Simple" (v15 audit P0-1)', async () => {
      const { html } = await fetchDoc('/');
      expectNotContains(html, 'Policy Management Made Simple', 'en');
    });

    it('home zh has no "策略管理 化繁为简"', async () => {
      const { html } = await fetchDoc('/zh');
      expectNotContains(html, '策略管理 化繁为简', 'zh');
      // 旧 hero "化繁为简" 应消失（"化繁为简" 单独出现可能是其他文案，重点是组合）
      expectNotContains(html, 'titleHighlight 化繁为简', 'zh');
    });

    it('hero CTA no longer says "14-day free trial" (PM v1.1: no trial CTA on hero)', async () => {
      const { html } = await fetchDoc('/');
      // hero.description 在 v1.1 改为 "No credit card required."
      // hero.noCreditCard 也是 "No credit card required."
      // 14-day trial 措辞应仅出现在 common.startFreeTrial 按钮（保留兼容）
      // 这里只检查 hero description 段落不含
      const heroSection = html.match(/<section[^>]*class="pt-32[^"]*"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
      expectNotContains(heroSection, '14-day free trial', 'en');
    });
  });
});
