# P0-A 回归工具签字资格政策（Item 2：legacy case-hash/m1.0）

**状态**: 已实施
**关联**: ADR 0030（P0-A 回归工具）；`src/services/policy/rule-regression-runner.ts`

## 背景

P0-A 回归报告的 `caseHash` 有两套公式版本：

- `case-hash/m1.0`：早期公式，只绑 9 个字段。
- `case-hash/m1.1`（当前）：补绑 `policyId` / `expectedDecision` / `coverageTags` /
  `baselineRuntimeToolchainId` / `sourceToolchainId` / `sourceEnvelopeSha256` / `sourceExecutionId`。

**问题**：`m1.0` 公式**不绑**的字段（`coverageTags` / `baselineRuntimeToolchainId` / `expectedDecision`）
恰恰喂给签字级 gate（覆盖门禁 + P0-1 toolchain guard）。因此一个 `m1.0` case 的这些字段可被篡改而不
破坏其 `caseHash`——run 时重算校验用 `m1.0` 公式检测不到。即：**`m1.0` case 的自洽不足以支撑签字级证明**。

`m1.0` 行来源：新 freeze **永不**产 `m1.0`（应用层硬写 `m1.1`）。`m1.0` 只可能来自 pre-m1.1 老代码、直接 DB
写、或迁移 `0036` 把既有行回填 `m1.0`（且旧 DB 列 default 曾是 `m1.0`）。

## ★生产现实：legacy 分支为 defense-in-depth，永不触发

生产**上线前会全量清空** RegressionCase / RegressionReport / DriftApproval（当前均为测试数据），且新
freeze 永不产 `m1.0` case。因此**生产上线后永远不会存在 `m1.0` case**——本文档所有 `m1.0` 相关处理
（run 拒绝、verify 弱绑定、historical approval、迁移路径）都是**纵深防御（defense-in-depth）**：只在有人
绕过应用层直接写入 `m1.0` 行时才 fail-closed 兜底，正常运营路径**永不触发**。

保留这些分支的理由：(1) 纯 `fail-closed`，不碰 `m1.1` 正常路径，无害；(2) `signability` 轴是「报告能否作为
签字证据」的**通用抽象**，未来任何不可签字条件都能挂上去，并非只为 `m1.0`。

## 政策

**`case-hash/m1.0` = 不可签字弱绑定版本。** 签字级路径**显式拒绝/降级** `m1.0` case，而非静默信任：

1. **run 侧**：`m1.0` case（caseHash 自洽校验通过后）标 `LEGACY_UNSIGNABLE_CASE_HASH_VERSION`，不参与
   runnable-PASS。报告新增**签字资格轴** `signability`（独立于 `status`）：含任何不可签字 case →
   `UNSIGNABLE_LEGACY_CASE_HASH_VERSION`。**可签字通过 = `status===PASS && signability===SIGNABLE`**。
2. **reportHash**：bump `p0a-runner/m1.3`——`signability` + `unsignableLegacyCases` 进报告哈希（`m1.0`/`m1.1`/
   `m1.2` 公式逐字冻结，历史可复算不破）。
3. **verify 侧**：`m1.0` golden 行即使自洽也标 `LEGACY_WEAK_BINDING_CASE_HASH_VERSION`（不计 MATCH）。
   `m1.3` 报告的顶层 `signability`/`unsignableLegacyCases` 声明必须与 cases 事实一致，否则 fail-closed。
4. **消费链**：list / 详情 / verify API、UI、审计、drift approval、effectiveStatus **统一**经
   `deriveReportSignabilityDetail`（从 cases 事实派生，不信不可信顶层声明）。不可签字报告**绝不**派生
   `ACCEPTED_DRIFT_WITH_APPROVAL`，`createDriftApproval` 直接拒绝。
5. **DB default**：迁移 `0038` 把 `RegressionCase.caseHashVersion` default 从 `m1.0` 改 `m1.1`（关闭「直接
   DB / 遗漏 writer 继续产 m1.0」入口）。既有行不动，CHECK 约束保留 `m1.0` 为合法历史值。

## 破坏性 / 兼容性

- **生产无历史数据**（上线前清空）→ 本变更对生产**无破坏**：没有既有 `m1.0`/`m1.1`/`m1.2` 报告或
  approval 会被本政策影响，也不存在需要迁移的历史 legacy case。
- `m1.0`/`m1.1`/`m1.2` reportHash 公式**逐字冻结**（历史向量测试守卫）——即使日后引入历史 artifact，其
  复算不变，旧 `approvalHash`/`reportHash` 不漂移。
- `0038` 只改未来默认值（`caseHashVersion` default `m1.0`→`m1.1`），不 UPDATE 任何现存行；CHECK 约束仍
  保留 `m1.0` 为合法历史值。

**理论上的政策语义**（仅当有人绕过应用层直接写入 legacy 数据时才相关，生产不发生）：`m1.0`/`m1.1` runner
报告一律不可签字，`effectiveStatus` 不对它们派生 `ACCEPTED_DRIFT_WITH_APPROVAL`；`m1.2` 报告按其 cases 的
`caseHashVersion` 精确派生。

## 迁移路径（若日后真出现 legacy case——生产预期不会）

`m1.0` case **无法原地重冻为 `m1.1`**：`RegressionCase` 是 append-only（迁移 `0037` 禁 UPDATE/DELETE）+
unique key + freeze `onConflictDoNothing`。真迁移 = 新建 PolicyVersion 行、在新 `policyVersionRowId` 下从
可信来源重新 freeze（产 `m1.1` case）；**绝不**原地重 hash `m1.0` 字段（那些正是没保护的字段）。

## 回滚

回滚仅回滚代码。历史 artifact 不改写。
