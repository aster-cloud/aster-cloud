# S2-1a-2 Slice-2a 设计（spec）：C 镜像签名 + D parity 门持续化 + F cloud 旁路抽象

**日期**: 2026-07-20
**状态**: SPEC（承 C–F 集成 spike 5 决策点已拍板；Codex 首审退回 5 blocker → 本版逐条修复；下一步 writing-plans）
**关联**:
- C–F 集成 spike（决策依据）: `p0a-s2-1a-2-cf-integration-spike.md`（Codex 98；5 决策点拍板）
- 事实基础: `p0a-s2-1a-2-cf-research-factbase.md`（三仓 file:line 实证）
- Slice-1（已上线 PR#153）: runner 模块 `aster-replay-runner`（stdin→stdout replay executor, application 打包, arm64 stock-JRE 镜像, Task 0 风险门证 byte-identical）+ `GenExpectedCorpusTest`（@QuarkusTest 驱动 aster-api evaluateSource 产权威 expected）+ `task0-arm64-parity.sh`（podman arm64 逐字节比 5 字段）。

---

## 目标（一句话）

把已上线的 runner 制品接入「签名 + 持续 parity + cloud 旁路」链路的**前置一半**：C（runner 镜像 cosign 签名 workflow）+ D（CI parity 门持续化）+ F（cloud `launchRunnerJob` 旁路抽象，调**可配置 runner endpoint**，首版 stub/local target）。**不碰 k3s 建 Job 面**（launcher = Slice-2b）。

## 诚实边界（承 spike，铁律）

- **Slice-2a 非 S2-1a-2 完成态**：S2-1a-2 完成 = Slice-2a + Slice-2b（launcher 真 in-cluster 编排）都上线。Slice-2a 是「不碰 k3s 建 Job 面」的可控前置。
- **F 在 stub target 下只验证接线正确性**（cloud 旁路调用 + 独立 HMAC + 收 ReplayMetadata + 失败隔离），**不能声称生产编排价值**（真编排在 Slice-2b）。
- **镜像 cosign = 层2 制品真实性，非 runner 输出的 workload 签名**（那是 S2-1b）。MVP 无 attestation、不喂 signability gate、不解锁签字。
- **F 不改生产 `evaluateForCapture`**（独立旁路验证流，纯附加信号，失败绝不影响生产 rule-regression）。

## 术语校准（承 Codex 审 blocker 5 — 全文单源）

**parity 比对的 5 字段（byte-compare）= ReplayMetadata 里除 `runtimeToolchainId` 外的 5 个 replay-critical 字段**，与真实 record `io.aster.policy.replay.ReplayMetadata`（`replay/src/main/java/io/aster/policy/replay/ReplayMetadata.java:58-74`）对齐：

| 参与 byte-compare 的 5 字段 | 排除字段 |
|---|---|
| `canonicalInputHash`、`canonicalOutputHash`、`canonicalizationVersion`、`replayabilityStatus`、`traceHash` | `runtimeToolchainId`（runner build= 段天然不同，见 `task0-arm64-parity.sh:39-41`）|

★**排除字段的真实名是 `runtimeToolchainId`**（record 第 1 字段，`ReplayMetadata.java:59`；cloud 侧 `PolicyReplayMetadata.runtimeToolchainId?`，`policy-api.ts:69`）。**本 spec 早期草稿误写 `toolchainId`，全文已改正为 `runtimeToolchainId`**。（`reasonCodes`/`replayabilityReasons`/M2 `canonicalInput|Output|Trace` 串字段不参与本 MVP 的 5 字段比对。）

★**「逐字节比 5 字段」的精确语义（Codex 第2轮——避免实现者误加序列化顺序/空白/envelope 结构比较）**：全文「逐字节比 5 字段」= **从两侧各抽取上述 5 个字段值，逐字段 `assertEquals`（归一后值完全一致）**，**不是**字面比较整个 ReplayMetadata JSON/envelope 的字节（A 是 aster-api REST 序列化的 `replayMetadata` JSON，B 是 `RunnerEnvelope.replayMetadata()` 反序列化对象——两者 JSON 序列化顺序/空白/结构可不同，只有 5 字段的**值**才是 replay-critical 比对对象）。D-1（in-JVM `assertEquals`）与 D-2（容器 `jq -S` 抽字段比对）均按此 per-field 归一语义。

## 架构

三子系统，跨两仓。C+D 在 aster-api，F 在 aster-cloud。

| # | 子系统 | 仓 | 责任 | 拍板反映 |
|---|---|---|---|---|
| C | runner 镜像 cosign 签名 workflow | aster-api | 新 `.github/workflows/aster-replay-runner-deploy.yml`：**4 job**（build 出 digest → sign `needs:build` → **parity-arm64 `needs:[build,sign]`（=D-2）** → image-pin `needs:[build,sign,parity-arm64]`），复用 `setup-aster-build`，`installDist`→`docker build`（arm64）→arm64-content-verify→cosign keyless sign+verify→arm64 parity 门→image-pin-PR（k3s allowed-images 加 runner entry）| C1=独立 workflow；C2=installDist 先于 docker build |
| D | CI parity 门持续化 | aster-api | **D-1（每 PR）**：新 @QuarkusTest `RunnerDistributionParityTest`（`:test` 加 `testImplementation project(':aster-replay-runner')`，同 host JVM 内 aster-api `evaluateSource` vs `RunnerMain.run()` 逐字节比 5 字段，无 arm64/QEMU）；**D-2（镜像发版门）**：C 的 workflow 里的独立 `parity-arm64` job（job-3，`needs:[build,sign]`），对 **C 刚 push/签的 `@DIGEST`** 拉取并跑 corpus（QEMU on ubuntu，全程 docker，不 rebuild）| D1=D-1每PR+D-2仅发版门 |
| F | cloud 旁路抽象 | aster-cloud | 新 `launchRunnerJob(...)` + 新 runner-launcher client（复用 `signInternalCallerHeaders` 7 行 canonical，独立 key `ASTER_RUNNER_LAUNCHER_HMAC_KEY`，新 env `ASTER_RUNNER_LAUNCHER_URL`）+ 独立 parity 验证入口（并行发 evaluateForCapture+launchRunnerJob 比对，失败隔离）；首版 endpoint 指 stub/local | F1=独立 HMAC key；F 独立旁路不改 evaluateForCapture |

## 子系统 C：runner 镜像 cosign 签名 workflow（aster-api）

**新文件** `.github/workflows/aster-replay-runner-deploy.yml`，仿 `deploy.yml` 结构（事实基础 §C；已核 `deploy.yml` 全文）。**4 job 闭合结构**（build→sign→parity-arm64（D-2）→image-pin；承 Codex 审 blocker 3 — job 边界/digest 输出/`needs`/stale-guard 数据流必须闭合，对齐 `deploy.yml` 现成机制）。★D-2（arm64 parity 门）作为 `parity-arm64` job 嵌在此 workflow（详见 §D-2），故本 workflow 是 4 job：

### C.job-1 `build`（出已验签前的 digest）
- `runs-on: ubuntu-latest`；`permissions: id-token:write / contents:read`（keyless OIDC，与 `deploy.yml:88-93` 一致）。
- **checkout 主仓到 `./aster-api`**（★`setup-aster-build` 是 local composite action，前提是先把 aster-api 检出到 `./aster-api`，见 `setup-aster-build/action.yml:7-10` 的鸡生蛋注释）：
  ```yaml
  - uses: actions/checkout@v7
    with: { path: aster-api }
  ```
- **`uses: ./aster-api/.github/actions/setup-aster-build`**（★**不是** `setup-java@v5`——`deploy.yml:62-67` 已改用此 composite action 统一「检出 7 个兄弟仓 + JDK 25 temurin + 发布共享版本目录到 Maven Local」；单独 `setup-java` 会缺 composite includeBuild 的兄弟仓源码与版本目录，构建即失败）：
  ```yaml
  - uses: ./aster-api/.github/actions/setup-aster-build
    with:
      cross-repo-token: ${{ secrets.CROSS_REPO_TOKEN }}
      require-cross-repo-token: "true"   # 部署链路 fail-closed（同 deploy.yml:67）
  ```
- `./gradlew :aster-replay-runner:installDist`（★C2：先于 docker build，产 `aster-replay-runner/build/install/aster-replay-runner/` 供 Dockerfile COPY；`working-directory: aster-api`）。
- `docker/setup-qemu-action@v4` + `docker/setup-buildx-action@v4` + `docker/login-action@v4`（DOCKER_USERNAME/PASSWORD，同 `deploy.yml:141-150`）。
- **`docker/build-push-action@v7`**（`id: build`，`context: aster-api/aster-replay-runner`, `file: aster-api/aster-replay-runner/Dockerfile`, `platforms: linux/arm64`, `provenance: false`, `sbom: false`, `pull: true`, tags `wontlost/aster-replay-runner:${sha7}`+`:jvm-latest`）——**输出 `steps.build.outputs.digest`**（同 `deploy.yml:161-185` 的 digest 提取模式）。
- **arm64-content verifier**（仿 `deploy.yml:192-216`）：QEMU preflight（`alpine:latest` uname 须 aarch64）→ 拉 `wontlost/aster-replay-runner@${DIGEST}` at `--platform linux/arm64` 断言 in-image `uname -m == aarch64`，否则**构建即失败**（杜绝 mislabeled amd64→arm64 镜像）。
- **job outputs**：`digest: ${{ steps.build.outputs.digest }}`（供 sign job 与 image-pin job `needs.build.outputs.digest`）。

### C.job-2 `sign`（`needs: build`）
- `permissions: id-token:write / contents:read`。
- `sigstore/cosign-installer@v3` → `cosign sign "wontlost/aster-replay-runner@${{ needs.build.outputs.digest }}"`（`env COSIGN_YES: "true"`）→ `cosign verify`：
  ```
  --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/\.github/workflows/aster-replay-runner-deploy\.yml@refs/heads/main$"
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
  ```
  ★identity-regexp 里 workflow 文件名必须是 `aster-replay-runner-deploy.yml`（本 workflow 自身文件名），不是 `deploy.yml`。**sign/verify 均对不可变 `@DIGEST` 做**（非浮动 tag），消除 signed-rollback（与 `deploy.yml:218-253` 一致）。

### C.job-4 `image-pin-pr`（★`needs: [build, sign, parity-arm64]`——Codex 第2轮抓的 needs 数据流 bug + D-2 fail-closed）
> ★job 顺序：job-1 `build` → job-2 `sign` → **job-3 `parity-arm64`（=D-2，见 §D-2）** → job-4 `image-pin-pr`。
- ★**`needs: [build, sign, parity-arm64]`（不是只 `needs: sign`）**：GitHub Actions 的 `needs` context **只暴露直接声明的依赖**——若只 `needs: sign`，则 `needs.build.outputs.digest` **未定义**（`sign→build` 不自动透传 build 的 outputs）。故 image-pin 必须**直接 needs build**（拿 digest）+ **sign**（保证签名先完成）+ **parity-arm64**（D-2 arm64 环境 parity 过才 pin，见 §D-2 fail-closed）。digest 读 `needs.build.outputs.digest`（build 是 digest 的产出者，image-pin 直接依赖它）。
- `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.IMAGE_PIN_APP_ID != ''`（同 `deploy.yml:275`；本 job 不做部署，只开 PR）。
- **Final stale gate**（承 blocker 3 的 stale-guard 数据流；仿 `deploy.yml:281-291`）：`git ls-remote https://github.com/${{ github.repository }}.git refs/heads/main` 取 tip，`GITHUB_SHA != tip` → `skip=true`（下次 push 重建，避免开过时 PR）。
- mint k3s-scoped App token（`actions/create-github-app-token@v3.2.0`，`client-id: vars.IMAGE_PIN_APP_CLIENT_ID`，owner `wontlost-ltd`，repositories `k3s`，`permission-contents: write` / `permission-pull-requests: write`，同 `deploy.yml:296-304`）→ checkout 本仓取共享脚本 → `bash scripts/ci/open-image-pin-pr.sh docker.io/wontlost/aster-replay-runner image-pin/aster-replay-runner`（env `DIGEST: ${{ needs.build.outputs.digest }}`，`SOURCE_SHA: github.sha`，`RUN_ID: github.run_id`）。

### C.触发（承 Codex 审 blocker 4 — path filter 不完整 + 与 stale/freshness 机制冲突）
```yaml
on:
  push:
    branches: [main]
    paths:
      - '.github/workflows/aster-replay-runner-deploy.yml'   # workflow 自身
      - 'aster-replay-runner/**'                             # runner 模块
      - 'replay/**'                                          # ★runner implementation project(':replay')（build.gradle:29）
      - 'build.gradle'                                       # ★根构建配置（root implementation project(':replay')，build.gradle:91）
      - 'settings.gradle'                                    # ★include 'aster-replay-runner'（settings.gradle:7）
  workflow_dispatch:
```
★**与 freshness/stale 机制的调和（blocker 4 核心）**：`deploy.yml` 刻意**不用 `paths-ignore`**，因它的 stale-guard 是「`github.sha == origin/main tip`」，前提是「每个 main commit 都有自己的 deploy run 接手」（`deploy.yml:6-11` 注释）。本 workflow **用 `paths`（白名单）而非 `paths-ignore`（黑名单）**——两者语义不同：
- `paths` 白名单只在 runner 制品的**真实输入**（workflow/runner/replay/根构建配置）变化时触发，**不会**制造 deploy.yml 那种「docs-only 提交前进 tip 但无 run 接手」的死角：runner 镜像的 digest 只由这些输入决定，与之无关的提交前进 tip **不改变 runner 制品**，故无需为它们跑 runner-deploy。
- 但**同一 stale-guard 仍必须保留**：若两个 runner-相关提交 A、B 紧邻上 main，A 的 run 在 build 期间 B 已成 tip，则 A 的 `image-pin-pr` 的 Final stale gate 会判 A 过时并 skip，交由 B 的 run 接手（B 一定触发，因它也命中 `paths`）——freshness 由 stale gate 保证，`paths` 白名单只是「无关提交不触发」，二者不冲突。
- ★**不可退化为 `aster-replay-runner/**` 单条**（早期草稿的错）：`replay/**` 改动会改变 runner 复用的 `ReplayExecutionCore`/canonical 逻辑 → 影响 5 字段 hash，却不触发 runner-deploy → 签的镜像与 main 上的 :replay 语义漂移。根 `build.gradle`/`settings.gradle` 同理（改依赖版本/模块装配影响制品）。

**★k3s 侧（image-pin PR 落地 + admission）**：runner 镜像上线须 k3s 加 CIP + trust root——但这属 Slice-2a 的 k3s 配置（不建 Job，只 admission 白名单），与 launcher 无关：
- `allowed-images.yaml` 加第 3 条 runner entry（手动，push-ruleset 保护）。
- 2 CIP（digest-verify + reject-tag for `wontlost/aster-replay-runner`）+ kustomization。
- ★注意：runner Job 由 launcher 建（Slice-2b），Slice-2a 无 runner Job 跑，故 admission 此刻不 fire（预置 CIP 为 Slice-2b 铺路）。

## 子系统 D：CI parity 门持续化（aster-api）

### D-1（★真 distribution-parity 门，每 PR，无 arm64/QEMU）—— 承 Codex 审 blocker 1（CRITICAL）

**问题（blocker 1）**：早期草稿说 D-1 跑 `GenExpectedCorpusTest` 并「断言 runner distribution vs 权威 5 字段 byte-identical」——**这是假的**。核 `GenExpectedCorpusTest.java` 缺省跑（无 `-Dparity.gen.expected`）**只驱动 aster-api `evaluateSource` REST 端点并断言 `REPLAYABLE`**（`:132-199`），**从不启动 runner distribution、也从不比对**。真正的 runner-vs-权威比对**只**在容器脚本 `task0-arm64-parity.sh` 里。所以照草稿实现，D-1 是**空门**（守不住 runner 打包/locale 分叉）。

**修复：新建真门 @QuarkusTest `RunnerDistributionParityTest`（aster-api `:test`）**，在**同一 host JVM 内**同时驱动两侧并逐字节比 5 字段——无 arm64/QEMU、每 PR 可跑。可行性已核实**无循环依赖**：
- `aster-replay-runner/build.gradle:29` = `implementation project(':replay')`；
- 根 `build.gradle:91` = `implementation project(':replay')`；
- 故新增 `aster-api-test → :aster-replay-runner`（→ `:replay`）与 `aster-api → :replay` 构成 **DAG（无环）**——`:aster-replay-runner` 不依赖根项目。

**a) 依赖新增**（根 `build.gradle` 的 test 依赖段）：
```gradle
testImplementation project(':aster-replay-runner')   // 让 :test 能在 host JVM 内直接调 RunnerMain.run()
```
★**为何 test-only 依赖**：runner distribution 是独立 application 制品，生产 aster-api 运行时**不**依赖它；只有 parity 测试需要在 host 进程内驱动 runner 代码路径。

**b) 测试逻辑**（对 corpus 每个 fixture）：
- **权威侧 A**：复用 `GenExpectedCorpusTest` 同款 HMAC harness（`POST /api/v1/policies/evaluate-source?replayCapture=true`，`HmacProfile` 关全局签名 + 强制 HMAC 校验路径，`GenExpectedCorpusTest.java:56-124`）→ 取响应 `replayMetadata` = **ReplayMetadata_A（权威）**。
- **runner distribution 侧 B**：把同一 corpus fixture 映射为 `RunnerRequest`（record 字段 `tenantId/source/input/locale/functionName/aliasSet`，`RunnerRequest.java:12-19`），序列化为 JSON，**IN-JVM 调用 `RunnerMain.run(InputStream stdin, PrintStream stdout) → int`**（真实签名，`RunnerMain.java:31`）：喂 `ByteArrayInputStream(reqJson)`，捕获 `ByteArrayOutputStream`，取 stdout **最后一行**反序列化为 `RunnerEnvelope`（`outcome/replayMetadata/errorCode/message/phase`，`RunnerEnvelope.java:12-25`）。断言 `envelope.outcome() == "SUCCESS"`，取 `envelope.replayMetadata()` = **ReplayMetadata_B（runner distribution，同 host JVM）**。
- **byte-compare 5 字段**：对 A、B 各取 `{canonicalInputHash, canonicalOutputHash, canonicalizationVersion, replayabilityStatus, traceHash}`（**排除 `runtimeToolchainId`**——A、B 的 build= 段天然不同），逐字段 `assertEquals`。任一分叉 → 测试红（守住「runner 打包/locale/依赖装配在同 JDK 下无分叉」）。

**c) 与 `GenExpectedCorpusTest` 的分工（保留，不删）**：
- `RunnerDistributionParityTest` = D-1 真 distribution-parity 门（每 PR，host JVM 内 A vs B）。
- `GenExpectedCorpusTest` = **保留为 D-2 的 expected.json 生成器**（`-Dparity.gen.expected=true` 由 `gen-expected.sh` 传入，产权威基线供 arm64 容器比对，`GenExpectedCorpusTest.java:183-189`）+ 缺省跑作为「corpus 每 fixture 在 aster-api 生产路径可编译执行且 REPLAYABLE」的 oracle。两个测试职责不重叠。

**d) 运行（CI 接线）**：在 `ci.yml` build job（已备 postgres/redis substrate + `setup-aster-build`）后加 step 或让 `./gradlew build` 覆盖：
```
./gradlew :test --tests "io.aster.replay.parity.RunnerDistributionParityTest"
```
★根项目 `:test`（非 `:aster-replay-runner:test`）——`RunnerDistributionParityTest` 是 @QuarkusTest，须跑在 aster-api 的 Quarkus test classpath 里（含 REST harness + testImplementation 的 runner）。**每 PR 跑**。

### D-2（★arm64 环境 parity，绑定 push 的签名 digest，镜像发版门）—— 承 Codex 审 blocker 2

**问题（blocker 2）**：早期草稿在 C 的 workflow 里跑 `task0-arm64-parity.sh` 原样。核该脚本（`task0-arm64-parity.sh:32-36`）：它 `installDist` 后 **`podman build --platform linux/arm64 -t aster-replay-runner:task0 .` 重新本地构建一个镜像**并 `podman run` 它——**验证的是一个与 C job-1 push/签的 `@DIGEST` 不同的镜像**。于是「签的镜像」与「parity 测的镜像」不是同一制品，签名保证落空。

**修复：D-2 必须对 C 刚 push/签的 `@DIGEST` 本体跑 corpus parity（不 rebuild）**。

★**D-2 是 C workflow 里的独立 job `parity-arm64`，`needs: [build, sign]`（Codex 第2轮——job 归属 + 容器运行时统一）**，序在 `sign` 之后、`image-pin-pr` 之前（image-pin 也应 `needs` parity-arm64，见下 fail-closed）：
- `runs-on: ubuntu-latest`；`docker/setup-qemu-action@v4`（binfmt arm64 emulation）。
- **先产权威 expected**：checkout `path: aster-api` + `setup-aster-build` + postgres/redis service → 跑 `gen-expected.sh`（= `GenExpectedCorpusTest` 加 `-Dparity.gen.expected=true`，@QuarkusTest 产权威 `*.expected.json`）。
- ★**容器运行时统一用 docker（不混 podman）——Codex 抓的不可重复隐患**：早期草稿 `docker pull` 但复用 `task0-arm64-parity.sh` 的 `podman run`——docker 与 podman **各自独立本地镜像存储**，`docker pull` 的镜像 podman 看不到（反之亦然），会不可重复/取错镜像。**D-2 全程用 docker**：先把 digest 存进 step env `DIGEST: ${{ needs.build.outputs.digest }}`（单源），再 `docker pull --platform linux/arm64 "wontlost/aster-replay-runner@${DIGEST}"` → `docker run -i --platform linux/arm64 "wontlost/aster-replay-runner@${DIGEST}" < req.json | tail -n1` → `jq -S "$FIELDS"` 比对 5 字段。★镜像引用全程 `wontlost/aster-replay-runner@${DIGEST}`（`${DIGEST}` = `needs.build.outputs.digest` 单源），不写裸 `${{ }}` 表达式于 shell 中段避免转义/引用歧义。
- **实现要求**：`task0-arm64-parity.sh` 须**参数化**（镜像引用 `$IMAGE` + 容器运行时命令），使同一比对逻辑既能本地 podman（Task 0 开发者手跑）又能 CI docker（D-2）——或在 `parity-arm64` job 内内联等价 docker 比对逻辑指向 `@DIGEST`。★核心不变量：**比对的镜像 = `wontlost/aster-replay-runner@${DIGEST}`（push 的签名制品），非任何 rebuild 的本地镜像**。
- ★**digest-binding 铁律**：D-2 测的镜像 == C 签的镜像 == image-pin PR pin 进 k3s 的镜像（同一 `@DIGEST`）。任何 rebuild 都破坏此等式。
- **fail-closed**：`image-pin-pr` 的 `needs` 加 `parity-arm64`——D-2 分叉/失败 → image-pin 不跑（签名制品**不 pin 上 k3s**）。故 `image-pin-pr.needs: [build, sign, parity-arm64]`（build 拿 digest / sign 保证已签 / parity-arm64 保证 arm64 环境 parity 过）。
- **仅镜像发版时跑**（arm64 是镜像属性，只随镜像变；QEMU on ubuntu）。

## 子系统 F：cloud 旁路抽象（aster-cloud）—— 承 Codex 审 blocker 5（合约必须现在锁定）

**blocker 5 定性**：F 的 launcher-call 是 **Slice-2b 真 launcher 必须实现的接口契约**。合约不能推给实现——本 spec 现在就把它锁死为 **stub↔launcher 兼容契约**。stub（2a）与真 launcher（2b）都必须满足下列合约。

### F.1 launcher 调用合约（stub 2a ↔ launcher 2b 必须逐字兼容）

| 合约项 | 规格（锁定） |
|---|---|
| **method + path** | `POST ${ASTER_RUNNER_LAUNCHER_URL}/api/v1/runner/launch`（path 归一名 = `/api/v1/runner/launch`，用于 HMAC canonical 的 path 段）|
| **请求 envelope（fields）** | JSON，字段与 `RunnerRequest`（`RunnerRequest.java:12-19`）一一对应：`{ tenantId: string, source: string, input: unknown, locale: string, functionName?: string, aliasSet?: Record<string,string[]> }`。★字段名/语义**必须**与 runner 的 `RunnerRequest` record 完全一致（launcher 直接透传给 runner stdin）。|
| **成功响应 envelope** | HTTP 200 + `{ outcome: "SUCCESS", replayMetadata: PolicyReplayMetadata }`——形状对齐 `RunnerEnvelope`（`RunnerEnvelope.java:12-25`）的成功分支；`replayMetadata` 对齐 `PolicyReplayMetadata`（`policy-api.ts:67-84`，含 `runtimeToolchainId?` 等）。|
| **错误响应 envelope** | HTTP 200 + `{ outcome: "ERROR", errorCode: "PARSE"\|"EXECUTION"\|"MODULE"\|"INTERNAL", message: string, phase: "parse"\|"execute"\|"trace"\|"metadata" }`——对齐 `RunnerEnvelope` 错误分支（`RunnerEnvelope.java:22-24`）。★runner 执行失败（如源码不可编译）是 **`outcome:"ERROR"` 的 200 业务响应**，**非** HTTP 4xx/5xx——client 须按 `outcome` 分类，不按 HTTP status。|
| **HTTP 层失败** | 非 200 / 网络不可达 / 超时 → 归类为「runner 不可用」（见 F.3 判别联合类型 `runner-unavailable`）。|
| **timeout / abort** | 复用 `policy-api.ts:262-263,319-320` 的 `AbortController` + `setTimeout(abort, timeout)` 模式：新 env `ASTER_RUNNER_LAUNCHER_TIMEOUT`（缺省 30000ms）；超时 `AbortError` → 归 `runner-unavailable`（不抛进权威路径）。|
| **HMAC 发送方（cloud→launcher）** | 复用 `signInternalCallerHeaders` 的 **7 行 canonical**（`api-signing.ts:100-128`：`method\npath\nts\nnonce\nbodySha256\ntenant\nrole`），但**用独立 key**——见 F.2。|
| **★HMAC 接收方（launcher/stub 必须真验，不能只 accept）** | stub（2a）与真 launcher（2b）**必须实际校验 HMAC**：按同一 7 行 canonical 用 `ASTER_RUNNER_LAUNCHER_HMAC_KEY` 重算签名，比对 `X-Internal-Signature`；时间戳 5min 窗口 + nonce 去重（与 aster-api `InternalCallerFilter` 同款语义）。**验签失败 → 拒（4xx）**，client 侧归 `runner-unavailable`（HMAC 拒也是不可达的一种）。★2a stub 也必须真验——否则 2a 就没验证「独立 HMAC 接线正确」这条唯一有意义的接线，退化成假门。|

### F.2 独立 HMAC key（F1 拍板）—— 复用 canonical，换 key

`signInternalCallerHeaders`（`api-signing.ts:100-128`）**硬编码** `process.env.ASTER_PLAN_GATE_HMAC_KEY`（`:107`）且硬编码 `X-Internal-Caller: 'cloud-bff'`（`:123`）。F 需独立 key，故**新增 `signRunnerLauncherHeaders(method, path, body?, tenantId?, role?)`**（放 `api-signing.ts`），**逐字节复用同一 7 行 canonical 构造**（同 `sha256Hex`/`hmacSha256`/`generateNonce`/timestamp 秒/nonce），仅两处不同：
- secret 从 `process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY`（缺失 throw，与 `:108-110` 同款 fail-loud）。
- `X-Internal-Caller` 值 = `'cloud-runner-launcher'`（与 `'cloud-bff'` 区分调用方身份，便于 launcher 侧审计）。

★**不改 `signInternalCallerHeaders`**（生产 evaluate-source 路径逐字节依赖它，破坏即 403）——新增独立函数，DRY 由复用 `sha256Hex`/`hmacSha256`/`generateNonce` 三个私有 helper 达成。

### F.3 独立 parity 验证入口（内部 service 函数，非生产 call site 内联）

**是 internal service 函数，不是 route**（Slice-2a 只验接线，不暴露公网面；避免新增未审计的公开路由）：`runRunnerParityCheck(params) → RunnerParityResult`，放 `src/services/policy/`。
- **新 client** `src/services/policy/runner-launcher-client.ts`：`launchRunnerJob(params) → Promise<RunnerLaunchOutcome>`——仿 `PolicyApiClient.request` 结构（`url = ASTER_RUNNER_LAUNCHER_URL + '/api/v1/runner/launch'`，`bodyStr = JSON.stringify(runnerRequest)`，`signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', bodyStr, tenantId, role)`，`AbortController` 超时，`fetch`）。返回按 F.1：成功 `{ok:true, replayMetadata}` / runner 业务错 `{ok:false, kind:'runner-error', errorCode, message, phase}` / 不可达 `{ok:false, kind:'unavailable', reason}`。
- **入口逻辑** `runRunnerParityCheck`：
  1. **并行发两路**（同 `source×input×locale×functionName×aliasSet`）：`evaluateForCapture(params)`（aster-api 生产 `evaluateSource(replayCapture=true)`，权威对照 A）+ `launchRunnerJob(params)`（→ runner endpoint，B）。
  2. **失败隔离（★铁律）**：`launchRunnerJob` 在**独立 try/catch**里，任何失败（不可达/超时/HMAC 拒/endpoint 错/`outcome:"ERROR"`）→ 结果标 `runner-unavailable` 或 `runner-error`，**绝不 throw 进 `evaluateForCapture` 路径**。若权威侧 A 自身失败（aster-api 200 但无 replayMetadata / 抛错），归 `authority-failure`（parity 不可判，非 runner 的错）。
  3. **两路都成功**才逐字节比 5 字段（排除 `runtimeToolchainId`）→ `match` 或 `divergent + 差异字段列表`。

**parity-result 判别联合类型（discriminated union，锁定）**：
```ts
type RunnerParityResult =
  | { status: 'match' }
  | { status: 'divergent'; divergentFields: Array<'canonicalInputHash'|'canonicalOutputHash'|'canonicalizationVersion'|'replayabilityStatus'|'traceHash'> }
  | { status: 'runner-unavailable'; reason: string }          // B 不可达/超时/HMAC 拒
  | { status: 'runner-error'; errorCode: string; phase: string; message: string }  // B 返 outcome:ERROR
  | { status: 'authority-failure'; reason: string };          // A 侧失败，parity 不可判
```
- **结果去向**：Slice-2a 只**返回 + 结构化 log**（`console.info`/结构化日志字段），**不喂 signability gate**、不写 Execution 生产列（承诚实边界「纯附加信号」）。Slice-2b 再决定是否落库/告警。

### F.4 stub/local target（Slice-2a）

`ASTER_RUNNER_LAUNCHER_URL` 指一个可替换 endpoint（首版本地/stub，Slice-2b 切真 launcher）。**stub 必须**（不只 accept）：
- 真验 HMAC（按 F.1 接收方合约，用 `ASTER_RUNNER_LAUNCHER_HMAC_KEY` + 7 行 canonical + 时间窗 + nonce）——验证「独立 HMAC 接线」这条唯一有意义的 2a 接线。
- 收 `POST /api/v1/runner/launch` 的 `RunnerRequest` envelope → 返回一个合法 `{outcome:"SUCCESS", replayMetadata}`（用于验接线，非真编排；replayMetadata 可为固定/回放 A 的值以模拟 match，或注入差异模拟 divergent 测试）。

### F.5 新 secret / env（wrangler）
- `ASTER_RUNNER_LAUNCHER_HMAC_KEY`（独立 HMAC key，`wrangler secret put`）。
- `ASTER_RUNNER_LAUNCHER_URL`（endpoint，wrangler.toml var 或 secret）。
- `ASTER_RUNNER_LAUNCHER_TIMEOUT`（可选，缺省 30000）。

## 数据流（一次 Slice-2a parity 验证）

```
[runRunnerParityCheck 入口]  (aster-cloud, 独立 service 函数 非生产 rule-regression 流)
    │  并行两路 (同 source×input×locale×functionName×aliasSet)
    ├─► evaluateForCapture(params)  → aster-api 生产 evaluateSource(replayCapture=true)  → ReplayMetadata_A (权威)
    └─► launchRunnerJob(params)     → [独立 HMAC: signRunnerLauncherHeaders, key=ASTER_RUNNER_LAUNCHER_HMAC_KEY]
    │                                  → POST ASTER_RUNNER_LAUNCHER_URL/api/v1/runner/launch (stub/local)
    │                                  → stub 真验 HMAC → 返回 {outcome:SUCCESS, replayMetadata_B}
    ▼  两路都成功 → 逐字节比 5 字段 (排除 runtimeToolchainId:
    ▼                canonicalInputHash + canonicalOutputHash + canonicalizationVersion + replayabilityStatus + traceHash)
    ▼  → RunnerParityResult: match / divergent+fields  — 仅返回+结构化 log，不喂 gate
    ★ launchRunnerJob 失败(不可达/超时/HMAC 拒/outcome:ERROR) → status=runner-unavailable|runner-error
      evaluateForCapture 路径完全不受影响 (独立 try/catch)
    ★ 权威侧 A 失败 → status=authority-failure (parity 不可判，非 runner 错)
```

## 测试策略

1. **C**：workflow 语法 + 本地 `installDist`→`docker build --platform linux/arm64` 真构建一次（Slice-1 已证 arm64 可跑，此验 CI 打包）；cosign sign/verify dry-run（或 staging）；核 `setup-aster-build` 前置 checkout 到 `./aster-api` 已就位。
2. **D-1**：`./gradlew :test --tests RunnerDistributionParityTest` 本地绿——**新测试**：host JVM 内 `evaluateSource`(A) vs `RunnerMain.run()`(B) 逐字节比 5 字段全 fixture match（验真门非空门）；顺带 `./gradlew build` 确认 `testImplementation project(':aster-replay-runner')` 不引入循环依赖。
3. **D-2**：本地按 `task0-arm64-parity.sh` 比对逻辑跑，但**指向 push 的 `@DIGEST`**（或本地先 push 到 registry 再拉 digest 跑），验「测的镜像==签的镜像」；验发版 workflow `parity-arm64` job 接线（gen-expected → pull @DIGEST → 比对）。
4. **F 单测**：`signRunnerLauncherHeaders` 独立 key 7 行 canonical 构造（与 `signInternalCallerHeaders` 同 canonical、异 key/caller）；`launchRunnerJob` 成功/`outcome:ERROR`/不可达/超时四路映射；parity 比对逻辑（match/divergent，排除 `runtimeToolchainId`）；★失败隔离（`launchRunnerJob` throw → `runRunnerParityCheck` 标 `runner-unavailable` 但 `evaluateForCapture` 结果不受影响）；★`authority-failure` 分支。
5. **F 集成（stub target）**：起本地 stub runner endpoint（**真验 HMAC**）→ `runRunnerParityCheck` 全链一次（两路并行→比对→`RunnerParityResult`）；验 HMAC 拒（错 key）→ `runner-unavailable`。

## 破坏性 / 迁移

- **纯增量**：C=新 workflow；D-1=新 @QuarkusTest `RunnerDistributionParityTest` + `testImplementation project(':aster-replay-runner')`（test-only，无循环依赖、不改生产运行时 classpath）；D-2=发版 workflow 的 `parity-arm64` job；F=新 client + 新 service 函数 + 新 `signRunnerLauncherHeaders` + secret，**不改** `signInternalCallerHeaders`、**不改** `evaluateForCapture`（生产 rule-regression 流零改动）。
- `GenExpectedCorpusTest` **保留**（D-2 expected 生成器 + corpus REPLAYABLE oracle），不删不改语义。
- k3s 加 runner CIP + trust root entry（手动）——admission 此刻不 fire（无 runner Job 跑），为 Slice-2b 铺路。
- 新 wrangler secret（`ASTER_RUNNER_LAUNCHER_HMAC_KEY`/`ASTER_RUNNER_LAUNCHER_URL`[/`_TIMEOUT`]）。

## 范围外（Slice-2a 不做）

- ❌ launcher 微服务 + SA/Role/RoleBinding + Deployment + tunnel 路由（Slice-2b，独立安全审）。
- ❌ 真 in-cluster runner Job 编排（Slice-2b；Slice-2a 用 stub target）。
- ❌ SPIRE/签名（S2-1b）；finalization receipt（S2-1c）；受签 ModuleClosure。
- ❌ 改生产 evaluateForCapture / signInternalCallerHeaders。
- ❌ parity 结果写 Execution 生产列 / 喂 signability gate（Slice-2b 再定）。

## 交叉审查

Claude 生成 spec → Codex 首审退回 5 blocker（D-1 空门 CRITICAL / D-2 digest 未绑 / C 未对齐 setup-aster-build 与 job 结构 / C path filter 不完整 / F 合约欠规格）→ 本版逐条修复（全部对真实文件 file:line 核实）→ 重提 Codex 审（禁止自审）。writing-plans 出计划后 subagent-driven，每任务 Codex/Claude 交叉审。
