# P0-A m1.5 架构 spike：runtime provenance verifier（真可签字 PASS 的路径）

**状态**: SPIKE（决策文档，非实现；等部署能力拍板后再落 epic）
**关联**: [[p0a-toolchain-trust-decision]]（Item 4 六层信任模型）、[[p0a-signability-policy]]（Item 4 F：`isSignablePass` 恒 false）、ADR 0030
**目标**: 让 `isSignablePass` 有条件转 `true`——产出**首个 CCO 可签字的绿色 PASS**（当前生态恒不可签字）。

## ★自审更正（诚实记录，承 Item 4 第一版风格）

本 spike 初稿的 **S2「cloud 自建 attested runner」被我自己的架构复审推翻其「绕开自证」的说法**——理由与 Item 4 第一版（把 cosign digest 误判为层3）**同构，第 7 次 declared≠real**：

> 「cloud 起个进程自签自己的执行证明」如果只是纯软件自签，它和「aster-api 自签」**同构**——被攻破的 cloud runner 用同一 key 仍能谎报加载了哪个 digest。**这是把「不信 aster-api 自报」偷换成「信 cloud 自报」，没有真正建立层3。**

**修正后的铁律**：**层3（runtime binding）没有纯软件捷径。** 它必须锚定在**执行者本身无法伪造**的根：
- **硬件根**：TPM measured-boot / confidential computing（SEV-SNP / TDX）attestation quote——CPU 证明「加载的镜像 measurement = X」，进程伪造不了。
- **或平台控制面根**：k8s admission 强制只跑 signed digest + SPIFFE workload identity 由控制面签发——信任根转移到**集群运营方**（比进程自签强，但仍是「信任集群运营方」而非密码学自证）。

S2 的**真实价值**因此收窄为：**把层3 的信任根从「aster-api 部署环境」搬到「cloud 部署平台」**——**仅当** cloud 平台有 admission/mesh/confidential-workload 而 aster-api 环境没有时才有意义。**「自建 runner」这个动作本身不解决层3**；解决层3 的永远是底下那个平台/硬件 attestation 根。下文 §2/§3 已按此更正。

---

## 0. 问题陈述（一句话）

Item 4 F 诚实降级后，`isSignablePass = status===PASS && signability===SIGNABLE` **恒 `false`**：任何声称跨升级安全的报告都带 `TOOLCHAIN_PROVENANCE_UNVERIFIED`（信任层 3 缺失），没有可翻 `true` 的开关。m1.5 = **建立信任层 3（runtime binding）+ 层 5（transition authorization）**，让特定条件下的报告能诚实地转 SIGNABLE。

**本 spike 不写实现**——它把「真正的决策点」摊开，因为层 3 的正确子方案**取决于部署平台能力**，这是代码问不出来的、必须你拍板的输入（ADR line 118-123）。

---

## 1. 已实证的现状资产（grep 确认，非臆断）

| 资产 | 位置 | 对 m1.5 的意义 |
|---|---|---|
| ✅ cloud **已有 Ed25519 验签**（Web Crypto，Node24+CF Workers 原生） | `aster-cloud/src/lib/license.ts:603` | cloud 能**验**非对称签名——验证端零新建 |
| ✅ **已有非对称签名权威**：`aster-deploy/services/license-signing-api`，2-人 approve+sign ceremony，**Vault Transit** 背书 | `aster-cloud/src/lib/license-signing-client.ts` | **签名端已存在**——不必在 aster-api 新建密钥管理（推翻 ADR Option B「全新密钥」的代价假设） |
| ✅ canonical JSON 双引擎 parity（跨引擎逐字节） | `rule-regression-runner.ts` computeReportHash | attestation payload 的 canonical 序列化直接复用 |
| ❌ aster-api **零非对称签名**（无 PrivateKey/KeyStore/Ed25519），只有对称 HMAC | `aster-api` grep 空 | aster-api **不能**自签自证层 3（自签进程被攻破用同一密钥仍谎报） |
| ❌ k3s **无 mesh/attestation/admission**（istio/linkerd/spiffe/cosign-policy 全空） | `aster-cloud-k3s/` grep 空 | 层 3 的「平台签响应」子方案**当前无基建** |
| ✅ CI **cosign 签镜像 digest** | `aster-api/deploy.yml:229` | 层 2（artifact authenticity）现成，但在部署管线不在响应路径 |

**关键推论**：签名权威（Vault Transit + 2-人 ceremony）**已存在且 cloud 已信任**。缺的不是「签名能力」，是**把签名绑定到「本次回放确实在受控 toolchain 里执行」的证明**（层 3）。

---

## 2. 信任层 × 覆盖矩阵（每个 MVP 切片诚实标到第几层）

回顾 [[p0a-toolchain-trust-decision]] 六层：1 唯一性 / 2 artifact authenticity / 3 runtime binding / 4 execution binding+freshness / 5 transition authorization / 6 semantic completeness。

| 切片 | 层1 | 层2 | 层3 | 层4 | 层5 | 层6 | 需要的新基建 | 产出的 signability |
|---|---|---|---|---|---|---|---|---|
| **现状（Item 4 F）** | 部分(dev) | ✗ | ✗ | ✗ | ✗ | ✗ | 无 | 恒 UNSIGNABLE（诚实） |
| **S0：修 build/core=真值** | ✅ | 索引 | ✗ | ✗ | ✗ | ✗ | aster-api 注入真 SHA | 仍 UNSIGNABLE（诚实，仅可观测性） |
| **S1：签名 upgrade-manifest（层5）** | ✅ | ✗ | ✗ | ✗ | ✅ | ✗ | 复用 signing-api 签 transition manifest | 仍 UNSIGNABLE（层3 缺，但**表达了批准的方向**） |
| **S2：cloud 侧 runner，锚定 cloud 平台 attestation** | ✅ | ✅ | ✅* | ✅ | ✅ | 部分 | cloud 起 pinned-digest runner **+ cloud 平台 attestation 根**（admission/mesh/confidential） | 可 SIGNABLE（*层3 强度=cloud 平台 attestation 强度，非「自建 runner」本身） |
| **S3：平台签响应（层3 aster-api 侧）** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | mesh/sidecar/confidential workload（**两侧 k3s 当前均无**） | 可 SIGNABLE（最完整，最贵） |

**★spike 核心洞察（已自审更正）**：层3 的信任根**必须**是执行者无法伪造的平台/硬件 attestation——**没有软件捷径**（见开头自审更正）。S2 与 S3 的区别**不是**「自证 vs 不自证」，而是**把层3 的 attestation 根放在哪个部署环境**：
- **S3（层3 根在 aster-api 环境）**：需 aster-api 部署平台把「响应体 + workload identity + image digest」一起签。k3s 当前无此基建。
- **S2（层3 根在 cloud 环境）**：把 replay 执行搬进 cloud 部署平台，**由 cloud 平台的 attestation**（admission 强制 signed digest / SPIFFE / confidential workload）证明「跑的是哪个 pinned aster-core」。**★S2 只在「cloud 平台有 attestation 能力而 aster-api 环境没有」时才优于 S3**；若两侧都没有平台 attestation，S2 和 S3 都到不了层3。「cloud 自建 runner」本身**不**是层3 的解——底下的平台 attestation 才是。

---

## 3. 三个候选 MVP 路线（按「首个可签字 PASS 的最短诚实路径」）

### 路线 α：S1 → S2（推荐评估，不依赖 mesh）
1. **S0**：aster-api 注入真 `core`/`build`（层1 补全，可观测性，独立价值，小）。
2. **S1**：signing-api 增 `purpose: 'regression-transition'`，签一个 **upgrade-manifest**（baseline toolchainId X → current Y，2-人 ceremony 批准）。cloud 验签 → 层 5 落地。**此时 signability 仍 UNSIGNABLE**（诚实：层3 缺），但报告携带「已批准的有方向升级」证据。
3. **S2**：cloud 侧 replay runner，**层3 根 = cloud 平台 attestation**（不是 runner 自签）——在 cloud 部署平台（需其提供 admission-enforced signed digest / SPIFFE / confidential workload）重跑 baseline+current。★关键：runner 的执行证明必须由**平台 attestation 根**背书，而非 runner 自己的软件 key（否则退化成 cloud 侧自证，见开头自审更正）。层3 强度 = cloud 平台 attestation 强度。
   - **★层3 attestation ≠ 层5 ceremony（两套机制，别混）**：层5 transition 批准是**稀疏、需人批**的事件 → 复用 signing-api 2-人 ceremony 合理（见路线 α 第 2 步 S1）。层3 replay-attestation 是**每次 run 都要、必须自动化**的 → **不能**用 2-人人工 ceremony（会卡死自动化）；它是平台自动签发的 workload-bound attestation（SPIFFE SVID / confidential quote），另一套信任根。
   - **可转 SIGNABLE 的条件**：报告 provenance 证据 = 平台 attestation 背书的执行证明 + pinned digest（层2/3）+ 批准的 manifest（层5，signing-api ceremony）+ execution binding（nonce+input/output hash+时间窗，层4）全部验签通过。`deriveUnsignableReasons` 增 m1.5 分支：这些证据齐 → **不加** `TOOLCHAIN_PROVENANCE_UNVERIFIED`。

### 路线 β：S3（最完整，重依赖）
上 service mesh / confidential workload，aster-api 响应由平台签。层 3-6 最完整，但 **k3s 当前无基建**，需先决定部署投资。**不推荐作为 MVP**（ADR：没定部署能力前不该铺开）。

### 路线 γ：只做 S0 + S1，暂不追 SIGNABLE
诚实承认层3 短期做不了，只补层1（可观测）+ 层5（批准方向），signability 维持 UNSIGNABLE 但报告证据更完整。**成本最低，不解锁签字**——适合「先不急着要绿 PASS，先把证据链补厚」。

---

## 4. 必须你拍板的决策点（代码问不出来的输入）

1. **哪个部署环境能提供平台 attestation？**（这是层3 的**唯一**真门槛，无软件捷径）——aster-api 环境有 admission/mesh/confidential-workload 吗（→S3）？cloud 部署平台有吗（→S2）？两侧都没有 → 层3 短期不可达，只能走 γ（补层1+5）。首个付费试点是 **on-prem k3s**（客户自有集群，能否要求装？）还是 **managed 边缘**？
2. **「可签字 PASS」的紧迫度**：试点**现在就要**绿色可签字报告，还是**先要厚证据链**（manifest+attestation）、可签字延后？——决定走 α（追 SIGNABLE，依赖决策1）还是 γ（先补证据，不依赖平台）。
3. **replay 执行位置**：replay 跑在 aster-api（→层3 必须 aster-api 环境有平台 attestation，S3）还是搬进 cloud 部署平台（→层3 靠 cloud 平台 attestation，S2）？★注意：**无论哪边，都必须有平台/硬件 attestation 根**——「换个进程自签」不解决层3（见开头自审更正）。
4. **签名机制分工 + 密钥分离**：层5 transition 批准复用 `license-signing-api` 2-人 ceremony（稀疏+需人批，语义匹配）——但建议**独立 Vault Transit keyId**（密钥分离 > 仅 `purpose` 字段分离，防 cross-protocol 混淆），而非同 key 换 `purpose`。层3 replay-attestation **另一套机制**（平台自动签发的 workload attestation，非人工 ceremony）。接受这个分工吗？

---

## 5. 推荐（诚实、最小、可增量）

**先做 S0（修 build/core=真值），并行出 S1 的 signing-api 契约草案**——这两步：
- S0 零风险、独立价值（层1 可观测，也是 Item 4 F 附带项）；
- S1 是**任何**追 SIGNABLE 路线（α）的必经前置（层5 授权），复用已有 signing-api ceremony（建议独立 keyId），不新建密钥管理；
- 两步都**不**假装解锁签字——signability 维持诚实 UNSIGNABLE，直到层3（平台 attestation）到位。

**层3（平台/硬件 attestation）是解锁首个可签字 PASS 的唯一真门槛，无软件捷径**（S2/S3 只是把 attestation 根放 cloud 还是 aster-api 环境）。这是中大型 epic，且**决策 1（哪个环境有平台 attestation）没定前不该动手**——否则会重蹈「自建 runner 自签=声明级」的覆辙。

> **一句话**：签名权威已经有了（Vault Transit + 2-人 ceremony，cloud 已信任）。m1.5 的真难点不是「怎么签」，是「签什么才诚实证明了 runtime binding」——而这取决于 replay 在哪执行、平台能提供什么。**先补层1+层5（S0+S1，复用现成 ceremony），层3 待部署决策。**

---

## 6. 本 spike 不做什么（防 scope 蔓延）

- ❌ 不写任何 m1.5 实现代码（等决策点拍板）。
- ❌ 不 bump reportHash 到 m1.5（无实现不冻版本）。
- ❌ 不碰 F-api 之外的 aster-api 改动（S0 是独立小 PR，可先行）。
- ❌ 不假设 mesh/confidential-workload 可用（k3s 现状无，S3 待部署投资决策）。
