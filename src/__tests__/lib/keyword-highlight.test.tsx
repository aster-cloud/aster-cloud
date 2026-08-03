// 四语关键词高亮回归测试。
//
// 背景（本次修复的三个真 bug）：
//   ① 多词关键词永不高亮 —— Monarch 首个匹配即用，标识符规则排在多词规则**之前**，
//      "for each" 被单词 "for" 吃掉后落 identifier，后面的 /for each/ 永远轮不到。
//   ② 印地语 100% 不高亮 —— 标识符正则只含 [a-zA-Z_\u4e00-\u9fa5]，天城文
//      (\u0900-\u097f) 根本匹配不上，连 cases 都进不去。
//   ③ 12 个关键词从未进分类表（含 integer divided by / io / cpu / option of…），
//      cases 查不到 → 落 identifier。
//
// ★用 Monaco **真实** Monarch 编译器（compile()）+ 它自己的 action.test()，
//   不复刻匹配逻辑——复刻两次都给出过错误结论（第一版读错 action.cases、
//   第二版读错 action.token），只有真编译器才可信。
import { describe, it, expect } from 'vitest';
import { getKeywordsByCategory, getLexicon, buildMultiWordRules } from '@/lib/aster-lexicon';
// monaco 在本仓是 serverExternalPackages，vite 解析不了深层子路径，
// 故用 createRequire 取绝对路径后动态 import（保持用**真实** Monarch 编译器）。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
const req = createRequire(import.meta.url);
// ★不能 resolve('monaco-editor/package.json')：monaco 的 exports 映射不暴露它。
//   改从允许的入口反推包根（pnpm 下路径含 .pnpm/<pkg>@<ver>，不可硬编码）。
let MONACO_ROOT = dirname(req.resolve('monaco-editor'));
while (MONACO_ROOT !== '/' && !existsSync(join(MONACO_ROOT, 'package.json'))) {
  MONACO_ROOT = dirname(MONACO_ROOT);
}
const MONARCH = join(MONACO_ROOT, 'esm/vs/editor/standalone/common/monarch');
const { compile } = await import(/* @vite-ignore */ MONARCH + '/monarchCompile.js');

function buildConfig(locale: string) {
  const k = getKeywordsByCategory(getLexicon(locale));
  return {
    moduleKeywords: k.module, typeKeywords: k.type, functionKeywords: k.function,
    controlKeywords: k.control, variableKeywords: k.variable, booleanKeywords: k.boolean,
    operatorKeywords: k.operator, literalKeywords: k.literal,
    primitiveTypeKeywords: k.primitiveType, workflowKeywords: k.workflow,
    asyncKeywords: k.async, constraintKeywords: k.constraint,
    effectKeywords: k.effect, domainTerms: [] as string[],
    tokenizer: { root: [
      [/\/\/.*$/, 'comment'], [/#.*$/, 'comment'],
      [/"/, 'string', '@string_double'], [/'/, 'string', '@string_single'],
      [/\d+/, 'number'],
      ...buildMultiWordRules(getLexicon(locale)),
      [/[a-zA-Z_一-龥ऀ-ॿ][\w一-龥ऀ-ॿ]*/, { cases: {
        '@moduleKeywords':'keyword.module','@typeKeywords':'keyword.type',
        '@functionKeywords':'keyword.function','@controlKeywords':'keyword.control',
        '@variableKeywords':'keyword.variable','@booleanKeywords':'keyword.boolean',
        '@operatorKeywords':'keyword.operator','@literalKeywords':'constant.language',
        '@primitiveTypeKeywords':'type','@workflowKeywords':'keyword.workflow',
        '@asyncKeywords':'keyword.async','@constraintKeywords':'keyword.constraint','@effectKeywords':'keyword.effect',
        '@domainTerms':'variable.domain','@default':'identifier' } }],
      [/[+\-*/<>=!]+/, 'operator'], [/[{}()\[\]]/, 'delimiter.bracket'],
      [/[;,.:：。，、]/, 'delimiter'], [/\s+/, 'white'],
    ],
    string_double: [[/[^\\"]+/, 'string'], [/"/, 'string', '@pop']],
    string_single: [[/[^\\']+/, 'string'], [/'/, 'string', '@pop']] },
  } as MonarchConfig;
}

/** Monarch 配置/编译产物的最小结构类型（monaco 未导出这些内部类型）。 */
type MonarchConfig = Record<string, unknown>;
interface CompiledRule {
  regex: RegExp;
  action?: string | { token?: string; test?: (id: string, m: RegExpExecArray, state: string, eos: boolean) => string };
}

function tokenTypes(locale: string, text: string): Array<[string,string]> {
  const rules = compile('t-'+locale, buildConfig(locale)).tokenizer.root;
  const out: Array<[string,string]> = [];
  let pos = 0, guard = 0;
  while (pos < text.length && guard++ < 500) {
    let hit = false;
    for (const r of rules as CompiledRule[]) {
      const re = new RegExp(r.regex.source, r.regex.flags.replace('g',''));
      const m = re.exec(text.slice(pos));
      if (!m || m.index !== 0 || !m[0].length) continue;
      const a = r.action;
      // action 可能是：字符串（简单规则）/ 带 test() 的 cases / 带 token 的对象。
      // ★第一版只读 a?.token，导致多词规则（action 是纯字符串）全部得到空 token，
      //   看起来像「规则没生效」——实为测试读错字段。
      const type =
        typeof a === 'string' ? a
        : typeof a?.test === 'function' ? a.test(m[0], m, 'root', false)
        : (a?.token ?? '');
      out.push([String(type), m[0]]); pos += m[0].length; hit = true; break;
    }
    if (!hit) { out.push(['none', text[pos]]); pos += 1; }
  }
  return out;
}

const ok = (locale: string, w: string) =>
  tokenTypes(locale, w).every(([t, f]) => !f.trim() || /keyword|type|constant/.test(t));

describe('四语关键词高亮（修复后）', () => {
  for (const loc of ['en-US','zh-CN','de-DE','hi-IN']) {
    it(loc, () => {
      const k = getKeywordsByCategory(getLexicon(loc)) as Record<string, (string|undefined)[]>;
      const all = [...new Set(Object.values(k).flat().filter((x): x is string => !!x))];
      const bad = all.filter((w) => !ok(loc, w));
      console.log(`  [${loc}] 关键词 ${all.length} → 未高亮 ${bad.length}` +
        (bad.length ? `：${bad.map((s)=>JSON.stringify(s)).join(', ')}` : ' ✅ 全部高亮'));
      expect(bad).toEqual([]);
    });
  }
  it('长词优先：integer divided by 不被 divided by 抢先', () => {
    const t = tokenTypes('en-US', 'integer divided by');
    console.log('  整体 token:', JSON.stringify(t));
    expect(t.length).toBe(1);
  });
});
