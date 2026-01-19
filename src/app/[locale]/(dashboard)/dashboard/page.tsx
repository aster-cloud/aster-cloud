import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getUsageStats } from '@/lib/usage';
import { db, policies, executions } from '@/lib/prisma';
import { eq, desc, sql } from 'drizzle-orm';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { getTranslations } from 'next-intl/server';
import { DashboardContent } from './dashboard-content';

// 服务端数据获取
async function getDashboardData(userId: string) {
  const [stats, policiesData, freezeStatus] = await Promise.all([
    getUsageStats(userId),
    db.query.policies.findMany({
      where: eq(policies.userId, userId),
      orderBy: desc(policies.updatedAt),
      limit: 20, // 只获取最近的20个用于排序
    }),
    getPolicyFreezeStatus(userId),
  ]);

  // 为每个策略获取执行次数
  const policiesWithCount = await Promise.all(
    policiesData.map(async (p) => {
      const [{ count: executionCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(executions)
        .where(eq(executions.policyId, p.id));

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        piiFields: p.piiFields as string[] | null,
        updatedAt: p.updatedAt.toISOString(),
        _count: { executions: executionCount },
        isFrozen: freezeStatus.frozenPolicyIds.has(p.id),
        isDeleted: p.deletedAt !== null,
      };
    })
  );

  // 按执行次数排序，取前5个（包括已删除的策略，显示已删除标记）
  const topPolicies = policiesWithCount
    .sort((a, b) => b._count.executions - a._count.executions)
    .slice(0, 5);

  return { stats, policies: topPolicies };
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { stats, policies } = await getDashboardData(session.user.id);
  const t = await getTranslations('dashboard');

  // 预计算 PII 总数
  const totalPiiFields = policies.reduce(
    (sum, p) => sum + (p.piiFields?.length || 0),
    0
  );

  // 预渲染翻译字符串（避免客户端加载）
  const translations = {
    welcomeBack: t('welcomeBack', { name: session.user.name?.split(' ')[0] || 'there' }),
    newPolicy: t('newPolicy'),
    trialActive: t('trialActive'),
    trialDaysLeft: stats.trialDaysLeft === 1
      ? t('trialDaysLeft', { count: stats.trialDaysLeft })
      : t('trialDaysLeftPlural', { count: stats.trialDaysLeft ?? 0 }),
    upgradeNow: t('upgradeNow'),
    toKeepProFeatures: t('toKeepProFeatures'),
    planActive: t('planActive', { plan: stats.plan }),
    stats: {
      totalPolicies: t('stats.totalPolicies'),
      executionsThisMonth: t('stats.executionsThisMonth'),
      apiCalls: t('stats.apiCalls'),
      piiFieldsDetected: t('stats.piiFieldsDetected'),
      limitTemplate: t.raw('stats.limit'),
      upgradeForApi: t('stats.upgradeForApi'),
      reviewRecommended: t('stats.reviewRecommended'),
    },
    quickActions: {
      title: t('quickActions.title'),
      createPolicy: t('quickActions.createPolicy'),
      createPolicyDesc: t('quickActions.createPolicyDesc'),
      generateReport: t('quickActions.generateReport'),
      generateReportDesc: t('quickActions.generateReportDesc'),
      apiKeys: t('quickActions.apiKeys'),
      apiKeysDesc: t('quickActions.apiKeysDesc'),
    },
    recentPolicies: {
      title: t('recentPolicies.title'),
      viewAll: t('recentPolicies.viewAll'),
      noPolicies: t('recentPolicies.noPolicies'),
      createFirst: t('recentPolicies.createFirst'),
      noDescription: t('recentPolicies.noDescription'),
      runsTemplate: t.raw('recentPolicies.runs'),
      deleted: t('recentPolicies.deleted'),
      restoreHint: t('recentPolicies.restoreHint'),
    },
  };

  return (
    <DashboardContent
      stats={stats}
      policies={policies}
      totalPiiFields={totalPiiFields}
      translations={translations}
    />
  );
}
