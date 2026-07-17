-- P0-A runner 加固第二批（CCO 复审 P0-4 受控接受 + P0-7 DB append-only）。
--
-- P0-4：RegressionDriftApproval——不可变审批 artifact，受控接受 FAIL_REGRESSION 报告的具体漂移，
-- 原失败报告不改。P0-7：DB 层 trigger 禁 UPDATE/DELETE RegressionCase/Report（append-only），
-- RegressionDriftApproval 只允许 revoke 列（revokedAt/revokedBy）从 NULL→非 NULL 的一次性撤销。

-- ============ P0-4 审批表 ============
CREATE TABLE IF NOT EXISTS "RegressionDriftApproval" (
  "id" text PRIMARY KEY NOT NULL,
  "reportId" text NOT NULL,
  "reportHash" text NOT NULL,
  "policyId" text NOT NULL,
  "policyVersionRowId" text NOT NULL,
  "acceptedDrifts" jsonb NOT NULL,
  "reason" text NOT NULL,
  "ticketRef" text,
  "approvedBy" text NOT NULL,
  "approvedAt" timestamp DEFAULT now() NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp,
  "revokedBy" text,
  "approvalHash" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "RegressionDriftApproval_approvalHash_unique" UNIQUE("approvalHash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionDriftApproval_reportId_idx" ON "RegressionDriftApproval" ("reportId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionDriftApproval_policyVersionRowId_idx" ON "RegressionDriftApproval" ("policyVersionRowId");--> statement-breakpoint
-- 一份报告对同一 approver 只允许一条**有效（未撤销）**审批（partial unique，撤销后可再建）。
CREATE UNIQUE INDEX IF NOT EXISTS "RegressionDriftApproval_active_unique" ON "RegressionDriftApproval" ("reportId","approvedBy") WHERE "revokedAt" IS NULL;--> statement-breakpoint

-- ============ P0-7 append-only 强制 ============
-- RegressionCase / RegressionReport：完全 append-only（禁 UPDATE + DELETE）。
CREATE OR REPLACE FUNCTION "regression_append_only_guard"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is forbidden (immutable evidence)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionCase_append_only" ON "RegressionCase";--> statement-breakpoint
CREATE TRIGGER "RegressionCase_append_only"
  BEFORE UPDATE OR DELETE ON "RegressionCase"
  FOR EACH ROW EXECUTE FUNCTION "regression_append_only_guard"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionReport_append_only" ON "RegressionReport";--> statement-breakpoint
CREATE TRIGGER "RegressionReport_append_only"
  BEFORE UPDATE OR DELETE ON "RegressionReport"
  FOR EACH ROW EXECUTE FUNCTION "regression_append_only_guard"();
--> statement-breakpoint

-- RegressionDriftApproval：禁 DELETE；UPDATE 只允许 revoke（revokedAt/revokedBy 从 NULL→非 NULL 一次），
-- 其它列一律不可改（防篡改已批范围/hash）。
CREATE OR REPLACE FUNCTION "regression_approval_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: DELETE on RegressionDriftApproval is forbidden';
  END IF;
  -- UPDATE：除 revokedAt/revokedBy 外所有列必须不变。
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."reportId" IS DISTINCT FROM OLD."reportId"
     OR NEW."reportHash" IS DISTINCT FROM OLD."reportHash"
     OR NEW."policyId" IS DISTINCT FROM OLD."policyId"
     OR NEW."policyVersionRowId" IS DISTINCT FROM OLD."policyVersionRowId"
     OR NEW."acceptedDrifts" IS DISTINCT FROM OLD."acceptedDrifts"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."ticketRef" IS DISTINCT FROM OLD."ticketRef"
     OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
     OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."approvalHash" IS DISTINCT FROM OLD."approvalHash"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'RegressionDriftApproval is immutable except revoke (revokedAt/revokedBy)';
  END IF;
  -- ★撤销是严格一次性状态转换（Codex 复审）：OLD 两列都 NULL、NEW 两列都非 NULL，缺一不可。
  -- 防：只改 revokedBy 留 revokedAt=NULL（审批仍有效）/ revokedAt 非 NULL 但 revokedBy=NULL（无撤销人）/
  -- 把已撤销改回 NULL。
  IF OLD."revokedAt" IS NOT NULL OR OLD."revokedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'RegressionDriftApproval already revoked; revoke is one-shot';
  END IF;
  IF NEW."revokedAt" IS NULL OR NEW."revokedBy" IS NULL THEN
    RAISE EXCEPTION 'revoke requires both revokedAt and revokedBy to be set (NULL->NOT NULL)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionDriftApproval_guard" ON "RegressionDriftApproval";--> statement-breakpoint
CREATE TRIGGER "RegressionDriftApproval_guard"
  BEFORE UPDATE OR DELETE ON "RegressionDriftApproval"
  FOR EACH ROW EXECUTE FUNCTION "regression_approval_guard"();
