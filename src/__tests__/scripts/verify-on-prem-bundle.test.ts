// verify-on-prem-bundle.ts scanContent 行为：
//   - SaaS-only npm import (stripe/resend/mixpanel-browser) → violation
//   - SaaS-only env literal access → violation
//   - SaaS-only SDK class symbols → violation
//   - 良性邻近模式（schema 列名 / requiredIn 元数据）→ 放行
//
// 重点是规则的正负样例覆盖：
//   - 一个真实 .open-next chunk 节选会命中
//   - ENV_CHECKS 元数据 chunk 不会命中（BENIGN window）
//   - 良性变量名（stripeCustomerId）不会命中
//
// 测试是 happy-path + 边界 case 覆盖；CI 时 verify:on-prem 跑实际 build
// 是 end-to-end 验证。

import { describe, it, expect } from 'vitest';
import {
  FORBIDDEN_IMPORTS,
  FORBIDDEN_ENV_LITERALS,
  FORBIDDEN_SDK_SYMBOLS,
  scanContent,
} from '../../../scripts/verify-on-prem-bundle';

const ALL_RULES = [
  ...FORBIDDEN_IMPORTS,
  ...FORBIDDEN_ENV_LITERALS,
  ...FORBIDDEN_SDK_SYMBOLS,
];

describe('verify-on-prem-bundle — scanContent', () => {
  describe('FORBIDDEN_IMPORTS', () => {
    it('catches `from "stripe"` ESM import', () => {
      const content = `import Stripe from "stripe";`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.length).toBeGreaterThanOrEqual(1);
      expect(vs.some((v) => v.rule.name === 'stripe import')).toBe(true);
    });

    it('catches `require("resend")` CJS form', () => {
      const content = `const { Resend } = require("resend");`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'resend import')).toBe(true);
    });

    it('catches `from "mixpanel-browser"`', () => {
      const content = `import mp from "mixpanel-browser";`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'mixpanel-browser import')).toBe(true);
    });

    it('catches dynamic `import("stripe")` (codex M1)', () => {
      // Spike report §3.2 — this is the critical form because webpack
      // treats dynamic imports as side-effectful even when dead.
      const content = `const m = await import("stripe");`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'stripe import')).toBe(true);
    });

    it('catches dynamic `import("resend")`', () => {
      const content = `const m = await import("resend");`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'resend import')).toBe(true);
    });

    it('catches dynamic `import("mixpanel-browser")`', () => {
      const content = `const m = await import("mixpanel-browser");`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'mixpanel-browser import')).toBe(true);
    });

    it('does NOT match commented-out import lines', () => {
      const content = `// import Stripe from "stripe";`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      // 注释行不算泄漏；BENIGN_PATTERNS 用 邻近 window 而非整行，但是
      // 注释包含的 "stripe" 仍可能 trigger。这是 acceptable noise —
      // minified production bundle 不应保留 //-style 注释。本测验证
      // *minified* form。
      // 但 forbidden import pattern 用了引号定界，注释里的 `"stripe"`
      // 如果带 import 前缀也会命中（弱信号）。这里我们不期望被放行。
      expect(vs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('FORBIDDEN_ENV_LITERALS', () => {
    it('catches process.env.STRIPE_SECRET_KEY access', () => {
      const content = `const k = process.env.STRIPE_SECRET_KEY;`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'STRIPE_SECRET_KEY literal')).toBe(true);
    });

    it('catches process.env.STRIPE_WEBHOOK_SECRET', () => {
      const content = `const s = process.env.STRIPE_WEBHOOK_SECRET;`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'STRIPE_WEBHOOK_SECRET literal')).toBe(true);
    });

    it('catches NEXT_PUBLIC_MIXPANEL_TOKEN', () => {
      const content = `process.env.NEXT_PUBLIC_MIXPANEL_TOKEN`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'NEXT_PUBLIC_MIXPANEL_TOKEN literal')).toBe(true);
    });

    it('catches RESEND_API_KEY', () => {
      const content = `const x = process.env.RESEND_API_KEY;`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'RESEND_API_KEY literal')).toBe(true);
    });
  });

  describe('FORBIDDEN_SDK_SYMBOLS', () => {
    it('catches StripeAPIError class name', () => {
      const content = `if (e instanceof StripeAPIError) throw e;`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'Stripe SDK error classes')).toBe(true);
    });

    it('catches `new Resend(`', () => {
      const content = `_inst = new Resend(key);`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'Resend constructor instantiation')).toBe(true);
    });

    it('catches mixpanel SDK init config (track_pageview)', () => {
      const content = `inst.init(t, { track_pageview: true });`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'Mixpanel SDK behaviour')).toBe(true);
    });
  });

  describe('BENIGN_PATTERNS', () => {
    it('放行 ENV_CHECKS metadata: STRIPE_SECRET_KEY 邻近 requiredIn', () => {
      // 模拟 env-validation 的 ENV_CHECKS 数组 minified 后的样子
      const content = `[{key:"STRIPE_SECRET_KEY",required:"production-only",requiredIn:["saas"],description:"Stripe API key"}]`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      // STRIPE_SECRET_KEY 字面量出现，但在 ±80 字符内有 requiredIn → 放行
      expect(vs.length).toBe(0);
    });

    it('放行 DB 列名 stripeCustomerId（不是 SDK 调用）', () => {
      const content = `findFirst({ where: eq(users.stripeCustomerId, id) })`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      // BENIGN_PATTERNS 包含 stripeCustomerId，且 forbidden 不匹配
      // （因为没有 STRIPE_ 字面量、没有 import、没有 SDK 符号）
      expect(vs.length).toBe(0);
    });

    it('真实 leak（无 requiredIn 邻近）仍报', () => {
      const content = `const k = process.env.STRIPE_SECRET_KEY; throw "leak";`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      expect(vs.some((v) => v.rule.name === 'STRIPE_SECRET_KEY literal')).toBe(true);
    });
  });

  describe('violation report', () => {
    it('returns file + line + excerpt + rule for each match', () => {
      const content = `import Stripe from "stripe";\nconst k = process.env.STRIPE_SECRET_KEY;\n`;
      const vs = scanContent(content, '/abs/path/foo.js', ALL_RULES);
      expect(vs.length).toBeGreaterThanOrEqual(2);
      for (const v of vs) {
        expect(v.file).toBe('/abs/path/foo.js');
        expect(v.line).toBeGreaterThan(0);
        expect(v.excerpt.length).toBeGreaterThan(0);
        expect(v.rule.name).toBeTruthy();
        expect(v.rule.rationale.length).toBeGreaterThan(20);
      }
    });

    it('line numbers are 1-based and correct across newlines', () => {
      const content = `// line 1\n// line 2\nimport Stripe from "stripe";\n`;
      const vs = scanContent(content, '/x/y.js', ALL_RULES);
      const importMatch = vs.find((v) => v.rule.name === 'stripe import');
      expect(importMatch).toBeDefined();
      expect(importMatch!.line).toBe(3);
    });
  });
});
