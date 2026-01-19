import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db, teams, teamMembers, policies } from '@/lib/prisma';
import { eq, desc, sql } from 'drizzle-orm';
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

  let teamsResult: {
    id: string;
    name: string;
    slug: string;
    role: string;
    memberCount: number;
    policyCount: number;
    createdAt: string;
  }[] = [];

  if (hasAccess) {
    // 首先获取用户所在的团队 ID
    const userTeamMemberships = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, session.user.id),
      columns: { teamId: true, role: true },
    });

    if (userTeamMemberships.length > 0) {
      // 获取这些团队的详细信息
      const teamsData = await db.query.teams.findMany({
        where: sql`${teams.id} IN ${sql.raw(
          `(${userTeamMemberships.map((m) => `'${m.teamId}'`).join(',')})`
        )}`,
        orderBy: desc(teams.updatedAt),
      });

      // 为每个团队获取成员数和策略数
      teamsResult = await Promise.all(
        teamsData.map(async (team) => {
          const membership = userTeamMemberships.find((m) => m.teamId === team.id);

          const [{ memberCount }, { policyCount }] = await Promise.all([
            db
              .select({ memberCount: sql<number>`count(*)::int` })
              .from(teamMembers)
              .where(eq(teamMembers.teamId, team.id))
              .then((r) => r[0]),
            db
              .select({ policyCount: sql<number>`count(*)::int` })
              .from(policies)
              .where(eq(policies.teamId, team.id))
              .then((r) => r[0]),
          ]);

          return {
            id: team.id,
            name: team.name,
            slug: team.slug,
            role: membership?.role || 'member',
            memberCount,
            policyCount,
            createdAt: team.createdAt.toISOString(),
          };
        })
      );
    }
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
      initialTeams={teamsResult}
      needsUpgrade={!hasAccess}
      translations={translations}
    />
  );
}
