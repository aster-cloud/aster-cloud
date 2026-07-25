/**
 * 「流行歌曲即源码」demo 的**生产可验证性**契约,钉死不变式,任一失败 = CI 硬失败:
 *  1. 歌词体源码用周杰伦别名词典编译成功(无诊断错误)。
 *  2. 别名不变式:歌词体版 ≡ 规范关键词版(剥 origin 后结构一致 Core IR)——证明别名只在表层。
 *  3. 引擎真裁决:四种前提组合 evaluate 出四种不同风格,翻前提即变(非回声)。
 *  4. If 分支优先级与源码顺序一致(晴天 > 青花瓷 > 双截棍)。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, ZH_CN } from '@aster-cloud/aster-lang-ts/browser';
import { POP_SONG, type SketchStyle } from '@/config/pop-song-demo';

/** 剥离 origin/span(位置元数据;结构比较口径)。 */
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

function run(inputs: Record<string, boolean>): SketchStyle {
  const r = compile(POP_SONG.source, { lexicon: POP_SONG.lexicon });
  expect(r.core).toBeTruthy();
  const ev = evaluate(r.core!, POP_SONG.entry, inputs);
  return ev.value as SketchStyle;
}

describe('pop-song demo: 流行歌曲即源码(周杰伦歌名即前提)', () => {
  it('1. 歌词体源码编译成功(无诊断错误)', () => {
    const r = compile(POP_SONG.source, { lexicon: POP_SONG.lexicon });
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    expect(r.core, `core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
    expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    expect(r.success).toBe(true);
  });

  it('2. 别名不变式:歌词体版 ≡ 规范关键词版(结构一致 Core IR)', () => {
    const lyric = compile(POP_SONG.source, { lexicon: POP_SONG.lexicon });
    const canon = compile(POP_SONG.canonical, { lexicon: ZH_CN });
    const lyricErrs = (lyric as { parseErrors?: unknown[] }).parseErrors ?? [];
    const canonErrs = (canon as { parseErrors?: unknown[] }).parseErrors ?? [];
    expect(lyric.success && lyricErrs.length === 0, `lyric: ${JSON.stringify(lyricErrs)}`).toBe(true);
    expect(canon.success && canonErrs.length === 0, `canon: ${JSON.stringify(canonErrs)}`).toBe(true);
    expect(stripOrigin(lyric.core)).toEqual(stripOrigin(canon.core));
  });

  it('3. 引擎真裁决:四种前提 → 四种不同风格', () => {
    expect(run({ 晴天: true, 青花瓷: false, 双截棍: false })).toBe('sunny');
    expect(run({ 晴天: false, 青花瓷: true, 双截棍: false })).toBe('chinese');
    expect(run({ 晴天: false, 青花瓷: false, 双截棍: true })).toBe('kungfu');
    expect(run({ 晴天: false, 青花瓷: false, 双截棍: false })).toBe('default');
  });

  it('4. If 分支优先级与源码顺序一致(晴天 > 青花瓷 > 双截棍)', () => {
    // 同时为真时,取源码里最先命中的分支。
    expect(run({ 晴天: true, 青花瓷: true, 双截棍: true })).toBe('sunny');
    expect(run({ 晴天: false, 青花瓷: true, 双截棍: true })).toBe('chinese');
  });

  it('5. toggles 声明的 style 与引擎单命中裁决一致(配置不漂移)', () => {
    for (const tg of POP_SONG.toggles) {
      const inputs = Object.fromEntries(POP_SONG.toggles.map((t) => [t.name, t.name === tg.name]));
      expect(run(inputs), `${tg.name} 单命中应得 ${tg.style}`).toBe(tg.style);
    }
  });
});
