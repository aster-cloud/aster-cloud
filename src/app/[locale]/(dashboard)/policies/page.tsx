import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { getTranslations } from 'next-intl/server';
import { PoliciesContent } from './policies-content';

// 服务端数据获取
async function getPoliciesData(userId: string) {
  const [policies, freezeStatus] = await Promise.all([
    prisma.policy.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { executions: true },
        },
      },
    }),
    getPolicyFreezeStatus(userId),
  ]);

  // 添加冻结状态到每个策略
  const policiesWithFreeze = policies.map((policy) => ({
    id: policy.id,
    name: policy.name,
    description: policy.description,
    content: policy.content,
    isPublic: policy.isPublic,
    piiFields: policy.piiFields as string[] | null,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
    _count: { executions: policy._count.executions },
  }));

  const freezeInfo = {
    limit: freezeStatus.limit,
    total: freezeStatus.totalPolicies,
    frozenCount: freezeStatus.frozenCount,
  };

  return { policies: policiesWithFreeze, freezeInfo };
}

export default async function PoliciesPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { policies, freezeInfo } = await getPoliciesData(session.user.id);
  const t = await getTranslations('policies');

  // 预渲染翻译字符串
  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    newPolicy: t('newPolicy'),
    failedToLoad: t('failedToLoad'),
    failedToDelete: t('failedToDelete'),
    confirmDelete: t('confirmDelete'),
    freeze: {
      title: t('freeze.title'),
      message: (frozen: number, limit: number, total: number) =>
        t('freeze.message', { frozen, limit, total }),
      upgradeLink: t('freeze.upgradeLink'),
      badge: t('freeze.badge'),
      cannotExecute: t('freeze.cannotExecute'),
      cannotEdit: t('freeze.cannotEdit'),
    },
    noPolicies: t('noPolicies'),
    getStarted: t('getStarted'),
    piiFields: (count: number) => t('piiFields', { count }),
    public: t('public'),
    executions: (count: number) => t('executions', { count }),
    executeAction: t('executeAction'),
    edit: t('edit'),
    delete: t('delete'),
    updated: (date: string) => t('updated', { date }),
  };

  return (
    <PoliciesContent
      initialPolicies={policies}
      freezeInfo={freezeInfo}
      translations={translations}
    />
  );
}
