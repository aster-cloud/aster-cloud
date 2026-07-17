-- P0-A runner 加固第三批（Item 3：INSERT 层 artifact 完整性 + 声明身份 SoD）。
--
-- 背景：0037 的 append-only trigger 只拦 UPDATE/DELETE，INSERT 完全无防护——可直插伪造行、backdate
-- （createdAt/approvedAt insert 时任意设）、插引用不存在报告的审批、绕过应用层 SoD。本迁移在 DB INSERT
-- 层补齐 artifact 完整性 + 声明身份不相等约束（BEFORE INSERT trigger，任何 INSERT 路径都跑，含直连）。
--
-- ★信任边界（诚实标注，见 docs/p0a-db-sod-decision.md）：本控制防「持受限运行时 DB 凭证的普通 INSERT」
-- 绕过应用校验，**不抗** DB owner / superuser / 迁移管理员（他们可 drop/disable trigger 或 SET
-- session_replication_role）。且 SoD 只比较 approvedBy vs report.createdBy 两个**声明字符串**是否相等——
-- 是「声明身份 SoD」，**不是**「真实主体 SoD」（trigger 无法证明 INSERT 由该主体发起）。真实 actor 身份**仅**
-- 来自应用认证上下文（app 从登录 session 取 approvedBy）；本 trigger 与 verifyReportIntegrity（只证 report/golden
-- 内容完整性）**均不提供 actor 身份的密码学证明**。

-- ============ FK：approval → report（防引用不存在报告） ============
-- 生产上线前清空数据，无孤儿行。preflight：若存在孤儿则本迁移应失败并暴露（下方 DO 块显式检查）。
DO $$
DECLARE
  v_orphans bigint;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM "RegressionDriftApproval" a
  LEFT JOIN "RegressionReport" r ON r."id" = a."reportId"
  WHERE r."id" IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'cannot add FK: % orphan RegressionDriftApproval rows reference missing RegressionReport', v_orphans;
  END IF;
END $$;
--> statement-breakpoint
-- NOT VALID + VALIDATE：新写入立即受约束，随后验证存量，降低大表建约束的锁窗口。
ALTER TABLE "RegressionDriftApproval"
  ADD CONSTRAINT "RegressionDriftApproval_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "RegressionReport"("id") ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
ALTER TABLE "RegressionDriftApproval" VALIDATE CONSTRAINT "RegressionDriftApproval_reportId_fkey";
--> statement-breakpoint

-- ============ Case/Report INSERT：backdate 防护 ============
-- 强制 createdAt = statement_timestamp()（语句执行时刻，非 now()=事务开始时间），无视 insert 提供值。
CREATE OR REPLACE FUNCTION "regression_case_report_insert_stamp"() RETURNS trigger AS $$
BEGIN
  NEW."createdAt" := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionCase_insert_stamp" ON "RegressionCase";--> statement-breakpoint
CREATE TRIGGER "RegressionCase_insert_stamp"
  BEFORE INSERT ON "RegressionCase"
  FOR EACH ROW EXECUTE FUNCTION "regression_case_report_insert_stamp"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionReport_insert_stamp" ON "RegressionReport";--> statement-breakpoint
CREATE TRIGGER "RegressionReport_insert_stamp"
  BEFORE INSERT ON "RegressionReport"
  FOR EACH ROW EXECUTE FUNCTION "regression_case_report_insert_stamp"();
--> statement-breakpoint

-- ============ Approval INSERT：完整性 + 声明身份 SoD ============
-- 一次查父 report，校验冗余字段一致 + 声明 SoD + 初始状态 + 时间关系 + backdate 防护。
CREATE OR REPLACE FUNCTION "regression_approval_insert_guard"() RETURNS trigger AS $$
DECLARE
  v_creator     text;
  v_report_hash text;
  v_policy_id   text;
  v_pv_row_id   text;
BEGIN
  -- backdate 防护：强制服务器语句时间（无视 insert 提供值）。
  NEW."approvedAt" := statement_timestamp();
  NEW."createdAt"  := statement_timestamp();

  -- 初始状态：INSERT 时不得预填撤销列（撤销是后续一次性 UPDATE，见 0037）。
  IF NEW."revokedAt" IS NOT NULL OR NEW."revokedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'RegressionDriftApproval must be inserted un-revoked (revokedAt/revokedBy must be NULL)';
  END IF;

  -- 时间关系：有效期须晚于审批时刻（防生效即过期/时间倒置）。
  IF NEW."expiresAt" <= NEW."approvedAt" THEN
    RAISE EXCEPTION 'RegressionDriftApproval expiresAt must be after approvedAt';
  END IF;

  -- 查父 report（FK 已保证存在，但 trigger 内查以取 createdBy + 校验冗余字段一致）。
  SELECT "createdBy", "reportHash", "policyId", "policyVersionRowId"
    INTO v_creator, v_report_hash, v_policy_id, v_pv_row_id
    FROM "RegressionReport" WHERE "id" = NEW."reportId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RegressionDriftApproval references missing report %', NEW."reportId";
  END IF;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'report % has NULL createdBy; cannot enforce separation of duties', NEW."reportId";
  END IF;

  -- 父表冗余字段一致（否则 approval 内部矛盾：reportId 指真报告但 hash/policy 指另一份）。
  IF NEW."reportHash" IS DISTINCT FROM v_report_hash THEN
    RAISE EXCEPTION 'RegressionDriftApproval reportHash does not match parent report';
  END IF;
  IF NEW."policyId" IS DISTINCT FROM v_policy_id THEN
    RAISE EXCEPTION 'RegressionDriftApproval policyId does not match parent report';
  END IF;
  IF NEW."policyVersionRowId" IS DISTINCT FROM v_pv_row_id THEN
    RAISE EXCEPTION 'RegressionDriftApproval policyVersionRowId does not match parent report';
  END IF;

  -- ★声明身份 SoD：审批人声明 != 报告创建者声明。诚实标注：这比较两个声明字符串，非真实主体
  -- （trigger 无法证明 INSERT 由该主体发起）。真身份 SoD 靠应用层可信 session。
  IF NEW."approvedBy" = v_creator THEN
    RAISE EXCEPTION 'separation_of_duties: approvedBy equals report creator (%)', v_creator;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionDriftApproval_insert_guard" ON "RegressionDriftApproval";--> statement-breakpoint
CREATE TRIGGER "RegressionDriftApproval_insert_guard"
  BEFORE INSERT ON "RegressionDriftApproval"
  FOR EACH ROW EXECUTE FUNCTION "regression_approval_insert_guard"();
