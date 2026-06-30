/**
 * 「源码即诗」demo 的**生产可验证性**契约（三语：zh/de/hi）。
 *
 * /demos/poem 展示一首夜/月主题小诗，**诗句本身就是 Aster 代码**（无字符串字面量）：每行诗
 * 是一个真规则，运行 = 执行这些语句、产出计算值。每种语言钉死三条不变式，任一失败 = CI 硬失败：
 *   1. 诗体源码用诗词别名词典编译成功（无诊断错误）。
 *   2. 每一行（规则）代入 sample 跑出的值与预期计算一致（月光=星², 霜=月光−星, 思=霜+月光）。
 *   3. 诗体方言版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——证明别名只在表层
 *      （ADR 0022 别名 + ADR 0027 无括号 apply），「源码是诗」与「源码是程序」是同一个东西。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, ZH_CN, DE_DE, HI_IN } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, type PoemLocale } from '@/config/poem-demo';

const BASE: Record<PoemLocale, typeof ZH_CN> = { zh: ZH_CN, de: DE_DE, hi: HI_IN };
const LOCALES: PoemLocale[] = ['zh', 'de', 'hi'];

/** 期望计算：月光=n², 霜=月光−n, 思=霜+月光 = 2n²−n。代入 sample 求三行预期值。 */
function expectedValues(n: number): number[] {
  const moonlight = n * n;
  const shadow = moonlight - n;
  const longing = shadow + moonlight;
  return [moonlight, shadow, longing];
}

/** 剥离 origin/span（位置元数据；结构比较口径）。 */
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

describe('poem demo: each verse line IS code — no strings, every line computes', () => {
  for (const loc of LOCALES) {
    const poem = POEMS[loc];

    it(`${loc} (${poem.title}): 诗体源码编译成功（无诊断错误）`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
      expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    });

    it(`${loc} (${poem.title}): 每行诗（规则）代入 sample 跑出的计算值正确`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      expect(r.core).toBeTruthy();
      const expected = expectedValues(poem.sample);
      poem.lines.forEach((line, i) => {
        const ev = evaluate(r.core!, line.rule, { [poem.param]: poem.sample });
        expect(ev.success, `[${loc}] ${line.rule} eval: ${ev.error ?? ''}`).toBe(true);
        expect(Number(ev.value), `[${loc}] ${line.rule}`).toBe(expected[i]);
      });
    });

    it(`${loc} (${poem.title}): 别名不变式 — 诗体版 ≡ 规范关键词版（结构一致 Core IR）`, () => {
      const poemR = compile(poem.source, { lexicon: poem.lexicon });
      const canonR = compile(poem.canonical, { lexicon: BASE[loc] });
      const poemErrs = (poemR as { parseErrors?: unknown[] }).parseErrors ?? [];
      const canonErrs = (canonR as { parseErrors?: unknown[] }).parseErrors ?? [];
      expect(poemR.success && poemErrs.length === 0, `[${loc}] poem: ${JSON.stringify(poemErrs)}`).toBe(true);
      expect(canonR.success && canonErrs.length === 0, `[${loc}] canonical: ${JSON.stringify(canonErrs)}`).toBe(true);
      expect(stripOrigin(poemR.core)).toEqual(stripOrigin(canonR.core));
    });

    it(`${loc} (${poem.title}): 无字符串字面量（诗句是代码，不是数据）`, () => {
      // 源码里不应出现该词典的任何字符串起止符——诗句必须是表达式，不是字符串。
      // 取词典自身的引号集合（zh 用「」/ de·hi 用 "），词典换引号也不漏。
      const q = (poem.lexicon as { punctuation?: { stringQuotes?: { open?: string; close?: string } } })
        .punctuation?.stringQuotes;
      for (const mark of [q?.open, q?.close, '"', '「', '」'].filter(Boolean) as string[]) {
        expect(poem.source.includes(mark), `[${loc}] contains quote ${mark}`).toBe(false);
      }
    });
  }
});
