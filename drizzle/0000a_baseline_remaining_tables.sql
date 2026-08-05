-- 基线补全：其余 24 张同样用 drizzle-kit push 建、从未生成迁移的表。
-- 与 0000 同因：生产靠 push 建库故一直正常，只有从空库重放（灾备/新环境）才暴露。
-- 全部 IF NOT EXISTS / DO 块，已有库重放为 no-op。

DO $$ BEGIN CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED','REJECTED','REQUESTED_CHANGES'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ComplianceType" AS ENUM ('gdpr','hipaa','soc2','pci_dss','custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "EventSeverity" AS ENUM ('INFO','WARNING','ERROR','CRITICAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ExecutionDecision" AS ENUM ('approved','denied','indeterminate','error'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ExecutionSource" AS ENUM ('dashboard','api','playground'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "Plan" AS ENUM ('free','trial','pro','team','enterprise'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','DEPRECATED','ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ReportStatus" AS ENUM ('generating','completed','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "SecurityEventType" AS ENUM ('SIGNATURE_INVALID','NONCE_REUSED','TIMESTAMP_EXPIRED','HASH_MISMATCH','UNAUTHORIZED_APPROVAL','SELF_APPROVAL_ATTEMPT','POLICY_EXECUTED','APPROVAL_DECISION','VERSION_CREATED','VERSION_NOT_FOUND','DEPRECATED_VERSION_EXECUTED','VERSION_SET_DEFAULT','VERSION_DEPRECATED','VERSION_ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('active','past_due','canceled','incomplete','incomplete_expired','trialing','unpaid','paused'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "TeamRole" AS ENUM ('owner','admin','member','viewer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "UsageType" AS ENUM ('execution','pii_scan','compliance_report','api_call'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Account" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text,
    refresh_token_expires_in integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ApiKey" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    prefix text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AuditLog" (
    id text NOT NULL,
    "userId" text,
    "teamId" text,
    action text NOT NULL,
    resource text NOT NULL,
    "resourceId" text,
    metadata jsonb,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ComplianceReport" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type public."ComplianceType" NOT NULL,
    title text NOT NULL,
    status public."ReportStatus" DEFAULT 'generating'::public."ReportStatus" NOT NULL,
    data jsonb,
    "policyIds" text[],
    period text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DemoAuditLog" (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    action text NOT NULL,
    resource text NOT NULL,
    "resourceId" text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DemoExecution" (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    "policyId" text NOT NULL,
    input jsonb NOT NULL,
    output jsonb,
    error text,
    "durationMs" integer NOT NULL,
    success boolean NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DemoPolicy" (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    name text NOT NULL,
    description text,
    content text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "defaultInput" jsonb,
    "piiFields" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DemoPolicyVersion" (
    id text NOT NULL,
    "policyId" text NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    comment text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DemoSession" (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Notification" (
    id text NOT NULL,
    "userId" text NOT NULL,
    kind text NOT NULL,
    data jsonb NOT NULL,
    "readAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    id text NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    expires timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PlatformSetting" (
    key text NOT NULL,
    value jsonb NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedBy" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Policy" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "teamId" text,
    "groupId" text,
    name text NOT NULL,
    description text,
    content text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "isPublic" boolean DEFAULT false NOT NULL,
    "shareSlug" text,
    "piiFields" jsonb,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text,
    "deleteReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PolicyApproval" (
    id text NOT NULL,
    "versionId" text NOT NULL,
    "approverId" text NOT NULL,
    decision public."ApprovalDecision" NOT NULL,
    comment text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PolicyGroup" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "parentId" text,
    "userId" text,
    "teamId" text,
    "isSystem" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PolicyRecycleBin" (
    id text NOT NULL,
    "policyId" text NOT NULL,
    "userId" text NOT NULL,
    snapshot jsonb NOT NULL,
    "deletedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedBy" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PolicyShare" (
    id text NOT NULL,
    "policyId" text NOT NULL,
    "teamId" text NOT NULL,
    "sharedByUserId" text NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    permission text DEFAULT 'execute'::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SecurityEvent" (
    id text NOT NULL,
    "eventType" public."SecurityEventType" NOT NULL,
    severity public."EventSeverity" NOT NULL,
    "policyId" text,
    "userId" text,
    "ipAddress" text,
    "userAgent" text,
    "requestId" text,
    details jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Session" (
    id text NOT NULL,
    "sessionToken" text NOT NULL,
    "userId" text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TeamInvitation" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    email text NOT NULL,
    role public."TeamRole" DEFAULT 'member'::public."TeamRole" NOT NULL,
    token text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TeamMember" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "userId" text NOT NULL,
    role public."TeamRole" DEFAULT 'member'::public."TeamRole" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UsageRecord" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type public."UsageType" NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    period text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UsedNonce" (
    id text NOT NULL,
    nonce text NOT NULL,
    "policyId" text,
    "userId" text,
    "usedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "VerificationToken" (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account" USING btree (provider, "providerAccountId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account" USING btree ("userId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_key_key" ON "ApiKey" USING btree (key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiKey_prefix_idx" ON "ApiKey" USING btree (prefix);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog" USING btree (action);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_teamId_idx" ON "AuditLog" USING btree ("teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ComplianceReport_createdAt_idx" ON "ComplianceReport" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ComplianceReport_userId_idx" ON "ComplianceReport" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoAuditLog_action_idx" ON "DemoAuditLog" USING btree (action);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoAuditLog_createdAt_idx" ON "DemoAuditLog" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoAuditLog_sessionId_idx" ON "DemoAuditLog" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoExecution_createdAt_idx" ON "DemoExecution" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoExecution_policyId_idx" ON "DemoExecution" USING btree ("policyId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoExecution_sessionId_idx" ON "DemoExecution" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoPolicy_sessionId_idx" ON "DemoPolicy" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoPolicyVersion_policyId_idx" ON "DemoPolicyVersion" USING btree ("policyId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DemoPolicyVersion_policyId_version_key" ON "DemoPolicyVersion" USING btree ("policyId", version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoSession_expiresAt_idx" ON "DemoSession" USING btree ("expiresAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DemoSession_sessionId_idx" ON "DemoSession" USING btree ("sessionId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DemoSession_sessionId_key" ON "DemoSession" USING btree ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification" USING btree ("userId", "readAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PasswordResetToken_email_idx" ON "PasswordResetToken" USING btree (email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PasswordResetToken_token_idx" ON "PasswordResetToken" USING btree (token);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken" USING btree (token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Policy_deletedAt_idx" ON "Policy" USING btree ("deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Policy_groupId_idx" ON "Policy" USING btree ("groupId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Policy_shareSlug_idx" ON "Policy" USING btree ("shareSlug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Policy_shareSlug_key" ON "Policy" USING btree ("shareSlug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Policy_teamId_idx" ON "Policy" USING btree ("teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Policy_userId_idx" ON "Policy" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyApproval_approverId_idx" ON "PolicyApproval" USING btree ("approverId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyApproval_createdAt_idx" ON "PolicyApproval" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyApproval_versionId_idx" ON "PolicyApproval" USING btree ("versionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyGroup_parentId_idx" ON "PolicyGroup" USING btree ("parentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyGroup_sortOrder_idx" ON "PolicyGroup" USING btree ("sortOrder");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyGroup_teamId_idx" ON "PolicyGroup" USING btree ("teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyGroup_userId_idx" ON "PolicyGroup" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyRecycleBin_expiresAt_idx" ON "PolicyRecycleBin" USING btree ("expiresAt");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PolicyRecycleBin_policyId_key" ON "PolicyRecycleBin" USING btree ("policyId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyRecycleBin_userId_idx" ON "PolicyRecycleBin" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyShare_policyId_idx" ON "PolicyShare" USING btree ("policyId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PolicyShare_policy_team_key" ON "PolicyShare" USING btree ("policyId", "teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PolicyShare_teamId_idx" ON "PolicyShare" USING btree ("teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SecurityEvent_createdAt_idx" ON "SecurityEvent" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SecurityEvent_eventType_idx" ON "SecurityEvent" USING btree ("eventType");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SecurityEvent_policyId_idx" ON "SecurityEvent" USING btree ("policyId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SecurityEvent_severity_idx" ON "SecurityEvent" USING btree (severity);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session" USING btree ("sessionToken");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TeamInvitation_email_idx" ON "TeamInvitation" USING btree (email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TeamInvitation_teamId_idx" ON "TeamInvitation" USING btree ("teamId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TeamInvitation_token_idx" ON "TeamInvitation" USING btree (token);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TeamInvitation_token_key" ON "TeamInvitation" USING btree (token);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_teamId_userId_key" ON "TeamMember" USING btree ("teamId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx" ON "TeamMember" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UsageRecord_userId_period_idx" ON "UsageRecord" USING btree ("userId", period);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UsageRecord_userId_type_period_key" ON "UsageRecord" USING btree ("userId", type, period);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UsedNonce_expiresAt_idx" ON "UsedNonce" USING btree ("expiresAt");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UsedNonce_nonce_key" ON "UsedNonce" USING btree (nonce);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UsedNonce_policyId_idx" ON "UsedNonce" USING btree ("policyId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key" ON "VerificationToken" USING btree (identifier, token);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken" USING btree (token);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Account" ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ComplianceReport" ADD CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "DemoAuditLog" ADD CONSTRAINT "DemoAuditLog_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "DemoExecution" ADD CONSTRAINT "DemoExecution_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "DemoPolicy" ADD CONSTRAINT "DemoPolicy_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "DemoPolicyVersion" ADD CONSTRAINT "DemoPolicyVersion_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "DemoSession" ADD CONSTRAINT "DemoSession_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY (key); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Policy" ADD CONSTRAINT "Policy_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PolicyApproval" ADD CONSTRAINT "PolicyApproval_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PolicyGroup" ADD CONSTRAINT "PolicyGroup_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PolicyRecycleBin" ADD CONSTRAINT "PolicyRecycleBin_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "PolicyShare" ADD CONSTRAINT "PolicyShare_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "UsedNonce" ADD CONSTRAINT "UsedNonce_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_table THEN null; WHEN invalid_table_definition THEN null; END $$;
--> statement-breakpoint