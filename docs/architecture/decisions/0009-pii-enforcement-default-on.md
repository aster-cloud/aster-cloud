---
last-reviewed-at: 2026-05-27
owner: '@aster/security-stewards @aster/lang-stewards'
---

# ADR-0009 — PII enforcement 默认启用（跨运行时一致）

**Status**: Accepted
**Date**: 2026-05-27
**Supersedes**: 渐进式启用 PII 检查策略（无版本号；本 ADR 之前的所有 PII 检查行为）
**Implementation**: 一次性切换，无 deprecation 窗口（无真实生产 PII 客户依赖）
**Plan reference**: P0-1 in the comprehensive Aster Lang improvement plan
（综合自 codex backend + frontend analysis 和 Claude 独立 PL 视角）

## Context

Aster Lang 把 PII（Personally Identifiable Information）作为**类型系统一等
公民**——`PiiType<level, category, baseType>` 内置于 Core IR，可以在
类型签名上标记字段为 `PiiType<'L3', 'identity', Text>`，然后通过 flow 分析
检测违规的 sink（HTTP、log、emit）和 downgrade（L3 → L1 赋值）。

这是 Aster 相对 OPA Rego / Cedar / Drools 的**核心差异化护城河**。

### 问题诊断

在 ADR-0009 之前，PII 检查是**opt-in**的：
- `aster-lang-ts/src/typecheck/utils.ts:103` — `shouldEnforcePii()` 依赖
  `globalThis.lspConfig.enforcePiiChecks` 或 `process.env.ENFORCE_PII`
- `aster-lang-ts/src/typecheck/browser.ts:184` — 浏览器路径**完全不实现**
  PII 检查，传 `enforcePii: true` 只发"unsupported"警告

这意味着 Aster 的核心差异化承诺**在生产部署形态下被静默禁用**：

| 部署形态 | PII 检查状态 | 用户体验 |
|---|---|---|
| Node CLI + ENFORCE_PII=true | ✅ 启用 | 与承诺一致 |
| LSP IDE（默认） | ❌ 禁用（除非显式启用） | 同一策略在 IDE 看不到 PII 诊断 |
| Browser Monaco editor | ❌ **完全禁用** | 用户写策略时看不到 PII 违规 |
| Cloudflare Workers (SaaS) | ❌ **完全禁用**（无 process.env） | 生产环境跑的策略没经 PII 检查 |

更糟糕的是，**同一策略在不同运行时报告不同的安全结论**：开发者在 CLI 测试
PII 通过，CI 上 ENFORCE_PII 没设也通过，部署到 Workers 也通过——但实际**没人
跑过 PII 检查**。Aster 的核心卖点变成营销话术。

### 根因分析

`typecheck-pii.ts`（PII flow 分析器本体）**本身环境无关**——它不读
`process.env` 或 `fs`，可以在任何 runtime 跑。可禁用性是历史包袱：早期为了
"避免破坏现有项目"而设的渐进式 opt-in 策略，已不再适用：
- 本质上是把"安全检查"做成可选 → 等同于"安全是 nice-to-have"
- 跨运行时的 drift 是结构性漏洞
- 没有真实生产客户依赖这个 opt-out 行为（核查过）

## Decision

**PII flow 分析永远启用，跨所有运行时一致。**

### 决定 1：删除所有 opt-in 配置

- `shouldEnforcePii()` 退化为 backwards-compat stub，总是返回 `true`
  （deprecated，下一个 major 移除）
- `module.ts` 移除 `if (shouldEnforcePii())` gate，PII 检查无条件运行
- `browser.ts` 删除 "unsupported in browser" 警告路径
- `BrowserTypecheckOptions.enforcePii` 字段保留但标记 `@deprecated`，无效
- `globalThis.lspConfig.enforcePiiChecks` 不再被读

### 决定 2：跨运行时 conformance 测试硬保障

新增 `aster-lang-ts/test/unit/typecheck/pii-cross-runtime-conformance.test.ts`：

- 对相同 Core IR 模块同时跑 `typecheckModule`（Node 路径）和
  `typecheckBrowser`（browser 路径）
- 断言两者返回的 PII 诊断**等价**：相同 codes + 相同 severities + 相同 count
- 覆盖 6 个场景：HTTPS L3 sink / HTTP L2 sink / L3→L1 降级赋值 /
  参数违规 / 无 PII baseline / 空模块
- 元测试保护 `PII_CODES` 集合的完整性（10 个 PII-related codes 全覆盖）

**"等价"的精确含义（P0-R 修订）**：诊断**消息字符串**可以因 locale 不同
而异，但**code + severity + count** 必须一致。这不是 byte-identical 字符串
比较——后者跨实现的等价是 P1 单 parser 真源议题，不在本 ADR 范围。

### 决定 3：Java 端 PII gate 同步移除（P0-R Critical 修复）

ADR-0009 原版漏了 Java 端的镜像问题。codex review 抓到后 P0-R 同步修复：

- `aster-lang-core/src/main/java/aster/core/typecheck/TypeChecker.java` —
  删除 `if (shouldEnforcePii())` gate；`shouldEnforcePii()` 改为 always-true
  stub（`@Deprecated(forRemoval = true)`）
- `aster-api/src/main/java/io/aster/policy/config/PIIConfig.java` —
  默认值从 `false` 改为 `true`，与 production properties 对齐；澄清注释：
  **运行时 PII 保护**（response 脱敏、日志脱敏）与编译时 PII flow 分析
  是两个独立关注点
- `aster-api/src/main/resources/application.properties` — 删除虚假对齐
  "与 ENFORCE_PII 保持一致" 的注释
- 新增 `aster-lang-core/src/test/java/aster/core/typecheck/PiiAlwaysOnConformanceTest.java`
  —— Java 端 PII always-on 合同测试

### 决定 4：分两层

- **编译时类型层 PII 检查**（PiiType 类型标记 + flow 分析）：永远启用，
  跨运行时 byte-identical
- **运行时 PII 保护**（aster-api response 脱敏 + 日志脱敏 + audit
  redaction）：仍可配置（`aster.pii.enforce=false`），默认启用。运行时
  保护有性能/可观察性 trade-off，某些环境（如纯内部 API、调试环境）
  可能合法选择禁用。
- **合规 policy pack**（HIPAA / GDPR / CCPA 具体规则集）：仍 opt-in，
  通过单独机制配置（不在本 ADR 范围；预计 ADR-0016+）

## Why not deprecation window?

需要明确区分**两个独立的 PII 关注点**——本节单独评估两者的 opt-out 依赖：

### 编译时 PII 类型检查（本 ADR 主要范围）

仓库内扫描（2026-05-27 P0-R2 重新验证；命令：
`grep -rn "ENFORCE_PII\|ASTER_ENFORCE_PII\|enforcePiiChecks\|enforcePii:\s*false"
/Users/rpang/IdeaProjects/aster-*`）：

| 入口 | 扫描范围 | 命中数 | 命中位置 |
|---|---|---|---|
| `ENFORCE_PII=false` env | aster-cloud + aster-api + aster-lang-* + aster-deploy | **0** | — |
| `ASTER_ENFORCE_PII=false` env | 同上 | **0** | — |
| `--no-enforce-pii` LSP flag | 所有 launch config / .vscode / IDE settings | **0** | — |
| `enforcePii: false` JS API 调用 | aster-cloud + aster-api + aster-lang-* | **0**（除 fixture/test） | — |
| `globalThis.lspConfig.enforcePiiChecks=false` | 所有仓库 | **0** | — |

**结论（编译时）**：硬切换零生产风险。

### 运行时 PII 保护（aster-api PIIConfig，独立关注点）

这是**与本 ADR 编译时检查不同的层**，但 codex review 抓出 ADR 原版扫描表
没区分。P0-R2 重新扫描：

| 入口 | 命中位置 | 影响 |
|---|---|---|
| `ASTER_PII_ENFORCE=false` env | `aster-deploy/.env.example:59` (注释行)；`aster-deploy/compose/podman-compose.test.yml:15` (测试 compose)；`aster-deploy/docs/local-debug.md:80` (本地调试文档) | 仅测试/调试用途；生产 properties (`src/main/resources/application.properties:74`) 默认 `${ASTER_PII_ENFORCE:true}` |
| `aster.pii.enforce=false` properties | `aster-api/src/test/resources/application.properties:55`；`aster-api/src/test/resources/application-prisma.properties:37` | 仅测试 |

**结论（运行时）**：生产环境不依赖 opt-out。本 ADR 把 PIIConfig default
从 `false` 改为 `true` 仅修正了"properties 未设时回退到不安全默认值"这个
独立 bug——不影响实际生产部署（生产 properties 已显式 `:true`）。

硬切换比保留兼容路径更安全：opt-out 路径长期存在反而会重新引入 drift。
保留为 stub + `@deprecated` 标记一个 major 周期足够给外部依赖时间响应。

## Implementation

### TypeScript 端

- `aster-lang-ts/src/typecheck/utils.ts` — `shouldEnforcePii()` 改为
  no-op stub，always returns `true`
- `aster-lang-ts/src/typecheck/module.ts:115` — 删除 `if (shouldEnforcePii())`
  gate；PII 检查无条件运行
- `aster-lang-ts/src/typecheck/browser.ts` — 模块注释更新；删除 "unsupported
  in browser" 路径；调用 `checkModulePII` 替代
- `aster-lang-ts/src/typecheck-pii.ts` — **无改动**（本来就环境无关）

### 测试（P0-R 修订后实际覆盖）

- `aster-lang-ts/test/unit/typecheck/pii-cross-runtime-conformance.test.ts`
  — 7 个用例：HTTPS L3 sink / HTTP L2 sink / L3→L1 降级赋值 / 参数违规 /
  无 PII baseline / 空模块 / PII_CODES 集合元测试。断言完整 diagnostic
  shape（code + severity）等价
- `aster-lang-ts/test/type-checker/pii-propagation.test.ts` — 两个测试翻转
  ("默认禁用 → 默认启用"）
- `aster-lang-ts/test/unit/browser/typecheck-browser-unsupported.test.ts` —
  两个测试翻转（"browser 警告 unsupported → browser 永远跑 PII"）
- `aster-lang-ts/test/unit/typecheck/should-enforce-pii.test.ts` — 完整重写，
  验证 stub 在所有配置下都返回 true
- `aster-lang-ts/test/unit/browser/typecheck-browser-pii-failure.test.ts` —
  新增（P0-R）：验证 PII_ANALYZER_FAILED 错误码 + severity=error 合同
- `aster-cloud/src/__tests__/app/execute-policy-content.integration.test.tsx`
  — 新增（P0-R）：集成回归测试，验证 ExecutePolicyContent 把 fetch 到的
  policy source 正确传给 DecisionTracePanel
- `aster-lang-core/src/test/java/aster/core/typecheck/PiiAlwaysOnConformanceTest.java`
  — 新增（P0-R）：Java 端 PII always-on 合同（无 env 时 TypeChecker 仍报
  PII 诊断）

## Consequences

### Positive

- **核心差异化承诺成立**：PII 检查在所有运行时一致生效——Aster vs
  Rego/Cedar 的护城河变硬
- **跨 runtime 等价**：同一策略 → 同一 PII 诊断；CI / IDE / Workers 不会
  drift
- **代码路径简化**：删除一整套配置注入机制（env / globalThis / option）
- **新增防御层**：browser conformance test 防止未来回归

### Negative

- **可能的诊断噪声**：原先依赖 opt-out 静默 PII 诊断的项目会突然看到 PII
  warning/error。Mitigation：核查显示无真实依赖（仅 fixture 测试代码）
- **`enforcePii` 选项保留但无效**：API 表面有 cosmetic dead code（标记
  `@deprecated`，下个 major 移除）
- **合规 policy pack 仍 opt-in**：保留可配置性的同时承担"双层"复杂度——
  本 ADR 接受这个取舍

### Neutral

- aster-lang-runtime / aster-lang-truffle 不受影响（Core IR 类型不变）
- aster-cloud Monaco editor 现在会显示 PII 诊断——这正是产品价值的体现

## P0-R Review Findings (codex independent reviews)

### Round 1 (2026-05-27)

ADR 原版（pre-P0-R）有几处粉饰和遗漏，已在本修订修正：

| Finding | 原版问题 | 修订 |
|---|---|---|
| Critical: Java 端 PII gate | 写 "aster-api 不受影响"，实际 aster-lang-core TypeChecker.shouldEnforcePii() 仍读 env | 决定 3 加入 Java 端同步修复 + PiiConfig 默认值修正 |
| High #1: 集成回归测试 | 原 P0-2 测试只测组件，bug 在 caller | 新增 ExecutePolicyContent 集成测试 |
| High #2: conformance 范围 | PII_CODES 集合只有 3 个，漏 W071/W074/E400 等 | 扩展到 10 个 codes |
| High #3: 测试覆盖说明 | 写 "降级赋值" 实际未实现 | 实现 4 个新场景；本节准确反映 |
| High #4: 跨仓库 grep | "aster-api 不受影响" 未经验证 | 决定 4 + "Why not deprecation window?" 加入实际扫描结果 |
| Medium: ADR 证据 | "no real users" 无来源 | "Why not deprecation window?" 加入实际仓库扫描表 |

### Round 2 (P0-R2, 2026-05-27)

第二轮 codex review 又抓出 12 个问题，含 1 Critical（aster-cloud 锁
0.2.0 不消费修复）+ 4 High + 5 Medium + 2 Low。P0-R2 修订：

| Finding | 修订 |
|---|---|
| Critical: aster-cloud 未消费 P0-R 修复 | aster-lang-ts bump 0.2.1 + aster-cloud package.json 改 `link:../aster-lang-ts`；CI 待 publish 后切回版本号 |
| High: Java 端无 E404 镜像 | aster-lang-core ErrorCode 加 PII_ANALYZER_FAILED (E404) + PII_MISSING_CONSENT_CHECK (E403) |
| High: Java conformance 无 env clear | build.gradle.kts test task 显式 `environment("ENFORCE_PII", "")` 隔离父进程 env |
| High: ADR 残留 "aster-api 不受影响" | 本次修订删除残留 bullet，移到 P0-R Findings 表 |
| High: ADR 扫描漏 aster-deploy | "Why not deprecation window?" 节拆分编译时 vs 运行时，诚实列出 aster-deploy 的 3 处 ASTER_PII_ENFORCE=false 命中（均为 test/debug 用途） |
| High: E404 帮助文本不可执行 | error_codes.ts E404 metadata help 改成浏览器用户可执行建议 |
| Medium: schemaError 直接渲染原始字符串 | 改为 `{messageKey, detail}` 结构化，主文案走 i18n |
| Medium: E404 测试用 regex 读 dist | 加入真实 fault injection：把 checkModulePII 改为可注入依赖 |
| Medium: PII_CODES 集合无自动派生 | 改为从 ERROR_METADATA category==='pii' 自动派生 |
| Medium: 集成测试 mock DecisionTracePanel | 新增不 mock 的 React integration test |
| Medium: locale 检测丢弃 confidence | 改用 detectCNLLanguage 完整结果，低置信度 fallback page locale |
| Low: import 位置 + aster-api 残留注释 + 版本统一 | 逐项清理（见对应 commits） |

## Open questions

无。本 ADR 决策已完整实现（P0-R2 后）：
- aster-lang-ts unit: 1042+ pass / 0 fail
- aster-lang-ts integration: 87/87 pass
- aster-lang-ts conformance: 7 个 PII 跨运行时用例 pass，含完整 diagnostic
  shape (code + severity) 等价 + 自动派生的 PII codes 集合元测试
- aster-lang-core Java test: 5+ 个新增 conformance tests pass，含 env clear
  forked JVM + analyzer failure contract
- aster-cloud: 14+ tests pass，含真实 DecisionTracePanel integration
- 浏览器路径成功调用 `checkModulePII`，捕获了原先静默的 HTTP sink violation

## Related

- ADR-0008 — zh-CN v2 keywords + CJK punctuation soft boundary（同期 v2/v3
  清理工作）
- Codex backend P0 #5 — "PII is a 亮点 but should not depend on env"（本
  ADR 提级到 P0 并加重）
- Codex frontend report — 暗示 "PII 一等公民" 是 Aster 真正护城河
- 未来 ADR：合规 policy pack 的可配置启用机制（HIPAA / GDPR / CCPA）

## Verification (P0-R2 后)

注意：跨实现等价不是 byte-identical 字符串比较——而是 **normalized PII
diagnostic shape equivalence**（相同 codes + 相同 severities + 相同 count）。
完整的源码 byte-identical 是 P1 单 parser 真源议题，不在本 ADR 范围。

```bash
# 1. aster-lang-ts unit + integration tests
cd aster-lang-ts && pnpm run test:unit:run
# 期望：1042+ pass / 0 fail / 2 skipped

cd aster-lang-ts && pnpm run test:integration:run
# 期望：87/87 pass

# 2. 验证跨运行时等价（Node vs browser 路径）
node --test 'aster-lang-ts/dist/test/unit/typecheck/pii-cross-runtime-conformance.test.js'
# 期望：7/7 pass，含完整 diagnostic shape 比较 + PII_CODES 元测试

# 3. 验证 Java 端 PII always-on 合同 + forked JVM env clear
cd aster-lang-core && ./gradlew test --tests "aster.core.typecheck.PiiAlwaysOnConformanceTest"
# 期望：5+ tests pass，含 isPiiCode 集合元测试 + E404 镜像验证

# 4. 验证 aster-cloud 集成回归（含 P0-R2 新增 real-trace 测试，P0-R3 补遗）
cd aster-cloud && pnpm vitest run \
  src/__tests__/app/execute-policy-content.integration.test.tsx \
  src/__tests__/app/execute-policy-content.real-trace.integration.test.tsx \
  src/__tests__/components/decision-trace-panel.test.tsx
# 期望：18+ pass（含不 mock DecisionTracePanel 的真实集成回归）
```

## aster-cloud 消费 aster-lang-ts 0.2.1（P0-R4 修复）

**当前状态**：aster-cloud 通过 commit 进 repo 的 tarball 消费 0.2.1。

- `aster-cloud/package.json` 引用 `file:vendor/aster-cloud-aster-lang-ts-0.2.1.tgz`
- tarball 由 `cd aster-lang-ts && pnpm pack --pack-destination ../aster-cloud/vendor` 生成
- CI 安装直接读 vendor 目录，无需 sibling repo / npm registry
- 浏览器端**完整应用** P0-R + P0-R2 + P0-R3 修复（含 PII_ANALYZER_FAILED catch、业务友好消息、production guard 等）

**长期 TODO（npm publish 凭证可用后）**：
1. `cd aster-lang-ts && npm publish` 发布 0.2.1 到 npm registry
2. `aster-cloud/package.json` 改 `file:vendor/...` → `^0.2.1`
3. 删除 `vendor/aster-cloud-aster-lang-ts-0.2.1.tgz`
4. `pnpm install && pnpm test` 验证

## Round 8 修复（P0-R8，2026-05-26）

**Round 8 codex 评分**：92/100 Block。剩余 Critical：

> 在无 `process` 全局的 runtime 中，`validateEnvOrWarn(env = process.env, mode?)`
> 默认参数会在函数体执行前求值 `process.env`，直接抛 `ReferenceError`。
> 同时 `src/lib/deployment-mode.ts` 模块顶部裸读 `process.env.NODE_ENV /
> NEXT_PHASE / VITEST / DEPLOYMENT_MODE`，被 env-validation transitively
> import 时同样在模块加载阶段抛 ReferenceError。

### 修复路径

| 文件 | 修复 |
|------|------|
| `src/lib/env-validation.ts` | 新增 `getProcessEnv()` 安全读取器（`typeof process !== 'undefined'` + try/catch）。`checkEnv / validateEnvOrThrow / validateEnvOrWarn` 三个函数的默认参数从 `= process.env` 改为 `= getProcessEnv()` —— 求值不再在调用点直接 ReferenceError |
| `src/lib/deployment-mode.ts` | 新增 `safeEnv(key)` 安全读取器。模块顶部 `_IS_RUNTIME_PRODUCTION` 与 `_RUNTIME` 中所有 `process.env.X` 改用 `safeEnv('X')` |
| `src/__tests__/lib/env-validation.test.ts` | 新增 "no-process runtime safety (P0-R8)" describe block，2 个测试：临时 `Object.defineProperty(globalThis, 'process', { value: undefined })` 模拟无 process 全局，验证 `checkEnv()` 与 `validateEnvOrWarn()` 默认参数不抛 ReferenceError（走真模块路径，不是 vm 内联字符串） |

### 验证

```bash
cd aster-cloud
pnpm exec tsc --noEmit           # 0 errors
pnpm test:run                    # 2548 passed | 8 skipped（4 个新 no-process assertion）
pnpm lint                        # 0 errors（1 个无关 warning）
```

### 设计理由

- **edge runtime 无 `process` 全局**（Cloudflare Workers、严格的 browser bundle、Edge functions）：模块加载阶段裸读 `process.env` 即 ReferenceError，**整个应用拒绝启动**——而非降级到无 env 的 warning 路径。
- **默认参数求值时机**：JS 默认参数在每次调用时（参数未传时）求值，不是函数定义时。`= process.env` 等价于 `if (env === undefined) env = process.env;` 在函数体之前执行，命中前述异常。
- **`getProcessEnv()` / `safeEnv()` 双重保险**：`typeof process !== 'undefined'` 是 V8 的静态判定，不会触发 ReferenceError；外层 try/catch 防御 sandbox 把 `process` 设成 throwing getter 的极端场景。
- **空 env fallback 行为**：无 process 时返回 `{}`，所有 env 校验视为"全部缺失"——进入 warning 路径而非崩溃。Cloudflare Workers 的 secret 通过 binding 注入到全局，不走 `process.env`，因此 `validateEnvOrWarn()` 在 Workers 看到的就是空 env，行为符合预期（只 console.error，不阻断启动）。

