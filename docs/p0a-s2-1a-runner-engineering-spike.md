# P0-A S2-1a 工程 spike：最小 replay runner 提取 + 双端执行编排 + byte-parity

**状态**: SPIKE（工程决策文档，非实现；S2-1 β 形态已拍板，本 spike 定 runner 提取边界 + parity 门 + Job 编排，通过后 → writing-plans）
**日期**: 2026-07-19
**关联**: [[p0a-s2-1-attested-runner-spike]]（β 上层 spike，Codex 6 轮 97 通过；用户拍板形态 B/on-prem k3s/方案三/首档/旧baseline）、[[m2-replay-payload-spike]]（ReplayMetadata + liftDecimals）、S2-0（cosign admission 已上线）
**目标**: 定「最小 JVM replay runner」的**提取边界 + byte-parity 验收门 + 双端 ephemeral Job 编排**——S2-1 三步里最难的 S2-1a。

---

## 0. ★★最重要结论（先说，源码实证）

**最小 runner 提取可行**——execute→ReplayMetadata 闭包**几乎全是 pure-JVM 静态方法**，无 REST/DB/auth 在热路径。但**整件事的成败 = byte-parity**：runner 产的**完整规范输出**（三 hash + canonical bytes + 状态 + reasons + 错误契约）必须与生产 aster-api 在**全回归语料 + 冷/热/顺序/并发排列**上逐字节一致，否则 β 不可信（拒真 PASS 或签假结果）。

**★Codex 退回 74 纠正的核心：共享边界不是「~6 类 + glue」而是「完整 ReplayExecutionCore 用例」。** 生产 replay 是一整条编排（vocab/alias→trace arm/drain/finally→replayable 传播→compute 异常降级→默认化→错误契约），散在 resource；只共享零散工具方法仍 Java↔Java 分叉。且**多模块 import 依赖 DB**（非功能开关）、**`aliasesTrusted` 是信任位非输入**、**parity 须 per-artifact-pair 受签**（形态 B 拉旧 digest）。

**★两个 pure-JVM 事实（实证）**：
1. `DynamicCnlExecutor` 虽 `@ApplicationScoped`，但**整条 compile+run 管线是 `static`**（`executeInternal`/`compileCoreIr`/`executeWithPolyglot`）；唯一 `@Inject ModuleResolver` **仅多模块 import 时解引用**（`!imports.isEmpty() && modulesEnabled`）→ 单模块 replay 走 `static executeWithContext(...)` **零 CDI**。
2. `ReplayMetadata`（+ `liftDecimals`/`stableTraceNode`）+ `CanonicalJson` + `TypeContext` + `DecisionTrace` **100% pure-JVM**（只依赖 Jackson + JDK）；`compute` 收 toolchainId 为**纯 String 参数**，不碰 provider。

**★成败点（本 spike 核心风险）**：byte-sensitive 的 trace-mapping glue（`toTraceSteps`/`buildVocabularyIndex`/`buildAliasSet` + `DecisionTrace` 组装）**现在在 JAX-RS resource 里**（`PolicyEvaluationResource` private 方法），不是可复用 service。提取它 = **有 Java↔Java 分叉风险**（正是 β spike §2 Codex 警告的坑）。→ **byte-parity 差分测试是 PR-blocking 门**（§4）。

---

## 1. 已实证现状 + 待抽取来源（Explore agent + 直接核对，2026-07-19）

★**这是「现状 + 逻辑归属」，不是 runner 实施方式**——实施是 §2 的完整 `ReplayExecutionCore` 共享用例（所有 byte-sensitive 逻辑**移入共享模块**，aster-api 与 runner **共同调用**，非各自复制/移植）。

| 逻辑 | 现状 Quarkus 耦合 | 归属（§2 共享用例） |
|---|---|---|
| `PolicyEvaluationResource` replay 编排 | 重（JAX-RS/12×@Inject/RoutingContext/Mutiny/HMAC/quota）但**replay 纯逻辑混在其中** | 认证/配额/HTTP/遥测**留 resource**；**replay 编排移入 `ReplayExecutionCore`** |
| `DynamicCnlExecutor` | `@ApplicationScoped`+1×`@Inject ModuleResolver`+1×`@ConfigProperty` 但**管线 static** | static 执行逻辑**移入共享模块**；CDI 壳留 aster-api adapter |
| `ReplayMetadata`（+liftDecimals/stableTraceNode） | **零**（plain record + static compute） | 移入/依赖共享模块 |
| `CanonicalJson`/`TypeContext`/`DecisionTrace` | **零**（aster-lang-core + plain record） | 依赖不动 |
| `InProcessCnlParser`/`NamedContextMapper`/`UserAliasValidator`/`EntryPointSelector` | 无（public static） | 共享模块调 |
| `ToolchainIdentityProvider` | `@ApplicationScoped`+`@ConfigProperty aster.runtime.build` | **格式化函数共享**；env/build-id 读取留各自 adapter（§3 observed vs expected） |
| `ModuleResolver` | `@ApplicationScoped`+**查 DB**（`PolicyVersion.findLibraryVersion`）+tenant | **非浅层**（§5 受签 ModuleClosure 或 import fail-closed） |
| `toTraceSteps`/`buildVocabularyIndex`/`buildAliasSet` glue + DecisionTrace 组装 | **private in JAX-RS resource**（byte-sensitive） | **移入共享模块**（resource 与 runner 共调，**非复制**）——分叉风险主因 |
| `io.aster.common.JacksonMappers` | 小 aster-api helper | 移入/依赖共享模块 |

- **单体 Gradle**（无 engine/web split）；aster-lang libs 经 catalog `cloud.aster-lang:aster-lang-platform:1.0.16` + 复合构建。runner 新 module 可只依赖 `asterLibs.{core,truffle,runtime,validation}` + lexicon SPI 包 + GraalVM Polyglot 25.0.3 + Jackson，**排除 quarkus-rest/jdbc/hibernate/cache**（共享 `ReplayExecutionCore` 用例不引用它们）。
- **无现成 standalone main**（`grep "public static void main"` 零命中）；最佳模板 = 单测 `ReplayMetadataTest`/`DynamicCnlExecutor*Test`（已驱动 static 路径）。
- Java toolchain **25**。

---

## 2. 共享边界 = 完整 ReplayExecutionCore 用例（★Codex P0-1 纠正——非零散类/glue）

**原稿「~6 类 + 3 段 glue」低估了执行闭包。** 生产 replay 路径**不是** `DynamicCnlExecutor → ReplayMetadata.compute` 两步，而是一整条编排（散在 `PolicyEvaluationResource` L490-638）：
```
request 默认值(locale/function)+原始 context → vocabulary/alias 转换 → aliasesTrusted 派生
→ TraceAccess arm → executor → drain(finally) → replayable 标记传播 → DecisionTrace 组装
→ ReplayMetadata.compute + 异常降级 → 规范化 outcome/errorCode
```
只共享 executor + 3 glue，仍让 aster-api 与 runner **各自编排** trace arm/drain/finally、replayable 传播、compute 异常降级、locale/function 默认化、vocab 解析失败退化、alias trust——**仍 Java↔Java 分叉**。

**★共享对象必须是「从受信 replay 请求到 ReplayMetadata 的完整纯编排」**：
```
// 新共享模块 aster-replay-core（aster-api 与 runner 都依赖，唯一一份代码）
ReplayExecutionCore.execute(ReplayExecutionRequest) → ReplayExecutionResult {
    businessOutput,          // 规范形式
    decisionTrace,           // 完整 DecisionTrace（steps 全稳定字段）
    replayMetadata,          // 三 hash + M2 canonical bytes + replayabilityStatus/reasons
    executionOutcome,        // 成功 / 各类签字级错误
    errorCode                // 规范化错误码（签字级错误契约，§4b）
}
```
- **aster-api resource**：只做认证、配额、HTTP 映射、遥测；**调 `ReplayExecutionCore.execute`**（不再自行编排 replay）。
- **runner main**：只做协议、challenge、SVID 签名；**调同一 `ReplayExecutionCore.execute`**。
- **两边不得自行重组 replay 流程**——这才是「同一份代码保 byte-parity」的真落地。

**共享模块内含（从 resource + executor 抽出、去 CDI）**：完整 replay orchestration（含 trace arm/drain/finally、replayable 传播、异常降级、默认化、vocab/alias 转换）+ `ReplayMetadata`/`DecisionTrace`（本就 pure-JVM）+ `DynamicCnlExecutor` static 执行 + `toTraceSteps`/`buildVocabularyIndex`/`buildAliasSet` glue + **toolchain identity 格式化函数**（env 读取只留在各自 adapter）。

**依赖不动**（aster-lang）：`CanonicalJson`/`CoreLowering`/`CoreModel`/`IdentifierIndex`/`LexiconAbiVersion`/`Canonicalizer`/`AsterLanguage`(Truffle)/`TraceAccess`/`TraceCollector`/`LambdaValue`/interop `Aster*Value`/lexicon SPI 包。

**★落地顺序（S2-1a-0 最小第一刀，低风险独立价值）**：先把完整 replay orchestration 从 resource 抽进 `aster-replay-core`，**aster-api resource 改调它**，证**行为不变 = 全回归绿 + 现有 ReplayMetadata 单测绿**（trace/错误降级/默认值 byte-identical）——这步不引入 runner，纯重构，独立可验；再让 runner 依赖同模块。

---

## 3. runner 输入/输出契约（byte-parity 锚点）

**可签输入**（verifier 喂 runner，绑进 challenge/authorization）：
- `source`（String CNL）
- `context`（Object：named `Map` 或 positional `List`/array）——★**`canonicalInputHash` 锚在原始 request-level context，非归一化位置参数**（named `{creditScore:680}` vs positional `[680]` hash 不同，文档化的有意行为）→ runner 必须喂**与 REST 层收到的完全同形对象**否则 hash 分叉。
- optional `locale`(默认 en-US)/`functionName`/`vocabulary`/`aliasSet`/`legacyEvaluateSentinel`
- + challenge/nonce（verifier 注入，绑 freshness）

★**`runtimeBuildId`/toolchain identity 所有权（Codex 第2轮 P1——非 verifier 任选的业务输入）**：拆 **expected**（verifier 从已验 `RunnerArtifactManifest` 派生）vs **observed**（runner 从**镜像内构建元数据**读取并输出）；verifier 要求二者一致，但 **observed 本身不增加 assurance**（自报不加信任）。★build identity **必须烘焙进最终制品**（镜像内 build metadata），**非依赖可变部署 env**（可变 env 可被改，不能作为身份真值）。

★**`aliasesTrusted` 不是普通 runner 输入（Codex P0-3）**：生产端它来自**已验证的内部 HMAC 调用上下文**（`PolicyEvaluationResource:509`），**非业务 payload**。若调用者自报，攻击者用 `aliasesTrusted=true` **改变解析语义**。

★★**但「verifier 派生」不能凭空——必须定义受签权威对象（Codex 第2/3轮 P0；★核对现状：cloud 现有 `sourceEnvelopeSha256` 是哈希非签名，无 `structuralAliasesAuthorized` 字段，`PolicyVersionEnvelopeVerifier` 只重算哈希不证 release 授权；生产 `aliasesTrusted` 来自 HMAC 调用身份且**不只**表达 policy 布尔，还门控 `replayCapture`）。**

**★拍板：新增单一受签对象 `SignedPolicyExecutionAuthorization`**（不用 `/` 二选一占位）：
```
SignedPolicyExecutionAuthorization {
  schemaVersion, purpose,
  tenantId, policyVersionId,
  sourceHash, sourceEnvelopeHash,
  aliasSetHash,                    // 绑具体 aliasSet，防换集
  structuralAliasesAuthorized,     // 该 policy version 是否获准结构别名
  authorizationBasis/grantVersion, // per-user grant 冻结依据
  issuedAt, expiresAt, keyId
} + signature
```
- **签发**：由 **policy publish/release pipeline** 在**验证 per-user structural alias grant + 冻结 alias snapshot + tenant ownership** 后签，用**专用 domain-separated key**（复用 S1 trust-bundle purpose 分派加新 purpose）。
- **验证 + 派生**：verifier 验签 + 校验撤销/期限 + **全 hash 绑定**（tenantId/policyVersion/sourceHash/sourceEnvelopeHash/aliasSetHash）→ 只从此对象派生 `StructuralAliasAuthorizationClaim`（绑 challenge + ReplayExecutionRequest）。runner **只接受此派生 claim**，不接调用者自报。
- **★边界（Codex 关键）**：此对象**只替代 alias-trust 语义**，**不替代 HMAC 对调用者身份 + `replayCapture` 权限的门控**（那是另一层，runner 场景由 verifier 触发链 + challenge 承担）。
- **★parity oracle 对齐**：差分测试须让**生产 API 与 runner 消费同一 authorization fact**（API replay 路径也改为消费此 claim，而非各自靠 HMAC 布尔 vs transition 布尔）；**须实证此对象语义等价于生产现基于 HMAC 派生 `aliasesTrusted` 的 alias-trust 结果**。
- 缺失/旧版本/验证失败 **一律 fail-closed**。同理任何影响解析语义的信任位都须此模式。

**输出**：`ReplayMetadata` record（runtimeToolchainId/canonicalizationVersion/三 hash/reasonCodes[M1=[]]/replayabilityStatus/reasons/M2 canonicalInput|Output|Trace）+ workload-bound 签名 envelope（runner SVID 签，见 β spike §5）。用 **同一 Jackson 版本**（aster-lang platform pin）序列化——★`ReplayMetadata` 用 `new ObjectMapper()` 但 executor 用 `JacksonMappers.DEFAULT`，number/decimal 处理须与生产产 hash 时一致。

---

## 4. ★byte-parity 验收门（PR-blocking，成败点）

runner 只有在**与生产 aster-api 逐字节一致**时才可信。★**Codex P0-4：只比三 hash + status 不够**——会漏「字段被丢弃但双方恰好走相同旧 hash 路径」的协议错误，也不验 runner envelope 实际返回的规范字节。

**完整输出契约比较（全项逐字节）**：
- `canonicalInput`/`canonicalOutput`/`canonicalTrace` **原始规范字节**（不只 hash）；
- 三 hash（canonicalInput/Output/Trace）；
- `canonicalizationVersion`；
- `reasonCodes` + `replayabilityReasons`（**含顺序**）；
- `replayabilityStatus`（REPLAYABLE/NON_REPLAYABLE 分类）；
- 业务输出的**规范形式**；
- trace steps 的**全部稳定字段 + 顺序**；
- 成功与错误的**规范化 outcome/errorCode**（§4b 错误契约）。

**差分语料**：现有 golden cases + 生成边界语料（Decimal/E-notation vs toPlainString/日期/locale/别名/错误路径）。**runner 与生产 aster-api** 各跑同 source×input，全项逐字节相同。任一分叉 = **PR-blocking，不得上线**。

**★确定性/全局状态排列测试（Codex P1-2——SHARED_ENGINE/static cache/ThreadLocal/lexicon SPI 见 [[lexicon-spi-loading-race]]）**：Job 冷状态 vs aster-api 热状态可能不同；批量 Job 的顺序/并发/残留可能改结果。故差分门须加：cold runner↔warm API / warm↔warm / 同语料不同排列 / 重复执行 / 并发执行 / **locale SPI 加载顺序排列** / trace drain 污染与异常后下一次执行 / cache hit-miss 等价 / 单 case Job vs 批量等价。**★证明前，首版最诚实设计 = 单 Job 单 execution 禁并发复用 runner 进程**。

- **★共享模块（§2）下**：runner 与 aster-api 用**同一份 `aster-replay-core`** → byte-parity 理论天然成立，差分测试是**回归守门**（证共享重构 + 冷/热/顺序/并发没引入分叉）非追赶。
- **★per-artifact-pair 发布认证（Codex P0-5）**：形态 B 拉**旧** runner digest → parity 证明必须回答「此 runner digest 与哪个 aster-api/toolchain artifact 通过了 parity」。故在**发布流水线**生成**受签 parity attestation**，由 `RunnerArtifactManifest`（β spike §4b）绑：`toolchainId/runnerImageDigest/replayCoreDigest/dependencyLockDigest/runtime-JDK-GraalVM identity/parityCorpusDigest/parityResultDigest/correspondingAsterApiArtifactDigest`。「当前 HEAD runner ↔ 当前 HEAD API 测试过」**不证**数月后拉的旧 runner digest 对应旧 toolchain X。★**工程验收 3 点（Codex 补）**：(1) 由受信 release pipeline 的**专用 domain-separated key** 签；(2) 测试对象必须是**最终构建的 API artifact + runner image**（非源码工作区）；(3) verifier/release gate 验 `replayCoreDigest` + dependency lock **确实嵌入两端最终制品**（非只信 manifest 声明）。

### 4b. ★签字级错误契约（Codex P0-4——错误路径不能只写进语料清单）

生产 REST 异常目前映射成 HTTP 错误，**未必产 ReplayMetadata**。共享 `ReplayExecutionCore` 必须先定义**签字级错误契约**：哪些错误是**可比较的规范化失败**（产 `errorCode` + 可差分）、哪些**直接不产 execution evidence**（该 case 不可签、fail-closed）。runner 与 aster-api 对同一错误输入须产**同一规范化 outcome/errorCode**（或同样「不产证据」）。

## 5. 多模块 import：受签 ModuleClosure 或 fail-closed（★Codex P0-2——不是功能开关）

`ModuleResolver` **不是浅层 pure-JVM 协作者**——它经 `PolicyVersion.findLibraryVersion(...)` **直接查 DB** + 依赖 tenant visibility（`ModuleResolver:61`）。故「runner 排除 JDBC」与「多模块时移植 ModuleResolver」**不能同时成立**；且**不能靠「扫 golden 有无 import」决定**——生产签字报告任一 case 出现 import 都必须明确处理（测试语料无 import ≠ 生产输入无）。

**二选一（拍板）**：
1. **推荐：执行前解析并冻结受签 `ModuleClosure`**（无 DB）——含每模块名称/版本/**源码摘要+内容**/依赖边/**tenant authorization commitment**；closure 纳入 runner 输入 + challenge + 证据签名。runner 离线执行，不碰 DB。
2. 或 runner 访权威模块存储——但**重新引入 DB/租户鉴权/TOCTOU/网络可用性/确定性**，不再是「最小离线 runner」。

★**在 `ModuleClosure` 完成前**：runner **按 case 运行时检测 import** → 有 import 一律 **fail-closed**（该 case 不产 `independentExecutionVerified`、报告不翻 finalized signable）。不能用「golden 没覆盖」代替生产能力边界。

---

## 6. 双端 ephemeral Job 编排（形态 B）

- verifier（cloud）按 S1 transition 的 `baselineToolchainId`/`currentToolchainId` → 经 paired RunnerArtifactManifest（β spike §4b）解析 `runnerImageDigest` → 分别启 **old/new digest-pinned K8s Job**（cosign-verified via S2-0 admission，SPIRE attested）。
- **on-prem k3s 同 aster-api 集群**（用户拍板）：复用 S2 PSAT 根 + S2-0 admission；runner 独立 Pod/SVID/ServiceAccount/触发链；**cloud→runner 调用 mTLS + challenge**（防又一个自报面）。★mTLS 只保护通道，**不替代实例绑定**（§6b）。

### 6a. ★运行时闭包必须精确固定进 manifest（Codex P1-3）
不能写「GraalVM 25.0.3 + Java 25 大致一致」——否则 byte-parity 只在 CI 成立不证 ARM64 Job 环境。固定并进 `RunnerArtifactManifest`：JDK vendor/distribution/版本/架构；GraalVM distribution + 组件；locale/Jackson/lexicon SPI **实际依赖闭包**；JVM flags/timezone/默认 locale/charset；classpath + **依赖锁摘要**。

### 6b. ★Job 控制器状态机（Codex P1-4——非「启动-执行-回传-销毁」；★终点非 FINALIZED，不越 S2-1c 层）
**单 Job 状态机**（只产**一端** evidence，**不能使报告 finalized**）：
```
CREATED → ADMITTED → ATTESTED → CHALLENGED → RUNNING → EVIDENCE_ACCEPTED → EVIDENCE_COMMITTED → COMPLETED
```
**★独立的 transition/finalization 状态机**（old/new 两端都完成后，属 S2-1c/β spike §7）：
```
BOTH_ENDPOINTS_VERIFIED → POLICY_EVALUATED → RECEIPT_SIGNED → FINALIZED_SIGNABLE
```
**★Job `COMPLETED` ≠ 报告可签字**——finalized signability 由 S2-1c 的 FinalizationReceipt 派生（β spike §7），非单个 Job。
须明确：challenge **一次性消费**；retry = **换 challenge**（非复用）；old/new **任一 Job 失败整体 fail-closed**；timeout/重复回传/迟到回传处理；**Job UID/Pod UID/SVID/imageID 实例关联**（β spike §5，非自报）；evidence 被 verifier **持久化成功（EVIDENCE_COMMITTED）后才删 Job**；旧 digest 不可拉/签名过期/撤销 → **baseline 重冻**；并发 transition 的**幂等键 + 资源上限**；**registry retention 是正式前置条件**（非运行时碰运气——旧 digest 须保证可拉）。
- **★GraalVM 冷启动**（Truffle CE 解释器 acceptable，`engine.WarnInterpreterOnly=false` 已设）；证据回传通道（Job→verifier）完整性。

---

## 7. 决策点（★用户已拍板 2026-07-19）

**已拍板**：①下一步 = **先做 S2-1a-0 共享模块重构**（纯 aster-api 内部抽取，证回归绿，不引入 runner）；②代码组织 = **同仓 aster-api 新 module**（`aster-replay-core` 共享 + `aster-replay-runner`）；③共享模块（非复制）；④多模块 = **首版就支持受签 ModuleClosure**（→须先补独立 ModuleClosure 协议 spike）；⑤首版并发 = 单 Job 单 execution。★**序列**：S2-1a-0 不依赖 ModuleClosure 决策（纯抽取不改行为）→先做；ModuleClosure 协议 spike 是后续 runner 侧 track。

### 原决策点全文（存档）

1. **runner 代码组织：新 gradle module（同 aster-api 仓）vs 独立仓？** ——同仓 module 复用构建/版本对齐易，但 runner 与 aster-api 同仓（common-mode 面稍大）；独立仓隔离强但版本同步/共享模块跨仓复杂。★推荐**同仓新 module `aster-replay-core`（共享）+ `aster-replay-runner`（main+镜像）**——共享模块保 byte-parity，runner 镜像最小化排除 quarkus。
2. **共享模块 vs 复制**：确认走**共享 `aster-replay-core` 模块**（aster-api resource 重构调它 + runner 依赖它，同一份代码保 byte-parity），而非复制 glue 到 runner（复制=分叉风险）？——★推荐共享。
3. **多模块 import**（§5，★非「扫语料决定」）：首版走 **(3) 全 import case fail-closed**（运行时检测 import→不产 evidence→不翻 finalized signable，单模块先上，**可直接进计划**）还是 **(1) 受签 DB-less `ModuleClosure`**（执行前冻结含 tenant authorization commitment，runner 离线执行）？——★推荐先 (3) fail-closed 上单模块；**选 (1) 须先补独立 ModuleClosure 协议 spike**（签发者/信任根/canonical schema/递归闭包+依赖环+版本冲突/DB snapshot-TOCTOU 边界/tenant 授权验证时点+撤销/closure hash 绑 transition+challenge+evidence——本 spike 未覆盖）。
4. **首版并发模型**：确认 **单 Job 单 execution、禁并发复用 runner 进程**（§4 确定性证明前最诚实）？还是先做批量（须先过顺序/并发/残留差分门）？
5. **下一步**：先做 **S2-1a-0（共享模块重构：把完整 replay orchestration 从 resource 抽进 `aster-replay-core`，aster-api 改调，证全回归绿 + ReplayMetadata 单测 byte-identical）** 作为最小第一刀（低风险、独立价值、纯 aster-api 内部重构、不引入 runner）——还是先出完整 S2-1a writing-plans？★推荐先 S2-1a-0（它是一切前置，且独立可验）。

---

## 8. 本 spike 不做什么

- ❌ 不写 runner/共享模块/Job 编排任何实现（等决策拍板）。
- ❌ 不假装 byte-parity 天然成立（是 PR-blocking 门；共享模块降低风险非消除，仍须**完整规范字节 + 冷/热/顺序/并发**差分守）。
- ❌ 不只共享 executor + glue（须共享**完整 ReplayExecutionCore 用例**，否则编排分叉）。
- ❌ 不复制 byte-sensitive 逻辑到 runner（分叉风险；走共享模块）。
- ❌ 不用「扫 golden 有无 import」代替多模块生产能力边界（有 import 一律 fail-closed 或受签 ModuleClosure）。
- ❌ 不把 `aliasesTrusted` 等信任位当调用者自报输入（verifier 派生）。
- ❌ 不让 runner 自报 toolchain/Pod UID 当真值（verifier 派生 + 实例绑定，β spike §5/§6）。
- ❌ 不用「当前 HEAD parity 过」证旧 digest（须 per-artifact-pair 受签 parity attestation 进 manifest）。
- ❌ 不在确定性证明前批量/并发复用 runner 进程（首版单 Job 单 execution）。

## 附：引用路径
`aster-api/src/main/java/io/aster/policy/{rest/PolicyEvaluationResource,parser/DynamicCnlExecutor,replay/ReplayMetadata,api/model/DecisionTrace,stability/ToolchainIdentityProvider}.java`；`aster-lang-core/.../canonical/CanonicalJson.java`。证据由 Explore agent 实证（execute 闭包 static/ReplayMetadata pure-JVM/trace glue 在 resource/单体 Gradle/无 standalone main）+ 主 AI 核对。
