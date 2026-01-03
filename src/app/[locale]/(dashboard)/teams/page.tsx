import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasFeatureAccess } from '@/lib/usage';
import { TeamsContent } from './teams-content';

export default async function TeamsPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const t = await getTranslations('teams');

  // 检查团队功能访问权限
  const hasAccess = await hasFeatureAccess(session.user.id, 'teamFeatures');

  let teams: {
    id: string;
    name: string;
    slug: string;
    role: string;
    memberCount: number;
    policyCount: number;
    createdAt: string;
  }[] = [];

  if (hasAccess) {
    const teamsData = await prisma.team.findMany({
      where: {
        members: {
          some: { userId: session.user.id },
        },
      },
      include: {
        members: {
          where: { userId: session.user.id },
          select: { role: true },
        },
        _count: {
          select: { members: true, policies: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    teams = teamsData.map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      role: team.members[0]?.role || 'member',
      memberCount: team._count.members,
      policyCount: team._count.policies,
      createdAt: team.createdAt.toISOString(),
    }));
  }

  // 预渲染所有翻译字符串
  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    newTeam: t('newTeam'),
    failedToLoad: t('failedToLoad'),
    noTeams: t('noTeams'),
    getStarted: t('getStarted'),
    memberCountTemplate: t.raw('memberCount'),
    policyCountTemplate: t.raw('policyCount'),
    roles: {
      owner: t('roles.owner'),
      admin: t('roles.admin'),
      member: t('roles.member'),
      viewer: t('roles.viewer'),
    },
    upgradeRequired: {
      title: t('upgradeRequired.title'),
      description: t('upgradeRequired.description'),
      upgradeButton: t('upgradeRequired.upgradeButton'),
    },
  };

  return (
    <TeamsContent
      initialTeams={teams}
      needsUpgrade={!hasAccess}
      translations={translations}
    />
  );
}
