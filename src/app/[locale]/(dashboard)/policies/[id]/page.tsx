import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getTranslations } from 'next-intl/server';
import { PolicyDetailContent } from './policy-detail-content';

// 服务端数据获取
async function getPolicyData(userId: string, policyId: string) {
  const policy = await prisma.policy.findFirst({
    where: {
      id: policyId,
      userId,
    },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 10,
      },
      _count: {
        select: { executions: true },
      },
    },
  });

  if (!policy) {
    return null;
  }

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    content: policy.content,
    version: policy.version,
    isPublic: policy.isPublic,
    shareSlug: policy.shareSlug,
    piiFields: policy.piiFields as string[] | null,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    versions: policy.versions.map((v) => ({
      id: v.id,
      version: v.version,
      content: v.content,
      comment: v.comment,
      createdAt: v.createdAt.toISOString(),
    })),
    _count: { executions: policy._count.executions },
  };
}

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  const policy = await getPolicyData(session.user.id, id);

  if (!policy) {
    notFound();
  }

  const t = await getTranslations('policies');

  // 预渲染翻译字符串
  const translations = {
    executeAction: t('executeAction'),
    edit: t('edit'),
    delete: t('delete'),
    confirmDelete: t('confirmDelete'),
    failedToDelete: t('failedToDelete'),
    public: t('public'),
    private: t('private'),
    detail: {
      version: t('detail.version'),
      executions: t('detail.executions'),
      viewLogs: t('detail.viewLogs'),
      piiFields: t('detail.piiFields'),
      status: t('detail.status'),
      piiWarning: t('detail.piiWarning'),
      piiWarningMessage: t('detail.piiWarningMessage'),
      policyContent: t('detail.policyContent'),
      versionHistory: t('detail.versionHistory'),
      backToPolicies: t('detail.backToPolicies'),
    },
  };

  return (
    <PolicyDetailContent
      policy={policy}
      translations={translations}
      locale={locale}
    />
  );
}
