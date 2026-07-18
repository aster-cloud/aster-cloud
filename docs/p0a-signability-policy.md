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
   `deriveReportSignabilityDetail`（从 cases 事实派生，不信不可信顶层声明）。**受控接受漂移的准入门**（写路径
   `createDriftApproval` + 读路径 `computeEffectiveStatus`）**共用** `isDriftApprovable`（= `goldenIntegritySignable`，
   见下 Item 4 F）：**golden 完整性不可信**（legacy 弱绑定 / 无 golden 承诺）的报告**绝不**派生
   `ACCEPTED_DRIFT_WITH_APPROVAL`，`createDriftApproval` 直接拒绝；而 **provenance 未验证**（Item 4 F）**不**阻断
   审批（ACCEPTED 是有人背书的已知漂移，不声称跨升级签字级通过）。
5. **DB default**：迁移 `0038` 把 `RegressionCase.caseHashVersion` default 从 `m1.0` 改 `m1.1`（关闭「直接
   DB / 遗漏 writer 继续产 m1.0」入口）。既有行不动，CHECK 约束保留 `m1.0` 为合法历史值。

## Item 4 F：toolchain provenance 诚实降级（`m1.4`）

**签字资格是多维的**，`signability` 是所有维度的复合二值结论（任一维度不可签字 → `UNSIGNABLE`）；具体维度在
顶层 `unsignableReasons`（封闭枚举 canonical 排序，进 `p0a-runner/m1.4` reportHash）：

| reason | 维度 | 由什么派生（唯一真相源） | 阻断签字通过 | 阻断受控接受 |
| --- | --- | --- | --- | --- |
| `LEGACY_CASE_HASH_VERSION` | golden 完整性 | 任一 case `caseHashVersion` 弱绑定（`m1.0`）——**cases 事实** | 是 | **是** |
| `GOLDEN_COMMITMENT_UNSUPPORTED` | golden 完整性 | 报告版本无 golden 承诺（`m1.0`/`m1.1`）——**版本事实** | 是 | **是** |
| `TOOLCHAIN_PROVENANCE_UNVERIFIED` | runtime provenance | 报告**声称跨升级安全**（`status===PASS`，或含可审批 `OUTPUT_HASH_MISMATCH` drift）——**status/reason 事实** | 是 | **否** |

**核心（Codex 复审致命 1）**：provenance 是否需要，由**报告声称的业务结果**（`status`/`reason`）判定，**不由
可删/可改的 artifact 字段**（case 的 `baselineToolchainId`/`currentToolchainId`）当开关——否则攻击者设相等/删字段
即洗白成可签字（自证漏洞）。toolchain pair 只作诊断。

**为什么 provenance 恒缺**：cloud 无 runtime provenance **第 3 层 verifier**（无法证明「谁执行了这次 replay」），
版本政策下**当前所有版本恒缺**，**无可翻 `true` 的 trusted 开关**（避免重新引入声明式自证漏洞）。直接含义：
`isSignablePass` 在当前生态**恒 `false`**——这是**诚实降级**，不是功能瘫痪。真正的可签字路径待未来 `m1.5`（E+D：
引入真 runtime verifier）落地，届时 provenance 维度才有条件转 `true`。

**两维度正交（Codex 复审 P0）**：
- **签字通过**（绿色可签字，`isSignablePass`，`status===PASS`）= **全维度** `SIGNABLE`，含 provenance；
- **受控接受漂移**（`ACCEPTED_DRIFT_WITH_APPROVAL`，`isDriftApprovable`）= 仅 **golden 完整性维度**可信，**排除**
  provenance。ACCEPTED 是「管理员人工背书的已知 before/after 漂移」，**不**声称「该 drift 由目标 runtime 执行产生」，
  故不需 provenance。写路径 `createDriftApproval` 与读路径 `computeEffectiveStatus` **共用** `isDriftApprovable`，防双口径。
- 声明不自洽（`m1.4` 顶层 `signability`/count/`unsignableReasons` 与派生事实矛盾）→ `declaredConsistent=false` →
  `goldenIntegritySignable=false`（fail-closed，即便派生 golden 维度干净也拒审批）。

**reportHash `m1.4`**：`m1.3` 全字段 + 顶层 `unsignableReasons`（严格 canonical——含未知/重复/乱序 reason 一律
`throw`，编码单射，与读路径 `declaredConsistent` 同一约束）。`m1.0`–`m1.3` 公式逐字冻结不破。

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
