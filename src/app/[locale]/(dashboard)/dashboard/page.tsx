import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getUsageStats } from '@/lib/usage';
import { prisma } from '@/lib/prisma';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { getTranslations } from 'next-intl/server';
import { DashboardContent } from './dashboard-content';

// 服务端数据获取
async function getDashboardData(userId: string) {
  const [stats, policiesData, freezeStatus] = await Promise.all([
    getUsageStats(userId),
    prisma.policy.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { executions: true },
        },
      },
      take: 20, // 只获取最近的20个用于排序
    }),
    getPolicyFreezeStatus(userId),
  ]);

  // 按执行次数排序，取前5个
  const topPolicies = policiesData
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      piiFields: p.piiFields as string[] | null,
      updatedAt: p.updatedAt.toISOString(),
      _count: { executions: p._count.executions },
      isFrozen: freezeStatus.frozenPolicyIds.has(p.id),
    }))
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
      limit: (count: number) => t('stats.limit', { count }),
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
      runs: (count: number) => t('recentPolicies.runs', { count }),
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
