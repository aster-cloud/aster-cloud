# S2-1a-2 「C–F」调研事实基础（三仓实证，2026-07-20）

**用途**: C–F spike 的附 B 前置事实。Explore agent 三仓 file:line 实证 + 主 AI 核对。承 `p0a-s2-1a-2-runner-engineering-spike.md` 六子系统。
**★Slice-1(A+B+Task0) 已上线 PR#153**（runner 骨架+arm64 镜像+Task 0 风险门证 stock-JRE byte-identical）；runner 文件在分支 `s2-1a-2-runner-mvp-slice1`（未合 main）。

---

## C — 镜像 cosign 签名 workflow（aster-api CI）

**EXISTS（模板 = `aster-api/.github/workflows/deploy.yml`）**：
- 3-job 结构：`build-and-test`（postgres:17+redis:7 services, `./gradlew build -Dquarkus.package.jar.type=fast-jar`, 上传 quarkus-app artifact）→ `deploy`（签名）→ `image-pin-pr`。
- `deploy` job 签名模板：`permissions: id-token:write`（keyless OIDC）+ stale-commit guard + `docker/build-push-action@v7`（`platforms:linux/arm64`, `provenance:false`, `build-args:ASTER_RUNTIME_BUILD=${github.sha}`）+ **arm64 内容验证器**（拉 `@DIGEST` 断言 `uname -m==aarch64`, QEMU/binfmt preflight）+ `sigstore/cosign-installer@v3` + `cosign sign "wontlost/aster-api@${DIGEST}"`（`COSIGN_YES:true`）+ `cosign verify ... --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/\.github/workflows/deploy\.yml@refs/heads/main$" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"`。
- `image-pin-pr` job：mint k3s-scoped GitHub App token（`actions/create-github-app-token@v3.2.0`, `owner:wontlost-ltd`, `repositories:k3s`）+ `scripts/ci/open-image-pin-pr.sh docker.io/wontlost/aster-api image-pin/aster-api`。
- **OIDC identity 格式**：`https://github.com/{sourceRepo}/.github/workflows/{workflowFile}@{sourceRef}`；aster-api 源仓=`aster-cloud/aster-api`（org `aster-cloud` 非 wontlost-ltd, allowed-images.yaml:21）。

**MUST BUILD**：
- runner 镜像**零接线**（`grep aster-replay-runner .github/workflows/`=0）。新 workflow/job for `wontlost/aster-replay-runner`：build（context `aster-replay-runner/`, `file:aster-replay-runner/Dockerfile`）→arm64-verify→cosign sign+verify→image-pin-PR。新 cert-identity 串（新 workflow 文件名）。
- ★**gap**：runner 用 `application`/`installDist`，镜像 build 须先 `./gradlew :aster-replay-runner:installDist` 再 `docker build`（Dockerfile `COPY build/install/aster-replay-runner/`）——不同于 aster-api 的 fast-jar+artifact-download 流。

---

## D — CI parity 门持续化（aster-api CI）

**EXISTS（slice1 分支）**：
- `aster-replay-runner/scripts/task0-arm64-parity.sh`：installDist→`podman build --platform linux/arm64`→逐 corpus `podman run --rm -i --platform linux/arm64` 喂 stdin, `tail -n 1`, `jq -S` 比 5 字段（canonicalInputHash/canonicalOutputHash/canonicalizationVersion/replayabilityStatus/traceHash, toolchainId 排除）。**一次性/podman-local, 不在任何 workflow**。
- `gen-expected.sh`：`./gradlew :test --tests "io.aster.replay.parity.GenExpectedCorpusTest" -Dparity.corpus.dir=<abs> -Dparity.gen.expected=true`。
- host CI 骨架 = `ci.yml` job `build`（postgres:17 DB `aster_policy`+redis, 分层 `test`→`integrationTest`）；或 `deploy.yml` `build-and-test`。
- ★**GenExpectedCorpusTest 得 aster-api 参照方式**：@QuarkusTest(@TestProfile HmacProfile) in-process 驱动真生产端点 `POST /api/v1/policies/evaluate-source?replayCapture=true`（RestAssured）+ 自建 7 行 HMAC canonical（同 cloud signer）。HmacProfile 覆盖 `aster.plan-gate.hmac-key`+`signature.enabled=false`。断言 200+replayMetadata+REPLAYABLE。CI 已跑 @QuarkusTest（ci.yml 97-111）→DB substrate 已在。

**MUST BUILD / gap**：
- 无 workflow 引用 parity 脚本/GenExpectedCorpusTest（都只在 slice1 分支）。
- ★**持续化张力**：`task0-arm64-parity.sh` 用 **podman+`--platform linux/arm64`**（真 arm64 容器）；GitHub `ubuntu-latest`=amd64→per-PR arm64 跑须 QEMU/binfmt（deploy.yml 204-209 有 QEMU preflight 模式）或 arm64 runner。expected.json 生成（@QuarkusTest）需 postgres——ci.yml 已备。
- ★**risk**：GenExpectedCorpusTest 是根项目测试（`:test`, io.aster.replay.parity）非 `:aster-replay-runner` 子模块（gen-expected.sh 注释警裸 `test` 误 target 子模块）。CI 门须 `:test --tests io.aster.replay.parity.GenExpectedCorpusTest` + 单独 arm64 容器比对。

---

## E — in-cluster launcher 微服务（k3s）

**EXISTS（可复用）**：
- **Deployment+SA 硬化模板** = `k3s/apps/infrastructure/cloudflare-tunnel/deployment.yaml`（Deployment+专用 SA, `runAsNonRoot`/`runAsUser:65532`/`seccompProfile:RuntimeDefault`/`allowPrivilegeEscalation:false`/`readOnlyRootFilesystem:true`/`capabilities.drop:[ALL]`）。★但此 SA `automountServiceAccountToken:false`=**故意无 K8s API 访问**（launcher 需相反）。
- **GitOps RBAC 白名单已允许** = `k3s/argocd/projects/aster-lang.yaml` `namespaceResourceWhitelist` 已含 `batch/Job`+`batch/CronJob`+`rbac.../Role`+`RoleBinding`+`ServiceAccount`。→launcher SA+Role+RoleBinding+Job 在 GitOps policy 内。
- **ArgoCD 上线模式** = `k3s/argocd/applicationsets/aster-lang.yaml` ApplicationSet git files generator（`files: - path: apps/aster-lang/*/kustomization.yaml`）→建 `apps/aster-lang/<name>/kustomization.yaml` 即自动发现（Application 名 `aster-<dir>`, ns `aster-<dir>`, prune+selfHeal）。
- **runner Job 模板** = `k3s/apps/aster-lang/cloud/migrate-job.yaml`（`ttlSecondsAfterFinished:86400`, `backoffLimit:2`, `restartPolicy:Never`, `automountServiceAccountToken:false`, pod+container securityContext 硬化, **resources requests 50m/128Mi limits 500m/512Mi**——★spike 警对 GraalVM 太小须放大, tmpfs emptyDir 64Mi）。
- **admission(S2-0) 模式** = `k3s/apps/infrastructure/policy-controller/policies/`（keyless digest-verify CIP `glob:index.docker.io/wontlost/aster-api@sha256:**` subject `...deploy.yml@refs/heads/main` mode:enforce + reject-tag `static:action:fail` on `:**`）。

**MUST BUILD / ★gap（关键）**：
- ★**k3s 无任何「建 Job 的 SA」先例**（`grep "kind: Role"/"kind: RoleBinding"` under apps/=0；唯一 workload SA cloudflared 明确无 API 访问；白名单 batch/jobs 只是 ArgoCD whitelist 非实际 RBAC Role.rules 授 create）。launcher SA+Role（`apiGroups:["batch"] resources:["jobs"] verbs:["create","get","list","watch","delete"]`）+RoleBinding **全新**（白名单允许，manifest 不存在）。
- ★**Tunnel ingress 路由 dashboard-managed**（token tunnel, `tunnel run --token`）——路由在 Cloudflare Zero Trust dashboard **不在 git**（tunnel dir 无 config.yaml/ConfigMap ingress）。**launcher HTTPS 路由须 dashboard 带外配, 无 in-repo YAML 可 PR/mirror**。
- ★**ArgoCD ns destinations**：aster-lang AppProject destinations（aster-lang.yaml:12-19）只列 aster-cloud/aster-lsp/aster-observability——新 runner ns 须加 destinations 白名单。
- ★**`policy.sigstore.dev/include=true` 标签全 git 缺**（`grep`=0；aster-cloud namespace.yaml 只 `part-of:aster-lang`）→runner Job ns 未贴=admission 静默不 fire（spike §5 警）。runner 须加 5th+6th CIP（digest-verify+reject-tag for `wontlost/aster-replay-runner`）+kustomization + **image-pin trust root `allowed-images.yaml` 加第 3 entry（手动, push-ruleset 保护非 auto-PR）**。
- **SPIRE/SPIFFE 100% 缺**（`grep`=0）→MVP 无 attestation, 归 S2-1b。

---

## F — cloud 触发旁路（aster-cloud）

**EXISTS（可复用）**：
- **触发点** = `aster-cloud/src/services/policy/rule-regression-runner.ts` 私有 `async function evaluateForCapture(params)`（def line 946, 参数 `{tenantId,actorUserId,source,input,locale,functionName,aliasSet}`, 返回 6 hash 字段, body 调 `createPolicyApiClient(...).evaluateSource(...replayCapture:true)`, 2 call sites line 1038+1287）。
- **HMAC signer** = `src/lib/api-signing.ts` `signInternalCallerHeaders`（secret `ASTER_PLAN_GATE_HMAC_KEY`, 7 行 canonical `method\npath\nts\nnonce\nbodyHash\ntenant\nrole` unix秒, headers `X-Internal-Caller:cloud-bff`+ts+nonce+`X-Internal-Signature`）。
- **cloud→外部 HTTPS+HMAC 模式（launcher 调用 mirror 这个）** = `src/services/policy/policy-api.ts` `PolicyApiClient.request`（`url=baseUrl+path`, `pathname=path.split('?')[0]` query 不签, `signInternalCallerHeaders(method,pathname,bodyStr,tenantId,role)` merge headers, plain `fetch`）。
- **cloud 达 k3s 方式** = server-side `baseUrl=process.env.ASTER_POLICY_API_INTERNAL_URL||...||'https://policy.aster-lang.dev'`——cloud 已经**公网 HTTPS**（经同一 Cloudflare Tunnel+Traefik）调 k3s-hosted aster-api。**零 K8s 访问确认**（package.json 无 @kubernetes/client-node）→launcher 调用=Worker→公网 HTTPS, 同现有 evaluateSource 传输, 只不同 host/route。

**MUST BUILD / gap**：
- 旁路**零存在**。须加新 module 级 `launchRunnerJob(...)` 平行于 evaluateForCapture（**不改** evaluateForCapture 946-979, spike §4/§6 强制）；复用同 HMAC scheme 调新 launcher baseURL（新 env 如 `ASTER_RUNNER_LAUNCHER_URL`）经新 client mirror PolicyApiClient.request；收 launcher 响应的 ReplayMetadata（同 runner RunnerEnvelope.replayMetadata shape）。
- ★**无 launcher URL/env/wrangler secret**（wrangler.toml 80-125 无 launcher URL/HMAC key）→须新 `wrangler secret put`。
- ★**HMAC key 复用决策**：launcher 可复用 `ASTER_PLAN_GATE_HMAC_KEY`（spike §附B「launcher 复用此 HMAC」）但与新 TCB 成员共享 aster-api plan-gate secret——plan 阶段决策（spike §3b launcher 是新 TCB 成员）。
- ★**双 HMAC caveat**：`/evaluate-source` 受 aster-api InternalCallerFilter+per-tenant RequestSignatureFilter 双层；launcher 是新端点只 launcher 自己 HMAC 层；但 runner Job 若重入 aster-api 仍须同 signInternalCallerHeaders canonical。MVP 证据本身无签名（spike §4）。

---

## 跨切 gap 汇总（附 B）
1. runner 镜像 build **未接线**（grep=0）——全新 CI, build 须 installDist 先于 docker build（异于 aster-api artifact-download）。
2. k3s 无「建 Job 的 SA」先例——cloudflared SA 无 API 访问；launcher SA+Role+RoleBinding 净新（白名单允许 manifest 不存在）。
3. Tunnel ingress 路由 dashboard-managed（token tunnel）——launcher 路由带外 Cloudflare 配, 无 in-repo YAML PR。
4. `policy.sigstore.dev/include=true` 标签全 git 缺——runner ns 贴标签手动, 未贴=admission 静默旁路。
5. SPIRE/SPIFFE 100% 缺（aster-api 证据签名 + k3s）——MVP 无 attestation。
6. image-pin trust root（allowed-images.yaml 2 entry）须手动加第 3 entry——非 auto-PR（push-ruleset 保护）。

**NOT FOUND**: 任何现存 arm64 CI runner 或 per-PR 跑 parity 容器的 QEMU arm64 test job（deploy.yml QEMU 只为镜像*验证*非跑 corpus）; 任何 in-repo Cloudflare Tunnel ingress 路由; 任何现存授 `create` on `batch/jobs` 的 Role。
