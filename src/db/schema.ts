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
  json,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

    // Trial
    trialStartedAt: timestamp('trialStartedAt', { mode: 'date' }),
    trialEndsAt: timestamp('trialEndsAt', { mode: 'date' }),

    // Onboarding
    onboardingUseCase: text('onboardingUseCase'),
    onboardingGoals: text('onboardingGoals').array(),
    onboardingCompletedAt: timestamp('onboardingCompletedAt', { mode: 'date' }),

    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('User_email_idx').on(table.email),
    index('User_stripeCustomerId_idx').on(table.stripeCustomerId),
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
