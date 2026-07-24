# 计划：runner-parity 接线（cloud→launcher 影子校验上线）

**日期**: 2026-07-24
**前置**: launcher 基建 go-live 完成（k3s#110-114：topology lane + render-guard + Ingress + reflector 修）；
  launcher 外部可达实证（`https://runner-launcher.aster-lang.dev/api/v1/runner/launch` → 401，HMAC 拒未签）；
  cloud Worker 已设 `ASTER_RUNNER_LAUNCHER_URL` + `ASTER_RUNNER_LAUNCHER_HMAC_KEY` 两 secret。
**用户拍板**: (1) trigger = **管理员可配三模式**（off/sampled+%/every/manual）；(2) 持久化 = **executions 新列**。

## 背景（诚实边界，铁律）
`runRunnerParityCheck`（`src/services/policy/runner-parity.ts`）已建但**从无调用者**（死代码，PR#278 Slice-2a
只建旁路抽象+stub target）。它并行跑权威侧 A（cloud/aster-api `evaluateSource(replayCapture=true)`）+ runner
侧 B（launcher），严格 `!==` 比 5 个 canonical-hash 字段（canonicalInputHash/canonicalOutputHash/
canonicalizationVersion/replayabilityStatus/traceHash；runtimeToolchainId 不进 parity）。
- **纯附加、log-only、绝不 gate**：不喂 signability、不改用户决策、不抛进 execute 路径（失败隔离铁律）。
- **parity 证集成正确性非算法独立性**：runner 与 aster-api 跑同一 executor 代码，byte-parity 近乎定义性；
  差分门守「打包/镜像/launcher/Job 环境未在共享代码外引入分叉」。
- Slice-2a spec §F.3 明确 defer 到「Slice-2b 决定是否持久化/告警」——本计划即那个决定。

## 插入点（已现成）
两条已认证 execute 路由**本就** `replayCapture:true` → 权威侧 A 的 replayMetadata 已在手：
- `src/app/api/policies/[id]/execute/route.ts:324-333`（dashboard，source='dashboard'）
- `src/app/api/v1/policies/[id]/execute/route.ts:239-249`（API-key，source='api'）
两者经 `executePolicyUnified`（cnl-executor.ts）→ `result.metadata.replay`。

## 交付物（分 PR，严格顺序）

### PR-1（aster-cloud）— platform-settings flag（管理员三模式配置）
- `src/lib/platform-settings.ts`：加 key `runner_parity.mode`（枚举 `off|sampled|every|manual`，DEFAULTS=`off`
  fail-OFF）+ `runner_parity.sample_pct`（0-100，默认 5）+ helper `getRunnerParityConfig()`（读两 key，
  60s cache 复用现有机制）。
- admin 写路径 `src/app/api/admin/platform-settings/route.ts` 已泛型支持新 key（校验枚举/范围）。
- 单测：mode 解析、sample_pct 范围校验、fail-OFF 默认、未配 `ASTER_RUNNER_LAUNCHER_URL` 时**隐式 off**
  （env self-gate 叠加 flag——两道都须 on 才跑）。

### PR-2（aster-cloud）— DB 列 + 迁移
- `src/db/schema.ts` executions 表加：`runnerParityStatus`（text nullable，枚举
  match|divergent|runner-unavailable|runner-error|authority-failure|skipped）+ `runnerParityDivergentFields`
  （jsonb/text nullable，divergent 时的字段名数组）+ `runnerParityCheckedAt`（timestamp nullable）。
- Drizzle 迁移（新列全 nullable，纯增量，历史行 NULL=未跑）。索引：parity_status 部分索引（查 divergent 快）。
- ★真库迁移法（承 [[drizzle-case-param-int-cast]] 教训）：drizzle-kit push 到真库验证，非只 mock。

### PR-3（aster-cloud）— 接线：execute 路由触发 parity（async 非阻塞）
- 新 `src/services/policy/runner-parity-from-execution.ts`：`maybeRunParityForExecution(execCtx)`——
  读 `getRunnerParityConfig()`：mode=off→skip；sampled→按 sample_pct 概率决定；every→跑；manual→skip（仅
  显式 endpoint 触发）。跑则调 `runRunnerParityCheck`（**复用已在手的权威侧 A metadata**——避免双评估：
  给 runRunnerParityCheck 传 `deps.authority` 桩返回已算的 side-A，只真跑 side-B launcher）。
- 两 execute 路由在写完 execution 后，用 **Cloudflare `waitUntil`（ctx.waitUntil）** 后台 fire
  `maybeRunParityForExecution`——**绝不阻塞用户响应**，失败不影响 execute（失败隔离铁律；parity 结果异步
  UPDATE 该 execution 行的 parity 列）。
- ★避免双评估的关键：runRunnerParityCheck 默认自己跑 side A（callAuthorityForParity）；接线时注入
  `deps.authority = () => Promise.resolve(alreadyComputedReplayMetadata)`，只让它真跑 side B。
- 单测 + 集成：mode 各值行为、sampled 概率、waitUntil 不阻塞、parity 结果落对应 execution 行、side-B
  失败不影响 execute 响应。

### PR-4（aster-cloud）— manual 触发 endpoint + logs UI badge（可选，manual 模式的入口）
- `src/app/api/policies/[id]/executions/[execId]/verify-parity/route.ts`（认证，admin/owner）：对指定
  execution 重跑 parity（重建 source/input/locale/functionName/aliasSet from stored execution）并写列。
  这是 manual 模式的入口 + 立即可用的**上线冒烟测试**（管理员点一下→真 cloud→launcher 签名调用）。
- logs UI（`src/app/[locale]/(dashboard)/policies/[id]/logs/page.tsx`）加 parity 徽章（读 runnerParityStatus）：
  match=绿✓ / divergent=红⚠+字段 / unavailable/error=灰 / null=未跑。i18n 四语。
- ★这也是**首个 parity UI surface**（此前 replay 哈希存了从不显示）。

## 交付顺序（铁律）
PR-1（flag）→ PR-2（列）→ PR-3（接线，依赖 flag+列）→ PR-4（manual+UI，依赖接线）。每 PR 独立可上线。

## 冒烟测试（接线后立即验 cloud→launcher HMAC 边界）
最快真实测：PR-4 的 verify-parity endpoint（管理员对一条真 execution 点「验证 parity」）→ 触发真
signRunnerLauncherHeaders → 真 POST launcher → 观察结果：
- `match` → **HMAC 边界 + parity 全绿**（key 匹配 + 集成无分叉）。
- `divergent` → HMAC 对了（跑到了比对），但打包/env 引入分叉——查 divergentFields。
- `runner-unavailable`（reason 含 403）→ **HMAC key 不匹配**（cloud secret ≠ launcher Vault 值）。
- `runner-error` → 跑到了 launcher 且验签过，launcher 内部编排错。
manual 模式让「测一次」不需要每次执行都跑。

## 破坏性 / 迁移
- 全附加：新 flag 默认 off、新列全 nullable、接线用 waitUntil 不改用户路径。零破坏。
- 未配 `ASTER_RUNNER_LAUNCHER_URL` 时 launchRunnerJob 返 unavailable（现有 self-gate）——flag+env 双门。

## 交叉审查（禁止自审）
Claude 生成 → Codex 审。每 PR。重点：(1) 失败隔离——side-B 任何失败绝不影响 execute 响应/决策；
(2) 不双评估（复用 side-A metadata，只真跑 side-B）；(3) waitUntil 生命周期（Worker 后台任务不被过早
终止）；(4) flag fail-OFF + env 双门；(5) 迁移向后兼容（历史行 NULL）。

## 范围外
- signability gate 接入（parity **永不** gate——诚实边界铁律）。
- S2-1b（SPIRE + workload signing，唯一真解锁签字）。
- parity 告警/webhook（本计划只落列 + log + UI badge；告警独立后续）。
