/**
 * 「原创歌词即源码」demo（《孤勇》原创词）的**生产可验证性**契约（decision + LayoutMap 范式），
 * 钉死不变式，任一失败 = CI 硬失败：
 *  1. 歌词体源码用《孤勇》别名词典编译成功（无诊断错误）。
 *  2. 别名不变式：歌词体版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——别名只在 canonicalize 表层。
 *  3. LayoutMap 不变式：toCanonical(layout) 逐字 === source（编译零漂移）；toDisplay 无关键词空格且
 *     逐字保留全部内容 span；verifyContentParity 通过。
 *  4. 裁决真推导：三信物全匹配 → verdictAll「归途」；翻任一 → verdictElse「坠落」（引擎真判定，
 *     翻转随信物，非查表）。且两裁决确实不同。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, ZH_CN } from '@aster-cloud/aster-lang-ts/browser';
import { GUYONG } from '@/config/guyong-demo';
import { toCanonical, toDisplay, verifyContentParity } from '@/lib/layout-map';

/** 按 demo content 同款方式编译：走 LayoutMap 的 toCanonical（= source）。 */
function compileLyric() {
  return compile(toCanonical(GUYONG.layout), { lexicon: GUYONG.lexicon });
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

/** 把「拨动状态」映射成引擎入参（真→matchValue，假→missValue），跑 evaluate 拿裁决。 */
function runVerdict(core: NonNullable<ReturnType<typeof compile>['core']>, held: Record<string, boolean>): string {
  const inputs: Record<string, string> = {};
  for (const tk of GUYONG.tokens) {
    inputs[tk.name] = held[tk.name] ? tk.matchValue : tk.missValue;
  }
  const ev = evaluate(core, GUYONG.entry, inputs);
  return ev.success ? String(ev.value) : 'ERR:' + (ev.error ?? '');
}

describe('guyong demo: 孤勇 · 原创歌词即源码（decision + LayoutMap 范式）', () => {
  it('1. 歌词体源码编译成功（无诊断错误）', () => {
    const r = compileLyric();
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    expect(r.core, `core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
    expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    expect(r.success).toBe(true);
  });

  it('2. 别名不变式：歌词体版 ≡ 规范关键词版（结构一致 Core IR）', () => {
    const lyric = compileLyric();
    const canon = compile(GUYONG.canonical, { lexicon: ZH_CN });
    const lyricErrs = (lyric as { parseErrors?: unknown[] }).parseErrors ?? [];
    const canonErrs = (canon as { parseErrors?: unknown[] }).parseErrors ?? [];
    expect(lyric.success && lyricErrs.length === 0, `lyric: ${JSON.stringify(lyricErrs)}`).toBe(true);
    expect(canon.success && canonErrs.length === 0, `canon: ${JSON.stringify(canonErrs)}`).toBe(true);
    expect(stripOrigin(lyric.core)).toEqual(stripOrigin(canon.core));
  });

  it('3a. LayoutMap — toCanonical(layout) 逐字 === source（编译零漂移）', () => {
    expect(toCanonical(GUYONG.layout)).toBe(GUYONG.source);
  });

  it('3b. LayoutMap — toDisplay 隐去关键词间空格且逐字保留全部内容', () => {
    const display = toDisplay(GUYONG.layout);
    expect(display.includes(' '), 'display must have no keyword-space').toBe(false);
    const contentPieces = GUYONG.layout
      .filter((s): s is { text: string } => 'text' in s)
      .map((s) => s.text);
    for (const piece of contentPieces) {
      expect(display.includes(piece), `display retains content '${piece}'`).toBe(true);
    }
  });

  it('3c. LayoutMap — verifyContentParity 通过（结构 span 未偷塞字面量）', () => {
    const v = verifyContentParity(GUYONG.layout);
    expect(v.ok, v.reason ?? '').toBe(true);
  });

  it('4. 裁决真推导：三信物全匹配 → 归途；翻任一 → 坠落（引擎真判定）', () => {
    const r = compileLyric();
    expect(r.core).toBeTruthy();
    const allHeld = Object.fromEntries(GUYONG.tokens.map((tk) => [tk.name, true]));
    expect(runVerdict(r.core!, allHeld), 'all held → verdictAll').toBe(GUYONG.verdictAll);
    // 逐个拨失某信物，其余为真——每种都应翻成 verdictElse。
    for (const flip of GUYONG.tokens) {
      const held = { ...allHeld, [flip.name]: false };
      expect(runVerdict(r.core!, held), `flip '${flip.name}' → verdictElse`).toBe(GUYONG.verdictElse);
    }
    // 且两裁决确实不同（否则「翻转」无意义）。
    expect(GUYONG.verdictAll).not.toBe(GUYONG.verdictElse);
  });

  it('5. config.verdict 与引擎实际输出一致（配置不漂移）', () => {
    const r = compileLyric();
    const allHeld = Object.fromEntries(GUYONG.tokens.map((tk) => [tk.name, true]));
    expect(runVerdict(r.core!, allHeld)).toBe(GUYONG.verdictAll);
    const oneOff = { ...allHeld, [GUYONG.tokens[0]!.name]: false };
    expect(runVerdict(r.core!, oneOff)).toBe(GUYONG.verdictElse);
  });
});
