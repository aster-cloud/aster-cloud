/**
 * Drizzle ORM Schema
 * 从 Prisma schema 迁移而来，用于 Cloudflare Workers/Pages 环境
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  bigint,
  json,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { desc, relations, sql } from 'drizzle-orm';

// ============================================
// Enums
// ============================================

export const planEnum = pgEnum('Plan', ['free', 'trial', 'pro', 'team', 'enterprise']);

export const subscriptionStatusEnum = pgEnum('SubscriptionStatus', [
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'unpaid',
  'paused',
]);

export const policyVersionStatusEnum = pgEnum('PolicyVersionStatus', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'DEPRECATED',
  'ARCHIVED',
]);

export const approvalDecisionEnum = pgEnum('ApprovalDecision', [
  'APPROVED',
  'REJECTED',
  'REQUESTED_CHANGES',
]);

export const securityEventTypeEnum = pgEnum('SecurityEventType', [
  'SIGNATURE_INVALID',
  'NONCE_REUSED',
  'TIMESTAMP_EXPIRED',
  'HASH_MISMATCH',
  'UNAUTHORIZED_APPROVAL',
  'SELF_APPROVAL_ATTEMPT',
  'POLICY_EXECUTED',
  'APPROVAL_DECISION',
  'VERSION_CREATED',
  'VERSION_NOT_FOUND',
  'DEPRECATED_VERSION_EXECUTED',
  'VERSION_SET_DEFAULT',
  'VERSION_DEPRECATED',
  'VERSION_ARCHIVED',
]);

export const eventSeverityEnum = pgEnum('EventSeverity', [
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);

export const executionSourceEnum = pgEnum('ExecutionSource', [
  'dashboard',
  'api',
  'playground',
]);

export const usageTypeEnum = pgEnum('UsageType', [
  'execution',
  'pii_scan',
  'compliance_report',
  'api_call',
]);

export const teamRoleEnum = pgEnum('TeamRole', ['owner', 'admin', 'member', 'viewer']);

export const complianceTypeEnum = pgEnum('ComplianceType', [
  'gdpr',
  'hipaa',
  'soc2',
  'pci_dss',
  'custom',
]);

export const reportStatusEnum = pgEnum('ReportStatus', [
  'generating',
  'completed',
  'failed',
]);

// ============================================
// NextAuth.js 必需的模型
// ============================================

export const accounts = pgTable(
  'Account',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
    refresh_token_expires_in: integer('refresh_token_expires_in'),
  },
  (table) => [
    uniqueIndex('Account_provider_providerAccountId_key').on(
      table.provider,
      table.providerAccountId
    ),
    index('Account_userId_idx').on(table.userId),
  ]
);

export const sessions = pgTable(
  'Session',
  {
    id: text('id').primaryKey().notNull(),
    sessionToken: text('sessionToken').notNull().unique(),
    userId: text('userId').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [index('Session_userId_idx').on(table.userId)]
);

export const verificationTokens = pgTable(
  'VerificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull().unique(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('VerificationToken_identifier_token_key').on(
      table.identifier,
      table.token
    ),
  ]
);

export const passwordResetTokens = pgTable(
  'PasswordResetToken',
  {
    id: text('id').primaryKey().notNull(),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('PasswordResetToken_email_idx').on(table.email),
    index('PasswordResetToken_token_idx').on(table.token),
  ]
);

// ============================================
// User 模型
// ============================================

export const users = pgTable(
  'User',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name'),
    email: text('email').unique(),
    /**
     * 反多重注册去重键（gmail+xxx 剥离、点号去除、toLowerCase）
     * 详见 lib/email-normalize.ts
     */
    emailNormalized: text('emailNormalized'),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    image: text('image'),
    passwordHash: text('passwordHash'),

    // Account Lockout
    failedLoginAttempts: integer('failedLoginAttempts').default(0).notNull(),
    lastFailedLoginAt: timestamp('lastFailedLoginAt', { mode: 'date' }),
    lockedUntil: timestamp('lockedUntil', { mode: 'date' }),
    lockoutCount: integer('lockoutCount').default(0).notNull(),

    // Subscription
    plan: planEnum('plan').default('free').notNull(),
    stripeCustomerId: text('stripeCustomerId').unique(),
    subscriptionId: text('subscriptionId').unique(),
    subscriptionStatus: subscriptionStatusEnum('subscriptionStatus'),
    // 老用户保护：首次锁定价格的时间，决定走 LEGACY_PLAN_LIMITS 还是 PM_PLAN_LIMITS_V2
    priceLockedAt: timestamp('priceLockedAt', { mode: 'date' }),
    // 遗留档位标记：grandfather Team 客户用（plan='pro' + legacyTier='team' = 老 Team 客户，UI 显示 Pro）
    legacyTier: text('legacyTier'),

    // Trial
    trialStartedAt: timestamp('trialStartedAt', { mode: 'date' }),
    trialEndsAt: timestamp('trialEndsAt', { mode: 'date' }),
    // F2.5 trial 邮件发送幂等标记：避免 webhook 重投导致重复发邮件
    trialEndingEmailSentAt: timestamp('trialEndingEmailSentAt', { mode: 'date' }),

    // AI 防盗刷自动封禁（v1.0 详见 07-ai-billing.md L3 异常检测）
    aiBannedUntil: timestamp('aiBannedUntil', { mode: 'date' }),
    aiBanReason: text('aiBanReason'),
    /**
     * 注册时的 SHA256(ip+salt) 前 16 字符（GDPR 数据最小化）
     * 用于反多重注册聚类检测：同 hash 24h 内 ≥5 个新账号有 LLM 调用 → 全部冻结
     */
    signupIpHash: text('signupIpHash'),

    // API 配额警告邮件幂等标记（避免 cron 重复发送，按 periodMonth 重置）
    apiQuotaWarn80SentAt: timestamp('apiQuotaWarn80SentAt', { mode: 'date' }),
    apiQuotaWarn100SentAt: timestamp('apiQuotaWarn100SentAt', { mode: 'date' }),
    apiQuotaWarn200SentAt: timestamp('apiQuotaWarn200SentAt', { mode: 'date' }),

    // Dunning 催收（详见 aster-deploy/docs/pm/08-dunning.md）
    /** 首次支付失败的时间戳；用于判断 grace period 起点 */
    gracePeriodStartsAt: timestamp('gracePeriodStartsAt', { mode: 'date' }),
    /** Grace period 截止日（now + 21d）；超过此日期 + 仍未付款 → auto-downgrade */
    gracePeriodEndsAt: timestamp('gracePeriodEndsAt', { mode: 'date' }),
    /** 已发送的催收邮件次数（0..4），用于幂等控制 */
    dunningEmailsSentCount: integer('dunningEmailsSentCount').default(0).notNull(),
    /** 上次催收邮件发送时间（避免一天发多封） */
    lastDunningEmailSentAt: timestamp('lastDunningEmailSentAt', { mode: 'date' }),
    /** 自动降级到 Free 的时间；30 天内重新付款可恢复，之后由 GDPR cleanup 清理 */
    downgradedAt: timestamp('downgradedAt', { mode: 'date' }),

    // Onboarding
    onboardingUseCase: text('onboardingUseCase'),
    onboardingGoals: text('onboardingGoals').array(),
    onboardingCompletedAt: timestamp('onboardingCompletedAt', { mode: 'date' }),

    // Soft-delete + grace-period reactivation
    /** 用户发起自删的时间。非空 → 账号处于墓碑状态，正常 signIn 拒绝。 */
    deletedAt: timestamp('deletedAt', { mode: 'date' }),
    /** Hard-purge 时间点（deletedAt + 30d）。cron 到此时间真正物理删除。 */
    purgePendingUntil: timestamp('purgePendingUntil', { mode: 'date' }),
    /** grace 期内复活的次数（审计 / 反复活滥用）。 */
    reactivationCount: integer('reactivationCount').default(0).notNull(),
    /** 该 emailNormalized 历史上被清理的次数（hard-purge 时累计，下次同邮箱注册时携带）。 */
    priorPurgeCount: integer('priorPurgeCount').default(0).notNull(),
    /**
     * 注册风险分层（0=trusted .. 4=hard block）。在 createUser 中计算并 freeze。
     * 由 lib/risk-tier.ts 评估；下游模块（trial、AI quota、API quota、Stripe）
     * 据此分流。详见 docs/risk-tier-design.md。
     */
    riskTier: integer('riskTier').default(0).notNull(),
    /** riskTier 评分时的关键原因（用于审计 + 客户支持 + 申诉）。 */
    riskTierReason: text('riskTierReason'),

    /**
     * 平台级 admin。**与套餐 plan 解耦**：plan=enterprise 的客户不会
     * 自动变 admin，反过来 admin 也可以是 free 用户。
     *
     * 用于 /admin/* 页面 + API 路由的 server-side gate（lib/admin-auth.ts）。
     * 默认 false；唯一授予方式：DBA / 紧急情况下 SQL 手动 set true。
     *
     * 避免之前 plan='enterprise' 当 admin 的设计：第一个真实 enterprise
     * 客户付费时其 owner 会自动看见全平台用户列表（数据泄露）。
     */
    isAdmin: boolean('isAdmin').default(false).notNull(),

    /**
     * Force password change on next login.
     *
     * Set to `true` when an account is provisioned with a temporary
     * password (e.g. admin bootstrap via `pnpm seed:admin`, or future
     * admin-issued invitations). Cleared the moment the user
     * successfully runs the change-password flow.
     *
     * The login + middleware path checks this flag after auth and
     * redirects to /onboarding/change-password before letting the user
     * reach any other dashboard surface.
     */
    mustChangePassword: boolean('mustChangePassword').default(false).notNull(),

    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('User_email_idx').on(table.email),
    index('User_stripeCustomerId_idx').on(table.stripeCustomerId),
    uniqueIndex('User_emailNormalized_unique').on(table.emailNormalized),
    // 用于 cron 找到所有该 hard-purge 的墓碑用户
    index('User_purgePendingUntil_idx').on(table.purgePendingUntil),
  ]
);

// ============================================
// API Keys
// ============================================

export const apiKeys = pgTable(
  'ApiKey',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('lastUsedAt', { mode: 'date' }),
    expiresAt: timestamp('expiresAt', { mode: 'date' }),
    revokedAt: timestamp('revokedAt', { mode: 'date' }),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ApiKey_userId_idx').on(table.userId),
    index('ApiKey_prefix_idx').on(table.prefix),
  ]
);

// ============================================
// Policy Group
// ============================================

export const policyGroups = pgTable(
  'PolicyGroup',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').default(0).notNull(),
    parentId: text('parentId'),
    userId: text('userId'),
    teamId: text('teamId'),
    isSystem: boolean('isSystem').default(false).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('PolicyGroup_parentId_idx').on(table.parentId),
    index('PolicyGroup_userId_idx').on(table.userId),
    index('PolicyGroup_teamId_idx').on(table.teamId),
    index('PolicyGroup_sortOrder_idx').on(table.sortOrder),
  ]
);

// ============================================
// Policy
// ============================================

export const policies = pgTable(
  'Policy',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    teamId: text('teamId'),
    groupId: text('groupId'),
    name: text('name').notNull(),
    description: text('description'),
    content: text('content').notNull(),
    version: integer('version').default(1).notNull(),
    isPublic: boolean('isPublic').default(false).notNull(),
    shareSlug: text('shareSlug').unique(),
    piiFields: json('piiFields'),
    deletedAt: timestamp('deletedAt', { mode: 'date' }),
    deletedBy: text('deletedBy'),
    deleteReason: text('deleteReason'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('Policy_userId_idx').on(table.userId),
    index('Policy_teamId_idx').on(table.teamId),
    index('Policy_groupId_idx').on(table.groupId),
    index('Policy_shareSlug_idx').on(table.shareSlug),
    index('Policy_deletedAt_idx').on(table.deletedAt),
  ]
);

// ============================================
// Policy Version
// ============================================

export const policyVersions = pgTable(
  'PolicyVersion',
  {
    id: text('id').primaryKey().notNull(),
    policyId: text('policyId').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    source: text('source'),
    sourceHash: text('sourceHash'),
    prevHash: text('prevHash'),
    comment: text('comment'),
    status: policyVersionStatusEnum('status').default('DRAFT').notNull(),
    createdBy: text('createdBy'),
    isDefault: boolean('isDefault').default(false).notNull(),
    releaseNote: text('releaseNote'),
    deprecatedAt: timestamp('deprecatedAt', { mode: 'date' }),
    deprecatedBy: text('deprecatedBy'),
    archivedAt: timestamp('archivedAt', { mode: 'date' }),
    archivedBy: text('archivedBy'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('PolicyVersion_policyId_version_key').on(table.policyId, table.version),
    index('PolicyVersion_policyId_idx').on(table.policyId),
    index('PolicyVersion_sourceHash_idx').on(table.sourceHash),
    index('PolicyVersion_status_idx').on(table.status),
    index('PolicyVersion_policyId_status_idx').on(table.policyId, table.status),
    index('PolicyVersion_policyId_isDefault_idx').on(table.policyId, table.isDefault),
  ]
);

// ============================================
// Policy Approval
// ============================================

export const policyApprovals = pgTable(
  'PolicyApproval',
  {
    id: text('id').primaryKey().notNull(),
    versionId: text('versionId').notNull(),
    approverId: text('approverId').notNull(),
    decision: approvalDecisionEnum('decision').notNull(),
    comment: text('comment'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('PolicyApproval_versionId_idx').on(table.versionId),
    index('PolicyApproval_approverId_idx').on(table.approverId),
    index('PolicyApproval_createdAt_idx').on(table.createdAt),
  ]
);

// ============================================
// Used Nonce (防重放攻击)
// ============================================

export const usedNonces = pgTable(
  'UsedNonce',
  {
    id: text('id').primaryKey().notNull(),
    nonce: text('nonce').notNull().unique(),
    policyId: text('policyId'),
    userId: text('userId'),
    usedAt: timestamp('usedAt', { mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('UsedNonce_expiresAt_idx').on(table.expiresAt),
    index('UsedNonce_policyId_idx').on(table.policyId),
  ]
);

// ============================================
// Signup Attempts（注册限流：IP/24h ≤ 3）
// ============================================

/**
 * 注册尝试记录：用 SHA256(ip+salt) 而非明文 IP（GDPR 数据最小化）
 * cron 每天清理 createdAt < now()-24h 的记录
 */
export const signupAttempts = pgTable(
  'SignupAttempt',
  {
    id: text('id').primaryKey().notNull(),
    /** SHA256(ip + SIGNUP_IP_SALT) hex 前 16 字符 */
    ipHash: text('ipHash').notNull(),
    /** 是否最终成功（用于区分尝试 vs. 实际注册） */
    succeeded: boolean('succeeded').default(false).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('SignupAttempt_ipHash_createdAt_idx').on(table.ipHash, table.createdAt),
    index('SignupAttempt_createdAt_idx').on(table.createdAt),
  ]
);

// ============================================
// API Call Records（Policy Execution API 配额计数）
// ============================================

/**
 * Policy 执行 API 的调用记录
 *
 * 与 aiUsageRecords（LLM 调用）不同——这里记的是用户编译后的 policy 被
 * 当作 endpoint 调用的次数，按月度配额（plans.ts limits.apiCalls）扣减。
 *
 * 设计：
 *   - userId / tenantId 双索引：tenant=team 时按 team owner 聚合
 *   - 不存请求/响应 body（policy 输入输出可能含 PII；不在此层做内容审计）
 *   - status: success / quota_exhausted / rate_limited / api_error
 *   - 保留 90 天滚动删除（cron 清理）
 */
export const apiCallRecords = pgTable(
  'ApiCallRecord',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    tenantId: text('tenantId'),
    apiKeyId: text('apiKeyId'),
    /** 'YYYY-MM' 用于按月聚合查询 */
    periodMonth: text('periodMonth').notNull(),
    /** /api/policies/evaluate / evaluate-json / evaluate-source / evaluate/batch */
    endpointPath: text('endpointPath').notNull(),
    /** 调用结果：success / quota_exhausted / rate_limited / api_error */
    status: text('status').notNull(),
    /** 端到端耗时，毫秒 */
    latencyMs: integer('latencyMs').notNull().default(0),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ApiCall_userId_period_idx').on(table.userId, table.periodMonth),
    index('ApiCall_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('ApiCall_apiKeyId_createdAt_idx').on(table.apiKeyId, table.createdAt),
    index('ApiCall_createdAt_retention_idx').on(table.createdAt),
  ]
);

// ============================================
// Security Event
// ============================================

export const securityEvents = pgTable(
  'SecurityEvent',
  {
    id: text('id').primaryKey().notNull(),
    eventType: securityEventTypeEnum('eventType').notNull(),
    severity: eventSeverityEnum('severity').notNull(),
    policyId: text('policyId'),
    userId: text('userId'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    requestId: text('requestId'),
    details: json('details').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('SecurityEvent_eventType_idx').on(table.eventType),
    index('SecurityEvent_severity_idx').on(table.severity),
    index('SecurityEvent_policyId_idx').on(table.policyId),
    index('SecurityEvent_createdAt_idx').on(table.createdAt),
  ]
);

// ============================================
// Policy Recycle Bin
// ============================================

export const policyRecycleBins = pgTable(
  'PolicyRecycleBin',
  {
    id: text('id').primaryKey().notNull(),
    policyId: text('policyId').notNull().unique(),
    userId: text('userId').notNull(),
    snapshot: json('snapshot').notNull(),
    deletedAt: timestamp('deletedAt', { mode: 'date' }).defaultNow().notNull(),
    deletedBy: text('deletedBy').notNull(),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('PolicyRecycleBin_userId_idx').on(table.userId),
    index('PolicyRecycleBin_expiresAt_idx').on(table.expiresAt),
  ]
);

// ============================================
// Execution
// ============================================

export const executions = pgTable(
  'Execution',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    policyId: text('policyId').notNull(),
    input: json('input').notNull(),
    output: json('output'),
    error: text('error'),
    durationMs: integer('durationMs').notNull(),
    success: boolean('success').notNull(),
    policyVersion: integer('policyVersion'),
    source: executionSourceEnum('source').default('dashboard').notNull(),
    apiKeyId: text('apiKeyId'),
    metadata: json('metadata'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('Execution_userId_idx').on(table.userId),
    index('Execution_policyId_idx').on(table.policyId),
    index('Execution_createdAt_idx').on(table.createdAt),
    index('Execution_success_idx').on(table.success),
  ]
);

// ============================================
// Usage Record
// ============================================

export const usageRecords = pgTable(
  'UsageRecord',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    type: usageTypeEnum('type').notNull(),
    count: integer('count').default(1).notNull(),
    period: text('period').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('UsageRecord_userId_type_period_key').on(
      table.userId,
      table.type,
      table.period
    ),
    index('UsageRecord_userId_period_idx').on(table.userId, table.period),
  ]
);

// ============================================
// Team
// ============================================

export const teams = pgTable(
  'Team',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    ownerId: text('ownerId').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('Team_ownerId_idx').on(table.ownerId),
    index('Team_slug_idx').on(table.slug),
  ]
);

// ============================================
// Team Member
// ============================================

export const teamMembers = pgTable(
  'TeamMember',
  {
    id: text('id').primaryKey().notNull(),
    teamId: text('teamId').notNull(),
    userId: text('userId').notNull(),
    role: teamRoleEnum('role').default('member').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('TeamMember_teamId_userId_key').on(table.teamId, table.userId),
    index('TeamMember_userId_idx').on(table.userId),
  ]
);

// ============================================
// Team Invitation
// ============================================

export const teamInvitations = pgTable(
  'TeamInvitation',
  {
    id: text('id').primaryKey().notNull(),
    teamId: text('teamId').notNull(),
    email: text('email').notNull(),
    role: teamRoleEnum('role').default('member').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('TeamInvitation_teamId_idx').on(table.teamId),
    index('TeamInvitation_email_idx').on(table.email),
    index('TeamInvitation_token_idx').on(table.token),
  ]
);

// ============================================
// Compliance Report
// ============================================

export const complianceReports = pgTable(
  'ComplianceReport',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    type: complianceTypeEnum('type').notNull(),
    title: text('title').notNull(),
    status: reportStatusEnum('status').default('generating').notNull(),
    data: json('data'),
    policyIds: text('policyIds').array(),
    period: text('period'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    completedAt: timestamp('completedAt', { mode: 'date' }),
  },
  (table) => [
    index('ComplianceReport_userId_idx').on(table.userId),
    index('ComplianceReport_createdAt_idx').on(table.createdAt),
  ]
);

// ============================================
// Audit Log
// ============================================

export const auditLogs = pgTable(
  'AuditLog',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId'),
    teamId: text('teamId'),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resourceId'),
    metadata: json('metadata'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('AuditLog_userId_idx').on(table.userId),
    index('AuditLog_teamId_idx').on(table.teamId),
    index('AuditLog_createdAt_idx').on(table.createdAt),
    index('AuditLog_action_idx').on(table.action),
  ]
);

// ============================================
// Demo 功能数据模型
// ============================================

export const demoSessions = pgTable(
  'DemoSession',
  {
    id: text('id').primaryKey().notNull(),
    sessionId: text('sessionId').notNull().unique(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('DemoSession_expiresAt_idx').on(table.expiresAt),
    index('DemoSession_sessionId_idx').on(table.sessionId),
  ]
);

export const demoPolicies = pgTable(
  'DemoPolicy',
  {
    id: text('id').primaryKey().notNull(),
    sessionId: text('sessionId').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    content: text('content').notNull(),
    version: integer('version').default(1).notNull(),
    defaultInput: json('defaultInput'),
    piiFields: json('piiFields'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('DemoPolicy_sessionId_idx').on(table.sessionId)]
);

export const demoPolicyVersions = pgTable(
  'DemoPolicyVersion',
  {
    id: text('id').primaryKey().notNull(),
    policyId: text('policyId').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    comment: text('comment'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('DemoPolicyVersion_policyId_version_key').on(
      table.policyId,
      table.version
    ),
    index('DemoPolicyVersion_policyId_idx').on(table.policyId),
  ]
);

export const demoExecutions = pgTable(
  'DemoExecution',
  {
    id: text('id').primaryKey().notNull(),
    sessionId: text('sessionId').notNull(),
    policyId: text('policyId').notNull(),
    input: json('input').notNull(),
    output: json('output'),
    error: text('error'),
    durationMs: integer('durationMs').notNull(),
    success: boolean('success').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('DemoExecution_sessionId_idx').on(table.sessionId),
    index('DemoExecution_policyId_idx').on(table.policyId),
    index('DemoExecution_createdAt_idx').on(table.createdAt),
  ]
);

export const demoAuditLogs = pgTable(
  'DemoAuditLog',
  {
    id: text('id').primaryKey().notNull(),
    sessionId: text('sessionId').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resourceId'),
    metadata: json('metadata'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('DemoAuditLog_sessionId_idx').on(table.sessionId),
    index('DemoAuditLog_createdAt_idx').on(table.createdAt),
    index('DemoAuditLog_action_idx').on(table.action),
  ]
);

// ============================================
// AI 计费 / 防盗刷（v1.0 详见 aster-deploy/docs/pm/07-ai-billing.md）
// ============================================

/**
 * AI 调用记录（细粒度 token 消耗）
 *
 * 每次成功 / 失败 / 拒绝的 LLM 调用都记一行。
 * 月度配额由 SUM(promptTokens + completionTokens) WHERE periodMonth=YYYY-MM 算出。
 *
 * 设计意图：
 *   - 只记 token 数 + 成本（USD 分）+ 是否走 BYOK，不记 prompt/response 内容（隐私）
 *   - 有租户 / 月份 索引，让 quota 检查 < 50ms
 *   - 异常检测扫描"最近 1h 重复 prompt hash"等用 promptHash 字段
 */
export const aiUsageRecords = pgTable(
  'AiUsageRecord',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    teamId: text('teamId'),
    /** 'YYYY-MM' 用于按月聚合查询 */
    periodMonth: text('periodMonth').notNull(),
    /** completion / explain / suggest / repair */
    callKind: text('callKind').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('promptTokens').notNull().default(0),
    completionTokens: integer('completionTokens').notNull().default(0),
    /** 估算成本（美分），用 INT 避免浮点精度问题 */
    costCents: integer('costCents').notNull().default(0),
    /** 是否使用了用户绑定的 BYOK key（true 则不计入平台配额） */
    usedByok: boolean('usedByok').notNull().default(false),
    /** 调用结果：success / quota_exhausted / rate_limited / banned / api_error */
    status: text('status').notNull(),
    /** 用于异常检测：prompt 内容的 SHA-256 前缀（不含原文） */
    promptHash: text('promptHash'),
    /**
     * 加密后的原始 prompt（pgp_sym_encrypt 输出 bytea，用 text 列简化）
     * 主密钥独立于 BYOK：env AI_AUDIT_ENCRYPTION_SECRET（Vault 注入）
     * 保留期 180 天，cron 删除
     */
    encryptedPrompt: text('encryptedPrompt'),
    /** 加密后的 LLM 输出，同上 */
    encryptedCompletion: text('encryptedCompletion'),
    /**
     * PII 脱敏后的 prompt 明文（邮箱/手机/卡号等已替换为 [REDACTED:TYPE]）
     * 永久保留：合规要求 + 内容安全分析 + 异常检测训练样本
     */
    redactedPrompt: text('redactedPrompt'),
    /**
     * 内容安全标记
     * { jailbreak_attempt: bool, pii_detected: bool, toxic: bool, blocked_reason?: string }
     * 永久保留，参与 anomaly detection
     */
    safetyFlags: json('safetyFlags').$type<{
      jailbreak_attempt?: boolean;
      pii_detected?: boolean;
      toxic?: boolean;
      blocked_reason?: string;
    }>(),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('AiUsage_userId_period_idx').on(table.userId, table.periodMonth),
    index('AiUsage_userId_createdAt_idx').on(table.userId, table.createdAt),
    index('AiUsage_teamId_period_idx').on(table.teamId, table.periodMonth),
    index('AiUsage_promptHash_idx').on(table.promptHash, table.userId),
    index('AiUsage_createdAt_retention_idx').on(table.createdAt),
  ]
);

/**
 * 用户 BYOK key 绑定（pgcrypto 加密存储）
 *
 * 安全约束：
 *   - 字段名不暴露 provider（aiK1 而非 openAiKey），防 SQL dump 推断
 *   - 加密用 pgp_sym_encrypt，主密钥来自 env AI_KEY_ENCRYPTION_SECRET（Vault 注入）
 *   - keyHint 仅存后 4 位明文，UI 显示时用
 */
export const aiKeyBindings = pgTable(
  'AiKeyBinding',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('userId').notNull(),
    /** openai / anthropic / vertex */
    provider: text('provider').notNull(),
    /** 加密后的 key（pgp_sym_encrypt 输出 bytea，Drizzle 用 customType 映射；这里用 text 简化）*/
    encryptedKey: text('encryptedKey').notNull(),
    /** 后 4 位明文，UI 显示用 */
    keyHint: text('keyHint').notNull(),
    /** 是否启用（用户可临时停用而不删除） */
    active: boolean('active').notNull().default(true),
    /** 上次成功调用时间（健康检查） */
    lastUsedAt: timestamp('lastUsedAt', { mode: 'date' }),
    /** 上次失败原因（如 401 → 用户 key 已被 OpenAI 撤销） */
    lastErrorAt: timestamp('lastErrorAt', { mode: 'date' }),
    lastError: text('lastError'),
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('AiKey_userId_provider_idx').on(table.userId, table.provider),
    index('AiKey_active_idx').on(table.active),
  ]
);

// users 表 v1.2 加禁用字段（防盗刷自动封禁用）
// 注意：因为不想破坏已有 users 表 schema，把禁用字段直接加在 users 同一文件
// 在现有 users 表定义末尾追加（已在 priceLockedAt / legacyTier 旁边）

// ============================================
// License v2 / Revocation
// ============================================

/**
 * On-prem license verification cache（单行表 id='current'）。
 *
 * 设计意图：
 *   - 每个 on-prem 部署只追踪 *自己* 的 license，不存别人的
 *   - SaaS 模式下表存在但不写入，保持两种部署 schema 一致
 *   - check 约束强制 id='current'，防止意外写入多行
 */
export const licenseCache = pgTable(
  'LicenseCache',
  {
    id: text('id').primaryKey().notNull().default('current'),
    licenseId: text('license_id').notNull(),
    licenseKeyHash: text('license_key_hash').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    signingKeyId: text('signing_key_id').notNull(),
    verifiedAt: timestamp('verified_at', { mode: 'date', withTimezone: true }).notNull(),
    revocationVersion: bigint('revocation_version', { mode: 'bigint' }),
    revocationPublishedAt: timestamp('revocation_published_at', {
      mode: 'date',
      withTimezone: true,
    }),
    revocationFetchedAt: timestamp('revocation_fetched_at', {
      mode: 'date',
      withTimezone: true,
    }),
    lastSuccessfulRevocationCheckAt: timestamp('last_successful_revocation_check_at', {
      mode: 'date',
      withTimezone: true,
    }),
    lastRevocationError: jsonb('last_revocation_error'),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    revokedReason: text('revoked_reason'),
    // 续费提醒幂等记录（PR-C）：{ version: 'signingKeyId:verifiedAtIso', thresholds: { '14': iso } }
    renewalNotifyRecord: jsonb('renewal_notify_record').default({}).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [check('LicenseCache_id_current_check', sql`${table.id} = 'current'`)]
);

/**
 * SaaS revocation 源表。
 *
 * 设计意图：
 *   - 只存 opaque licenseId + 运维原因，不存客户身份信息
 *   - 发布器按 revoked_at 排序合成签名 revocation.json
 *   - on-prem 端只通过签名 JSON 拉取，不直接读这张表
 */
export const revokedLicenses = pgTable(
  'RevokedLicense',
  {
    licenseId: text('license_id').primaryKey().notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedBy: text('revoked_by').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes'),
    customerRef: text('customer_ref'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('RevokedLicense_revokedAt_idx').on(table.revokedAt)]
);

/**
 * 不可变 revocation publications。
 *
 * version 由 PR-L7 的 publisher 单调递增分配；当前仅用 check 约束确保正整数。
 * 索引按 published_at desc 加速"最新版"查询。
 *
 * mode='bigint'（codex Minor-7）：version 是 anti-rollback 数值，必须支持
 * 64-bit 精度。Number.MAX_SAFE_INTEGER 也够用，但 bigint 更明确表达意图，
 * 避免日后超过 2^53 时静默 truncate。
 */
export const revocationPublications = pgTable(
  'RevocationPublication',
  {
    version: bigint('version', { mode: 'bigint' }).primaryKey().notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    validUntil: timestamp('valid_until', { mode: 'date', withTimezone: true }).notNull(),
    revokedCount: integer('revoked_count').notNull(),
    signedDoc: text('signed_doc').notNull(),
    signature: text('signature').notNull(),
  },
  (table) => [
    index('RevocationPub_publishedAt_idx').on(desc(table.publishedAt)),
    check(
      'RevocationPublication_version_positive_check',
      sql`${table.version} > 0`,
    ),
    check(
      'RevocationPublication_revoked_count_nonnegative_check',
      sql`${table.revokedCount} >= 0`,
    ),
  ]
);

// ============================================
// Renewal portal (v3) — see ADR + drizzle 0013/0014
// ============================================

// Hash-only token store (plaintext never persisted). One row per renewal
// invitation; ops uses token to reach /renew/<token> which kicks off
// Stripe checkout. After checkout success the row's consumedAt is stamped.
export const renewalTokens = pgTable(
  'RenewalToken',
  {
    tokenHash: text('token_hash').primaryKey().notNull(),
    licenseId: text('license_id').notNull(),
    customer: text('customer').notNull(),
    oldDeploymentBinding: jsonb('old_deployment_binding').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    emailSentAt: timestamp('email_sent_at', { mode: 'date', withTimezone: true }),
    consumedAt: timestamp('consumed_at', { mode: 'date', withTimezone: true }),
  },
  (table) => [
    index('RenewalToken_license_expires_idx').on(table.licenseId, desc(table.expiresAt)),
    index('RenewalToken_expires_idx').on(table.expiresAt),
  ]
);

// Audit trail of every license ever signed. License key bytes are not
// stored (show-once contract); we keep enough metadata to drive lifecycle
// + ops UI + replay reconstruction.
export const issuedLicenses = pgTable(
  'IssuedLicense',
  {
    licenseId: text('license_id').primaryKey().notNull(),
    customer: text('customer').notNull(),
    deploymentBinding: jsonb('deployment_binding').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    payloadHash: text('payload_hash').notNull(),
    signingKeyId: text('signing_key_id').notNull(),
    signedAt: timestamp('signed_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    tier: text('tier').notNull(),
    licenseTerm: text('license_term').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    renewedFromLicenseId: text('renewed_from_license_id'),
    supersededAt: timestamp('superseded_at', { mode: 'date', withTimezone: true }),
    supersededBy: text('superseded_by'),
  },
  (table) => [
    index('IssuedLicense_stripe_session_idx').on(table.stripeCheckoutSessionId),
    index('IssuedLicense_stripe_subscription_idx').on(table.stripeSubscriptionId),
    index('IssuedLicense_customer_expires_idx').on(table.customer, desc(table.expiresAt)),
    index('IssuedLicense_renewed_from_idx').on(table.renewedFromLicenseId),
    // Partial index for the overlap-expiry cron: rows pending supersede
    index('IssuedLicense_pending_supersede_idx').on(
      table.supersededBy,
      table.expiresAt,
    ),
  ]
);

// ============================================
// Relations
// ============================================

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  apiKeys: many(apiKeys),
  policies: many(policies),
  policyGroups: many(policyGroups),
  executions: many(executions),
  usageRecords: many(usageRecords),
  teamMembers: many(teamMembers),
  ownedTeams: many(teams),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const policyGroupsRelations = relations(policyGroups, ({ one, many }) => ({
  parent: one(policyGroups, {
    fields: [policyGroups.parentId],
    references: [policyGroups.id],
    relationName: 'GroupHierarchy',
  }),
  children: many(policyGroups, { relationName: 'GroupHierarchy' }),
  policies: many(policies),
  user: one(users, {
    fields: [policyGroups.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [policyGroups.teamId],
    references: [teams.id],
  }),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  user: one(users, {
    fields: [policies.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [policies.teamId],
    references: [teams.id],
  }),
  group: one(policyGroups, {
    fields: [policies.groupId],
    references: [policyGroups.id],
  }),
  executions: many(executions),
  versions: many(policyVersions),
  recycleBin: one(policyRecycleBins),
}));

export const policyVersionsRelations = relations(policyVersions, ({ one, many }) => ({
  policy: one(policies, {
    fields: [policyVersions.policyId],
    references: [policies.id],
  }),
  approvals: many(policyApprovals),
}));

export const policyApprovalsRelations = relations(policyApprovals, ({ one }) => ({
  version: one(policyVersions, {
    fields: [policyApprovals.versionId],
    references: [policyVersions.id],
  }),
}));

export const policyRecycleBinsRelations = relations(policyRecycleBins, ({ one }) => ({
  policy: one(policies, {
    fields: [policyRecycleBins.policyId],
    references: [policies.id],
  }),
}));

export const executionsRelations = relations(executions, ({ one }) => ({
  user: one(users, {
    fields: [executions.userId],
    references: [users.id],
  }),
  policy: one(policies, {
    fields: [executions.policyId],
    references: [policies.id],
  }),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  user: one(users, {
    fields: [usageRecords.userId],
    references: [users.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, {
    fields: [teams.ownerId],
    references: [users.id],
  }),
  members: many(teamMembers),
  policies: many(policies),
  policyGroups: many(policyGroups),
  invitations: many(teamInvitations),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const teamInvitationsRelations = relations(teamInvitations, ({ one }) => ({
  team: one(teams, {
    fields: [teamInvitations.teamId],
    references: [teams.id],
  }),
}));

export const demoSessionsRelations = relations(demoSessions, ({ many }) => ({
  policies: many(demoPolicies),
  executions: many(demoExecutions),
  auditLogs: many(demoAuditLogs),
}));

export const demoPoliciesRelations = relations(demoPolicies, ({ one, many }) => ({
  session: one(demoSessions, {
    fields: [demoPolicies.sessionId],
    references: [demoSessions.id],
  }),
  versions: many(demoPolicyVersions),
  executions: many(demoExecutions),
}));

export const demoPolicyVersionsRelations = relations(demoPolicyVersions, ({ one }) => ({
  policy: one(demoPolicies, {
    fields: [demoPolicyVersions.policyId],
    references: [demoPolicies.id],
  }),
}));

export const demoExecutionsRelations = relations(demoExecutions, ({ one }) => ({
  session: one(demoSessions, {
    fields: [demoExecutions.sessionId],
    references: [demoSessions.id],
  }),
  policy: one(demoPolicies, {
    fields: [demoExecutions.policyId],
    references: [demoPolicies.id],
  }),
}));

export const demoAuditLogsRelations = relations(demoAuditLogs, ({ one }) => ({
  session: one(demoSessions, {
    fields: [demoAuditLogs.sessionId],
    references: [demoSessions.id],
  }),
}));

// ============================================
// TypeScript Types (替代 @prisma/client 类型)
// ============================================

// Enum 类型导出
export type Plan = (typeof planEnum.enumValues)[number];
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];
export type PolicyVersionStatus = (typeof policyVersionStatusEnum.enumValues)[number];
export type ApprovalDecision = (typeof approvalDecisionEnum.enumValues)[number];
export type SecurityEventType = (typeof securityEventTypeEnum.enumValues)[number];
export type EventSeverity = (typeof eventSeverityEnum.enumValues)[number];
export type ExecutionSource = (typeof executionSourceEnum.enumValues)[number];
export type UsageType = (typeof usageTypeEnum.enumValues)[number];
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];
export type ComplianceType = (typeof complianceTypeEnum.enumValues)[number];
export type ReportStatus = (typeof reportStatusEnum.enumValues)[number];

// 表类型导出（InferSelectModel 和 InferInsertModel）
import { type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Policy = InferSelectModel<typeof policies>;
export type NewPolicy = InferInsertModel<typeof policies>;

export type PolicyVersion = InferSelectModel<typeof policyVersions>;
export type NewPolicyVersion = InferInsertModel<typeof policyVersions>;

export type PolicyApproval = InferSelectModel<typeof policyApprovals>;
export type NewPolicyApproval = InferInsertModel<typeof policyApprovals>;

export type PolicyGroup = InferSelectModel<typeof policyGroups>;
export type NewPolicyGroup = InferInsertModel<typeof policyGroups>;

export type Execution = InferSelectModel<typeof executions>;
export type NewExecution = InferInsertModel<typeof executions>;

export type Team = InferSelectModel<typeof teams>;
export type NewTeam = InferInsertModel<typeof teams>;

export type TeamMember = InferSelectModel<typeof teamMembers>;
export type NewTeamMember = InferInsertModel<typeof teamMembers>;

export type TeamInvitation = InferSelectModel<typeof teamInvitations>;
export type NewTeamInvitation = InferInsertModel<typeof teamInvitations>;

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type UsageRecord = InferSelectModel<typeof usageRecords>;
export type NewUsageRecord = InferInsertModel<typeof usageRecords>;

export type SecurityEvent = InferSelectModel<typeof securityEvents>;
export type NewSecurityEvent = InferInsertModel<typeof securityEvents>;

export type ComplianceReport = InferSelectModel<typeof complianceReports>;
export type NewComplianceReport = InferInsertModel<typeof complianceReports>;

export type AuditLog = InferSelectModel<typeof auditLogs>;
export type NewAuditLog = InferInsertModel<typeof auditLogs>;

export type LicenseCache = InferSelectModel<typeof licenseCache>;
export type NewLicenseCache = InferInsertModel<typeof licenseCache>;

export type RevokedLicense = InferSelectModel<typeof revokedLicenses>;
export type NewRevokedLicense = InferInsertModel<typeof revokedLicenses>;

export type RevocationPublication = InferSelectModel<typeof revocationPublications>;
export type NewRevocationPublication = InferInsertModel<typeof revocationPublications>;

export type RenewalToken = InferSelectModel<typeof renewalTokens>;
export type NewRenewalToken = InferInsertModel<typeof renewalTokens>;

export type IssuedLicense = InferSelectModel<typeof issuedLicenses>;
export type NewIssuedLicense = InferInsertModel<typeof issuedLicenses>;
