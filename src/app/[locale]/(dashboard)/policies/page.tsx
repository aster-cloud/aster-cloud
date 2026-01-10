import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { getTranslations } from 'next-intl/server';
import { PoliciesContent } from './policies-content';
import type { PolicyGroup } from '@/components/policy/policy-group-tree';

// 递归构建分组树
type RawGroup = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
  isSystem: boolean;
  sortOrder: number;
  _count: { policies: number };
};

function buildGroupTree(groups: RawGroup[]): PolicyGroup[] {
  const groupMap = new Map<string, PolicyGroup>(
    groups.map((g) => [
      g.id,
      {
        ...g,
        children: [],
      },
    ]),
  );
  const rootGroups: PolicyGroup[] = [];

  for (const group of groups) {
    const node = groupMap.get(group.id)!;
    if (group.parentId && groupMap.has(group.parentId)) {
      const parent = groupMap.get(group.parentId)!;
      parent.children.push(node);
    } else {
      rootGroups.push(node);
    }
  }

  return rootGroups;
}

// 服务端数据获取
async function getPoliciesData(userId: string) {
  const [policies, freezeStatus, groups] = await Promise.all([
    prisma.policy.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            icon: true,
            parentId: true,
          },
        },
        _count: {
          select: { executions: true },
        },
      },
    }),
    getPolicyFreezeStatus(userId),
    prisma.policyGroup.findMany({
      where: {
        OR: [
          { userId },
          { isSystem: true },
        ],
      },
      include: {
        _count: {
          select: { policies: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  // 添加冻结状态到每个策略
  const policiesWithFreeze = policies.map((policy) => ({
    id: policy.id,
    name: policy.name,
    description: policy.description,
    content: policy.content,
    isPublic: policy.isPublic,
    piiFields: policy.piiFields as string[] | null,
    groupId: policy.groupId,
    group: policy.group,
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

  // 构建分组树
  const groupTree = buildGroupTree(groups);

  return { policies: policiesWithFreeze, freezeInfo, groups: groupTree };
}

export default async function PoliciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  const { policies, freezeInfo, groups } = await getPoliciesData(session.user.id);
  const t = await getTranslations('policies');

  // 预渲染翻译字符串
  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    newPolicy: t('newPolicy'),
    trash: t('trash.title'),
    failedToLoad: t('failedToLoad'),
    failedToDelete: t('failedToDelete'),
    confirmDelete: t('confirmDelete'),
    freeze: {
      title: t('freeze.title'),
      messageTemplate: t.raw('freeze.message'),
      upgradeLink: t('freeze.upgradeLink'),
      badge: t('freeze.badge'),
      cannotExecute: t('freeze.cannotExecute'),
      cannotEdit: t('freeze.cannotEdit'),
    },
    noPolicies: t('noPolicies'),
    getStarted: t('getStarted'),
    piiFieldsTemplate: t.raw('piiFields'),
    public: t('public'),
    executionsTemplate: t.raw('executions'),
    executeAction: t('executeAction'),
    edit: t('edit'),
    delete: t('delete'),
    updatedTemplate: t.raw('updated'),
    groups: {
      allPolicies: t('groups.allPolicies'),
      ungrouped: t('groups.ungrouped'),
      newGroup: t('groups.newGroup'),
      newSubgroup: t('groups.newSubgroup'),
      edit: t('groups.edit'),
      delete: t('groups.delete'),
      policiesCount: t('groups.policiesCount'),
      createTitle: t('groups.createTitle'),
      editTitle: t('groups.editTitle'),
      nameLabel: t('groups.nameLabel'),
      namePlaceholder: t('groups.namePlaceholder'),
      descriptionLabel: t('groups.descriptionLabel'),
      descriptionPlaceholder: t('groups.descriptionPlaceholder'),
      save: t('groups.save'),
      cancel: t('groups.cancel'),
      deleteConfirm: t('groups.deleteConfirm'),
      deleteWarning: t('groups.deleteWarning'),
      saving: t('groups.saving'),
      deleting: t('groups.deleting'),
    },
  };

  return (
    <PoliciesContent
      initialPolicies={policies}
      initialGroups={groups}
      freezeInfo={freezeInfo}
      translations={translations}
      locale={locale}
    />
  );
}
