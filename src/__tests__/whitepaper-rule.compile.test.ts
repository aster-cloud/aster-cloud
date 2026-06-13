/**
 * 白皮书示例规则的**生产可验证性**契约。
 *
 * /equivalence/whitepaper 的「实例演练」展示一条三语信贷规则代码块。该代码不是
 * 排版文本——它必须能在生产同款引擎 `@aster-cloud/aster-lang-ts/browser` 里真正
 * 编译并执行，否则白皮书自身就成了「说一套、做一套」。本测试对 en/zh/de 三语白皮书
 * 规则逐一：编译无错 + 用白皮书所述申请人(score 561)执行，决策必须落到 declined 文本。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US, ZH_CN, DE_DE } from '@aster-cloud/aster-lang-ts/browser';
import { WHITEPAPER, type WhitepaperLocale } from '@/config/whitepaper';

const LEX: Record<WhitepaperLocale, unknown> = { en: EN_US, zh: ZH_CN, de: DE_DE };
// 白皮书规则的函数名 + 参数名 + 字段名（与代码块本地化标识符一致）。
const SHAPE: Record<WhitepaperLocale, { fn: string; param: string; score: string; income: string; debt: string }> = {
  en: { fn: 'decide', param: 'applicant', score: 'creditScore', income: 'monthlyIncome', debt: 'monthlyDebt' },
  zh: { fn: '评估', param: '申请人', score: '信用分', income: '月收入', debt: '月负债' },
  de: { fn: 'entscheiden', param: 'antrag', score: 'score', income: 'einkommen', debt: 'schulden' },
};
// 白皮书声明：score 561 → 被拒（declined 文本）。每语言的 declined 文本。
const DECLINED: Record<WhitepaperLocale, string> = {
  en: 'Declined — credit score below threshold',
  zh: '拒绝 — 信用分低于门槛',
  de: 'Abgelehnt — Bonität unter Schwellenwert',
};

describe('whitepaper worked-example rule compiles & declines APP-10561', () => {
  for (const loc of ['en', 'zh', 'de'] as WhitepaperLocale[]) {
    it(`${loc}`, () => {
      const source = WHITEPAPER[loc].example.ruleCode;
      // 白皮书代码块只含 Rule（无 Module/Define 头）——补一个最小可编译外壳前缀，
      // 用与 /demo 相同的本地化模块/类型声明，保证 Rule 体本身能编译执行。
      const s = SHAPE[loc];
      const header =
        loc === 'zh'
          ? `模块 信贷.准入。\n\n定义 申请人 包含\n  ${s.score} 作为 整数，\n  ${s.income} 作为 小数，\n  ${s.debt} 作为 小数。\n\n`
          : loc === 'de'
          ? `Modul kredit.zulassung.\n\nDefiniere Antragsteller hat\n  ${s.score} als Ganzzahl,\n  ${s.income} als Dezimal,\n  ${s.debt} als Dezimal.\n\n`
          : `Module credit.approval.\n\nDefine Applicant has\n  ${s.score} as Int,\n  ${s.income} as Float,\n  ${s.debt} as Float.\n\n`;
      const result = compile(header + source, { lexicon: LEX[loc] } as Parameters<typeof compile>[1]);
      const errs = ((result as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter((d) => d.severity === 'error');
      expect(result.core, `[${loc}] core; diags=${JSON.stringify(errs)}`).toBeTruthy();
      expect(errs.length, `[${loc}] ${JSON.stringify(errs)}`).toBe(0);

      // 白皮书申请人 APP-10561：score 561, debt 1640, income 4100 → declined。
      const ev = evaluate(result.core!, s.fn, {
        [s.param]: { [s.score]: 561, [s.income]: 4100, [s.debt]: 1640 },
      });
      expect(ev.success, `[${loc}] eval: ${ev.error}`).toBe(true);
      expect(String(ev.value), `[${loc}]`).toBe(DECLINED[loc]);
    });
  }
});
