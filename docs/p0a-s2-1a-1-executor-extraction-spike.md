# P0-A S2-1a-1 工程 spike：executor implementation 提取 + ModuleGraphResolver 接口

**状态**: SPIKE（工程策略，非实现；S2-1a-0 已上线，本 spike 定 executor 提取边界，Codex 策略审通过后 → writing-plans）。★Codex 策略审退回 72 后重研究真实编译闭包并重写。
**日期**: 2026-07-20
**关联**: [[p0a-s2-1a-runner-engineering-spike]]（S2-1a 母 spike，§2c 提取策略；executor 提取 + ModuleGraphResolver 明确延后到本刀）、S2-1a-0（共享 ReplayExecutionCore，已上线 PR#150 byte-identical）、[[p0a-s2-1-attested-runner-spike]]（β runner）
**目标**: 把 executor implementation（`DynamicCnlExecutor` + 传递闭包）提入共享 `aster-replay-core`，`ModuleResolver` 依赖反转成 `ModuleGraphResolver` 接口——**byte-identical 不改行为**，使**未来 β runner 复用同一 executor**（非另写 parser/executor，防执行分叉），且 runner 侧可插入受签 ModuleClosure 实现。

---

## 0. ★★最重要结论（先说，源码实证）

**executor 提取 FEASIBLE 且比预想干净——单一 de-risk 事实：`ModuleResolver.resolveGraph` 返回纯 `aster.core.module.ModuleGraph` record，非 Panache 实体（`PolicyVersion` 从不跨 seam）。** 故 `ModuleGraphResolver` 接口反转是**单方法纯提取**。

**★S2-1a-1 是 S2-1a-0 的直接续刀 + 双重解锁**：
- executor 移入共享模块 → β runner 复用**同一份** executor（同 parser/入口选择/module linking），兑现 S2-1a-0 §2c 承诺的「executor implementation 唯一份」。
- `ModuleGraphResolver` 接口 = **module 解析的 seam**：aster-api 插 DB-backed `ModuleResolver`，**runner 插受签 ModuleClosure 实现**（用户已选）。这是 ModuleClosure 协议 spike 的落点。

**★真实工程变更（Codex 退回 72 后重研究纠正——原「~7 文件」会编译失败）**：
- **8 个既有文件 move 入 core**：{DynamicCnlExecutor, InProcessCnlParser, **AliasOverlayLexicon（原漏）**, **CnlErrorListener（原漏）**, UserAliasValidator, EntryPointSelector, NamedContextMapper, ModuleResolutionException}。
- **+1 新 core-local mapper**（`JacksonMappers` **不移**，ownership 倒置，见 §6b；core 用自己的等价 mapper + canonical-byte parity fixture 守门）。
- **+1 新接口 `ModuleGraphResolver`**（`ModuleResolver` 因 Panache/DB **不能移**，只反转）。
- **+1 aster-api CDI producer**（`@Produces @ApplicationScoped DynamicCnlExecutor`）。
- **+ 新 Gradle 依赖**（core 现无 graalvm polyglot/sdk/truffle-api/jboss-logging/ANTLR——见 §1 矩阵）。
**闭包完成的判据 = `:aster-replay-core:compileJava` + `runtimeClasspath` 冻结绿，非人工数文件**。

---

## 1. 已实证提取面（Explore agent + 直接核对，2026-07-20）

### move 集 = 8 个既有文件（真实编译闭包，全 pure 无 CDI/DB，重研究实证）+ JacksonMappers 不移（§6b）
| 文件 | 说明 |
|---|---|
| `parser/DynamicCnlExecutor.java`（821行）+ 嵌套 `ExecutionResult`/`CoreIrCacheKey`/`CompiledCoreIr`/`CacheStats` + 3 嵌套异常 | executor 本体（CDI 面须剥，见 §2） |
| `parser/InProcessCnlParser.java`（365行，最大块） | 调 `AliasOverlayLexicon.wrap`(L139)+`CnlErrorListener`(L159)+`UserAliasValidator.validate`(L114)+`JacksonMappers.DEFAULT`(L303) |
| **`parser/AliasOverlayLexicon.java`（★原漏）** | 实现 aster-lang `Lexicon` SPI，**零 aster-api 引用**，纯 |
| **`parser/CnlErrorListener.java`（★原漏）** | 只 ANTLR + JDK regex；嵌套 `record Diagnostic` 被 `CnlParseException` 引用（须同移） |
| `parser/UserAliasValidator.java` | 只 aster.core.identifier/lexicon + Jackson + JDK，纯 |
| `parser/EntryPointSelector.java` | final，只 JDK；public sealed `Selection` |
| `api/convert/NamedContextMapper.java` | 只 CoreModel + logging；public `MappingResult` record |
| `module/ModuleResolutionException.java` | plain RuntimeException + Code enum + candidates；被 `ModuleExecutionException` 包 |

★**不移**：`common/JacksonMappers.java`（17 文件/13 包用，非 executor 专用，ownership 倒置）→ core 用等价 core-local mapper + canonical-byte parity（§6b）。

### 一个接口反转（新，core）
- **`ModuleGraphResolver`**：单方法 `ModuleGraph resolveGraph(String tenantId, CoreModel.Module rootCore, List<Decl.Import> rootImports, String locale)`——**返回纯 aster-lang record，参数全纯**。`DynamicCnlExecutor` 字段 `ModuleResolver`→`ModuleGraphResolver`（L63 + executeInternal/compileCoreIr 参数 L286/294/304/405 + 调 L433 retype）。
- ★**`ModuleResolver` 不能移**（Codex 纠正——`PolicyVersion extends PanacheEntityBase` + `@Entity` + jakarta.persistence + Quarkus，DB/Panache/CDI-tainted）。`ModuleResolver` 留 aster-api（保 Panache）`implements ModuleGraphResolver`。★DB leak（`PolicyVersion`）**全封装在 `ModuleResolver` 私有方法**（L94/135/155），从不跨 `resolveGraph` 公开签名——这是接口干净的关键（`ModuleGraph` 是纯 record）。

### 留 aster-api
- `ModuleResolver.java`（DB/Panache，implements ModuleGraphResolver）、`PolicyVersion.java`（Panache 实体）、`PolicyEvaluationResource.java`（4 catch）、`TruffleRuntimeHealthCheck.java`、lexicon 服务、+ **executor 的薄 CDI producer**（§2）。

### 排除（研究纠正）
- **`ParameterSchemaExtractor` 不在闭包**（grep 零命中于 executor；只 resource+SchemaResponse 用）——排除。

### ★core 依赖矩阵（Codex P0——core 现无这些，会编译失败）
core `build.gradle` 现只有 jackson-databind + asterLibs.core/truffle/runtime。移入代码需**新增**：
| 依赖 | scope | 版本来源 | 现状 |
|---|---|---|---|
| `org.graalvm.polyglot:polyglot` | implementation | 25.0.3（对齐 aster-api root L103） | **缺，须加** |
| `org.graalvm.sdk:graal-sdk` | implementation | 25.0.3 | **缺，须加** |
| `org.graalvm.truffle:truffle-api` | implementation | 25.0.3（VirtualFrame 编译需） | **缺，须加** |
| `org.graalvm.truffle:truffle-runtime`+`truffle-compiler`+`org.graalvm.compiler:compiler` | runtimeOnly | 25.0.3 | **缺，须加**（执行需） |
| `org.jboss.logging:jboss-logging` | implementation | 显式 pin（core 无 Quarkus BOM 管理） | **缺，须加** |
| `org.antlr:antlr4-runtime` | implementation | 冻结版本（对齐 parser generator） | **无条件直接声明（Codex——parser 直接 import ANTLR；不写「若非传递则加」，偶然 transitive 不证 runner 闭包稳定）** |
| **locale SPI**：`asterLibs.{en,zh,de}`（`cloud.aster-lang:aster-lang-locales-{en,zh,de}`）+ **`asterLibs.hi`（独立 artifact `cloud.aster-lang:aster-lang-hi`，★非 `aster-lang-locales-hi`）** | runtimeOnly | artifact manifest 固定摘要 | ★**须列三层归属**（见下） |
| jackson-databind / asterLibs.core/truffle/runtime | — | 已在 | ✓ |
★**locale SPI 三层归属（Codex——「core 编译过」不推出 runner locale 运行时等价）**：
- **core 模块**：不必携带具体 locale 实现（编译只需 SPI 接口）；
- **core 测试（★拍板全覆盖，非「实现时定」）**：`testRuntimeOnly asterLibs.en/zh/de/hi` **四套全进**（byte-parity 需覆盖全 locale parse；不留逐 locale 能力矩阵的缺口）；
- **aster-api**：现有 en/zh/de/hi `runtimeOnly` 不变；
- **runner image**：**必须按 artifact manifest 固定同一 locale SPI 集合（4 套）+ 摘要**（否则 parse locale 分叉）。
★**runner 镜像闭包关键**：core 在 aster-api 里能编译 ≠ 独立 runner 有同运行时闭包。依赖矩阵用**最终 `runtimeClasspath`/dependency lock 验证**冻结（compile vs runtime 分清），不靠 aster-api root 偶然 transitive。

---

## 2. CDI 重定位策略（★friction 1）

executor 现 CDI 面（全部）：`@ApplicationScoped`（L43）+ `@Inject ModuleResolver`（L62-63）+ `@ConfigProperty aster.modules.enabled`（L65-66）。**别无**（无 @PostConstruct/其它 @Inject/其它 config）。

★**策略：executor 移入 core 为 POJO，aster-api 保薄 CDI producer**：
- core 的 executor **剥 CDI 注解**（`@ApplicationScoped`/`@Inject`/`@ConfigProperty`），module 路径的 `moduleResolver`+`modulesEnabled` 经**构造参数**注入。★**已实证可行**：私有 `executeInternal` 早已把 `moduleResolver, modulesEnabled` 作**方法参数**穿线（L286/294/304/405）；static `execute`/`executeWithContext` 已传 `null` resolver。
- ★**双构造器（Codex P1——保 API 不破）**：
  - **保留 public no-arg 构造**（现状单模块语义：resolver=null、modulesEnabled=false）——★4 个测试站点 `new DynamicCnlExecutor()`（`UserAliasCompileTest:169/184`、`DynamicCnlExecutorCacheTest:68/107`）依赖它，删则破 API 违反「无签名变化」。
  - 新增 public 参数构造 `DynamicCnlExecutor(ModuleGraphResolver, boolean modulesEnabled)` 供 CDI producer/runner 用。
  - ★**多模块 enabled 但 resolver=null → fail-closed（非 NPE）**：保现状（现 `!imports.isEmpty() && modulesEnabled` 才解引用，resolver=null 时抛明确异常）。
- aster-api 保 **`@Produces @ApplicationScoped DynamicCnlExecutor`**（★product scope 显式 `@ApplicationScoped`，否则默认 `@Dependent` 无理由改原 bean 生命周期）：`@Inject ModuleResolver`（作 ModuleGraphResolver 实现）+ 读 `@ConfigProperty aster.modules.enabled`，`new DynamicCnlExecutor(resolver, enabled)` 暴露给 CDI（满足 `@Inject DynamicCnlExecutor` 的 `TruffleRuntimeHealthCheck`/`ReplayExecutorAdapter`）。
- ★**FQCN 保留**：core executor 保 `io.aster.policy.parser.DynamicCnlExecutor` → 消费者 import 不改；`@Produces` 方法（非新增类名）避免撞名。
- ★**SHARED_ENGINE/static 缓存不受影响**（Codex 确认）：类级 static，与 producer 建几个实例无关；static `clearCompilationCaches()` 纯 static，`HotPlugLexiconLoader`/`LexiconAvailabilityService` 调用不变。

---

## 3. 包私有测试钩可见性（★我原判断错，Codex 纠正——不是问题）

★**原 spike 说「跨 Gradle module 包私有不可见」是错的**（Codex P1，重研究确认）：仓库**无任何 `module-info.java`**（`find . -name module-info.java` 空）→ 无 JPMS named module → Java 访问控制按 **Java package** 判，**非 Gradle project**。故 aster-api 侧 `io.aster.policy.parser` 的测试**仍能访问** core jar 里同包 `io.aster.policy.parser` 类的包私有成员。**「必须移测试或加宽可见性」是解决不存在的问题——不做。**

★**唯一铁律：移入的类保原包名**（`io.aster.policy.parser` / `io.aster.policy.api.convert` / `io.aster.policy.module`，**不改成 `io.aster.replay.core`**）→ 同包测试跨 project 边界仍可访问包私有钩。

**实况（重研究核对，纠正原猜）**：
- 用包私有钩 `clearCachesForTest`/`cacheStatsForTest`/`coreIrCacheKeyForTest`/`CacheStats` 的**只有** `DynamicCnlExecutorCacheTest`（`io.aster.policy.parser`，同包，保留 aster-api 即可访问）。
- `parseUnsafeWithAliases` 被 `UserAliasArchTest`+`UserAliasCompileTest`（均 `io.aster.policy.parser`，同包）用。
- `CnlErrorFriendlyTest`（`io.aster.policy.parser`）用 `CnlErrorListener.humanize`（同包，移后仍同包可访问）。
- `PolicyMetricsTest`（`io.aster.policy.metrics`，**不同包**）的 `CacheStats` 匹配是 grep 噪声——**几乎肯定是 PolicyMetrics 自己的 `CacheStats`，非 executor 的**（实现 PR 一行确认）。
★**结论**：现有 aster-api 测试**原地保留即可**（保原包名前提下同包可访问）；core 可另加自己的 executor 单测，但**不删 aster-api 侧测试**（root 侧 CDI 装配/多模块 IT 层须留）。

---

## 4. 异常契约（S2-1a-0 已铺，本刀保持）

3 异常全 `public static` 嵌套在 `DynamicCnlExecutor`（`DynamicExecutionException` L773 / `ModuleExecutionException` L788 extends 前者持 `ModuleResolutionException` / `AmbiguousEntryException` L806 extends 前者持 candidates）。resource 4 catch 经**外类 FQCN 引用嵌套类型**（`DynamicCnlExecutor.AmbiguousEntryException` 等，L606/618/635/642）→ executor 移入 core 保 FQCN + 嵌套异常随外类移 + `ModuleResolutionException` 移（move 集）+ `InProcessCnlParser.CnlParseException` 移（parser 移）→ **catch 全保持不变**。与 S2-1a-0 `ReplayExecutor` 契约「异常原样透传由 resource 四类 catch」一脉相承。

---

## 5. 消费者影响（全确认，FQCN 保留则多数不改）

move 后 executor 保 FQCN `io.aster.policy.parser.DynamicCnlExecutor`，aster-api 已 `implementation project(':aster-replay-core')`：
- `HotPlugLexiconLoader`（L544/764）+ `LexiconAvailabilityService`（L225/234）：调 **static `clearCompilationCaches()`** → FQCN 保留，import 不改，**无需 adapter**。
- `TruffleRuntimeHealthCheck`（L15，`@Inject DynamicCnlExecutor`，仅 null-check）+ `ReplayExecutorAdapter`（L24/34，`@Inject`，调实例 executeWithTenantContext）：需 **CDI 可见 bean** → §2 的 aster-api producer 满足。
- `PolicyEvaluationResource`（L14 import 供异常 catch）：§4 保持。
- ★只有 `ReplayExecutorAdapter` + `TruffleRuntimeHealthCheck` 需 DB-capable bean；static 调用者（HotPlug/LexiconAvail）用纯 static。

---

## 6. byte-parity 验收（承 S2-1a-0）

- **同一 executor + parser 字节在 aster-api 与未来 runner 都跑**——这是 S2-1a-1 的全部意义（消除执行分叉）。
- 本刀是**纯提取（FQCN 保留、无签名变化、接口反转纯单方法；★JacksonMappers 是引用替换须 parity fixture，§6b）**，byte-parity 靠：全回归绿 + **现有 aster-api 测试原地保留**（`DynamicCnlExecutorCacheTest` 等同包可访问包私有钩，§3）+ core 可新增独立单测（不替代 root 装配测试）+ 字符化测试 `PolicyEvaluationReplayOrderingTest`（S2-1a-0 建，evaluate-source 端到端）**unchanged + 绿** + `PublicApiContractTest` golden 不变 + integrationTest（HMAC/quota/多模块 import 路径）绿 + **mapper canonical-byte parity fixture 绿**（§6b）。
- ★**多模块 import 路径必须回归**（这刀动了 module 解析 seam）：`aster.modules.enabled=true` 且有 import 的 case，经 `ModuleGraphResolver`→`ModuleResolver`（DB）解析，结果与现状 byte-identical。★**保留 root 侧真实 DB-backed 多模块 IT**（非只 core 用 mock resolver 测）——Codex 铁律。

---

## 6b. ★JacksonMappers ownership 倒置（Codex P1——不直接塞 replay 模块）

`JacksonMappers`（`io.aster.common`）被 **17 文件 / 13 包**用（workflow/billing/LLM/websocket/policy-compiler/REST/security/i18n...），**非 executor 专用的通用 JSON 基础设施**。直接移入 `aster-replay-core`（replay-命名模块）= **ownership 倒置**：15 个无关 aster-api 类（billing/LLM/workflow）会为一个 Jackson holder 反依赖 replay 模块。

★**方案（拍板，§7 决策点）**：
1. **推荐（首选）：`JacksonMappers` 留 aster-api，移入的 parser 类改用 core-local mapper**——core 定义自己的 mapper factory/holder（配置与 `JacksonMappers.DEFAULT` 一致；★现状 `DEFAULT` 本质是 vanilla `new ObjectMapper()`，core 可等价）。这样 core 自足、无 ownership 倒置。
2. 或抽成中性模块 `aster-common-json`，aster-api 与 replay core 共依赖（改动大，本刀不做）。
- ★**不选**「直接移入 replay-core 靠 aster-api transitive 解析」——虽能编译（aster-api 已依赖 core），但把 billing/LLM/workflow 耦合到 replay 模块。
- ★**这是「引用替换」非纯移动，须 canonical-byte parity fixture 守门（Codex——不只比 feature flags）**：断言 core-local mapper 与 `JacksonMappers.DEFAULT` 对 executor 实际涉及数据**逐字节一致**——Core IR JSON / decimal+E-notation / Map key ordering / Unicode+locale 字符 / null / nested list-map / ReplayMetadata canonical fixtures。number/decimal 处理直接影响 ReplayMetadata hash，任一分叉 = PR-blocking。

---

## 7. 必须拍板的决策点

1. **JacksonMappers（§6b）**：**方案1 留 aster-api + core-local mapper（配置 parity 测试守门，推荐）** 还是抽 `aster-common-json` 中性模块？
2. **CDI producer（§2）**：aster-api 用 **`@Produces @ApplicationScoped DynamicCnlExecutor`（不新增类名，显式 scope，推荐）**；executor **双构造器**（保 no-arg 兼容 4 测试站点 + 新参数构造）——确认？
3. **本刀范围**：S2-1a-1 只做 aster-api 侧（`ModuleResolver implements ModuleGraphResolver`，executor 依赖接口）；**runner 侧受签 ModuleClosure 实现留 ModuleClosure 协议 spike + runner 刀**——推荐（本刀纯提取不引入 runner）。
4. **下一步**：先出 **S2-1a-1 writing-plans** 落这刀，还是先补 **ModuleClosure 协议 spike**？——★推荐先 S2-1a-1（`ModuleGraphResolver` 接口先存在，ModuleClosure 才有可实现的目标）。

---

## 8. 本 spike 不做什么

- ❌ 不写 executor 移动/接口任何实现（等策略拍板）。
- ❌ 不引入 runner 或 runner 侧 ModuleGraphResolver 实现（本刀纯提取；受签 ModuleClosure 留后续）。
- ❌ 不改 executor/parser 逻辑（纯移动，byte-identical）。
- ❌ 不让 `PolicyVersion`/Panache 跨 `ModuleGraphResolver` seam（接口须纯）。
- ❌ 不把 `JacksonMappers` 直接塞 replay-core（ownership 倒置；留 aster-api + core-local mapper parity）。
- ❌ 不删/不移 aster-api 侧包私有测试（保原包名则同包可访问；保 root CDI/多模块 IT 层）。
- ❌ 不删 executor no-arg 构造（4 测试站点依赖）；不靠 aster-api root 偶然 transitive 满足 core 依赖（冻结依赖矩阵）。

## 附：引用路径
`aster-api/src/main/java/io/aster/policy/{parser/DynamicCnlExecutor(+InProcessCnlParser/UserAliasValidator/EntryPointSelector),module/ModuleResolver(+ModuleResolutionException),api/convert/NamedContextMapper,rest/PolicyEvaluationResource,replay/ReplayExecutorAdapter,health/TruffleRuntimeHealthCheck,lexicon/{HotPlugLexiconLoader,LexiconAvailabilityService},entity/PolicyVersion}.java`、`io/aster/common/JacksonMappers.java`；`aster-lang-core/.../module/ModuleGraph.java`。证据由 Explore agent 实证（resolveGraph 返回纯 ModuleGraph 非 Panache/闭包全 pure/CDI 仅 3 面/异常嵌套/消费者分类）。
