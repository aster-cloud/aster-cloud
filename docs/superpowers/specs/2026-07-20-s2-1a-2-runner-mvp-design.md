# S2-1a-2 Runner MVP 设计（spec）

**日期**: 2026-07-20
**状态**: SPEC（brainstorming 完成，用户逐节认可；下一步 writing-plans）
**关联**:
- 工程 spike（决策依据）: `aster-cloud/docs/p0a-s2-1a-2-runner-engineering-spike.md`（Codex 96 定稿；附 B 前置事实）
- β 母 spike: `aster-cloud/docs/p0a-s2-1-attested-runner-spike.md`（§5 实例关联/§8 阶段划分为 SPIRE 真相源）
- 共享模块: aster-api `:replay`（原 `aster-replay-core`，PR#152 重命名；含 `ReplayExecutionCore`/`DynamicCnlExecutor`）

---

## 目标（一句话）

给已共享的 `:replay` 模块加一个 **standalone JVM runner**（`main()` + `application`-plugin distribution 打包 + 最小 arm64 镜像），配一个**新建的集群内 launcher 微服务**（cloud 经 Cloudflare Tunnel HMAC 调它启 digest-pinned runner Job），并用**分层 parity 门**（CI 双跑守 JVM distribution 层 + arm64 容器/E2E 守运行时环境+编排层）守集成 parity。

## 诚实边界（铁律，承工程 spike §4）

**S2-1a-2 = runner integration/parity milestone，不是 attestation 安全增量。**
- ✅ 证的是：runner 的打包/镜像/launcher/Job 环境**没在共享 executor 代码外引入分叉**（locale SPI 装载/JVM flag/内存/冷启动 GraalVM 状态差异）。
- ❌ 不证：executor 算法独立性（那要 TS 二引擎，母 spike 已定 TS 是非签字级 differential checker）。
- ❌ MVP **无签名** → 不喂 signability gate、不抗 aster-api 攻破、不抗 launcher 攻破、不解锁签字。
- SPIRE + workload-bound 签名统一归 **S2-1b**（阶段归属以母 spike §8 为准，本 spec 不重定义）。

## 架构

单一 build（aster-api 仓）+ 新建 launcher 微服务 + cloud 旁路触发。六子系统（A–F）+ 一个风险门（Task 0，插在 A+B 之后、C–F 之前）。

### Task 0（前置风险门，一次性——★阻塞 C–F，非阻塞 A/B）

**arm64 容器真跑验证**：podman 真构建 runner **application-distribution** 镜像（stock Zulu JRE 25），真跑固定 corpus 一次，证 **stock JRE + Truffle 解释器能跑 + 对权威对照路径 byte-identical**（比对规则=排除 toolchainId，见数据契约 / 测试策略对照定义）。

- ★**顺序（消除循环矛盾，Codex 纠正）**：Task 0 **不在 A/B 之前**——它需要 A（`main()`+application distribution）+ B（arm64 Dockerfile）先存在最小可跑版本。正确序列：**先做 A+B 的最小切片（runner main + distribution + Dockerfile）→ Task 0 真跑验证这个切片 → 过了才继续 C–F**（CI 签名/parity 门/launcher/cloud）。即 Task 0 是 **A+B 之后、C–F 之前的风险门**，阻塞的是 C–F，不是 A/B 自身。若 Task 0 失败→回头改 A/B（Dockerfile 可能须 GraalVM JDK 基镜像而非 stock JRE），不浪费 C–F 投入。
- 依据（工程 spike 附 B）：`DynamicCnlExecutor` 已设 `engine.WarnInterpreterOnly=false`（注释「CE 版本无 JIT 是已知情况」）→ 解释器模式是**设计内预期**；但本地 JDK 是 Oracle GraalVM 25（有 JIT），**证不了** stock JRE 解释器路径，必须真容器真跑。

### 六子系统

| # | 子系统 | 仓 | 责任 | 拍板反映 |
|---|---|---|---|---|
| A | runner main + 打包 | aster-api（新 module `aster-replay-runner`）| `main()` 读请求(schema ②)→`ReplayExecutionCore` 三阶段→**向 stdout 输出结果 envelope**（成功=③ / 错误=④，runner 是 envelope 唯一生产方）；**Gradle `application` plugin** 分发（★产**启动脚本 + `lib/*.jar` install 目录，非 fat-jar/uber-jar**——locale 四 jar 物理分开在 lib/，SPI 零合并风险）；`import :replay` | 打包=application distribution；import-free(no-arg executor) |
| B | 最小 arm64 镜像 | aster-api | 新 Dockerfile：stock **Zulu JRE 25**（无 Quarkus/PG/Redis）+ COPY application `lib/` install 目录（含 **locale artifacts 提升 runtimeOnly**：en/zh/de/hi）+ 启动脚本 ENTRYPOINT + arch 断言 | byte-parity 头号陷阱=locale 提升 |
| C | 镜像 cosign 签名 workflow | aster-api | 仿 `deploy.yml`：build→arm64-verify→**cosign keyless 签 runner 镜像**（层2 制品真实性，**非** runner 输出的 workload 签名——那是 S2-1b）→image-pin-PR；新 OIDC identity | S2-0 模式复用 |
| D | parity 差分门（**JVM distribution 层**）| aster-api CI | 固定语料**双跑**（aster-api 生产路径 vs runner **application distribution** 路径，**同 CI 容器内**）逐字节比对 canonical ReplayMetadata。★**只守 JVM distribution parity**（同 JDK 同 classpath 下 runner 打包是否引入分叉），**不守** Docker/Job/arm64 环境 parity（那是 Task 0 + E2E） | parity 门=CI 双跑（distribution 层） |
| E | in-cluster launcher | 新专用微服务 + k3s | 独立微服务：自己 SA + 最小 BatchV1 RBAC，收 cloud HMAC→建 digest-pinned runner Job→**回收 Job 结果**→回传 cloud；自身 cosign admission（复用 S2-0）；**持有并发/排队所有权**（见容量约束） | launcher=新建专用微服务 |
| F | cloud 触发（旁路）| aster-cloud | 独立 parity 验证路径：调 launcher 启 runner + 收 ReplayMetadata；**不改变生产 evaluate 数据流及返回语义**（`evaluateForCapture` 逐字不动） | cloud 接线=独立旁路 |

## 数据流（一次 parity 验证的完整链路）

```
[aster-cloud F]  独立 parity 旁路触发
    │  POST /launch  (HMAC signInternalCallerHeaders 7行 canonical, ASTER_PLAN_GATE_HMAC_KEY)
    │  body: { tenantId, source, input, locale, functionName, aliasSet, requestId }
    ▼
[launcher E]  验 HMAC → 建 digest-pinned runner Job (BatchV1)
    │  Job env/args 注入执行请求 (JSON)
    ▼
[runner A]  main() 读请求 JSON (schema ②)
    │  → new DynamicCnlExecutor()          (no-arg, null resolver, import-free)
    │  → ReplayExecutionCore.execute(request, executor)       → ExecutionPhaseResult
    │  → ReplayExecutionCore.buildDecisionTrace(...)          → DecisionTrace
    │  → ReplayExecutionCore.computeReplayMetadata(toolchainId, ...) → ReplayMetadata
    │  → 向 stdout 输出结果 envelope (成功=③ / 错误=④)；exit code: 成功=0 / 错误≠0
    ▼
[launcher E]  Job 终态后读 Pod log 取 stdout envelope → 回传 cloud
    ▼
[aster-cloud F]  对比 runner vs aster-api 的 ReplayMetadata（★排除 toolchainId 字段，
                 只比 canonicalInputHash/canonicalOutputHash/canonicalizationVersion/
                 replayabilityStatus/traceHash）(仅记录/展示, 不喂 gate)
```

### 四个 JSON schema（定稿——writing-plans 直接用）

**① `/launch` 请求（cloud F → launcher E）**：
```json
{
  "requestId":   "string (UUID, 幂等键+关联键)",
  "tenantId":    "string",
  "source":      "string (CNL 源码)",
  "input":       "object | array (评估输入)",
  "locale":      "string (en|zh|de|hi)",
  "functionName":"string",
  "aliasSet":    "Record<string,string[]> | null (raw, 未建 index)"
}
```
字段来源：cloud 侧 parity 旁路构造（同一 source×input 也发给 aster-api 生产路径取对照）。传输：HTTP POST，`signInternalCallerHeaders` 7 行 canonical HMAC（`ASTER_PLAN_GATE_HMAC_KEY`，`X-Internal-Caller: cloud-bff`）。

**② runner 请求（launcher E → runner A，经 Job env/文件注入）**：
= `ReplayExecutionRequest` 的 JSON 序列化。字段从 ① 派生（launcher 透传 tenantId/source/input/locale/functionName/aliasSet；`aliasesTrusted=false`、`legacyEvaluateSentinel=false`、`trace`/`effectiveReplayCapture` 按 parity 需要固定值）。**launcher 只透传不改语义**（§3b：launcher 不可信编排者，MVP 无签名故不防其篡改——诚实）。

**③ 成功响应（runner A → launcher E → cloud F）**：runner 直接向 **stdout** 输出此 envelope（runner 是唯一生产方；launcher 不重新包装，只透传）。
```json
{
  "outcome": "SUCCESS",
  "replayMetadata": { /* ReplayMetadata canonical JSON: canonicalInputHash,
                         canonicalOutputHash, canonicalizationVersion,
                         replayabilityStatus, traceHash, (toolchainId 见下) */ }
}
```
★**结果回收介质 = Pod stdout log（定稿，非结果文件）**。理由：stdout 无需共享卷/额外挂载权限，与 `readOnlyRootFilesystem:true`+`automountServiceAccountToken:false` 的最小权限 Job 天然相容；launcher 有 `pods/log` read RBAC 即可回收，无状态载体清理负担。runner 保证 envelope 是 stdout 的**最后一行完整 JSON**（前置 log 用 stderr，避免污染 stdout）。

**④ 错误响应（独立 error envelope，★不污染 ReplayMetadata——Codex 纠正）**：
```json
{
  "outcome":   "ERROR",
  "errorCode": "string (与 aster-api 四类 HTTP 映射同源: PARSE/EXECUTION/MODULE/INTERNAL)",
  "message":   "string",
  "phase":     "string (parse|execute|trace|metadata)"
}
```
★**错误是独立顶层 envelope，不是 ReplayMetadata 的字段**。理由：ReplayMetadata 是「成功执行的 canonical 承诺」，把 errorCode/outcome 塞进它会污染其 byte-parity 契约（成功与失败混用同一 schema→比对语义模糊）。runner 顶层捕获 executor 原样透传的异常→映射成 ④，exit code≠0。

**★toolchainId 归一（byte-identical 比对的关键，Codex 抓的真陷阱）**：
- runner 与 aster-api **build 标识天然不同**（不同镜像/不同 CI）。若把完整 `ReplayMetadata`（含 `toolchainId`）逐字节比，会在**业务结果完全相同**时因 toolchainId 不同而误失败。
- **对照规则**：parity 比对 ReplayMetadata 时**排除 `toolchainId` 字段**（它是自报诊断，非业务承诺）；比对的是 `canonicalInputHash + canonicalOutputHash + canonicalizationVersion + replayabilityStatus + traceHash` 的逐字节一致。toolchainId 单独**记录**（供诊断 X→Y 漂移），不进比对判定。
- **toolchainId 是 runner 自报**（4 常量 + 1 env 复现，仅诊断；MVP 无 attestation，verifier 不信任它）。

**关键接口签名**（工程 spike 附 B 实证，runner main 直接消费）：
- `ReplayExecutionCore`（隐式 no-arg 构造）三阶段：`execute(ReplayExecutionRequest, ReplayExecutor) → ExecutionPhaseResult` / `buildDecisionTrace(ReplayExecutorResult, TraceAccess.DrainResult, boolean) → DecisionTrace` / `computeReplayMetadata(String toolchainId, Object context, ReplayExecutorResult, DecisionTrace, TraceAccess.DrainResult) → ReplayMetadata`。
- `ReplayExecutor` 接口（runner 供实现，仿 aster-api `ReplayExecutorAdapter`）：`execute(String tenantId, String source, Object context, String functionName, String locale, IdentifierIndex vocabIndex, boolean legacyEvaluateSentinel, Map<SemanticTokenKind,List<String>> aliasSet, boolean aliasesTrusted) → ReplayExecutorResult`；★异常**原样透传不 wrap**。
- `DynamicCnlExecutor` no-arg 构造 = `this(null,false)`（import-free）。

## 错误处理（fail-closed 铁律）

| 场景 | 处理 |
|---|---|
| policy 用 `import`（无 resolver）| runner **fail-closed 报错退出**（非静默降级）；exit code≠0，launcher 标记失败 |
| locale SPI 未加载全（缺 en/zh/de/hi）| runner 启动时**断言 4 locale 全在 classpath**，缺则 fail-closed（防 byte-parity 静默分叉——头号风险） |
| runner OOM / GraalVM 崩 | Job `restartPolicy: Never` + 有限 `backoffLimit`；launcher 收非零 exit→报失败不无穷重试 |
| launcher HMAC 验签失败 | 拒绝（403），不启 Job |
| executor 抛异常 | **原样透传**（`ReplayExecutor` 契约不 wrap）→ runner 顶层捕获→输出**独立错误 envelope ④**（errorCode/phase，★**不进 ReplayMetadata**，保 ReplayMetadata 只承成功执行）；errorCode 与 aster-api 四类 HTTP 映射同源；exit code≠0 |

## 测试策略（分层，honest——★两个 parity 门各证什么必须区分清，Codex 纠正）

**★对照定义（三门共用，定稿）**：
- **权威对照路径** = aster-api 生产 `evaluateSource(...replayCapture:true)` 产的 ReplayMetadata（同一 source×input×locale×functionName×aliasSet）。
- **语料（corpus）** = **import-free 子集**（首版 import-free fail-closed，故语料不含跨模块引用）；覆盖 en/zh/de/hi 四 locale + Decimal/Date 合规原语 + 代表性决策形态；固定在 repo（版本化 fixture）。
- **canonical 输出抽取** = ReplayMetadata canonical JSON，**排除 `toolchainId`**（见数据契约的归一规则）。
- **byte-identical 判定** = 抽取后逐字节相等（`canonicalInputHash+canonicalOutputHash+canonicalizationVersion+replayabilityStatus+traceHash`）。

1. **Task 0 前置风险门（一次性，阻塞 C–F；序在 A+B 最小切片之后——见架构 Task 0）**：podman 真构建 runner **application-distribution arm64 镜像**，真跑上述 corpus 一次 → 证 (a) **stock Zulu JRE 25 + Truffle 解释器能跑**（非 GraalVM JDK）；(b) 产的 ReplayMetadata 对权威对照**byte-identical**。★证的是 **Docker/arm64/stock-JRE/冷启动环境 parity**（容器内真跑）。若失败→B 的 Dockerfile 方案推倒（可能须 GraalVM JDK 基镜像）。
2. **CI parity 差分门（持续，每 PR）= 子系统 D**：**同 CI 容器内**双跑（aster-api 路径 vs runner application-distribution 路径）→ byte-identical。★只守 **JVM distribution parity**（同 JDK 同 classpath 下 runner 打包/locale 提升是否引入分叉），**不守** Docker/Job/arm64 环境（那是 Task 0 一次性 + E2E）。**两门互补，各证不同层**：D 守打包，Task 0/E2E 守运行时环境。
3. **launcher 单测**：HMAC 验签、Job spec 生成（digest-pinned、resource 封套、securityContext）、**并发/排队协议**（见容量约束）、Job 结果回收、错误路径。
4. **runner 单测**：main() 请求解析（schema ②）、import-free fail-closed、locale 断言、错误 envelope ④、成功响应 ③。
5. **端到端（本地 k3s/kind 或 podman）**：cloud→launcher→runner→回传全链一次（**这是唯一覆盖 launcher/Job 编排 parity 的门**——D 不覆盖）。

## 容量约束（工程 spike §2，实测驱动）

- 节点 4× A1.Flex 6GB 已 54–76% 满；`DynamicCnlExecutor` 注释警 GraalVM polyglot **2GB heap/并发 4 会 OOM**。
- request/limit 用**峰值 RSS + p95 冷启动 + 代表性 corpus 实测定**，非猜。
- ❌ 不用 `migrate-job.yaml` 的 128Mi/512Mi 封套跑 GraalVM（OOM）。可能须独立节点池/taint（现无，须建）或错峰。

**★并发控制所有权 + 协议（Codex 纠正——「全局并发 1」不能只是目标数字）**：
- **所有权 = launcher（子系统 E）**。launcher 是唯一建 Job 的主体，故并发上限由它持有并强制。
- **协议（定稿）**：launcher 维护「在飞 runner Job 计数」（默认上限 **1**）。收到 `/launch` 时：
  - 计数 < 上限 → 建 Job，计数+1；Job 终态（成功/失败/超时）→ 计数−1。
  - 计数 ≥ 上限 → **拒绝**（HTTP 429 + `Retry-After`），**不排队**（首版简单 fail-fast；cloud 侧 parity 旁路是非实时的，重试可接受）。
- **上限来源**：默认 1（承母 spike「单 Job 单 execution」）；**容量验收（测试策略/§2 契约）通过后才允许配置升至 2**——配置项非硬编码，但默认 1。
- **超时**：launcher 对每个 Job 设 watch 超时（> p95 冷启动+执行）；超时→**尝试读 Pod log**（可能有部分/无 envelope）→标失败（无有效 envelope 即记 timeout 错误 ④）→计数−1→删 Job。与下述"统一清理"一致：**任何终态（含超时）都先读 log 再删**。
- **Job 清理（正常终态+超时统一）**：launcher watch 到 Job 终态（Complete/Failed/超时）→**先读 Pod log 取 envelope**（成功=③ / 错误或缺失=④）→再删 Job（计数−1）；Job spec 另设 `ttlSecondsAfterFinished` 作兜底 GC（防 launcher 崩溃时 Job 泄漏）。**launcher 主动删（拿到 log 后）+ ttl 兜底** 双保险。
- **launcher 重启语义**：launcher 重启后，靠 label selector 枚举现存 runner Job 重建在飞计数（幂等 requestId label）；已终态但未回收的 Job，读 log 补回收后删。

## 破坏性 / 迁移

- **★"不改变生产 evaluate 数据流及返回语义"（收窄——非"零生产影响"，Codex 纠正）**：F 是独立 parity 旁路，`evaluateForCapture` 生产路径**逐字不动**，返回语义不变，runner 未接管任何真流量。**但确有生产侧新增面**：新 launcher 微服务消耗集群容量（已 54–76% 满的节点）、新 Cloudflare Tunnel 路由、新 SA+RBAC、新 admission CIP、`allowed-images.yaml` 新 entry——这些是**新增基础设施**（须评估容量/安全），不是"零影响"。
- 新 module `aster-replay-runner` + 新 launcher 微服务 + 新镜像 + 新 CIP entry + runner Job ns（贴 `policy.sigstore.dev/include=true` admission 标签）：纯增量。
- k3s `allowed-images.yaml` 加第 3 条 runner entry = **人工流程**（受 push ruleset 保护，非自动 PR）；runner 镜像 digest 由 C 的 image-pin-PR 提供，paired manifest（toolchainId↔digest 映射）归 **S2-1b**（MVP 无签名不产 manifest）。

## parity 声明的诚实边界（★Codex 纠正——避免夸大 parity 覆盖）

**S2-1a-2 的 parity 门分层证明不同的东西，别混为一谈**：
- **子系统 D（CI 双跑，持续）**：只证 **JVM distribution parity**——同 JDK/classpath 下 runner 的 `application` 打包 + locale 提升 **没引入分叉**。
- **Task 0（arm64 容器，一次性）**：证 **Docker/arm64/stock-JRE/冷启动环境 parity**。
- **E2E（本地全链，一次性）**：**唯一**证 **launcher/Job 编排 parity**（请求注入/结果回收链）。
- ❌ **无门证 executor 算法独立性**（那要 TS 二引擎，母 spike 已定非签字级）。
- ❌ **无门提供 attestation 安全性**（无签名；S2-1b 才有）。

## 范围外（本 MVP 不做）

- ❌ SPIRE / workload-bound 签名（S2-1b）。
- ❌ finalization receipt gate / 两档 policy（S2-1c）。
- ❌ 受签 ModuleClosure（首版 import-free fail-closed；ModuleClosure 另开独立协议 spike）。
- ❌ 接管生产 evaluateForCapture 流量。
- ❌ γ-SEV 硬件级（S2-2，长期）。

## 交叉审查

Claude 生成 spec → Codex 审（禁止自审）。writing-plans 出实现计划后，subagent-driven 执行，每任务 Codex/Claude 交叉审。
