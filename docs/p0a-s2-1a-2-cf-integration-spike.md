# P0-A S2-1a-2「C–F」集成 spike：runner 接入真实编排链

**状态**: SPIKE（工程决策，非实现；Slice-1 A+B+Task0 已上线 PR#153，本 spike 定 C–F 落地边界 + 决策点，Codex 策略审通过后拆 spec/plan）
**日期**: 2026-07-20
**关联**:
- 工程 spike（架构真相源）: `p0a-s2-1a-2-runner-engineering-spike.md`（Codex 96 定稿；六子系统 A–F）
- 事实基础: `p0a-s2-1a-2-cf-research-factbase.md`（三仓 file:line 实证）
- β 母 spike: `p0a-s2-1-attested-runner-spike.md`（§8 阶段：S2-1b SPIRE/签名, S2-1c finalization）
- Slice-1（已上线）: aster-api PR#153（`aster-replay-runner` 模块 + arm64 Dockerfile + Task 0 风险门证 stock-JRE byte-identical）

---

## 0. ★最重要结论（先说）

**Slice-1 证明了 runner 能在 arm64 stock-JRE 容器 byte-identical 跑。C–F 把这个已验证的 runner 制品接入真实编排链：签名镜像（C）→ 持续 parity 门（D）→ in-cluster launcher 启 Job（E）→ cloud 旁路触发（F）。**

**★三个 load-bearing 现实约束（事实基础实证，决定 C–F 形状）**：
1. **k3s 无任何「建 Job 的 SA」先例**（唯一 workload SA=cloudflared 明确无 API 访问）。launcher 的 SA+Role(`batch/jobs:create`)+RoleBinding **净新**——GitOps 白名单允许，但**这是集群里第一个能建 Job 的服务**，安全审须认真（新 TCB 成员，承 §3b）。
2. **Cloudflare Tunnel 路由 dashboard-managed**（token tunnel，路由不在 git）→ launcher 的 HTTPS 入口**须带外在 Cloudflare Zero Trust dashboard 配**，无 in-repo YAML 可 PR。这是 GitOps 之外的手动步骤。
3. **arm64 parity 在 CI 须 QEMU**（GitHub ubuntu runner 是 amd64；Slice-1 的 `task0-arm64-parity.sh` 用 podman `--platform linux/arm64` 本地跑）——持续 parity 门要么 QEMU 要么自托管 arm64 runner，两者都有代价。

**★诚实边界（承工程 spike §4，不变）**：C–F 仍是 **integration/parity milestone，非 attestation 安全增量**。MVP 无签名（镜像 cosign 签的是层2 制品真实性，**非** runner 输出的 workload 签名）→ 不喂 signability gate、不解锁签字。SPIRE+签名归 S2-1b。F 是独立旁路，不改生产 evaluate 数据流。

---

## 1. C — 镜像 cosign 签名 workflow（aster-api CI）

**EXISTS（模板 `deploy.yml`，事实基础 §C 实证）**：3-job 结构（build→cosign keyless sign→image-pin-PR）+ arm64-content verifier + cert-identity 格式全现成。

**MUST BUILD**：新 workflow/job for `wontlost/aster-replay-runner`——build（`installDist` 先于 docker build，context `aster-replay-runner/`）→arm64-verify→`cosign sign`→image-pin-PR。新 cert-identity 串（新 workflow 文件名）。

**★决策点 C1（workflow 组织）**：runner 镜像 CI 是
- **(a) aster-api `deploy.yml` 加新 job**（同 workflow 多 job，共享 checkout/setup）——但 runner 与 aster-api 发版节奏耦合；或
- **(b) 新独立 workflow `aster-replay-runner-deploy.yml`**（独立触发/OIDC identity，解耦发版）——工程 spike §5 倾向此（独立 identity）。
推荐 **(b)**：runner 是独立制品，独立签名节奏 + 独立 cert-identity 更清晰（且 image-pin trust root 本就按镜像分条目）。

**★工程约束 C2（非决策点——Slice-1 已定，Codex 降级）**：runner 镜像 build 用 **CI 先 `./gradlew :aster-replay-runner:installDist` 再 `docker build`**（Dockerfile `COPY build/install/`，Slice-1 现状已验证 arm64 真跑）。这是既定约束不是选择——Slice-1 Dockerfile 已按此设计并通过 Task 0，spec 直接沿用。

---

## 2. D — CI parity 门持续化（aster-api CI）

**EXISTS（Slice-1）**：`task0-arm64-parity.sh`（podman arm64 真跑逐字节比 5 字段）+ `GenExpectedCorpusTest`（@QuarkusTest 驱动真生产 evaluateSource 产权威 expected）+ corpus。CI 已跑 @QuarkusTest（DB substrate 在）。

**MUST BUILD / ★张力**：持续 parity 门须进 CI。分两层（承 Slice-1 测试策略）：
- **JVM distribution parity（D-1，每 PR，便宜）**：`./gradlew :test --tests io.aster.replay.parity.GenExpectedCorpusTest`——同 CI 容器内驱动 aster-api evaluateSource + runner distribution 路径比对。**无需 arm64/QEMU**，只需现有 postgres substrate。守「runner 打包/locale 在同 JDK 下无分叉」。
- **arm64 环境 parity（D-2，贵）**：`task0-arm64-parity.sh` 真 arm64 容器跑。GitHub ubuntu=amd64→须 QEMU 或自托管 arm64 runner。

**★决策点 D1（D-2 arm64 容器 parity 的运行频率——三选一互斥，Codex）**。前提：D-1（distribution parity）**恒定每 PR 跑**（便宜，守打包分叉）；本决策只定 D-2 何时跑：
- **(a) 每 PR 跑**（QEMU on ubuntu binfmt，慢~数分钟；deploy.yml 有 QEMU preflight 模式可复用）；
- **(b) nightly 定时跑**（周期性覆盖 arm64 环境，不阻塞 PR）；
- **(c) 仅镜像发版门跑**（arm64 环境 parity 是「镜像构建产物」属性，只随镜像变才需重验；不进常规/nightly CI）。
推荐 **(c)**：arm64 环境 parity 是镜像属性，随镜像发版验一次即够；D-1 每 PR 已守 arm64 无关的打包分叉。避免每 PR QEMU 慢门 + 避免 nightly 冗余（镜像没变时 arm64 结果不会变）。(c) 是最小充分的互斥选择。

---

## 3. E — in-cluster launcher 微服务（k3s，最大工程 + 最大安全面）

**EXISTS**：Deployment+SA 硬化模板（cloudflare-tunnel）、GitOps RBAC 白名单已允许 batch/Job+Role+RoleBinding、ArgoCD ApplicationSet 自动发现（`apps/aster-lang/<name>/kustomization.yaml`）、runner Job 模板（migrate-job.yaml）、S2-0 admission 模式。

**MUST BUILD（★全是集群里的第一次）**：
- **launcher 服务本身**（新代码）：HTTPS API 收 cloud HMAC 调用 → 校验 → 建 digest-pinned runner Job → watch Job 终态 → 读 Pod log 取 stdout envelope → 回传 cloud。承工程 spike §3b 威胁模型：launcher 只编排不产证据、并发所有权（默认1超限429不排队）、Job 清理（先读 log 后删+ttl 兜底）。
- **launcher SA + Role + RoleBinding**（净新，集群第一个建 Job 的 SA）。★Role 完整权限（Codex——log 回收机制依赖）：`batch/jobs:create,get,list,watch,delete`（建/管 Job）+ **`pods:get,list,watch`**（发现 Job 拉起的 Pod）+ **`pods/log:get`**（读 stdout envelope）。缺 pods/log 权限则「读 Pod log 取 envelope」机制无法工作。
- **launcher Deployment + kustomization**（`apps/aster-lang/<name>/`，ArgoCD 自动发现）+ ns destinations 加白名单。
- **两个镜像的 cosign admission（★归属分清，Codex）**：复用 S2-0——**(a) launcher 镜像** `wontlost/aster-replay-launcher` 加 2 CIP（digest-verify + reject-tag）；**(b) runner 镜像** `wontlost/aster-replay-runner` 加 2 CIP（Slice-1 已产此镜像，C 签它）。共 4 新 CIP（现有 4 → 8）+ kustomization + **image-pin trust root `allowed-images.yaml` 加 2 条手动 entry**（runner + launcher，push-ruleset 保护非 auto-PR）。
- **runner Job ns 贴 `policy.sigstore.dev/include=true`**（手动/带外，否则 admission 静默失效）；launcher Deployment 的 ns 同样须贴（launcher 镜像 admission 才生效）。
- **Cloudflare Tunnel 路由**（dashboard 带外配 launcher HTTPS 入口）。

**★决策点 E1（launcher 实现语言/框架）**：launcher 是新服务，用什么写？（★「复用 aster-api 加 endpoint」不是选项——工程 spike §3b 否决：aster-api 正是 runner 要独立验证的对象，给它建 Job 权限=把被验证方放进启动链污染 TCB。launcher 必须是**独立服务**。）
- **(a) Go（推荐）**——K8s `client-go` 是集群原生 client、小镜像/快启动/低内存（launcher 是长驻编排服务，轻量占用重要，尤其节点已 54-76% 满）；缺点=团队新栈。
- **(b) Quarkus/Java**——团队熟、fabric8 K8s client 成熟；但 JVM 启动/内存重（长驻服务在已满节点上不理想）。
推荐 **(a) Go**：launcher 职责窄（收 HMAC→建 Job→watch→读 log→回传），K8s client-go 原生 + 轻量占用契合「长驻编排服务在紧资源节点」；Java 的团队熟悉度优势不抵其内存代价（且 launcher 逻辑简单，新栈学习成本低）。★这决定 launcher 镜像/CI/运维栈——若你更看重团队栈统一可选 (b)。

**★决策点 E2（launcher 是否 MVP 就上，还是先 stub）**：E 是 C–F 里最大工程 + 最大安全面（集群第一个建 Job 的服务）。
- **(a) MVP 就完整建 launcher**（大工程，但 F 的旁路才有真实 target）；
- **(b) 先做 C+D+F 的「本地 E2E」验证（podman 起 runner，不经 launcher/k3s），launcher 单独下一 slice**——把「runner 接入 cloud 旁路」与「launcher k3s 编排」解耦，降低单 slice 风险。
推荐待你拍板。★倾向 (b)：C（签名镜像）+D（parity 门）+F（cloud 旁路调用抽象）可先在无 launcher 下验证（cloud 调一个可替换的 runner endpoint），launcher 作为「集群第一个建 Job 的服务」值得独立 slice + 独立安全审。

---

## 4. F — cloud 触发旁路（aster-cloud）

**EXISTS**：`evaluateForCapture` 触发点、`signInternalCallerHeaders` HMAC、`PolicyApiClient.request` 外部 HTTPS+HMAC 模式、cloud 经公网 HTTPS 达 k3s（零 K8s）。

**MUST BUILD**：新 module 级 `launchRunnerJob(...)` 平行于 evaluateForCapture（**不改**它）+ 复用 HMAC scheme 调新 launcher baseURL（新 env `ASTER_RUNNER_LAUNCHER_URL`）+ 收 ReplayMetadata。新 `wrangler secret`。

**★F 的真实调用点 + 调用顺序 + 失败隔离（Codex——否则只是未用抽象非旁路）**：
- **真实调用点**：`launchRunnerJob` 由 **rule-regression 旁路验证入口**触发（一个新的、显式的 parity 验证动作——如 admin UI 的「跑 runner parity 检查」按钮，或一个专用 parity-check route），**不**在 `evaluateForCapture` 的两个生产 call site（rule-regression-runner.ts:1038/1287）内联。即 F 是一条**独立触发的旁路验证流**，与生产 rule-regression 报告生成流并行、不交织。
- **调用顺序（一次 parity 验证）**：旁路入口对同一 (source×input×locale×functionName×aliasSet) **并行**发两路——(1) `evaluateForCapture`（aster-api 生产路径，权威对照）；(2) `launchRunnerJob`（→launcher→runner Job→回传 ReplayMetadata）。两路都回来后**逐字节比对**（排除 toolchainId，同 D 的 5 字段）→ 记录/展示 parity 结果，**不喂 signability gate**。
- **失败隔离（关键）**：`launchRunnerJob` 失败（launcher 不可达/超时/Job 失败/HMAC 拒）**绝不影响** `evaluateForCapture` 生产路径——旁路验证流独立 try/catch，runner 侧失败只标记「parity 验证失败/不可用」，生产 rule-regression 报告照常产出。承工程 spike「不改变生产 evaluate 数据流及返回语义」：runner 旁路是**纯附加的验证信号**，永不阻塞或改变生产结果。

**★决策点 F1（HMAC key 复用）**：launcher 调用的 HMAC 用
- **(a) 复用 `ASTER_PLAN_GATE_HMAC_KEY`**（工程 spike §附B 提到；但与新 TCB 成员共享 aster-api plan-gate secret）；或
- **(b) 独立新 key `ASTER_RUNNER_LAUNCHER_HMAC_KEY`**（密钥隔离，承 S1 密钥分离原则——launcher 攻破不泄 plan-gate key）。
推荐 **(b)**：密钥隔离（承 S1 [[p0a-s1-upgrade-manifest-decisions]] 独立 keyId 原则）——launcher 是新 TCB 成员，独立 key 使其攻破面不牵连 aster-api plan-gate。

---

## 5. 推荐分阶段（C–F 可能拆多 slice）

承工程 spike §6，C–F 是 S2-1a-2 的剩余，但 E（launcher）体量+安全面大。建议拆两 slice。**★两 slice 都属 S2-1a-2；Slice-2a 不是 S2-1a-2 的完成态——S2-1a-2 完成 = Slice-2a + Slice-2b 都上线（真 in-cluster 编排跑通）。Slice-2a 只是「不碰 k3s 建 Job 面」的可控前置。**

**Slice-2a（C+D+F-abstraction，无 launcher/k3s——★S2-1a-2 的前置一半，非完成态）**：
- C：runner 镜像 cosign 签名 workflow（独立 workflow，C1-b）。
- D：parity 门持续化（D-1 每 PR distribution parity + D-2 arm64 parity 按 D1 拍板频率）。
- F：cloud `launchRunnerJob` 抽象 + HMAC（独立 key）——★调一个可配置 runner endpoint，**首版指向本地/stub target**（真 launcher 未上），**不改 evaluateForCapture**。★注意：stub target 下 F 只验证「cloud 旁路调用 + HMAC + 收 ReplayMetadata + 失败隔离」的**接线正确性**，不能声称「生产上线的编排价值」（真编排在 Slice-2b）。
- **本地 E2E**：cloud→（可替换 endpoint 指本地 runner）→回传 ReplayMetadata 全链一次。
- 价值：签名镜像 + 持续 parity 门 + cloud 旁路**接线**上线，风险可控，不碰 k3s 建 Job 面。**但 runner 尚未在集群真编排——那是 Slice-2b。**

**Slice-2b（E launcher，独立安全审——★S2-1a-2 的完成态）**：
- launcher 服务（语言待拍 E1）+ SA/Role/RoleBinding（集群第一个建 Job）+ Deployment/kustomization + admission CIP + tunnel 路由 + runner Job ns 标签。
- F 的 endpoint 从 stub 切到真 launcher。
- 价值：真 in-cluster 编排；但这是集群第一个建 Job 的服务，值得独立 slice + 认真安全审（§3b 威胁模型骨架落地）。

**S2-1b（SPIRE+签名）**：才解锁签字（母 spike §8）。

---

## 6. 必须你拍板的决策点（5 个；C2 是既定工程约束非决策——见 §1）

1. **C1 workflow 组织**：runner 镜像 CI = **独立 workflow（推荐，解耦发版+独立 cert-identity）** 还是 aster-api deploy.yml 加 job？
2. **D1 D-2 arm64 parity 频率**（D-1 恒每 PR）：每 PR QEMU（慢）／nightly／**仅镜像发版门（推荐，arm64 是镜像属性只随镜像变）**？
3. **E1 launcher 语言/框架**：**Go（推荐，client-go 原生+轻量占用，契合紧资源节点）** 还是 Quarkus/Java（团队熟但 JVM 重）？（复用 aster-api 已否决——污染 TCB）。
4. **E2 + 分阶段**：**Slice-2a（C+D+F-abstraction 不碰 k3s 建 Job）先上 + launcher 独立 Slice-2b（独立安全审）（推荐）** 还是 C–F 一刀全做（含 launcher）？★两 slice 都属 S2-1a-2，2a 非完成态。
5. **F1 HMAC key**：launcher 用**独立新 key（推荐，密钥隔离，承 S1）** 还是复用 plan-gate key？

---

## 7. 本 spike 不做什么
- ❌ 不写 C/D/E/F 任何实现（等拍板）。
- ❌ 不假装 launcher 是既有模式复用（集群无建 Job 的 SA 先例，是第一次）。
- ❌ 不假装 tunnel 路由能 GitOps PR（dashboard-managed，带外）。
- ❌ 不假装 MVP 有 attestation（镜像 cosign=层2 制品真实性≠runner 输出 workload 签名；无签名不解锁签字）。
- ❌ 不改生产 evaluateForCapture（F 独立旁路）。
- ❌ 不给 aster-api 加建 Job 权限（污染 TCB，§3b）。
