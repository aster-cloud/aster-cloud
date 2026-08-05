-- 基线迁移：创建 0001 之前就已存在的 4 张核心表。
-- 
-- ★为什么之前没有：这 4 张表最初是用 drizzle-kit push 直接建的，
--   从未生成对应迁移。于是 0001 起就 ALTER 一张迁移链里不存在的表，
--   导致从空库重放必然失败（relation "User" does not exist）。
--   生产库因为是 push 建的所以一直正常——问题只在灾备/新环境重建时暴露。
-- 
-- ★列集合 = 生产当前列 − 后续迁移 ADD COLUMN 的列。
--   不能直接照搬生产全部列，否则后续 ADD COLUMN 会 duplicate column 报错。
-- 
-- 幂等：全部用 IF NOT EXISTS，已有库重放本文件是 no-op。

-- 依赖的 enum 类型（DO 块保证幂等：已存在则跳过）
DO $$ BEGIN CREATE TYPE "ExecutionDecision" AS ENUM ('approved','denied','indeterminate','error'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ExecutionSource" AS ENUM ('dashboard','api','playground'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "Plan" AS ENUM ('free','trial','pro','team','enterprise'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','DEPRECATED','ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('active','past_due','canceled','incomplete','incomplete_expired','trialing','unpaid','paused'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "User" (
	id text NOT NULL,
	name text,
	email text,
	"emailVerified" timestamp without time zone,
	image text,
	"passwordHash" text,
	"failedLoginAttempts" integer NOT NULL DEFAULT 0,
	"lastFailedLoginAt" timestamp without time zone,
	"lockedUntil" timestamp without time zone,
	"lockoutCount" integer NOT NULL DEFAULT 0,
	plan "Plan" NOT NULL DEFAULT 'free'::"Plan",
	"stripeCustomerId" text,
	"subscriptionId" text,
	"subscriptionStatus" "SubscriptionStatus",
	"trialStartedAt" timestamp without time zone,
	"trialEndsAt" timestamp without time zone,
	"createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp without time zone NOT NULL,
	"onboardingUseCase" text,
	"onboardingGoals" text[],
	"onboardingCompletedAt" timestamp without time zone,
	"emailNormalized" text,
	"signupIpHash" text,
	"apiQuotaWarn80SentAt" timestamp without time zone,
	"apiQuotaWarn100SentAt" timestamp without time zone,
	"apiQuotaWarn200SentAt" timestamp without time zone,
	"gracePeriodStartsAt" timestamp without time zone,
	"gracePeriodEndsAt" timestamp without time zone,
	"dunningEmailsSentCount" integer NOT NULL DEFAULT 0,
	"lastDunningEmailSentAt" timestamp without time zone,
	"downgradedAt" timestamp without time zone,
	"priceLockedAt" timestamp without time zone,
	"legacyTier" text,
	"trialEndingEmailSentAt" timestamp without time zone,
	"aiBannedUntil" timestamp without time zone,
	"aiBanReason" text,
	"deletedAt" timestamp without time zone,
	"purgePendingUntil" timestamp without time zone,
	"reactivationCount" integer NOT NULL DEFAULT 0,
	"priorPurgeCount" integer NOT NULL DEFAULT 0,
	"riskTier" integer NOT NULL DEFAULT 0,
	"riskTierReason" text,
	"isAdmin" boolean NOT NULL DEFAULT false,
	"mustChangePassword" boolean NOT NULL DEFAULT false,
	"replayRetentionEnabled" boolean NOT NULL DEFAULT false,
	"byokQuotaResetAt" timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Team" (
	id text NOT NULL,
	name text NOT NULL,
	slug text NOT NULL,
	"ownerId" text NOT NULL,
	"createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp without time zone NOT NULL,
	"enabledLocales" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PolicyVersion" (
	id text NOT NULL,
	"policyId" text NOT NULL,
	version integer NOT NULL,
	content text NOT NULL,
	source text,
	"sourceHash" text,
	"prevHash" text,
	comment text,
	status "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT'::"PolicyVersionStatus",
	"createdBy" text,
	"isDefault" boolean NOT NULL DEFAULT false,
	"releaseNote" text,
	"deprecatedAt" timestamp without time zone,
	"deprecatedBy" text,
	"archivedAt" timestamp without time zone,
	"archivedBy" text,
	"createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"vocabularySnapshotIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"aliasSet" text,
	"sourceEnvelopeSha256" text,
	"sourceToolchainId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Execution" (
	id text NOT NULL,
	"userId" text NOT NULL,
	"policyId" text NOT NULL,
	input jsonb NOT NULL,
	output jsonb,
	error text,
	"durationMs" integer NOT NULL,
	success boolean NOT NULL,
	"policyVersion" integer,
	source "ExecutionSource" NOT NULL DEFAULT 'dashboard'::"ExecutionSource",
	"apiKeyId" text,
	metadata jsonb,
	"createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	decision "ExecutionDecision",
	"policyVersionRowId" text,
	"functionName" text,
	locale text,
	"aliasSetJson" json,
	"vocabSnapshotRef" json,
	"sourceToolchainId" text,
	"runtimeToolchainId" text,
	"reasonCodes" json,
	"traceJson" json,
	"traceHash" text,
	"canonicalInputHash" text,
	"canonicalOutputHash" text,
	"canonicalizationVersion" text,
	"replayCaptureVersion" text,
	"replayabilityStatus" text,
	"replayabilityReasons" json,
	"replayPayloadCiphertext" text,
	"replayPayloadAlg" text,
	"replayPayloadKeyId" text,
	"replayPayloadNonce" text,
	"replayPayloadHash" text,
	"piiRetentionUntil" timestamp without time zone,
	"piiPolicyVersion" text
);
--> statement-breakpoint

-- 主键（约束名与生产一致；IF NOT EXISTS 由 DO 块模拟）
DO $$ BEGIN ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Team" ADD CONSTRAINT "Team_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Execution" ADD CONSTRAINT "Execution_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
