-- P0-A runner 加固（CCO 复审 P0-6）：RegressionCase 加 caseHashVersion 列。
-- run 重算 caseHash 校验完整性时按 case 自己的公式版本选公式（新旧共存），避免改 caseHash 公式
-- 让已冻结的 m1.0 case 整批 GOLDEN_INTEGRITY_FAILURE。既有行回填 'case-hash/m1.0'（其 caseHash
-- 用旧 9 字段公式计算），新 freeze 写 'case-hash/m1.1'（全字段公式）。
--
-- 锁风险：ADD COLUMN 带常量 DEFAULT + NOT NULL 在 PG 11+ 不重写全表（元数据级），历史行读到默认值。
ALTER TABLE "RegressionCase"
  ADD COLUMN IF NOT EXISTS "caseHashVersion" text NOT NULL DEFAULT 'case-hash/m1.0';
--> statement-breakpoint
-- caseHashVersion 只允许已知公式版本（DB 层 fail-closed，防写入 corrupt 版本绕过完整性校验）。
DO $$ BEGIN
  ALTER TABLE "RegressionCase"
    ADD CONSTRAINT "RegressionCase_caseHashVersion_check"
    CHECK ("caseHashVersion" IN ('case-hash/m1.0', 'case-hash/m1.1'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
