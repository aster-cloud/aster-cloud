// verify-on-prem-ui.ts scanContent 行为：
//   - 明确 href="/billing" / "/pricing" / "/signup" → violation
//   - router.push('/billing') → violation
//   - 客户端 gate（CLIENT_CAPABILITIES.X 或 minified .T.X）邻近 → 放行
//   - IS_SAAS 三元 gate 邻近 → 放行
//   - cta:{href:...} 形式（PricingPreview 死代码 false-positive）→ 放行

import { describe, it, expect } from 'vitest';
import { FORBIDDEN_URLS, scanContent } from '../../../scripts/verify-on-prem-ui';

describe('verify-on-prem-ui — scanContent', () => {
  describe('FORBIDDEN_URLS', () => {
    it('catches href="/billing"', () => {
      const content = `(0,d.jsx)(Link,{href:"/billing",children:"Upgrade"})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.some((v) => v.rule.name === 'href to /billing')).toBe(true);
    });

    it('catches href="/zh/billing" (locale-prefixed)', () => {
      const content = `<a href="/zh/billing">x</a>`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.some((v) => v.rule.name === 'href to /billing')).toBe(true);
    });

    it('catches href="/pricing"', () => {
      const content = `Link({href:"/pricing"})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.some((v) => v.rule.name === 'href to /pricing')).toBe(true);
    });

    it('catches href="/signup"', () => {
      const content = `Link({href:"/signup"})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.some((v) => v.rule.name === 'href to /signup')).toBe(true);
    });

    it("catches router.push('/billing')", () => {
      const content = `router.push("/billing");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      const names = vs.map((v) => v.rule.name);
      expect(names).toContain('router navigation to SaaS-only route');
    });

    it('catches router.replace("/pricing") (codex Minor)', () => {
      const content = `router.replace("/pricing");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(
        vs.some((v) => v.rule.name === 'router navigation to SaaS-only route'),
      ).toBe(true);
    });

    it('catches router.push("/zh/signup") (locale-prefixed)', () => {
      const content = `router.push("/zh/signup");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(
        vs.some((v) => v.rule.name === 'router navigation to SaaS-only route'),
      ).toBe(true);
    });

    it('catches navigate.push("/billing") (alternate navigation API)', () => {
      const content = `navigate.push("/billing");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(
        vs.some((v) => v.rule.name === 'router navigation to SaaS-only route'),
      ).toBe(true);
    });

    it('does NOT match /api/billing (different prefix)', () => {
      const content = `fetch("/api/billing/status")`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      // /api/billing 是 API 端点，不是 UI 路由；不该 trigger
      expect(vs.length).toBe(0);
    });

    it('does NOT match /billing-something (longer path)', () => {
      const content = `link("/billing-info")`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      // 我们的 regex 用 [\/?"#'] 限定 /billing 后必须是路径分隔/查询/结束
      expect(vs.length).toBe(0);
    });
  });

  describe('BENIGN_PATTERNS — CLIENT_CAPABILITIES gate', () => {
    it('放行 minified `&&` gate: `X.T.billing&&...href:"/billing"`', () => {
      const content = `n.T.billing&&(0,d.jsx)(Link,{href:"/billing"})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.length).toBe(0);
    });

    it('放行 minified `?` ternary: `X.T.billing?...href:"/billing":...`', () => {
      const content = `i.T.billing?(0,d.jsx)(Link,{href:"/billing"}):(0,d.jsx)(\"span\",{})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.length).toBe(0);
    });

    it('放行 if-gated router.push: `if(j.T.billing)return void b.push("/billing")`', () => {
      const content = `if(j.T.billing)return void b.push("/billing");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.length).toBe(0);
    });

    it('放行 MarketingPrimaryCta ternary: `g.cm?...href:"/signup"`', () => {
      // g.cm 是 minified IS_SAAS
      const content = `function f(){return g.cm?(0,d.jsx)(x.N_,{href:"/signup",className:""}):(0,d.jsx)("a",{href:"mailto:sales@..."})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.length).toBe(0);
    });

    it('放行 PricingPreview cta object literal — 仅在 marketing home chunk 中 (codex M3)', () => {
      const content = `features:x.free,cta:{href:"/signup",label:"start"}`;
      // marketing home chunk 路径：
      const inMarketingHome = scanContent(
        content,
        '/abs/.open-next/server-functions/default/.next/server/app/[locale]/page.js',
        FORBIDDEN_URLS,
      );
      expect(inMarketingHome.length).toBe(0);
    });

    it('NOT放行 同模式出现在其它文件中（如未来 onboarding 组件）', () => {
      const content = `features:x.free,cta:{href:"/signup",label:"start"}`;
      // 非 marketing home 文件 → 仍然 violation
      const inOnboarding = scanContent(
        content,
        '/abs/.open-next/server-functions/default/.next/server/app/[locale]/onboarding/page.js',
        FORBIDDEN_URLS,
      );
      expect(
        inOnboarding.some((v) => v.rule.name === 'href to /signup'),
      ).toBe(true);
    });
  });

  describe('real leaks past benign window', () => {
    it('未 gate 的 href="/billing" 远离任何 capabilities → violation', () => {
      // 320+ char of unrelated context before the href
      const filler = 'x'.repeat(350);
      const content = `${filler}(0,d.jsx)(Link,{href:"/billing"})`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(vs.some((v) => v.rule.name === 'href to /billing')).toBe(true);
    });

    it('未 gate 的 router.push("/billing") → violation', () => {
      const filler = 'y'.repeat(350);
      const content = `${filler}; router.push("/billing");`;
      const vs = scanContent(content, '/x/y.js', FORBIDDEN_URLS);
      expect(
        vs.some(
          (v) =>
            v.rule.name === 'router.push("/billing")' ||
            v.rule.name === 'href to /billing',
        ),
      ).toBe(true);
    });
  });

  describe('violation report', () => {
    it('returns file + line + excerpt + rule for each match', () => {
      const content = `<a href="/billing">x</a>\n<a href="/pricing">y</a>`;
      const vs = scanContent(content, '/abs/path/foo.js', FORBIDDEN_URLS);
      expect(vs.length).toBeGreaterThanOrEqual(2);
      for (const v of vs) {
        expect(v.file).toBe('/abs/path/foo.js');
        expect(v.line).toBeGreaterThan(0);
        expect(v.excerpt.length).toBeGreaterThan(0);
        expect(v.rule.rationale.length).toBeGreaterThan(20);
      }
    });
  });
});
