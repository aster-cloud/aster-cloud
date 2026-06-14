/**
 * 领域词汇 demo 的**生产可验证性**契约（三语）。
 *
 * /vocab-demo 展示「用行业术语写规则 → 引擎注入领域词汇后照样编译执行」，且**三语本地化**：
 * 中文站用中文 CNL 关键词 + 中文行业术语 + 中文决策，德文站用德文。这些规则必须能在生产
 * 同款 `@aster-cloud/aster-lang-ts/browser` 引擎里真编译真执行，否则演示当场翻车。
 *
 * 对 3 领域 × 3 语言逐一：registerCustom 注入领域词汇后规则编译成功（无诊断错误）；
 * 每个案例（canonical-key 输入）执行，决策与该语言预期逐字一致。任一组合失败 = CI 硬失败。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  VOCAB_DOMAINS, VOCAB_DOMAIN_IDS, VOCAB_DEMO_TENANT,
  registerVocabForDomain, lexiconFor,
  type DemoLocale,
} from '@/config/vocab-demo';

const LOCALES: DemoLocale[] = ['en', 'zh', 'de'];

describe('vocab demo: industry-term rules compile & run in every language', () => {
  for (const id of VOCAB_DOMAIN_IDS) {
    const domain = VOCAB_DOMAINS[id];
    for (const loc of LOCALES) {
      it(`${id}/${loc}: localized rule compiles after registerCustom and every case matches`, () => {
        const domainKey = registerVocabForDomain(domain, loc);
        const rule = domain.rules[loc];
        const r = compile(rule.source, {
          lexicon: lexiconFor(loc),
          domain: domainKey,
          tenantId: VOCAB_DEMO_TENANT,
        } as Parameters<typeof compile>[1]);
        const errs = ((r as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter((d) => d.severity === 'error');
        expect(r.core, `[${id}/${loc}] core; diags=${JSON.stringify(errs)}`).toBeTruthy();
        expect(errs.length, `[${id}/${loc}] ${JSON.stringify(errs)}`).toBe(0);

        for (const c of domain.cases) {
          // eval 输入用 canonical 字段名（领域词只在表层，IR 是规范名）。
          const ev = evaluate(r.core!, rule.ruleName, { [rule.paramName]: c.input });
          expect(ev.success, `[${id}/${loc}] ${c.id} eval: ${ev.error ?? ''}`).toBe(true);
          expect(String(ev.value), `[${id}/${loc}] ${c.id}`).toBe(c.expect[loc]);
        }
      });
    }
  }
});
