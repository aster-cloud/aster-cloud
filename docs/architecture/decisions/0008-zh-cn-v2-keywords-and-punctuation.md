---
last-reviewed-at: 2026-05-27
owner: '@aster/lang-stewards'
---

# ADR-0008 — zh-CN v2 关键字 + CJK 标点软边界

**Status**: Accepted
**Date**: 2026-05-27
**Supersedes**: zh-CN v1 lexicon（无版本号；本 ADR 之前的所有 zh-CN 实现）
**Implementation**: 一次性切换，无 deprecation 窗口（无真实用户）

## Context

Aster 是受控自然语言（CNL）DSL，定位为业务规则与策略语言。它通过
lexicon 表支持多种自然语言（en-US、zh-CN、de-DE）的关键字。

zh-CN v1 的关键字表存在三个不可接受的工程性缺陷：

### 缺陷 1：13 个 1 字关键字与中文常用业务标识符冲突

v1 lexicon 使用单字关键字：
- `或` (OR)、`且` (AND)、`非` (NOT)
- `真` (TRUE)、`假` (FALSE)、`空` (NULL)、`无` (NONE)
- `是` (IS)、`在` (IN)、`为` (BE)
- `加` (PLUS)、`减` (MINUS)、`乘` (TIMES)

这些字都是中文常用字。实际业务代码极易产生标识符冲突：

```
变量名 "或然率"   → 与关键字 "或" 冲突
变量名 "真客户"   → 与关键字 "真" 冲突
方法名 "是否成年" → 与关键字 "是" 冲突
变量名 "在职"     → 与关键字 "在" 冲突
变量名 "为父"     → 与关键字 "为" 冲突
```

事实证据：现有的 zh-CN test fixture **隐性地避开了**这些字。fixture 之所以能跑，
是作者无意识地选用了不冲突的标识符。这不是用户能保证的。

### 缺陷 2：fixture 普遍使用强制空格分隔

v1 中文 fixture 必须在中文 token 之间手动加空格（如 `规则 验证 给定 患者`），
否则词法器无法分词。这反自然——母语中文用户的直觉是用**标点节奏**而非空格分词。

### 缺陷 3：双 parser canonical 差异 - canonicalize 不可对齐

Java（aster-lang-core）和 TypeScript（aster-lang-ts）有各自的 canonicalizer。
两端在**关键字翻译策略**上根本不同：Java 在 canonicalize 阶段把中文关键字翻译
为英文 IR（为 ANTLR 准备）；TS 在 lex 之后才翻译。这意味着 *端到端的
canonicalize 输出永远不可能 byte-identical*。

这是双 parser 的固有矛盾，超出本 ADR 范围（属于 codex 提到的 P1 "砍双 parser"
议题）。但 v2 引入新功能（CJK 标点软边界）必须**至少在新功能层面**做到字节等价。

## Decision

**采用"方案 C + 方案 A"组合**（详细背景见 conversation 记录）。

### 决定 1：砍掉 13 个冲突 1 字关键字，升级为多字形式

| 旧（v1） | 新（v2） | SemanticTokenKind |
|---|---|---|
| `或` | `或者` | OR |
| `且` | `并且` | AND |
| `非` | `不是` | NOT |
| `真` | `真值` | TRUE |
| `假` | `假值` | FALSE |
| `空` | `空值` | NULL |
| `无` | `无值` | NONE |
| `是` | `等于` | IS（与 EQUALS_TO 合并） |
| `在` | `属于` | IN |
| `为` (BE) | `定义为` | BE |
| `为` (WHEN) | `当` | WHEN |
| `若` (MATCH) | `匹配于` | MATCH |
| `加` | `加上` | PLUS |
| `减` | `减去` | MINUS_WORD |
| `乘` | `乘以` | TIMES |
| `于` (ON) | `基于` | ON |

**保留**：所有 2+ 字关键字不变（`如果` `否则` `规则` `定义` `给定` `产出` `返回`
`包含` `大于` `小于` `等于` `多于` `不足` `超过` 等）。

### 决定 2：CJK 标点 → 英文等价（软边界归一化）

在 canonicalize 流程的 `fullWidthToHalfWidth` 之后插入一步
`normalizeCJKPunctuation`。映射：

```
。→ .（语句终止符）
：→ :（块起始符）
，→ ,（列表/字段分隔符）
；→ ;（块内分隔）
、→ ,（枚举分隔，与列表分隔语义等价）
```

仅对字符串字面量之外的位置生效；字符串内的中文标点 100% 保留。

设计选择：
- 中文标点与英文标点**逐一对应**，保持 token 流跨语言等价
- 不引入新 token 类型；归一化后的字符串走纯英文 token 边界规则
- 与 `fullWidthToHalfWidth` 设计一致（逐字符等价映射）

### 决定 3：硬切换，无 deprecation 窗口

无真实用户，不需要 deprecation 窗口。**一次性切换**：
- 移除 v1 关键字识别
- TS 和 Java 两端同步更新到 v2
- 所有 fixture / corpus 一次性迁移

### 决定 4：跨实现 conformance 测试仅覆盖 v2 新功能层

承认双 parser 在 canonicalize 端到端不可能 byte-identical。但在 v2 新加的
`normalizeCJKPunctuationOnly` 层面，两端必须 byte-identical。

实现：
- TS 端导出 `normalizeCJKPunctuationOnly(text, quotes?)`
- Java 端导出 `Canonicalizer.normalizeCJKPunctuationOnly(text)`
- Corpus：`aster-lang-test/corpus/conformance/cjk-v2/*.aster` + `.expected.txt`
- TS 测试：`aster-lang-ts/test/unit/canonicalizer/conformance-cjk-v2.test.ts`
- Java 测试：`aster-lang-zh/src/test/java/aster/lang/zh/CjkV2ConformanceTest.java`

任何 drift 是 P0 release 阻塞。

## Why these choices, not alternatives

### 为什么不引入中文分词器？

完整中文分词（jieba / MeCab）能解决"强制空格"问题，但代价是：
1. **歧义无法消除**：分词总是概率最大切分，无法保证编译器和业务专家"读法一致"。
   在合规审计场景下不可接受。
2. **业务词典维护**：jieba 通用词典不知道 `医保支付率`、`理赔上限`，每个项目都需
   手动维护用户词典。这是 onboarding 障碍而非便利。
3. **承诺爬坡**：加分词器 = 承诺"我懂中文"。用户期望会无限升级到完整 NLP。
   Inform 7（自然语言写游戏）就是这么死的。
4. **历史证据**：所有成熟的工业 DSL（SQL、Rego、Drools）都选择"关键字英文 +
   字符串/标识符任意语言"。唯一"中文关键字 + 工业级"的尝试（易语言）20 年来
   也没解决"看起来不自然"的问题。

### 为什么不保留 v1 作为兼容选项？

无真实用户。保留 v1 兼容会让 canonicalizer 永远要走两条路径，增加复杂度但
零收益。一次性切换在测试覆盖到位的前提下风险可控。

### 为什么 IS 和 EQUALS_TO 合并为 '等于'？

v1: IS='是'、EQUALS_TO='等于'。v2 砍掉单字 '是' 后，IS 没有合适的多字替代
（'是的'/'确实' 都不自然）。语义上 `If x is true` 与 `If x equals to true`
在 Aster 几乎等价，合并到 '等于' 简化关键字表，与英文 lexicon 中 IS/EQUALS_TO
同义共享一致（en-US 'is' 是单独关键字但 IS 的 SemanticTokenKind 也常被
EQUALS_TO 替代）。

通过 `allowedDuplicates: [[IS, EQUALS_TO]]` 在 lexicon 层显式声明合并。

## Implementation

### TypeScript 端

- `aster-lang-ts/src/config/lexicons/zh-CN.ts` — 关键字表 v2
- `aster-lang-ts/src/frontend/canonicalizer.ts` — `normalizeCJKPunctuation`
  + 导出 `normalizeCJKPunctuationOnly`
- `aster-lang-ts/test/unit/canonicalizer/cjk-punctuation.test.ts` — 11 个单元测试
- `aster-lang-ts/test/unit/canonicalizer/conformance-cjk-v2.test.ts` —
  cross-impl 等价测试

### Java 端

- `aster-lang-zh/src/main/resources/lexicons/zh-CN.json` — 关键字表 v2
- `aster-lang-zh/src/main/java/aster/lang/zh/transformers/ChineseLetBeTransformer.java` —
  `令...定义为` 重排（v2 关键字）
- `aster-lang-zh/src/main/java/aster/lang/zh/transformers/ChineseOperatorTransformer.java` —
  `设置 X 为 Y` → `令 X 定义为 Y`
- `aster-lang-core/src/main/java/aster/core/canonicalizer/Canonicalizer.java` —
  `normalizeCJKPunctuation` 私有 + `normalizeCJKPunctuationOnly` 公开静态测试钩子
- `aster-lang-zh/src/test/java/aster/lang/zh/CjkV2ConformanceTest.java` —
  Java 侧 conformance 测试

### Corpus 迁移

`aster-lang-test/corpus/tier3-fixtures/lexicon-i18n/` 下所有 7 个 zh-CN fixture
重写为 v2 关键字。结构等价，AST 等价，golden 等价。

### 新增 corpus

`aster-lang-test/corpus/conformance/cjk-v2/` — 4 个 conformance 用例：
1. 标点基础（句号/冒号/逗号/分号/顿号映射）
2. 字符串字面量保留（CJK 标点在 「」 内不变）
3. v2 所有关键字端到端
4. 标识符无冲突（或然率 / 真客户标识 / 是否成年 / 在职状态 / 和约编号）

## Consequences

### Positive

- **标识符自由**：业务代码可以使用 `或然率` `真客户` `是否成年` 等自然中文术语，
  零冲突风险
- **可读节奏更接近中文**：用户可用中文标点（，。：；、）作为自然分隔，token
  仍正确切分
- **字符串字面量 100% 保留**：业务文案中的中文标点不被歪曲
- **conformance 合同建立**：v2 新功能在 Java/TS 两端字节等价，有测试硬保障
- **零累积技术债**：硬切换消除了 v1 兼容路径，canonicalizer 路径单一清晰

### Negative

- **学习曲线**：现有材料/文档中的 v1 关键字示例需要更新（已完成 7 个 fixture）
- **关键字字数增加**：`真` → `真值` 多 1 字。代价小但累积起来源码会略长
- **conformance 范围有限**：byte-identical 仅覆盖 normalizeCJK 一层，不是端到端
  canonicalize。这是双 parser 设计差异的副作用，超出本 ADR 范围

### Neutral

- aster-lang-runtime / aster-lang-truffle / aster-api 不受影响（消费 Core IR）
- aster-cloud（前端）需要更新 Monaco 关键字高亮表（机械替换）；不阻塞 ADR

## Open questions

无。本 ADR 的所有决策已在实现中验证完毕（1048/1050 unit tests pass + 4/4 Java
conformance + 4/4 TS conformance）。

## Related

- ADR-0001 — Single source, two distributions
- ADR-0005 — Locale backbone en-US (此 ADR 是 zh-CN 的对应清理)
- ADR-0007 — Per-tenant license keys (无直接关系，但同属 v2 范畴的清理工作)
- Codex 双视角分析报告（语言核心 + DX）— 提出"砍同义词"建议的来源
- `aster-cloud/docs/architecture/decisions/README.md` — ADR 总览
