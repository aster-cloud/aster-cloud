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

`m1.0` 行来源：新 freeze **永不**产 `m1.0`（应用层硬写 `m1.1`）。`m1.0` 只来自 pre-m1.1 老代码、直接 DB
写、或迁移 `0036` 把既有行回填 `m1.0`（且旧 DB 列 default 曾是 `m1.0`）。

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

## ★破坏性 / 历史 approval 语义变化（必读）

这是一次**有意的签字政策收紧**，不是向后兼容：

- **`m1.0`/`m1.1` runner 报告现一律不可签字**（无 golden 承诺）。
- 这些报告**过去已存在的 drift approval 行不删除、不改写**；历史 `reportHash` / `approvalHash` /
  `caseHash` 复算不变（公式逐字冻结）。
- 但 `effectiveStatus` **不再对它们派生** `ACCEPTED_DRIFT_WITH_APPROVAL`——保持/回退为 `FAIL_REGRESSION`。
  即「历史审批记录保留，但按当前签字政策不再满足可签字，故不派生受控接受」。
- `m1.2` 报告按其 cases 的 `caseHashVersion` 精确派生（含 `m1.0` case → UNSIGNABLE）。

**不可声称历史 approval 行为完全不变。**

## 迁移路径（恢复签字资格）

`m1.0` case **无法原地重冻为 `m1.1`**：`RegressionCase` 是 append-only（迁移 `0037` 禁 UPDATE/DELETE）+
unique key `(policyVersionRowId, functionName, locale, canonicalInputHash)` + freeze 用 `onConflictDoNothing`。

**真迁移 = 新建 PolicyVersion 行，在新 `policyVersionRowId` 下从可信来源重新 freeze**（产 `m1.1` case）。
**绝不**原地重 hash `m1.0` 字段——那些正是没保护的字段，等于给可能被篡改的值盖章。

## 回滚

回滚仅回滚代码；**不能**把已判不可签字的报告重新宣称可签字。历史 artifact 不改写。
