/**
 * 「源码即诗」demo 的**生产可验证性**契约（四语：en/de/zh/hi）。
 *
 * /demos/poem 展示一首该界面语言的名诗，源码读起来就是那首诗，由生产同款
 * `@aster-cloud/aster-lang-ts/browser` 引擎真编译、递归真执行。每种语言钉死三条不变式，
 * 任一失败 = CI 硬失败（演示当场翻车）：
 *   1. 诗体源码用该语言诗词别名词典编译成功（无诊断错误）。
 *   2. 入口 rule 从 start 行递归执行，吟诵结果与 expect 逐字一致。
 *   3. 诗体方言版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——证明别名只在表层，
 *      「源码是诗」与「源码是程序」是同一个东西（ADR 0022 别名 + ADR 0027 无括号 apply）。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US, ZH_CN, DE_DE, HI_IN } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, reciteLines, type PoemLocale } from '@/config/poem-demo';

const BASE: Record<PoemLocale, typeof EN_US> = { en: EN_US, zh: ZH_CN, de: DE_DE, hi: HI_IN };
const LOCALES: PoemLocale[] = ['en', 'zh', 'de', 'hi'];

/** 剥离 origin/span（位置元数据，因别名长度不同而偏移；结构比较口径）。 */
function stripOrigin(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigin);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin' || k === 'span') continue;
      r[k] = stripOrigin((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}

describe('poem demo: every UI language has a famous poem that compiles and runs', () => {
  for (const loc of LOCALES) {
    const poem = POEMS[loc];

    it(`${loc} (${poem.title}): 诗体源码编译成功（无诊断错误）`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      const errs = ((r as { parseErrors?: { message?: string }[] }).parseErrors ?? []);
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
      expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    });

    it(`${loc} (${poem.title}): 递归吟诵结果与预期逐字一致`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      expect(r.core).toBeTruthy();
      const ev = evaluate(r.core!, poem.entry, { [poem.param]: poem.start });
      expect(ev.success, `[${loc}] eval: ${ev.error ?? ''}`).toBe(true);
      expect(String(ev.value), `[${loc}]`).toBe(poem.expect);
    });

    it(`${loc} (${poem.title}): 别名不变式 — 诗体版 ≡ 规范关键词版（结构一致 Core IR）`, () => {
      const poemR = compile(poem.source, { lexicon: poem.lexicon });
      const canonR = compile(poem.canonical, { lexicon: BASE[loc] });
      // 两侧都须真编译成功（不只 core truthy），否则不变式无意义。
      const poemErrs = (poemR as { parseErrors?: unknown[] }).parseErrors ?? [];
      const canonErrs = (canonR as { parseErrors?: unknown[] }).parseErrors ?? [];
      expect(poemR.success && poemErrs.length === 0, `[${loc}] poem compiles: ${JSON.stringify(poemErrs)}`).toBe(true);
      expect(canonR.success && canonErrs.length === 0, `[${loc}] canonical compiles: ${JSON.stringify(canonErrs)}`).toBe(true);
      expect(stripOrigin(poemR.core)).toEqual(stripOrigin(canonR.core));
    });

    it(`${loc} (${poem.title}): reciteLines 精确切回每一诗行（UI 展示）`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      const ev = evaluate(r.core!, poem.entry, { [poem.param]: poem.start });
      const lines = reciteLines(poem, String(ev.value));
      // 多于一行（确实切开了），且无空白拼回 == 完整吟诵（不丢字、不错位）。
      expect(lines.length, `[${loc}] line count`).toBeGreaterThan(1);
      expect(lines.join('').replace(/\s/g, ''), `[${loc}] rejoined`).toBe(poem.expect.replace(/\s/g, ''));
    });
  }
});
