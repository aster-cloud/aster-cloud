/**
 * 信贷风控 demo 规则的**生产可验证性**契约。
 *
 * /demo 页按语言展示规则（中文站中文规则、德文站德文规则）。这些规则不是
 * 装饰性文本——它们必须能在生产同款引擎里**真正编译且执行**，否则就是给客户/监管
 * 演示时当场翻车。本测试用与生产相同的 `@aster-cloud/aster-lang-ts/browser` 引擎，
 * 对 en/zh/de 三语规则逐一：
 *   1. 编译成功（产出 Core IR），无诊断错误；
 *   2. 用三个 demo 申请人执行，产出与 demo 场景声明一致的决策文本。
 * 任一语言不编译或决策不符 = CI 硬失败。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US, ZH_CN, DE_DE } from '@aster-cloud/aster-lang-ts/browser';
import {
  CREDIT_RISK_RULE_BY_LOCALE,
  getDemoScenarios,
  type DemoLocale,
} from '@/config/credit-risk-demo';

const LEXICONS: Record<DemoLocale, unknown> = {
  en: EN_US,
  zh: ZH_CN,
  de: DE_DE,
};

describe('credit-risk demo rules compile & run in every language', () => {
  for (const loc of ['en', 'zh', 'de'] as DemoLocale[]) {
    describe(`${loc}`, () => {
      const source = CREDIT_RISK_RULE_BY_LOCALE[loc];

      it('compiles to Core IR with no errors', () => {
        const result = compile(source, { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
        const diags = (result as { diagnostics?: unknown[] }).diagnostics ?? [];
        if (!result.core) {
          // 失败时打印诊断，便于定位是哪个关键词/语法在该语言下不被接受。
          console.error(`[${loc}] compile failed:`, JSON.stringify(diags));
        }
        expect(result.core).toBeTruthy();
        expect(diags.length).toBe(0);
      });

      it('runs each demo applicant to the declared decision', () => {
        const result = compile(source, { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
        expect(result.core).toBeTruthy();

        for (const scenario of getDemoScenarios(loc)) {
          const a = scenario.applicant;
          // decide(applicant): 命名式 context，参数名 applicant 映射到 Applicant 结构。
          const evalResult = evaluate(result.core!, 'decide', {
            applicant: {
              id: a.id,
              creditScore: a.creditScore,
              monthlyIncome: a.monthlyIncome,
              monthlyDebt: a.monthlyDebt,
              requestedAmount: a.requestedAmount,
            },
          });

          expect(
            evalResult.success,
            `[${loc}] ${scenario.key} eval failed: ${evalResult.error ?? ''}`,
          ).toBe(true);
          // 引擎产出必须与 demo 场景声明的决策文本一致——保证页面展示的结果是真算出来的。
          expect(String(evalResult.value)).toBe(scenario.decision);
        }
      });
    });
  }
});
