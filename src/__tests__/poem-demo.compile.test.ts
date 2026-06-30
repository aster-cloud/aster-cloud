/**
 * 「源码即诗」demo 的**生产可验证性**契约（三语：zh/de/hi）。
 *
 * /demos/poem 展示一首连贯的望月诗：每段诗**上半是诗句、下半是真计算**（Match 选景 +
 * List.range/List.sum 真求和 + 无括号 apply 织段）。诗读下来连贯，但每个数、每次分支、
 * 每次求和都是引擎真求值。每种语言钉死四条不变式，任一失败 = CI 硬失败：
 *   1. 诗体源码用诗词别名词典编译成功（无诊断错误）。
 *   2. 入口 rule 代入每个样本 input 跑出的整首诗与预期逐字一致（计算交织的诗）。
 *   3. 诗体方言版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——证明别名只在表层
 *      （ADR 0022 别名 + ADR 0027 无括号 apply）。
 *   4. 诗句仍是代码：源码里有 List 求和 + Match 等真计算结构（不是纯字符串表）。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, ZH_CN, DE_DE, HI_IN } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, type PoemLocale } from '@/config/poem-demo';

const BASE: Record<PoemLocale, typeof ZH_CN> = { zh: ZH_CN, de: DE_DE, hi: HI_IN };
const LOCALES: PoemLocale[] = ['zh', 'de', 'hi'];

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

describe('poem demo: a connected poem whose lines compute (Match + List + apply)', () => {
  for (const loc of LOCALES) {
    const poem = POEMS[loc];

    it(`${loc} (${poem.title}): 诗体源码编译成功（无诊断错误）`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
      expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    });

    it(`${loc} (${poem.title}): 每个样本代入后织出的整首诗逐字一致（计算驱动）`, () => {
      const r = compile(poem.source, { lexicon: poem.lexicon });
      expect(r.core).toBeTruthy();
      for (const s of poem.samples) {
        const ev = evaluate(r.core!, poem.entry, { [poem.param]: s.input });
        expect(ev.success, `[${loc}] ${poem.entry}(${s.input}) eval: ${ev.error ?? ''}`).toBe(true);
        expect(String(ev.value), `[${loc}] ${poem.entry}(${s.input})`).toBe(s.woven);
      }
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

    it(`${loc} (${poem.title}): 诗句仍是代码（含 List 求和等真计算，非纯字符串表）`, () => {
      // 源码必须含真计算结构：List.range + List.sum（不是只有 Match 的字符串查表）。
      expect(poem.source.includes('List.range'), `[${loc}] has List.range`).toBe(true);
      expect(poem.source.includes('List.sum'), `[${loc}] has List.sum`).toBe(true);
    });
  }
});
