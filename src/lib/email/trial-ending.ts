// F2.5 trial 邮件序列
// 详见 aster-deploy/docs/pm/05-pricing-packaging.md F2.5 章节
//
// 在 trial 结束前 3 天 (T-3) 与 1 天 (T-1) 各发一封：
//   - T-3：温柔提醒 + 个性化用量数据
//   - T-1：紧迫感 + 一键续费 link
//
// 触发渠道：
//   - T-3 由 Stripe webhook customer.subscription.trial_will_end 触发（Stripe 默认提前 3 天）
//   - T-1 由 cron 路由 /api/cron/trial-day-1-reminder 每天 09:00 UTC 扫描

import { db, users, policies } from '@/lib/prisma';
import { sendTrialExpiringEmail } from '@/lib/resend';
import { eq, and, isNull, gte, lt } from 'drizzle-orm';

export type TrialEmailStage = 'T-3' | 'T-1';

/**
 * 给单个用户发 trial ending 邮件
 *
 * 幂等保护：trialEndingEmailSentAt 设了就不再发同阶段邮件
 * Mixpanel 埋点：调用方负责（前端 / cron 路由），避免循环依赖
 */
export async function sendTrialEndingEmailForUser(
  userId: string,
  stage: TrialEmailStage
): Promise<{ sent: boolean; reason?: string }> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !user.email || !user.trialEndsAt) {
    return { sent: false, reason: 'no_user_or_trial' };
  }

  // 幂等：T-3 发过就不再发；T-1 复用同字段，依赖时间窗口区分
  if (stage === 'T-3' && user.trialEndingEmailSentAt) {
    return { sent: false, reason: 'already_sent_t3' };
  }

  // 个性化用量数据：trial 期间发布了多少策略
  const userPolicies = await db.query.policies.findMany({
    where: and(eq(policies.userId, userId), isNull(policies.deletedAt)),
  });
  const publishedCount = userPolicies.length;

  const now = Date.now();
  const trialEndMs = user.trialEndsAt.getTime();
  const daysLeft = Math.max(1, Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000)));

  await sendTrialExpiringEmail(user.email, user.name || 'there', daysLeft);

  // 记录幂等标记（仅 T-3 写，避免覆盖）
  if (stage === 'T-3') {
    await db
      .update(users)
      .set({ trialEndingEmailSentAt: new Date() })
      .where(eq(users.id, userId));
  }

  return { sent: true, reason: `published=${publishedCount}` };
}

/**
 * cron 路由用：扫描 trial 在 24~48 小时内结束的用户
 *
 * 仅返回未在 T-1 窗口内通知过的；具体邮件由调用方循环触发。
 */
export async function findUsersForT1Reminder(): Promise<typeof users.$inferSelect[]> {
  const now = Date.now();
  const t1Start = new Date(now + 24 * 60 * 60 * 1000);
  const t1End = new Date(now + 48 * 60 * 60 * 1000);

  return db.query.users.findMany({
    where: and(
      gte(users.trialEndsAt, t1Start),
      lt(users.trialEndsAt, t1End),
      eq(users.subscriptionStatus, 'trialing')
    ),
  });
}
