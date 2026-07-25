/**
 * 「流行歌曲即源码」demo(《以父之名》)的**生产可验证性**契约(alias-literal 范式),钉死不变式,
 * 任一失败 = CI 硬失败:
 *  1. 歌词体源码用《以父之名》别名词典 + 字面量宏词汇编译成功(无诊断错误)。
 *  2. 别名不变式:歌词体版 ≡ 规范关键词版(剥 origin 后结构一致 Core IR)——别名/宏只在表层。
 *  3. 字面量宏真实生效:歌词体源码含触发词「自负」但**不含**展开主题句,规范版**含**展开主题句,
 *     运行输出 = 宏展开内容。
 *  4. 入口规则运行恒输出主题句(宏展开,与入参无关;入口规则无参)。
 *  5. config.output 与引擎实际输出一致(配置不漂移)。
 */
import { describe, it, expect } from 'vitest';
import {
  compile,
  evaluate,
  ZH_CN,
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '@aster-cloud/aster-lang-ts/browser';
import { POP_SONG } from '@/config/pop-song-demo';

/** 按 demo content 同款方式编译:先注册字面量宏词汇,再带 domain 编译。 */
function compileLyric() {
  initBuiltinVocabularies();
  vocabularyRegistry.registerCustom(POP_SONG.vocab.id, POP_SONG.vocab);
  return compile(POP_SONG.source, {
    lexicon: POP_SONG.lexicon,
    domain: POP_SONG.vocab.id,
    tenantId: POP_SONG.vocab.id,
  });
}

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

describe('pop-song demo: 以父之名 · 歌词即源码(alias-literal 范式)', () => {
  it('1. 歌词体源码编译成功(无诊断错误)', () => {
    const r = compileLyric();
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    expect(r.core, `core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
    expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    expect(r.success).toBe(true);
  });

  it('2. 别名不变式:歌词体版 ≡ 规范关键词版(结构一致 Core IR)', () => {
    const lyric = compileLyric();
    const canon = compile(POP_SONG.canonical, { lexicon: ZH_CN });
    const lyricErrs = (lyric as { parseErrors?: unknown[] }).parseErrors ?? [];
    const canonErrs = (canon as { parseErrors?: unknown[] }).parseErrors ?? [];
    expect(lyric.success && lyricErrs.length === 0, `lyric: ${JSON.stringify(lyricErrs)}`).toBe(true);
    expect(canon.success && canonErrs.length === 0, `canon: ${JSON.stringify(canonErrs)}`).toBe(true);
    expect(stripOrigin(lyric.core)).toEqual(stripOrigin(canon.core));
  });

  it('3. 字面量宏真实生效:源码含触发词但不含展开内容,规范版含展开内容', () => {
    // 歌词体源码含触发词「自负」,但**不含**展开主题句。
    expect(POP_SONG.source).toContain(POP_SONG.macroTrigger);
    expect(POP_SONG.source).not.toContain(POP_SONG.output);
    // 规范版**含**展开主题句(宏在此已展开)。
    expect(POP_SONG.canonical).toContain(POP_SONG.output);
  });

  it('4. 入口规则运行输出主题句(宏展开,与入参无关)', () => {
    const r = compileLyric();
    expect(r.core).toBeTruthy();
    // 无参入口;传任意入参都应恒输出主题句(宏展开与入参无关)。
    for (const inp of [{}, { x: 1 }, { 自负: false }]) {
      const ev = evaluate(r.core!, POP_SONG.entry, inp);
      expect(ev.value, `入参 ${JSON.stringify(inp)}`).toBe(POP_SONG.output);
    }
  });

  it('5. config.output 与引擎实际输出一致(配置不漂移)', () => {
    const r = compileLyric();
    const ev = evaluate(r.core!, POP_SONG.entry, {});
    expect(ev.value).toBe(POP_SONG.output);
  });
});
