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

/** 把「拨动状态」布尔直接传给引擎（真布尔 decision，无字符串映射），跑 evaluate 拿裁决。 */
function runVerdict(core: NonNullable<ReturnType<typeof compile>['core']>, held: Record<string, boolean>): string {
  const inputs: Record<string, boolean> = {};
  for (const tk of GUYONG.tokens) {
    inputs[tk.name] = held[tk.name];
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

  it('3b. LayoutMap — toDisplay 逐字保留全部意象内容 span（按顺序、按次数）', () => {
    // 注：本 demo 是布尔 decision，display 为流动中文短句（会有自然空格，不同于静夜思的无空格诗），
    // 故不断言「无空格」；断言的核心是意象内容 span 逐段按序按次保留（防显示欺骗）。
    const display = toDisplay(GUYONG.layout);
    const contentPieces = GUYONG.layout
      .filter((s): s is { text: string } => 'text' in s)
      .map((s) => s.text);
    // 成员性：每段内容 span 都出现在 display 中。
    for (const piece of contentPieces) {
      expect(display.includes(piece), `display retains content '${piece}'`).toBe(true);
    }
    // 顺序 + 次数（Codex 审查改进 #1）：逐段从游标位置向后 indexOf，确保内容 span 按
    // layout 顺序、按出现次数逐一命中——防止某段被结构 span 悄悄吞掉或重排却仍通过成员性检查。
    let cursor = 0;
    for (const piece of contentPieces) {
      const at = display.indexOf(piece, cursor);
      expect(at, `content '${piece}' must appear in order at/after ${cursor}`).toBeGreaterThanOrEqual(cursor);
      cursor = at + piece.length;
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

  // 6. config 自洽断言（Codex 审查改进 #3）：把「拨失不翻转」类的隐性配置错误从「裁决错误」
  //    提前成明确的配置断言失败，定位更直接。
  it('6. config 自洽：token name 唯一 / derived.from 引用存在的 token', () => {
    const tokenNames = GUYONG.tokens.map((tk) => tk.name);
    // token name 唯一（重名会让 held 映射相互覆盖）。
    expect(new Set(tokenNames).size, `token names must be unique: ${JSON.stringify(tokenNames)}`).toBe(tokenNames.length);
    // derived.from 只能引用存在的 token 名（前端镜像复算引用不存在的输入会静默为 falsy）。
    const nameSet = new Set(tokenNames);
    for (const d of GUYONG.derived) {
      for (const from of d.from) {
        // derived 既可引用 token（守/进/记←光/步/路 的输入名），也可引用同为 token 名的推导域；
        // 这里只校验非 token 名的 from 至少是另一个 derived 名（不引用凭空的名字）。
        const derivedNames = new Set(GUYONG.derived.map((x) => x.name));
        expect(
          nameSet.has(from) || derivedNames.has(from),
          `derived '${d.name}' references unknown name '${from}'`,
        ).toBe(true);
      }
    }
    // 两裁决必须不同（否则 decision 范式无意义）。
    expect(GUYONG.verdictAll).not.toBe(GUYONG.verdictElse);
  });
});
