/**
 * 🐱 猫咪心情引擎 fun-demo 的生产可验证性契约（三语）。
 *
 * /cat-mood 用撸猫领域词写规则，引擎注入猫词汇后真编译真执行，决策驱动简笔猫动画。
 * 规则必须能在生产同款浏览器引擎里编译执行，否则彩蛋当场翻车。三语 × 四场景逐一：
 * 编译无错 + 决策 == 预期心情 + 客户端镜像 catMoodOf 与引擎一致。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  CAT_RULES, CAT_SCENES, CAT_DEMO_TENANT,
  registerCatVocab, catLexiconFor, catMoodOf,
  type DemoLocale,
} from '@/config/cat-mood';

const LOCALES: DemoLocale[] = ['en', 'zh', 'de'];

describe('cat mood engine compiles & runs in every language', () => {
  for (const loc of LOCALES) {
    it(`${loc}: poetic cat rule compiles + every scene yields the expected mood`, () => {
      const domainKey = registerCatVocab(loc);
      const rule = CAT_RULES[loc];
      const r = compile(rule.source, {
        lexicon: catLexiconFor(loc), domain: domainKey, tenantId: CAT_DEMO_TENANT,
      } as Parameters<typeof compile>[1]);
      const errs = ((r as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter((d) => d.severity === 'error');
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs)}`).toBeTruthy();
      expect(errs.length, `[${loc}] ${JSON.stringify(errs)}`).toBe(0);

      for (const scene of CAT_SCENES) {
        const ev = evaluate(r.core!, rule.ruleName, { [rule.paramName]: scene.input });
        expect(ev.success, `[${loc}] ${scene.id}: ${ev.error ?? ''}`).toBe(true);
        // 引擎决策 == 场景预期心情，且客户端镜像一致。
        expect(String(ev.value), `[${loc}] ${scene.id} engine`).toBe(scene.id);
        expect(catMoodOf(scene.input), `[${loc}] ${scene.id} mirror`).toBe(scene.id);
      }
    });
  }
});
