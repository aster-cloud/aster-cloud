/**
 * 「源码即诗」demo 的**生产可验证性**契约。
 *
 * /demos/poem 展示一段读起来就是诗的 `.aster` 源码，由生产同款 `@aster-cloud/aster-lang-ts/browser`
 * 引擎真编译、递归真执行。本测试钉死三条不变式，任一失败 = CI 硬失败（演示当场翻车）：
 *   1. 诗体源码用 NIGHTFALL 别名词典编译成功（无诊断错误）。
 *   2. 每个星数案例执行，吟诵结果与预期逐字一致（gather 递归）。
 *   3. 诗体方言版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——证明别名只在表层，
 *      「源码是诗」与「源码是程序」是同一个东西（ADR 0022 别名 + ADR 0027 无括号 apply）。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US } from '@aster-cloud/aster-lang-ts/browser';
import {
  NIGHTFALL_EN,
  NIGHTFALL_SOURCE,
  NIGHTFALL_CANONICAL,
  NIGHTFALL_ENTRY,
  NIGHTFALL_PARAM,
  NIGHTFALL_CASES,
  reciteLines,
} from '@/config/poem-demo';

/** 剥离 origin（源码位置元数据，因别名长度不同而偏移；结构比较口径）。 */
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

describe('poem demo: the source reads as verse, yet compiles and runs', () => {
  it('诗体源码用 NIGHTFALL 别名词典编译成功（无诊断错误）', () => {
    const r = compile(NIGHTFALL_SOURCE, { lexicon: NIGHTFALL_EN });
    const errs = ((r as { diagnostics?: { severity?: string }[] }).diagnostics ?? [])
      .filter((d) => d.severity === 'error');
    expect(r.core, `core; diags=${JSON.stringify(errs)}`).toBeTruthy();
    expect(errs.length, JSON.stringify(errs)).toBe(0);
  });

  it('递归执行：每个星数案例吟诵结果与预期逐字一致', () => {
    const r = compile(NIGHTFALL_SOURCE, { lexicon: NIGHTFALL_EN });
    expect(r.core).toBeTruthy();
    for (const c of NIGHTFALL_CASES) {
      const ev = evaluate(r.core!, NIGHTFALL_ENTRY, { [NIGHTFALL_PARAM]: c.stars });
      expect(ev.success, `stars=${c.stars} eval: ${ev.error ?? ''}`).toBe(true);
      expect(String(ev.value), `stars=${c.stars}`).toBe(c.expect);
    }
  });

  it('别名不变式：诗体方言版 ≡ 规范关键词版（结构一致 Core IR）', () => {
    const poem = compile(NIGHTFALL_SOURCE, { lexicon: NIGHTFALL_EN });
    const canon = compile(NIGHTFALL_CANONICAL, { lexicon: EN_US });
    expect(poem.core, 'poem compiles').toBeTruthy();
    expect(canon.core, 'canonical compiles').toBeTruthy();
    expect(stripOrigin(poem.core)).toEqual(stripOrigin(canon.core));
  });

  it('reciteLines：把吟诵结果切回 n 行（UI 展示用，与递归同源）', () => {
    const r = compile(NIGHTFALL_SOURCE, { lexicon: NIGHTFALL_EN });
    for (const c of NIGHTFALL_CASES) {
      const ev = evaluate(r.core!, NIGHTFALL_ENTRY, { [NIGHTFALL_PARAM]: c.stars });
      expect(reciteLines(String(ev.value)).length, `stars=${c.stars} lines`).toBe(c.stars);
    }
  });
});
