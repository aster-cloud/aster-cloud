# P0-A S2-1 架构 spike：cloud 侧 attested runner（β）——首个可签字绿 PASS 的落地路径

**状态**: SPIKE（决策文档，非实现；待用户拍板 runner 部署形态后再落 epic）
**日期**: 2026-07-19（Codex 退回 68 后重写：核心决策从「TS vs JVM 引擎」纠正为「runner 部署形态 + 双端证据 + workload-bound 签名」）
**关联**: [[p0a-s2-runtime-provenance-verifier-spike]]（S2 层3 spike，§4 五档 assurance + 非全序铁律 + m1.6 18 铁律）、[[p0a-item4f-provenance-honest-downgrade]]（Item 4 六层 + m1.X + ★"自报字段当开关=自证漏洞"教训）、[[m2-replay-payload-spike]]（M2 payload + liftDecimals gap）、S2-0（cosign admission 已上线 PR#91）、[[p0a-s1-upgrade-manifest-decisions]]（S1 签名基建 + isStoredManifestVerified 读路径重验模式）
**目标**: 产出**首个 CCO 可签字绿 PASS**——用户已拍板路线里**唯一解锁签字**的一步。★**注意（方案三 finalization，§7b）**：原报告诚实冻结 UNSIGNABLE，`isSignablePass(report)` 永不翻 true；「可签字」由**新入口 `isFinalizedSignablePass(report, verifiedContext)`**（先 `verifyFinalizationContext` 重验）派生（外部 finalization receipt 事实，非原报告字段）。

---

## 0. ★★最重要的诚实结论（先说，Codex 退回后纠正）

**β 的价值 = 抗「aster-api 进程被攻破自签谎言」，靠 cloud 侧独立重执行 exact Java artifact + 不信 aster-api 自报。达到 `PLATFORM_EXECUTION_VERIFIED` 档。不抗运营方（软件根，须 γ-SEV）。**

**★三个被 Codex 纠正的关键认知（我原稿都错/漏了）**：

1. **TS 重执行不是签字级 β 候选**（原稿把它当二选一之一是错的）。TS 引擎即便在语料上与 Java byte-parity，也只证明「另一套 TS 实现产出相同字节」，**不证明「被部署的 Java artifact 执行了」**。致命场景：新版 Java 因 bug 输出 Y，TS 仍输出 X → TS runner 判 PASS，**恰好漏掉 β 存在的意义（检测 Java 升级回归）**。→ **TS 降为非签字级 differential/parity checker**；签字级 β **只接受执行 exact Java artifact closure 的 runner**。

2. **真正的核心决策不是引擎语言，而是 runner 部署形态 + 双端版本化执行**（原稿把「引擎选择」当核心，掩盖了更关键的跨版本双端证据编排）。跨升级报告要绑 baseline(旧 toolchain)+current(新 toolchain) **两端**——单个常驻 runner **无法证明旧 baseline 的 provenance**（旧 baseline 无 attestation，不可事后补签，S2 spike 已定「须重 capture/freeze」）。→ 见 §3。

3. **中心 signing-api（signPayloadRaw）不是 workload-bound attestation 签名**（原稿建议直接复用是换错信任根）。它证明「中心 signing-api 批准并签了某 payload」，**不证明「payload 由某 SPIRE-attested runner 执行产生」**——攻击者控制 cloud 的 operator/witness 凭据即可提交伪造 ReplayMetadata 让中心签，根本不跑 runner（Item 4 F "布尔开关"漏洞变体）。→ 须 **runner workload-bound 内层签名（SVID）** + 可选中心 notarization 外层。见 §5。

**★两个我在第一次重写里引入、被 Codex 第二轮抓的新问题（已修）**：

4. **reportHash↔transition manifest 循环**（§7b）：原稿说「m1.6 reportHash 绑 transitionManifestHash」，但 S1 manifest 报告后签且绑 reportHash → 循环无法生成；且报告 signability 冻结后外部证据不能翻它。→ **方案三 finalization receipt**：原报告诚实 UNSIGNABLE 冻结，最终 SIGNABLE 是独立签名 receipt 派生的外部事实（非原 reportHash 自绑）。**S1 toolchainId ≠ runner image digest** → 补 §4b paired RunnerArtifactManifest。

5. **policy 又进 claims 派生**（§7）：原稿 `verifyRunnerEvidenceBundle(evidence, report, effectivePolicy)` 让 policy 影响 claims，重现 S2 spike 第4轮消除的循环。→ 严格单向：`证据→policy 无关 claims→evaluateSigningPolicy(claims,policy)→signability`。

---

## 1. 已实证现状（Explore agent + 直接核对，2026-07-19）

| 事实 | 证据 |
|---|---|
| 回放执行**现在在 aster-api**，cloud 远调 HMAC | `rule-regression-runner.ts:946` `evaluateForCapture`→`policy-api.ts:384`→`POST /evaluate-source?replayCapture=true` |
| 权威 hash **从 Java 返回**（cloud 零 ReplayMetadata 生产者，现全远调取或写 null） | `evaluateForCapture` 取 `resp.replayMetadata`；grep 只有消费者 |
| **ReplayMetadata 在 aster-api 层非纯 core**（含 DynamicCnlExecutor/Truffle/validator/trace drain/canonicalization） | `ReplayMetadata.java:58-74`,`compute` L108,`liftDecimals` L194-233；`PolicyEvaluationResource.evaluateSource` L423 |
| baseline 捕获来自 aster-api（`freezeFromExecutions` 用历史 toolchainId；`freezeHandwritten` 调当前 `evaluateForCapture`） | `rule-regression-runner.ts:1038,1287` |
| cloud **有 TS 引擎能执行**（`evaluate()`）但零 decimal-lift（parity gap 之一） | `aster-lang-ts@1.0.13` `browser.d.ts` `evaluate`；grep `liftDecimals/NON_INTEGER` **零命中** |
| **signability 单源** `deriveUnsignableReasons`（**同步纯函数**，无 provenance 开关，claiming 恒加 reason，派生冻进 reportHash 严格一致性检查不可 bypass） | `rule-regression-runner.ts:1497-1519`（injection L1512-1517）,`isSignablePass` L1736,`deriveReportSignabilityDetail` L1657 |
| S1 签名**中心双人 ceremony**（非 workload-bound）：`signPayloadRaw` 走 operator+witness JWT→`/v1/approve`+`/v1/sign`，中心 signing-api 签 | `license-signing-client.ts:219`（且 `signPayloadRaw` 现为 private + IS_SAAS gated） |
| S1 验证模板可复用：`verifyRegressionTransition`（受信 key 集查→Ed25519 验→purpose re-assert）+ 读路径重验 `isStoredManifestVerified` | `regression-transition-verify.ts`,`license-trust-bundle.ts` purpose 分派 |
| aster-core **是 JVM 库需 GraalVM Polyglot+Truffle**（cloud Next.js/CF 不能进程内跑） | `settings.gradle:22-33`,`build.gradle:99-106` |
| S2-0 admission（cosign-verified digest）已上线，可复用于 runner 镜像验签 | k3s PR#91 |

---

## 2. β 骨架（不管部署形态）

1. **独立重执行 exact Java artifact**：cloud verifier 触发一个**执行 exact、被 cosign-verified、被 attested 的 Java replay-execution 闭包**的 runner 重跑 source×input，**不接受 aster-api 自报结果/hash**。
2. **产 ReplayMetadata + workload-bound 执行证明**：runner 复用**共享的 Java replay-execution 模块**（含 `ReplayMetadata.compute`+`liftDecimals`+executor+trace wiring，**不复制否则新 Java↔Java 分叉**）算三 hash + 自报 toolchain（仅诊断）；用 **runner SVID 私钥**对执行 envelope 签（内层，workload-bound）。
3. **verifier 独立验证 + 派生 + 签 finalization receipt**：cloud verifier 验 SVID 链/SPIFFE ID/challenge/绑定/**平台观察的 actual imageID**→cosign digest→toolchain manifest→派生版本（runner 自报仅交叉核对，不一致 fail-closed，一致不加信任）；派生 policy 无关 capability claims；policy 消费后**签 finalization receipt**（§7b）。★原报告仍诚实 UNSIGNABLE 冻结；「可签字」= 消费端重验 receipt 后由 `isFinalizedSignablePass` 派生（§7），**不改** `deriveUnsignableReasons`。

**★铁律（承 S1/S2 m1.6 18 铁律）**：workload-bound 签名；verifier 独立派生 assurance（非自报）；绑 baseline+current 两端；challenge/freshness；完整 execution binding（source/input/case/golden/output/trace/imageID/toolchain）；缺失/失败/不匹配 fail-closed；证据不可拼接嫁接；旧 baseline 不可追溯补证。

---

## 3. ★核心决策 1：runner 部署形态（含双端版本化执行）

跨升级要 baseline(旧 digest)+current(新 digest) 两端各自被对应 runner 执行证明。**单个常驻 runner 证不了旧 baseline**。三个候选：

### 形态 A：常驻 JVM runner service（单版本）
- cloud 起一个长期 JVM workload（当前 toolchain）。
- **★致命缺陷**：只能产 current 端证据；**旧 baseline 无对应 runner**（旧 digest 的 runner 不存在）→ 旧 baseline 续 UNSIGNABLE，或须为每个历史版本常驻一个 runner（不可行）。**不推荐单独用**。

### 形态 B（Codex 推荐，第三形态）：verifier 按 digest 启短生命周期 digest-pinned K8s Job
- ★**正确流程（Codex 收口——transition 只有 toolchainId 无 digest，§4b）**：S1 transition 的 `baselineToolchainId`/`currentToolchainId` → verifier **分别解析并验签 baseline/current RunnerArtifactManifest** → 取得两个 `runnerImageDigest` → **分别启动两个 digest-pinned runner Job**（cosign-verified，SPIRE attested）→ 各跑同 source×input → 各产 workload-bound 证据 → verifier 验两端 + 签 finalization receipt（§7b）→ 完成后销毁运行实例但**保留签名证据**。
- **优点**：天然支持 baseline/current 不同版本；减少长期暴露攻击面；每次执行独立 challenge；易绑 Pod UID/imageID/job ID；旧 baseline 可用「其历史 digest 的 Job」重执行（若该 digest 仍可 cosign-verified 拉取）。
- **★旧 baseline 的诚实语义（Codex 本轮收窄——不是「恢复历史 provenance」）**：用旧 digest Job 现在重执行，证明的是「**现在重跑旧 artifact，结果仍匹配冻结 baseline commitment**」，**不是**「当初那次 baseline 捕获确实由该 artifact 执行」。流程须明确：
  1. 旧 artifact runner 现在重执行；
  2. 新产的 input/output/trace hash **必须与冻结 golden commitment 一致**；
  3. 一致 → 作为「当前重新认证旧 baseline」的新证据（非冒充原历史证据）；
  4. **不一致 → fail-closed**（含「digest 可拉但重执行不匹配」这种情况，非只「不可拉才重冻」）；
  5. 若选重冻 → 产**新 baseline + 新 case commitment + 新 transition 起点**，不冒充原历史证据。
- **★S2 上线前 baseline 不自动获同等资格**（承 S2 spike 不可追溯补证）。**首个可签字周期的现实流程**：
  ```
  部署 S2 runner X → 用 runner X 建立首个受证明 baseline → 保留 runner X artifact
  → 升级到 Y → runner X 与 runner Y 双端执行 → 形成首个签字级 X→Y 报告
  ```
- **达到档**：`PLATFORM_EXECUTION_VERIFIED`，双端齐。

### 形态 C：常驻 current runner + baseline 重冻策略
- 常驻 current runner 产 current 端；baseline 端一律**重 capture/freeze on current runner**（放弃「证明历史 Java 版本」，改为「用当前受信 runner 重新确立 baseline」）。
- **权衡**：简单（一个常驻 runner），但**改变 baseline 语义**（baseline 不再是「历史那次执行」而是「当前 runner 对同 source×input 的重跑」）——这对「检测 X→Y 升级回归」是否够？须确认回归语义（回归比的是 golden output hash，若 baseline 用 current runner 重立，则比的是「当前 runner 跑 baseline source 的 output」vs「当前 runner 跑 current source 的 output」，仍能捕获 source/policy 变更，但**捕获不到「Java toolchain 本身 X→Y 的行为漂移」**——而那正是跨升级回归的核心）。**故 C 弱于 B**。

**★形态对比**

| 维度 | A 常驻单版本 | B digest-pinned ephemeral Job（推荐） | C 常驻+baseline 重冻 |
|---|---|---|---|
| 双端版本化 | ✗（证不了旧 baseline） | ✅（old/new Job 各 pin digest） | 🟡（放弃证明历史 Java 版本） |
| 捕获 Java toolchain X→Y 漂移 | 🟡 | ✅ | ✗（baseline 用 current runner 重立） |
| 攻击面 | 长期暴露 | 短生命周期，小 | 长期暴露 |
| challenge/绑定 | 弱 | ✅ 每次独立 | 弱 |
| 运维 | 中 | 中（Job 编排 + 冷启动 × N） | 低 |
| 旧 digest 依赖 | — | 须旧 digest 仍 cosign-verifiable | 无 |

**★我的诚实倾向（非替你拍板）**：**形态 B（digest-pinned ephemeral Job）**——唯一能真正双端版本化、捕获 Java toolchain X→Y 漂移、绑定强、攻击面小。代价是 Job 编排 + 冷启动 + 旧 digest 须仍可 cosign-verified 拉取（不可则该 baseline 重冻）。

---

## 4. ★核心决策 2：runner 镜像构型（抗 common-mode compromise）

走 JVM runner，镜像**不应直接复用 aster-api 同镜像**（Codex 纠正：同镜像的共同失陷面 ≫ 供应链同源，还含共享可远程利用漏洞/无关 REST 攻击面/配置错误/共享 Secret/ServiceAccount/网络入口/依赖）。

- **构型**：从**共享的、固定版本的 Java replay-execution 模块**（core+truffle+validator+executor+ReplayMetadata+trace wiring，与 aster-api 同源代码同版本）构建**最小化专用 runner 镜像**——**不含** aster-api 的外部 REST、DB、管理端点、无关凭据。
- **效果**：复用同一执行代码（无 Java↔Java 分叉），又大幅减小 common-mode compromise 面。
- **★"抗 aster-api 攻破"成立的条件（Codex 收窄）**：独立 Pod + 独立 SVID/ServiceAccount + 独立触发链 + 不接受 aster-api 输入 + 独立 cosign-verified 最小镜像。满足这些，攻破一个 aster-api Pod 不自动取得 runner 的进程状态/SVID/signer/网络入口/challenge。

### 4b. ★paired RunnerArtifactManifest（Codex 本轮 P0——toolchainId ≠ runner image digest）

S1 transition manifest 签的是 `baselineToolchainId`/`currentToolchainId`（`regression-upgrade-manifest.ts`），**无 `oldDigest/newDigest`、无 runner image digest**。**toolchainId 是逻辑标识，runner image digest 是部署对象，二者非同物**——故 §3 由 transition 的 toolchainId **经本 paired manifest 解析** runner digest（非 transition 直接给 digest）。仅验「runner 镜像被 cosign 签过」只证镜像来源可信，**不证它与 S1 的 baseline/current toolchainId 对应**——须本 manifest 建立映射。

**须新增受签的 paired manifest**（baseline/current **各一份**，verifier 分别验）：
```
RunnerArtifactManifest {
  toolchainId,                    // 对应 S1 的 baseline 或 current toolchainId
  runnerImageDigest,             // 该端 runner Job pin 的镜像 digest
  replayExecutionArtifactDigest, // 共享 Java replay-execution 模块 digest/版本
  coreArtifactDigest,
  validatorVersion,
  canonicalizationVersion,
  graalVersion, jdkVersion,
  sourceCommit, buildProvenance
}
```
- verifier 派生链（§6）用它把 `platform 观察的 actual imageID → runnerImageDigest → toolchainId → 执行闭包版本`，**再与 S1 transition 的 baseline/current toolchainId 对齐**。
- 这份 manifest 的 hash（baseline/current 各一，有方向）进 finalization receipt（§7b）。
- **★manifest 签发信任根（Codex 补——否则攻击者拿合法 cosign runner 镜像伪造映射称对应目标 toolchainId）**：由**受信 release pipeline / 专用 artifact-manifest signing key** 签（**非 runner 自签自己的映射**），严格 domain-separate；谁授权 toolchainId↔runnerImageDigest 对应、是否绑 build provenance/SLSA、baseline/current 分别验、manifest 可撤销、sourceCommit 与 artifact digest 冲突时 fail-closed——落 epic。

---

## 5. ★核心决策 3：签名信任根——workload-bound 内层 + 可选中心外层

**原稿直接复用 `signPayloadRaw` 是换错信任根（Codex P0）。** 正确双层：

```
runner SVID/私钥
  签 execution envelope（内层，workload-bound）
       ↓
cloud verifier 验 SVID 链 + SPIFFE ID + actual imageID + challenge + 结果绑定
       ↓
可选：中心 signing-api 对「已验证的 verifier receipt / report commitment」做外层 notarization
```

- **内层（必须）**：runner 用 SVID 私钥签 envelope。证明「该 SPIFFE ID 的 workload 产出此 payload」——中心 signing-api **不能替代**。
- **外层（可选）**：中心 signing-api 继续用于 CCO/双人授权、长期归档、receipt notarization、policy authorization——但只签**已被 verifier 验证过的 receipt**，非直接签 runner 自交的 payload。
- **★短期 SVID 证书历史可验证**（S2 spike 铁律 5/18）：保存 SVID 证书链 + 当时 trust bundle + verifier acceptance receipt + evidence digest + 可信时间/透明日志锚点（否则数月后不能复验）。
- **★实例关联（Codex 本轮——envelope 里的 Pod UID 是自报，不够）**：恶意 runner 可自报别的 Pod UID。须由下述之一把「签名证书 ↔ SPIFFE workload ↔ 实际响应连接 ↔ Pod UID ↔ actual imageID」闭合：(a) SPIRE registration entry 含足够严格的 k8s selectors（把 SVID 绑到具体 runner，非所有 runner 共用宽泛 SPIFFE ID）；(b) runner controller 签发绑定 SVID/cert 指纹 ↔ Pod UID/imageID 的 receipt；(c) verifier 经受认证 mTLS 连接 + 平台 endpoint→Pod 映射确认响应副本。

---

## 6. ★核心决策 4：assurance verifier 派生链（非自报）

runner 自报 `runtimeToolchainId` **仅诊断，不作 gate 真值**。verifier 必须独立确认（Codex 给的链）：

1. 证据签名对应受信 SPIFFE ID；
2. challenge/nonce/audience/request ID 正确且未消费；
3. 签名 envelope 绑 source/input/case/golden/output/trace；
4. **实际响应副本对应哪个 Pod UID**；
5. 从**受信平台观察**取该 Pod 的 actual `imageID`（非自报）；
6. **该 imageID 的 cosign identity/build provenance 直接重验**（★Codex 本轮——admission 放行状态**不是历史验签证据**：admission 是部署时强制，读路径不能只信「据说当时 admission 放行了」；须 evidence acceptance 时直接重验 cosign，或验一个由 admission/controller 签发且绑 Pod UID/imageID/policy version/时间的 receipt）；
7. digest 对应受信 toolchain manifest；
8. manifest 映射 core/validator/build/canonicalization/JDK/GraalVM 版本；
9. runner 自报 toolchain 与派生值**一致才继续**（不一致 fail-closed；一致本身不加信任）；
10. baseline/current 分别对应批准 transition 的两端。

全过才派生 capability claims：`workloadIdentityVerified` / `artifactBound` / `executionChallengeBound` / `independentExecutionVerified`。**绝不因 payload 写了档位或 toolchain 就移除 reason。**

---

## 7. ★核心决策 5：m1.6 gate 接口（唯一调用链，非旁路）

**`deriveUnsignableReasons` 是同步纯函数，不能内联验签/SVID/IO**（Codex 上轮 P0）。★**且 policy 必须与 claims 派生正交**（Codex 本轮 P0——原稿把 `effectivePolicy` 传进 verifier 重现了 S2 spike 第4轮消除的循环）。定义**严格单向、policy 独立**的调用链：

★**唯一链终止于 finalized signability，`deriveUnsignableReasons` 完全不碰 runner evidence/claims/policy**（Codex 第4轮收口——原稿把 claims 喂回 `deriveUnsignableReasons` 是保留了「receipt 改原报告」的旧口径 A，与 §7b 选的方案 B 冲突，删净）：
```
// 第1步：policy 无关的客观证据验证 → 客观 claims（不含任何 policy 输入）
verifyRunnerEvidenceBundle(evidence, report, assuranceSchema)
    → VerifiedProvenanceClaims        // 仅由 verifier 依证据 + 固定 schema 产生；报告存储的 claims 不能直接传入

// 第2步：policy 消费客观 claims（求包含/严格累计，非序号）
evaluateSigningPolicy(verifiedClaims, effectivePolicy)
    → PolicyEvaluation

// 第3步：签 finalization receipt（绑全部已验对象，§7b）
buildAndSignFinalizationReceipt(report, verifiedClaims, policyEvaluation, activeTransition, evidence)

// 第4步：读路径每次重验 → 受验上下文（不能从 DB JSON 直接反序列化）
verifyFinalizationContext(report, rawReceipt, activeTransition, effectivePolicy)
    → VerifiedFinalizationContext     // 只能由统一 verifier 构造；重验 receipt 签名/expiry/transition 未撤销未过期/policy 未弱化替换/reportHash 匹配/schema/purpose/key 可信/防 rollback

// 第5步：纯函数依受验上下文派生最终状态
deriveFinalizedSignability(report, verifiedContext)
    → FINALIZED_SIGNABLE | NOT_FINALIZED_SIGNABLE
```
★**`deriveUnsignableReasons(cases, status, version)` 签名不变**——**不接收** runner evidence / claims / policySatisfied；继续只描述原报告创建时事实（含恒加 `TOOLCHAIN_PROVENANCE_UNVERIFIED`）。原报告永远 UNSIGNABLE。

- **`effectivePolicy` 绝不进 `verifyRunnerEvidenceBundle`**——claims 是客观事实（policy 无关），policy 只在第2步消费。这样 assurance 与 policy 正交（承 S2 spike 铁律 16），无循环。
- ★`VerifiedProvenanceClaims` 的类型名**不是安全边界**：构造须不可外部调用 + claims 绑可重验的 evidence/receipt + 每读路径重验 + 禁从 DB 的 claims JSON 直接反序列化使用。
- **gate 判定非裸序号**（承 S2 非全序铁律）：`evaluateSigningPolicy` 对 **capability claims 集合求包含**（或严格累计 profile 逐项验），**禁 `assurance ≥ level`**。

★★**关键收口（方案三下唯一状态入口）**：因为原报告诚实冻结 UNSIGNABLE（§7b），**原 `isSignablePass(report)` 永远返回 false，原报告的 `signability`/`unsignableReasons` 永不重写、永不重新解释**。上面五步链的最终入口：
```
// I/O 验证编排集中在异步外层，先构造受验上下文
verifyFinalizationContext(report, rawReceipt, activeTransition, effectivePolicy)
    → VerifiedFinalizationContext   // 只能由统一 verifier 构造；每读路径重构造；禁 DB JSON 直接反序列化

// 业务派生保持纯函数，只接受受验上下文（★不接受 raw receipt——否则调用方直传 DB 里任意 receipt=「行存在即 verified」漏洞）
isFinalizedSignablePass(report, verifiedContext): boolean   // CCO/UI/export 唯一最终「可签字」入口
```
- `deriveUnsignableReasons` **继续只描述原报告创建时事实**（含恒加 `TOOLCHAIN_PROVENANCE_UNVERIFIED`）——**不因 receipt 存在而不加 reason**（receipt 不反向改原报告派生事实，否则撞冻结严格一致性检查）。
- 消费端（CCO/UI/export）判「可签字」= 先 `verifyFinalizationContext`（验 receipt 签名/expiry + active transition 未撤销未过期 + policy 未弱化替换 + reportHash 匹配 +防 rollback）再 `isFinalizedSignablePass`，**不读原报告 `signability`**。
- 历史 m1.0-m1.5 逐字冻结不动。★**reportHash 是否 bump 待实现计划定**：方案三下**原报告格式若不变则未必 bump m1.6**；需 bump 的是 **finalization 协议版本**（`finalizationReceiptSchemaVersion`），非 reportHash 公式。

### 7b. ★避免 reportHash↔transition manifest 循环 + 冻结声明冲突（Codex 本轮 P0，最严重）

**原稿「m1.6 reportHash 绑 transitionManifestHash」有密码学循环**：S1 的 transition manifest 是**报告创建后**签发的，其签名体绑 `reportHash`（`regression-upgrade-manifest.ts`）。若 reportHash 又含 transitionManifestHash → `reportHash 需 manifestHash 需 reportHash`，按现协议**无法生成**。且**时序冲突**：报告创建时 `signability`/`unsignableReasons` 已冻进 reportHash；创建时无 provenance 证据应 UNSIGNABLE，事后加外部证据**不能让冻结声明自动变 SIGNABLE**（否则撞严格一致性检查）。

**★采用方案三（finalization receipt，对现有 S1 结构改动最小，Codex 推荐）**：
- **reportHash 不含任何后置证据**（不含 transitionManifestHash / runner evidence hash）——原始 reportHash 只绑报告创建时的客观事实，创建时无 provenance → **诚实 UNSIGNABLE 冻结**。
- 最终 SIGNABLE **不是原报告冻结事实，而是一个独立签名的 finalization receipt 派生的事实**。**完整协议**（Codex 第3轮补全）：
  ```
  FinalizationReceipt {
    schemaVersion, purpose: "regression-finalization", receiptId,
    reportHash,                              // 既有冻结报告（单向引用，无环）
    transitionManifestHash,                  // S1 层5（单向绑既有 reportHash）
    baselineToolchainId, currentToolchainId,
    baselineEvidenceHash, currentEvidenceHash,           // 双端 workload-bound 证据（有方向）
    baselineRunnerArtifactManifestHash,                  // §4b paired，★拆两个有方向字段
    currentRunnerArtifactManifestHash,                   //   （防角色互换/单端遗漏/拼接）
    evidenceVerificationReceiptHash,         // ★先生成的证据验证 receipt（非本 receipt 自身，避免自引用）
    verifiedClaimsDigest, policyEvaluationResult,   // ★规范化值且进签名体；消费端重算或由受信 finalization signer 作最终证明，不只读布尔
    effectivePolicyId/version, assuranceSchemaId/version,
    challengeSessionId, issuedAt, expiresAt,
    verifierKeyId, signature                 // 由 finalization signer 签
  }
  ```
- 消费端（UI/导出/CCO）判「可签字」= **验 finalization receipt**（读路径重验签，mirror `isStoredManifestVerified`）+ **重验 active transition 仍有效**，**不是**读原报告的 `signability` 字段。
- ★**诚实收窄**：**不能同时声称「原 reportHash 自身已绑所有证据」和「finalization receipt 派生」**——本 spike 取后者：原报告诚实 UNSIGNABLE，SIGNABLE 是 receipt 派生的外部事实（唯一入口 `isFinalizedSignablePass`，§7）。
- **★finalization signer 信任根（Codex 补，须列入 TCB）**：谁拥有 finalization signer / 公钥由哪个 trust bundle 管理（复用 S1 purpose 分派加第 4/5 purpose `regression-finalization`）/ purpose domain separation / key rotation active-verify-only-retired / **compromised cloud verifier 是否在威胁模型内**（β 信任 cloud verifier，须明确列入 TCB）/ 是否再经中心双人 notarization。
- **★撤销/过期语义（Codex 补）**：S1 transition 支持过期+撤销 → 消费时**每次重验 transition 仍有效**（撤销后既有 receipt 应失效）；policy 撤销/替换使 receipt 失效；新 receipt 替代旧的**防 rollback 到较弱 policy**。否则 receipt 把可撤销授权永久固化。
- **备选（若要「报告自身即 SIGNABLE」语义）**：方案一预授权 transition（执行前签 `authorizationId` 绑 policyId/baseline/current toolchain/policy/有效期，**与 reportHash 无关**；报告把 authorizationHash 纳入 reportHash——无循环）。但预授权改 S1 时序较大，**首版取方案三**。

---

## 8. 推荐分阶段

**S2-1a（runner + 双端执行编排，最难）**：按 §3 拍板形态（倾向 B ephemeral Job）→ 构建最小化专用 runner 镜像（§4，共享 Java replay 模块非复制）+ paired RunnerArtifactManifest（§4b，受信 pipeline 签）→ SPIRE attest + runner 镜像 cosign admission（复用 S2-0）→ verifier 由 transition toolchainId **经 paired manifest 解析 runner digest** 启双端 Job → 旧 baseline 重冻规则。**先出这一步详细工程 spike/plan**（大工程）。

**S2-1b（workload-bound 签名 + verifier 派生链）**：runner SVID 内层签 envelope（§5）；verifier 派生链（§6）；可选中心 notarization 外层。

**S2-1c（finalized signability 接口 + 两档 policy）**：完整唯一链（§7，不可省 receipt 签发 + 受验上下文两步）：`verifyRunnerEvidenceBundle → VerifiedProvenanceClaims → evaluateSigningPolicy → PolicyEvaluation → buildAndSignFinalizationReceipt → verifyFinalizationContext → VerifiedFinalizationContext → deriveFinalizedSignability/isFinalizedSignablePass`；capability claims 集合判定（非序号）；两档 signingPolicy（`PLATFORM_EXECUTION_VERIFIED` 解锁 / `HARDWARE_EXECUTION_BOUND` 待 γ）。★**FinalizationReceipt commitment 完整绑定**所有后置证据（§7b）——**非** reportHash 绑定；原 reportHash 只冻结原报告自身，是否 bump m1.6 待实现计划定（原报告格式不变则未必 bump；需 bump 的是 `finalizationReceiptSchemaVersion`）。

**TS 引擎（非签字级）**：可并行做为 **differential/parity checker**——补 TS liftDecimals + 回归语料 TS↔Java hash 差分测试，用于**检测第二实现分歧 / 推进 tier1-parity**，但**不喂 signability gate**。

**S2-2（长期 γ-SEV）**：银行档抗运营方（非本 spike）。

---

## 9. 决策点（★用户已拍板 2026-07-19）

**已拍板**：①runner 形态 = **B digest-pinned ephemeral Job**；②部署位置 = **on-prem k3s 同 aster-api 集群**（复用 S2 PSAT 根 + S2-0 admission；cloud→runner mTLS/challenge）；③最终 SIGNABLE = **方案三 finalization receipt**（原报告永 UNSIGNABLE 冻结，`isFinalizedSignablePass` 唯一入口）；④signing policy 首档 = **`PLATFORM_EXECUTION_VERIFIED`**；⑤旧 baseline = 形态 B 蕴含（旧 digest 可 cosign-verified→其 Job 重执行须匹配冻结 commitment 否则 fail-closed；不可拉/不匹配→重冻）。下一步 = **先出 S2-1a 工程 spike/plan**。

### 原决策点全文（存档）

1. **runner 部署形态：形态 B（digest-pinned ephemeral Job，推荐）还是 C（常驻+baseline 重冻）？**（§3）——B 能捕获 Java toolchain X→Y 漂移、双端版本化、绑定强，但要 Job 编排 + 旧 digest 须仍 cosign-verifiable；C 简单但放弃证明历史 Java 版本（baseline 语义变，捕获不到 toolchain 漂移）。这是 S2-1 epic 形态总开关。
2. **runner 部署位置**：on-prem k3s（同 aster-api 集群，复用 S2 spike PSAT 根 + S2-0 admission）还是独立节点？runner 触发链（cloud→runner）是否 mTLS/challenge 防又一个自报面。
3. **旧 baseline 策略**：旧 digest 仍可 cosign-verified 拉取时用其 Job 重执行，否则重冻——接受「S2 上线前无 provenance 的 baseline 一律重冻」？
4. **signing policy 首档 re-confirm**：首个付费试点定 `PLATFORM_EXECUTION_VERIFIED`（β 解锁）——与 S2 spike 拍板一致。★m1.6 是**能力里程碑**（S2 finalization v1），**不必等于 reportHash 版本**（原报告格式不变则 reportHash 未必 bump，见 §7b）。
5. **workload-bound 签名根**：runner SVID（SPIRE）内层签 + 中心 signing-api 仅可选外层 notarization——确认这个双层（而非中心签 runner payload）？
6. **★最终 SIGNABLE 事实来源（本 spike 已默认取方案三，此处请你确认或改选）**：**方案三 finalization receipt**（默认，改 S1 最小）——原报告诚实 UNSIGNABLE 冻结，SIGNABLE 是独立签名 receipt 派生的外部事实，消费端验 receipt。**备选方案一预授权 transition**——执行前签 authorizationId（与 reportHash 无关），报告把 authorizationHash 纳入 reportHash，报告自身即可 SIGNABLE（但改 S1 时序较大）。若你偏好「报告自身即 SIGNABLE」语义则改选方案一，否则确认方案三。

---

## 10. 本 spike 不做什么

- ❌ 不写任何 β 实现（等形态拍板）。
- ❌ 本 spike 不执行版本变更；reportHash 是否 bump 由实现计划定（§7b），`finalizationReceiptSchemaVersion` 必须独立版本化。
- ❌ 不把 TS 引擎当签字级 β（它是 differential checker；byte-parity ≠ Java artifact provenance）。
- ❌ 不用中心 signing-api 替代 runner workload-bound 签名。
- ❌ 不让执行证明旁路冻结派生（必须走 §7 完整唯一链：`verifyRunnerEvidenceBundle → claims → evaluateSigningPolicy → buildAndSignFinalizationReceipt → verifyFinalizationContext → deriveFinalizedSignability`；★`deriveUnsignableReasons` 不在此链，只描述原报告创建时事实）。
- ❌ 不假装 β 抗运营方（软件根，须 γ-SEV）。
- ❌ 不给旧 baseline 事后补签（不可追溯补证；须重冻）。
- ❌ 不让 policy 进 claims 派生（policy 与 assurance 正交，单向链）。
- ❌ 不让 reportHash 绑 transitionManifestHash（循环）；SIGNABLE 由 finalization receipt 派生非原 reportHash 自绑。
- ❌ 不把 runner 镜像 cosign 签过当作与 S1 toolchainId 对应的证明（须 paired RunnerArtifactManifest 映射）。
- ❌ 不把 admission 放行状态当长期读路径证据（须重验 cosign 或验平台 receipt）。
- ❌ 不信 envelope 自报 Pod UID（须 SVID selector / controller receipt / mTLS 平台映射闭合实例关联）。

## 附：引用路径说明
本文引用 `aster-api/...`、`aster-cloud/...` 为跨仓（相对本仓 aster-cloud 需 `../aster-api/`）。证据由 Explore agent 各仓实证 + 主 AI 核对（liftDecimals 零命中 TS / deriveUnsignableReasons 同步纯函数无 provenance 开关 / signPayloadRaw 中心双人 ceremony / core 是 JVM 库需 GraalVM）。Codex 交叉审查退回 68 后重写核心决策。
