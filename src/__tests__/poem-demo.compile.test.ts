/**
 * 「源码即诗」demo 的**生产可验证性**契约（四语：en/zh/de/hi）。
 *
 * /demos/poem 有两种范式，每种都钉死不变式，任一失败 = CI 硬失败：
 *
 * **computed 范式**（en/de/hi）——一首连贯诗，每段**上半诗句、下半真计算**（Match 选景 +
 *   List.range/List.sum 真求和 + 无括号 apply 织段）。诗读连贯，但每个数、每次分支、每次
 *   求和都是引擎真求值：
 *   1. 诗体源码用诗词别名词典编译成功（无诊断错误）。
 *   2. 入口 rule 代入每个样本 input 跑出的整首诗逐字一致（计算交织的诗）。
 *   3. 诗体方言版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——证明别名只在表层。
 *   4. 诗句仍是代码：源码含 List 求和 + Match（zh 历史）或无括号递归调用（en）等真计算结构。
 *
 * **alias-literal 范式**（zh《静夜思》）——李白整首诗按**原词序**即源码：关键词别名把领字
 *   变结构关键词（床前→Module / 疑是→Rule / 举头→produce / 低头→Return），**字面量宏**
 *   （IdentifierKind.LITERAL）把末词展开成字符串字面量（思故乡→"静夜思"），运行输出诗名：
 *   1. 诗体源码（注入别名 + 字面量宏词汇表）编译成功（无诊断错误）。
 *   2. 入口 rule 每个样本 input 输出恒为诗名「静夜思」（宏展开，与入参无关）。
 *   3. 诗体版 ≡ 规范关键词版 Core IR——证明别名 + 字面量宏都只在 canonicalize 表层。
 *   4. 字面量宏真实生效：源码含被展开的领字（思故乡），且规范版含展开后的字符串字面量。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US, ZH_CN, DE_DE, HI_IN, vocabularyRegistry, initBuiltinVocabularies } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, type PoemLocale, type PoemConfig } from '@/config/poem-demo';

const BASE: Record<PoemLocale, typeof ZH_CN> = { en: EN_US, zh: ZH_CN, de: DE_DE, hi: HI_IN };
const LOCALES: PoemLocale[] = ['en', 'zh', 'de', 'hi'];

/** 按 demo content 同款方式编译一首诗：alias-literal 范式先注册字面量宏词汇表并传 domain。 */
function compilePoem(poem: PoemConfig) {
  if (poem.vocab) {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(poem.vocab.id, poem.vocab);
    return compile(poem.source, { lexicon: poem.lexicon, domain: poem.vocab.id, tenantId: poem.vocab.id });
  }
  return compile(poem.source, { lexicon: poem.lexicon });
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

describe('poem demo: a connected poem whose lines compute (Match + List + apply)', () => {
  for (const loc of LOCALES) {
    const poem = POEMS[loc];

    it(`${loc} (${poem.title}): 诗体源码编译成功（无诊断错误）`, () => {
      const r = compilePoem(poem);
      const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs.map((e) => e.message))}`).toBeTruthy();
      expect(errs.length, JSON.stringify(errs.map((e) => e.message))).toBe(0);
    });

    it(`${loc} (${poem.title}): 每个样本代入后的输出逐字一致`, () => {
      const r = compilePoem(poem);
      expect(r.core).toBeTruthy();
      for (const s of poem.samples) {
        const ev = evaluate(r.core!, poem.entry, { [poem.param]: s.input });
        expect(ev.success, `[${loc}] ${poem.entry}(${s.input}) eval: ${ev.error ?? ''}`).toBe(true);
        expect(String(ev.value), `[${loc}] ${poem.entry}(${s.input})`).toBe(s.woven);
      }
    });

    it(`${loc} (${poem.title}): 别名不变式 — 诗体版 ≡ 规范关键词版（结构一致 Core IR）`, () => {
      const poemR = compilePoem(poem);
      const canonR = compile(poem.canonical, { lexicon: BASE[loc] });
      const poemErrs = (poemR as { parseErrors?: unknown[] }).parseErrors ?? [];
      const canonErrs = (canonR as { parseErrors?: unknown[] }).parseErrors ?? [];
      expect(poemR.success && poemErrs.length === 0, `[${loc}] poem: ${JSON.stringify(poemErrs)}`).toBe(true);
      expect(canonR.success && canonErrs.length === 0, `[${loc}] canonical: ${JSON.stringify(canonErrs)}`).toBe(true);
      expect(stripOrigin(poemR.core)).toEqual(stripOrigin(canonR.core));
    });

    it(`${loc} (${poem.title}): 诗句仍是真代码（按范式验证计算/字面量宏）`, () => {
      if (poem.paradigm === 'alias-literal') {
        // 字面量宏范式：所有 input 输出恒为诗名（宏展开，与入参无关）。
        const wovens = new Set(poem.samples.map((s) => s.woven));
        expect(wovens.size, `[${loc}] literal-macro output is constant`).toBe(1);
        // vocab contract：compile 用 lexicon.id 作 locale 查词汇表 → vocab.id/locale 都须 = lexicon.id，
        // 否则 registry 静默查不到 index，直到中文 demo 编译失败才暴露（Codex 审查提示）。
        expect(poem.vocab, `[${loc}] alias-literal poem has a vocab`).toBeTruthy();
        expect(poem.vocab!.id, `[${loc}] vocab.id === lexicon.id`).toBe(poem.lexicon.id);
        expect(poem.vocab!.locale, `[${loc}] vocab.locale === lexicon.id`).toBe(poem.lexicon.id);
        // 字面量宏真实生效，且不是绕过宏手写字面量：
        const literal = poem.vocab?.literals?.[0];
        expect(literal, `[${loc}] has a literal-macro mapping`).toBeTruthy();
        // ① 源码含被展开的领字（触发词），且**不含**已包引号的目标内容（证明诗体源码没绕过宏直接写死）。
        expect(poem.source.includes(literal!.localized), `[${loc}] source contains localized trigger`).toBe(true);
        expect(poem.source.includes(literal!.canonical), `[${loc}] source must NOT hand-write the expanded literal (macro must produce it)`).toBe(false);
        // ② 规范版含展开后的字符串内容。
        expect(poem.canonical.includes(literal!.canonical), `[${loc}] canonical contains expanded literal`).toBe(true);
        // ③ 编译后运行结果即字面量内容——证明宏确实展开成了字符串字面量并被求值。
        const r = compilePoem(poem);
        expect(r.core, `[${loc}] compiles`).toBeTruthy();
        const ev = evaluate(r.core!, poem.entry, { [poem.param]: poem.samples[0].input });
        expect(ev.success && String(ev.value) === literal!.canonical, `[${loc}] macro expands to the literal content at runtime`).toBe(true);
      } else {
        // computed 范式：三个样本输出互不相同——结果随入参由计算决定，不是固定整首诗。
        const wovens = new Set(poem.samples.map((s) => s.woven));
        expect(wovens.size, `[${loc}] distinct woven per input`).toBe(poem.samples.length);
        // 源码含真计算结构：List 求和（计算驱动选句）或无括号递归调用（en Nightfall 逐句聚拢）。
        const hasListSum = poem.source.includes('List.range') && poem.source.includes('List.sum');
        const aliasApply = (poem.lexicon as { aliases?: Record<string, string[]> }).aliases?.['APPLY']?.[0] ?? '';
        const hasRecursiveCall = aliasApply.length > 0 && poem.source.includes(aliasApply);
        expect(hasListSum || hasRecursiveCall, `[${loc}] has List sum or paren-free recursive call`).toBe(true);
      }
    });
  }
});
