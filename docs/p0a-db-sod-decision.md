# Item 3 架构决策记录：P0-A 回归表 DB 层职责分离 + INSERT 防护

**状态**: 已实施（方案 B 完整版，迁移 `0039`；用户拍板走 B + 诚实收窄口径）

## 已实施（迁移 0039 + schema.ts FK）

`BEFORE INSERT` trigger（任何 INSERT 路径都跑，含直连）+ FK，落地方案 B 完整版 9 项：
- **FK** `RegressionDriftApproval.reportId → RegressionReport(id)`（`ON DELETE NO ACTION`，preflight 查孤儿 +
  `NOT VALID`/`VALIDATE` 降锁）；schema.ts 同步 `.references()`。
- **backdate 防护**：`regression_case_report_insert_stamp` + approval trigger 强制 `createdAt`/`approvedAt` =
  `statement_timestamp()`（无视 insert 值）。
- **approval INSERT guard**（`regression_approval_insert_guard`）：拒预填 revoke / `expiresAt > approvedAt` /
  父表 `reportHash`·`policyId`·`policyVersionRowId` 一致 / `NOT FOUND` + `createdBy IS NULL` fail-closed /
  **声明身份 SoD**（`approvedBy != report.createdBy`）。
- **真库测试** `p0a-insert-guards.integration.test.ts`（13 例）：正常应用路径成功 · Case/Report/Approval
  backdate 覆盖实证 · 五类拒绝场景各独立分支（声明 SoD / orphan+FK / 父表 reportHash·policyId·pvRowId 不一致 /
  预填 revoke 含只设 revokedBy / 过期倒置）· FK 存在且 convalidated（pg_constraint 直查）。

**信任边界（诚实，务必读下方「信任边界真相」节）**：SoD 是**声明身份不相等**，非真身份 SoD；本控制防**受限
运行时凭证的普通 INSERT**，不抗 DB owner / superuser / 迁移管理员（可 drop trigger / SET session_replication_role）。

---

## 原决策上下文（保留）
**关联**: ADR 0030（P0-A 回归工具）；[[p0a-signability-policy]]；`drizzle/0037_regression_drift_approval_and_append_only.sql`

## 威胁模型（要防什么）

P0-A 回归 artifact（`RegressionCase` / `RegressionReport` / `RegressionDriftApproval`）是**签字级证据**。
当前 append-only trigger（`0037`）只保证行**创建后**不可 UPDATE/DELETE，但 **INSERT 完全无防护**。任何持有
`DATABASE_URL`（含仓库里提交的 dev 凭证、或生产 secret）的人可直连 DB：

| # | 威胁 | 现状 |
|---|---|---|
| T1 | **伪造行**：直插一条看似合法的签字级 report/approval | ✗ 无 INSERT trigger / 无 FK 拦 |
| T2 | **backdate**：insert 时任意设 `createdAt`/`approvedAt`（append-only 只拦 UPDATE，不拦创建时撒谎） | ✗ 可直接插 `createdAt='2020-01-01'` |
| T3 | **归因伪造**：`createdBy`/`approvedBy` 是**无 FK 的自由 text**，可设任意值 | ✗ 无 FK 无 check |
| T4 | **SoD 绕过**：`approvedBy === report.createdBy` 的审批 | ✗ SoD 仅一行 TS `if`，直插绕过 |
| T5 | **hash 不一致**：`reportHash`/`approvalHash` DB 从不校验，可存与内容矛盾的 hash | ✗ 仅 UNIQUE 约束 |

★另：`RegressionDriftApproval.reportId` **无 FK** 指向 `RegressionReport`——审批可引用不存在/不匹配的报告。

## 现状（已实证）

- **单 DB 用户**（运行时经 Cloudflare Hyperdrive / `DATABASE_URL`；迁移与 app 同角色，无 role 分离）。
- append-only trigger 只 `BEFORE UPDATE OR DELETE`，**无任何 INSERT trigger**。
- **无 RLS / CREATE POLICY / GRANT / CREATE ROLE**（迁移里零，只有运维文档里一次性手动 grant）。
- SoD 纯应用层（`createDriftApproval` 一行 `if (report.createdBy === approvedBy) throw`），doc 注释自认「跨表 DB
  check 做不到」。
- 三表**无 FK**、`createdAt`/`approvedAt` 有 `DEFAULT now()` 但**创建时可被覆盖**（backdate）。
- drizzle 迁移是手写 raw `.sql`（`0037` 已含 plpgsql trigger），**能 ship trigger/RLS/role**——唯一门槛是连接
  角色的权限等级。

## 部署现实（决定方案可行性）

| 目标 | role/RLS 能力 | 说明 |
|---|---|---|
| **生产 / on-prem（k3s + cloudnative-pg，自管 PG）** | ✅ 完全可行 | superuser bootstrap 已存在（2026-05-12 手动 grant 先例）；可 CREATE ROLE / REVOKE / RLS / SECURITY DEFINER |
| **managed（Prisma Postgres / Neon / Supabase）** | ⚠️ 受限 | 通常单 app 角色无 CREATEROLE/superuser；RLS 表 owner 可建，但跨角色 REVOKE 可能不行 |
| **Hyperdrive 连接池（运行时）** | ⚠️ `SET ROLE`/session GUC **脆弱** | 池化连接复用——`SET LOCAL`/会话变量可能跑在不同连接（`db-bootstrap.ts` 已记录同类风险）。**trigger / 表权限**模型无会话状态，最安全 |

## 三方案

### 方案 A：DB role + RLS + 拒直插（最强，仅 on-prem 可行）
- 建 `regression_writer` role（SECURITY DEFINER 存储过程）；`REVOKE INSERT ON Regression* FROM aster_api_user`；
  只允许经存储过程写。或 RLS policy 限制 INSERT。
- **防**: T1-T5 全防（直连普通角色连 INSERT 都不行）。
- **代价**: 需 superuser 一次性 bootstrap（迁移外，同 2026-05-12 先例）；**managed DB 大概率做不到**；Hyperdrive
  下若依赖 `SET ROLE`/session GUC 脆弱（须用表权限而非 session 变量）。
- **可行性**: on-prem ✅ / managed ✗。

### 方案 B：INSERT-trigger 校验（最可移植，**推荐基线**）
新增 `BEFORE INSERT` trigger（plpgsql，与 `0037` 同风格）在 DB 层校验，**任何 INSERT 路径都跑**（含直连）：
- **T2 防 backdate（DB 强制，完全）**: trigger 强制 `createdAt`/`approvedAt := statement_timestamp()`（无视 insert 值）。
- **T4 仅「声明身份不相等」约束（★非真身份 SoD）**: approval trigger `SELECT createdBy FROM RegressionReport WHERE
  id=NEW.reportId`，若 `= NEW.approvedBy` → RAISE。★但 approvedBy/createdBy 都是 INSERT 方**可任意提供的字符串**——
  这只堵「同一字符串误用」，**不堵**「攻击者设两个不同伪造字符串」。**不是**「跨表真 SoD 的解」，见下方「信任边界真相」。
- **T1 部分防**: 加 **FK** `RegressionDriftApproval.reportId → RegressionReport.id`（拦引用不存在报告）+ 父表
  `reportHash`/`policyId`/`policyVersionRowId` 一致性 trigger（拦内部矛盾 artifact）。**不加 User FK**（避免服务账号问题）。
- **T3 未闭**: `approvedBy`/`createdBy` 仍是无 FK 自由 text，恶意直插可设任意值。
- **T5**: reportHash/approvalHash 内容一致性 DB 难校验——靠 Item 1 离线核验（内容完整性，**非** actor 身份）。
- **防住**: T2 完全 + orphan/父表矛盾 + 初始状态/时间关系。**未防**: T3 + 恶意直插下的 T4（可选两个伪造字符串）+
  DB owner/superuser 绕过。
- **可行性**: **on-prem ✅ / managed ✅**（只需表 owner 权限，app 角色已有）；Hyperdrive 安全（无会话状态）。

### 方案 C：仅应用层加固（最小，**不够**）
- `computeEffectiveStatus` 读路径补 SoD 复查。
- **防**: 不防 T1/T2/T3（直连 DB 写全绕过）——REAL GAP。
- **可行性**: 全平台，但**结构上无法覆盖直连/raw SQL**，是当前（不足的）基线，非改进。

## 推荐（已采纳：B 完整版 + 诚实收窄口径）

**方案 B 完整版作全平台基线**（用户拍板）。★**诚实口径**：B **完整关闭** T2（backdate）+ orphan reference +
approval-parent 冗余字段矛盾 + 初始状态/时间关系；对 T4 **只建立「声明身份不相等」约束，不抵抗可任意选择 actor
字符串的恶意 writer**；T3 未闭；不抗 DB owner/superuser。**不是**「采购级真身份 SoD」，**不是**「真正防住任意直连
篡改」——真身份 SoD 需可信身份根（role / 签名 actor assertion），在部署约束（Hyperdrive + 可能 managed）下难做。

B 相对现状（SoD 仅一行可绕过的 TS `if`）是**实质加固**，且全平台可行 + Hyperdrive 安全 + 与 `0037` 同风格，故作
基线。on-prem 若要更强可另叠加方案 A（role/RLS，另立迁移 + superuser bootstrap）——可选，不阻塞基线。

## ★信任边界真相（Codex 设计审 72 揭示，我原推荐口径夸大了，诚实更正）

方案 B 的跨表 SoD trigger 只能比较 `NEW."approvedBy"` vs `RegressionReport."createdBy"`——**两者都是 INSERT
方自由提供的 text**。攻击者直连 DB 可设 `createdBy='fake-a'` / `approvedBy='fake-b'`（不等）→ trigger 放行。

**所以方案 B 的 SoD 只保证「两个声明字符串不相等」，不是「真实同一主体审批自己的报告」。** 加 User FK 也
只证「字符串对应某现存用户」，仍不能证「INSERT 是那个用户发起」——攻击者照样选两个不同合法 user ID。

**真身份级 SoD 靠 trigger 不可实现**——它凭空不知道真实调用者是谁。要闭合需**可信身份根**：
- 独立 writer/approver DB 角色（=方案 A，但 managed 不可行 + Hyperdrive 脆弱）；或
- 应用为 actor 生成服务端签名 assertion，DB/离线 verifier 验签；或
- approval 用可信外部签名 artifact。
这些都是比 B 大得多的工程，且部分与部署约束冲突。

**因此 Item 3 的诚实验收口径**：方案 B = **「DB artifact 完整性 + 声明身份不相等约束」**，**不是**「可信身份级
职责分离」。T3（归因伪造）+ 恶意直插下的 T4 仍未闭——其根治是**凭证管理**（谁能拿运行时 DB 写权限）+ 应用层
可信 session（app 已从登录态拿 approvedBy，这是真身份来源），DB 层不重复这个信任根。

## ★方案 B 完整版（Codex 最低可接受清单——比我原设计多补 6 项）

原设计只有 FK + backdate + SoD-equality，Codex 指出**父表一致性 + 初始状态 + 时间关系**是 artifact 完整性的
必要部分（否则「approval 钉死确切报告」只活在 TS writer，不在 DB 不变量）：

1. **FK** `reportId → RegressionReport(id)`，`ON DELETE NO ACTION`；生产用 preflight 查孤儿 +（大表）
   `NOT VALID` 后 `VALIDATE CONSTRAINT` 降锁；**schema.ts 同步声明**（防 drift）。
2. **时间用 `statement_timestamp()`**（非 `now()`=事务开始时间），case/report/approval 的 createdAt/approvedAt。
3. approval INSERT trigger **一次查父行**并校验：`reportHash`/`policyId`/`policyVersionRowId` 与父 report 一致
   （否则可插内部矛盾 artifact）。
4. approval INSERT **拒绝预填** `revokedAt`/`revokedBy`（必须均 NULL——防插入即预置撤销态）。
5. approval INSERT 校验 `expiresAt > approvedAt`（防生效即过期/时间倒置）。
6. `NOT FOUND` + `v_creator IS NULL` 均 **fail-closed** RAISE。
7. approver ≠ creator 的**声明**不相等 check（诚实标注=声明身份，非真身份）。
8. **查明运行时 DB 凭证是否能 drop/disable trigger**——若 runtime = 表 owner，本控制只防误操作/受限凭证直插，
   不抗 owner/superuser（文档如实写「防受限运行时凭证普通 INSERT，不抗 DB owner/superuser/迁移管理员」）。
9. 全部 DB 拒绝路径**真库测试**（非只测 TS writer）。

## 待你拍板的点

1. **知情下确认方案 B 的收窄口径**（关键）：DB 层做「artifact 完整性 + 声明身份不相等」（完整版 9 项），
   **不假装**真身份 SoD——真身份来自**应用认证上下文**（app 从登录 session 取 approvedBy）；★当前 DB artifact
   和离线完整性核验（Item 1 `verifyReportIntegrity` 只证内容/golden 完整性）**不提供 actor 身份的密码学证明**。这在
   你的部署约束（Hyperdrive + 可能 managed）下是务实最优：真关闭 backdate/orphan/父表矛盾，SoD 从可绕过的 TS
   `if` 变 DB 层声明约束。**接受继续实现 B 完整版？** 还是要探讨可信身份根（签名 actor assertion，大工程 +
   部分与部署冲突）？
2. **凭证入口（旁支，已澄清）**：本地 `.env` 含 secret 但**已核实未提交**（`.gitignore` 有 `.env*`）——非仓库
   泄露。T1 真实入口=生产 secret 管理，与 DB 层防护正交，本 ADR 不处理。
