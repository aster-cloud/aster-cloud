// 防回归：所有内置策略样例（en-US / zh-CN / de-DE）必须编译零错误。
//
// 历史 bug：zh-CN loan 等样例用了单字布尔字面量 `真`/`假`，而 CNL zh-CN 的
// Bool 字面量是 `真值`/`假值`（2 字，故意避免与业务标识符冲突）。typechecker
// 把 `真`/`假` 当未定义变量 → Monaco editor 显示「Undefined variable: 真/假」
// 编译错误（用户反馈：内置模版样例编译有错）。
//
// 本测试遍历每个样例 × 每个 locale，断言 parseErrors / typeErrors 均为空。

import { describe, it, expect } from 'vitest';
import { compileAndTypecheck, EN_US, ZH_CN, DE_DE } from '@aster-cloud/aster-lang-ts/browser';
import { POLICY_EXAMPLES, type SupportedLocale } from '@/data/policy-examples';

const LEXICONS: Record<SupportedLocale, unknown> = {
  'en-US': EN_US,
  'zh-CN': ZH_CN,
  'de-DE': DE_DE,
};

// 全部内置样例（en-US / zh-CN / de-DE）现已编译零错误，无 known-failing。
// 历史失败已根治：
// - zh 样例错误关键词（令...为→定义为、非→不是、单字 乘/加→乘以/加上）
// - healthcare 三语 price/patientCost 数字字段缺/错类型（统一 Float）
// - creditcard 三语 typechecker 函数返回类型推断局限（算术/字段访问返回 Unknown），
//   已在 aster-lang-ts 0.2.2 修复（inferStaticType 支持算术 Call + dotted Name）。
const KNOWN_FAILING = new Set<string>();

describe('内置策略样例编译验证（防 Undefined variable / 语法错误）', () => {
  for (const example of POLICY_EXAMPLES) {
    for (const locale of Object.keys(example.sources) as SupportedLocale[]) {
      if (KNOWN_FAILING.has(`${example.id}:${locale}`)) {
        it.todo(`${example.id} [${locale}] 编译零错误（known failing — 见样例治理 issue）`);
        continue;
      }
      it(`${example.id} [${locale}] 编译零错误`, () => {
        const src = example.sources[locale];
        expect(src, `${example.id} 缺少 ${locale} 源`).toBeTruthy();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = compileAndTypecheck(src, { lexicon: LEXICONS[locale] as any });

        const parseErrors = (r.parseErrors ?? []).map((e) =>
          typeof e === 'object' && e !== null && 'message' in e
            ? (e as { message: string }).message
            : String(e)
        );
        const typeErrors = (r.typeErrors ?? []).map((e) => e.message);

        expect(parseErrors, `${example.id} [${locale}] parseErrors`).toEqual([]);
        expect(typeErrors, `${example.id} [${locale}] typeErrors`).toEqual([]);
      });
    }
  }
});
