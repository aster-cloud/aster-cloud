# Item 4 架构决策记录：P0-A toolchain 身份信任模型（runtime provenance）

**状态**: 待决策（纯 ADR，跨仓 epic；★第一版被独立审查退回——见下「修订说明」）
**关联**: ADR 0030（P0-A 回归工具）；[[p0a-db-sod-decision]]（声明级 vs 真身份信任边界方法论）；[[p0a-signability-policy]]

## ★修订说明（诚实记录）

本 ADR 第一版推荐「选项 C：绑 cosign 镜像 digest」并称其为「密码学级」——**被独立审查（Codex）退回 61**，
理由正确：**我犯了与 Item 3 同构的信任错误**——把「镜像 digest 被 CI 签过」当成「本次响应来自该镜像」。cosign
只证前者。`build=digest` 仍是 aster-api **自报的字符串**，只是指向一个密码学可验的 artifact——攻击者跑恶意镜像却
自报一个合法签名 digest，cloud 验签通过。这是**声明级 runtime 身份**，非真 provenance。本版按审查意见重写。

| Item 3（已修） | Item 4 第一版的错 |
|---|---|
| `approvedBy` 是自由声明 | `build=digest` 是自由声明 |
| 用户 ID 可能真实存在 | digest 可能确实被 cosign 签 |
| 不证明 INSERT 来自该用户 | **不证明响应来自该镜像** |

## 威胁模型（对称、完整版）

P0-1 的 M1 前提：baseline 在**旧** toolchain 冻结、run 在**新** toolchain 回放 → 报告证明「升级前后无漂移」。
当前 P0-1 只做 `baseline !== current && 非空`（`rule-regression-runner.ts:1185`）。真正要防的是**一整套**：

| # | 威胁 | 现状 |
|---|---|---|
| T1 | current toolchainId 伪造/新奇 → 假 signable PASS | ✗ 无 registry/manifest |
| T2 | current 逐字信任 aster-api 自报，从不校验值 | ✗ |
| T3 | **baseline 同样 aster-api 自报**（freeze 时）——攻击者可 freeze 伪造 baseline + run 伪造 current，选一对合法但不相关的身份 | ✗ ADR 第一版漏了 baseline 对称性 |
| T4 | **「不同」≠「升级」**：同源重构 digest 变但语义同 / 回滚 / 不同 channel / 无批准的升级关系 | ✗ `!==` 不表达「有方向的批准 transition」 |
| T5 | **「相等」≠「语义同」**：同 digest 下 JVM 参数/flag/config/外部 validator 版本仍可变 | ✗ digest 是锚非完整 identity |
| T6 | **runtime binding 缺失**：即使 digest 可验，也不证明**本次响应**来自该 digest 的实例 | ✗ 核心断层 |
| T7 | mixed-toolchain downgrade 只查一轮内多个 current（一致性），**不防统一伪造同一 digest** | ✗ 是一致性检查非来源认证 |

## 现状（两仓实证）

- **cloud**：P0-1 纯不等值；`runtimeToolchainId` 逐字信任（`policy-api.ts:67`→`policy-execution-log.ts:191`），
  进 caseHash/reportHash 仅作**完整性**（防篡改）非**授权**。无 toolchain registry/manifest。已有 Ed25519 验签基建
  （license trust bundle，`license.ts:474`）。
- **aster-api**：toolchainId = **`abi=1.0;core=dev;validator=1;build=dev`**——`core`（无 MANIFEST）和 `build`
  （`aster.runtime.build` 从不注入）都退化 `dev`。**无非对称签名基建**（零 PrivateKey/KeyStore），只有对称 HMAC。
  唯一非对称信任根 = **CI cosign 签镜像 digest**（`deploy.yml:229`）——在部署管线，**不在响应路径，不绑 toolchainId**。
- **toolchainId 外部不可验**：纯进程自报。

## ★信任分层（Codex：任何签字级 toolchain 证明必须逐层建立）

1. **唯一性**：ID 能区分构建/环境。（build 接真实标识——当前缺，`dev`）
2. **artifact authenticity**：digest 对应的镜像由认可 CI 签署。（cosign 现成）
3. **runtime binding**：**当前响应确实来自该 artifact**。（★最难，当前完全缺——这是 Item 4 的真核心）
4. **execution binding + freshness（防重放）**：证据绑定**本次执行**（请求 nonce + case/input hash + output hash +
   toolchain/env identity + 时间窗口）——否则即使响应来自合法 workload，也可能重放该 workload 的**旧**证明。（当前缺）
5. **transition authorization**：baseline→current 是**被批准的有方向升级**。（当前缺）
6. **semantic completeness**：ID 覆盖所有影响回放语义的运行状态（config/env/外部版本）。（当前缺）

「build 接 image digest」只解决第 1 层 + 为第 2 层提供索引，**不自动解决 3-6**。第 3 层（runtime binding）没有平台层
能力（workload attestation / mesh 身份 / sidecar 签响应）**无法**由 aster-api 自签自证——自签的进程若被攻破，用同一
密钥仍能谎报。

## 选项（★诚实标注每个选项真正证明到第几层）

### A：cloud registry（allowlist 批准的 toolchainId）
- **主要到第 1 层（限制可声明身份集合）**；只有 registry 条目来源本身经 cosign/provenance 验证时才**部分**触及
  第 2 层——普通管理员手填 allowlist 本身**不**提供 artifact authenticity。强度取决于攻击者能力——**仅控 api**：挡随机新 ID，但可冒充
  任一**已登记** ID；**控 api + registry writer**：完全失效；registry append-only/审批保护则更强。
- **不到第 3 层**：不证响应来自登记 artifact。当前 toolchainId=dev 时登记无意义。

### B：aster-api 签名 replayMetadata（cloud Ed25519 验签）
- **是「响应真实性」能力，不自动到第 2 层**（artifact authenticity）——普通私钥签只证「持钥者签发」，不证 digest
  对应镜像被 CI 签。**不到第 3 层**——被攻破的容器用同一私钥仍谎报。只有 key 与经 attestation 的 workload/artifact
  **绑定**后，才贡献 runtime provenance（第 3 层）。
- **代价**：aster-api 全新密钥管理（无现成）+ attestation 基建。

### C（第一版误判为最优，实为不到第 3 层）：绑 cosign 镜像 digest
- **到第 2 层**：证 digest 被 CI 签。**★不到第 3 层**——digest 仍自报，不证响应来自该镜像（见修订说明）。
- 要到第 3 层需组合 runtime binding（C1 可信部署控制面证明 endpoint→digest 且请求真路由到该 workload / C2 响应带
  workload-bound key 签名 / C3 sidecar/node/mesh attestation 签请求+响应+workload identity）。

### D：批准的 transition 授权（signed upgrade-manifest 或等价可信有方向授权）
- **第 5 层**：证「baseline X → current Y 被某主体批准」。**仍需**与 runtime binding 组合（不证实际执行环境是 X/Y）。
- ★**第 5 层授权能力非可选**，是签字级「受控升级」语义的必要组成（承 T4：`!==` 不表达批准的升级方向）。实现未必
  必须是 signed manifest——任何可信、有方向的授权机制等价。

### E：可信执行环境/部署证明（★真正解决第 3 层——但仅特定子方案）
不让 aster-api 自报身份，由**平台**提供绑定证明。★注意：单纯 k8s admission / workload identity / mesh 身份**本身
未必**证明响应来自特定镜像——**只有能把「响应/请求摘要 + workload identity + image/config digest」一起签署/证明的
具体子方案**才真正到第 3 层（如：mesh/sidecar 对响应体签 + 附 workload attestation；confidential workload 对响应
attestation）。依赖部署平台能力（on-prem k3s 可能有 mesh/admission；managed 边缘可能没）。

### F：诚实降级「跨升级证明」口径（★零基建，最务实起点，承 Item 2/3 方法论）
若无法建 runtime provenance，就**不声称**报告证明「旧→新升级安全」。报告只诚实证明：
> 「两次由后端**声明**为不同 toolchain 的执行，结果一致」——**声明级**，非可信 provenance。

**★明确决策（非"或"）**：无可信 toolchain runtime provenance 的报告 → **`signability=UNSIGNABLE`**（新增
`TOOLCHAIN_PROVENANCE_UNVERIFIED` 不可签字维度）。**不**保留「弱证据但仍可签字」——弱证据只能作**诊断展示**
（面板标注），**不得**保留签字资格。P0-1 **不再承担它证明不了的语义**。这与 [[p0a-signability-policy]]（m1.0 不可
签字）、[[p0a-db-sod-decision]]（声明身份 SoD）一脉相承——**诚实收窄口径，不假装**。

## 推荐（修订后）

**分两步，先诚实后加固：**

1. **立即（零跨仓基建）：选项 F**——诚实降级口径。当前 P0-1 的「跨升级证明」是**声明级**（baseline/current 都
   aster-api 自报，无 runtime provenance）。把这个事实反映进 signability：无可信 toolchain provenance 的报告，其
   「证明升级安全」口径降级（不冒充密码学级跨升级证明）。**这是眼下唯一能诚实交付的**，且和前三项方法论一致。
   附带修 `build=dev`（可观测性修复，第 1 层，独立价值）。

2. **后续 epic（依赖平台能力，需你定部署环境）：选项 E + 执行绑定 + D**——真 runtime provenance（第 3 层，平台
   attestation）+ execution binding/freshness 防重放（第 4 层）+ transition authorization（第 5 层）+ semantic env
   digest（第 6 层）。这是 aster-api ↔ cloud ↔ **部署平台**三方信任协议，工程量大且依赖 on-prem/managed 的
   attestation 能力。**不该在没定部署能力前铺开。**

签字级报告应承诺**完整 verification evidence**（非只 toolchainId）：artifact digest + provenance identity +
signature/bundle hash + workload/runtime binding + **request nonce + case/input/output hash + 时间窗（execution
binding/freshness）** + semantic-env digest + verification policy version + verified-at + approved transition
manifest hash。当前一样都没有——故 F（诚实标注证据缺失 → 降级为 UNSIGNABLE）是正确的第一步。

## 待你拍板的点

1. **接受修订后的分层认知**吗？——Item 4 的真核心是 **runtime provenance**（证明「谁执行了本次回放」），不是
   「toolchainId 字符串校验」；当前是**声明级**，我第一版把它说成密码学级（已诚实更正）。
2. **先做选项 F（诚实降级口径 + 修 build=dev）**？——零跨仓基建，立即可做，和前三项一脉相承。这也是我推荐的第一步。
3. **真 runtime provenance（E+D）**要不要启动？——依赖你的**部署平台能力**（有没有 service mesh / workload
   attestation / admission）。请先告诉我目标部署环境（on-prem k3s？managed 边缘？）能提供什么，我再评估 E 的可行性。
4. 还是 Item 4 到此**只落 ADR**、择日再启动实现？
