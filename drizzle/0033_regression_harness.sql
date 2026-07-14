-- P0-A 规则集升级回归工具（ADR 0030 M1，附录 B）——证据模型表。
-- RegressionCase（不可变 golden）+ RegressionReport（审计 artifact）+ User.replayRetentionEnabled
-- （PII 数据准入 opt-in）。
--
-- ★手写精确迁移（非 drizzle-kit generate）：schema.ts 领先 migration snapshot 存在既有漂移，
-- drizzle-kit generate 会产大量无关表迁移可能破坏生产。只加本特性所需表/列/索引，零副作用。
--
-- 锁风险评估：CREATE TABLE IF NOT EXISTS 新表无锁历史表；User ADD COLUMN nullable 无默认重写
-- 风险——replayRetentionEnabled 有 DEFAULT false NOT NULL，PG 11+ 对「有常量默认的 NOT NULL 列」
-- 也是元数据操作（存默认在 catalog，不重写全表）。索引在新空表非 concurrent 无锁风险。

-- PII 数据准入 opt-in（tenant=userId 级；默认关=不留明文回放真值）。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "replayRetentionEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "RegressionCase" (
	"id" text PRIMARY KEY NOT NULL,
	"policyId" text NOT NULL,
	"policyVersionRowId" text NOT NULL,
	"policyVersion" integer,
	"functionName" text NOT NULL,
	"locale" text NOT NULL,
	"aliasSetJson" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vocabSnapshotRef" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputJson" jsonb,
	"canonicalInputHash" text NOT NULL,
	"expectedOutputHash" text NOT NULL,
	"expectedDecision" text,
	"canonicalizationVersion" text NOT NULL,
	"sourceKind" text NOT NULL,
	"sourceExecutionId" text,
	"coverageTags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"baselineRuntimeToolchainId" text,
	"sourceToolchainId" text,
	"sourceEnvelopeSha256" text,
	"caseHash" text NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RegressionCase_caseHash_unique" UNIQUE("caseHash"),
	-- 证据模型完整性硬化（DB 层防非法枚举值，Codex 复审建议）。
	CONSTRAINT "RegressionCase_sourceKind_check" CHECK ("sourceKind" IN ('execution', 'handwritten'))
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "RegressionReport" (
	"id" text PRIMARY KEY NOT NULL,
	"policyId" text NOT NULL,
	"policyVersionRowId" text NOT NULL,
	"status" text NOT NULL,
	"comparisonMode" text NOT NULL,
	"caseCount" integer DEFAULT 0 NOT NULL,
	"runnableCaseCount" integer DEFAULT 0 NOT NULL,
	"passedCaseCount" integer DEFAULT 0 NOT NULL,
	"failedCaseCount" integer DEFAULT 0 NOT NULL,
	"nonReplayableCaseCount" integer DEFAULT 0 NOT NULL,
	"coverageJson" jsonb NOT NULL,
	"reportJson" jsonb NOT NULL,
	"reportHash" text NOT NULL,
	"currentRuntimeToolchainId" text,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RegressionReport_reportHash_unique" UNIQUE("reportHash"),
	-- 证据模型完整性硬化（Codex 复审建议）。
	CONSTRAINT "RegressionReport_status_check" CHECK ("status" IN ('PASS', 'FAIL_REGRESSION', 'FAIL_INSUFFICIENT_COVERAGE', 'NON_REPLAYABLE'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "RegressionCase_policyId_idx" ON "RegressionCase" USING btree ("policyId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionCase_policyVersionRowId_idx" ON "RegressionCase" USING btree ("policyVersionRowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionCase_canonicalInputHash_idx" ON "RegressionCase" USING btree ("canonicalInputHash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "RegressionCase_unique_case_idx" ON "RegressionCase" USING btree ("policyVersionRowId","functionName","locale","canonicalInputHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionReport_policyVersionRowId_createdAt_idx" ON "RegressionReport" USING btree ("policyVersionRowId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionReport_status_idx" ON "RegressionReport" USING btree ("status");
