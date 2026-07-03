import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, policyVersions, executions } from '@/lib/prisma';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { detectPII } from '@/services/pii/detector';
import { createVersion } from '@/services/policy/version-manager';
import { getStructuralAliasGrant, buildAliasReservedForUser } from '@/lib/structural-alias-grants';
import { isPolicyFrozen } from '@/lib/policy-freeze';
import { softDeletePolicy } from '@/lib/policy-lifecycle';
import { invalidatePolicyCache } from '@/lib/cache';


interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/policies/[id] - Get a single policy
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 先查用户自己的策略或公开策略
    let policy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, id),
        isNull(policies.deletedAt),
        sql`(${policies.userId} = ${session.user.id} OR ${policies.isPublic} = true)`
      ),
    });

    // 如果不是用户自己的策略,检查是否是团队策略
    if (!policy || (policy.userId !== session.user.id && !policy.isPublic)) {
      const teamPolicy = await db.query.policies.findFirst({
        where: and(
          eq(policies.id, id),
          isNull(policies.deletedAt)
        ),
        with: {
          team: {
            with: {
              members: true,
            },
          },
        },
      });

      if (teamPolicy?.team?.members.some(m => m.userId === session.user.id)) {
        policy = teamPolicy;
      }

      // Final fallback: the policy was shared with one of the
      // caller's teams via PolicyShare. Only consult when sharing
      // is platform-enabled — flag off → shares are dormant data,
      // not access grants.
      if (!policy && teamPolicy) {
        const { isPolicySharingEnabled } = await import(
          '@/lib/platform-settings'
        );
        if (await isPolicySharingEnabled()) {
          const sharedRows = (await db.execute(sql`
            SELECT 1 AS ok
            FROM "PolicyShare" ps
            JOIN "TeamMember" tm ON tm."teamId" = ps."teamId"
            WHERE ps."policyId" = ${id}
              AND tm."userId" = ${session.user.id}
            LIMIT 1
          `)) as unknown as Array<{ ok: number }>;
          if (sharedRows.length > 0) {
            policy = teamPolicy;
          }
        }
      }
    }

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 获取版本列表
    const versions = await db.query.policyVersions.findMany({
      where: eq(policyVersions.policyId, id),
      orderBy: desc(policyVersions.version),
      limit: 10,
    });

    // 获取执行次数
    const [{ count: executionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(eq(executions.policyId, id));

    // 检查策略是否被冻结（只对策略所有者检查）
    let freezeInfo = null;
    if (policy.userId === session.user.id) {
      freezeInfo = await isPolicyFrozen(session.user.id, id);
    }

    return NextResponse.json({
      ...policy,
      versions,
      _count: { executions: executionCount },
      isFrozen: freezeInfo?.isFrozen ?? false,
      freezeInfo: freezeInfo
        ? {
            reason: freezeInfo.reason,
            limit: freezeInfo.activePoliciesLimit,
            total: freezeInfo.totalPolicies,
            frozenCount: freezeInfo.frozenCount,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/policies/[id] - Update a policy
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { name, content, description, isPublic, groupId, aliasSet, locale } = await req.json();

    // Check ownership (exclude deleted policies)
    const existingPolicy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, id),
        eq(policies.userId, session.user.id),
        isNull(policies.deletedAt)
      ),
    });

    if (!existingPolicy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查策略是否被冻结
    const freezeInfo = await isPolicyFrozen(session.user.id, id);
    if (freezeInfo.isFrozen) {
      return NextResponse.json(
        {
          error: 'Policy is frozen',
          message: `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`,
          frozen: true,
        },
        { status: 403 }
      );
    }

    // Update policy and create new version if content changed
    const newVersion = content !== undefined && content !== existingPolicy.content;

    const piiResult = newVersion ? detectPII(content) : null;

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (content !== undefined) updateData.content = content;
    if (description !== undefined) updateData.description = description;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    if (groupId !== undefined) updateData.groupId = groupId || null;

    if (newVersion) {
      updateData.piiFields = piiResult?.detectedTypes;
    }

    // C2：新版本必须走 version-manager（校验别名 + canonical + envelope 冻结 + 审计），
    // 不能裸插 policyVersions（此前编辑路径丢弃 aliasSet、无 envelope/审计/事务）。
    // aliasSet 从 body 取；allowStructural 从服务端 per-user entitlement 权威取（不信前端）；
    // 事务包 update + createVersion 防不一致。null/空 aliasSet 行为不变。
    // ★Policy.version 由 createVersion 计算的版本号回填，保证 Policy.version ==
    //   PolicyVersion.version（执行路径 C1 靠此 JOIN 取活跃版本的冻结 aliasSet）。
    const aliasSetInput =
      aliasSet &&
      typeof aliasSet === 'object' &&
      !Array.isArray(aliasSet) &&
      Object.keys(aliasSet as Record<string, unknown>).length > 0
        ? (aliasSet as Record<string, string[]>)
        : null;
    const compileLocale = typeof locale === 'string' && locale.trim() ? locale : 'en-US';

    const policy = await db.transaction(async (tx) => {
      if (newVersion) {
        const allowStructural = await getStructuralAliasGrant(session.user.id);
        const aliasReserved = aliasSetInput
          ? await buildAliasReservedForUser(session.user.id, compileLocale)
          : undefined;
        const createdVersion = await createVersion({
          policyId: id,
          source: content,
          createdBy: session.user.id,
          releaseNote: 'Edited version',
          locale: compileLocale,
          aliasSet: aliasSetInput,
          aliasReserved,
          allowStructuralAliases: allowStructural,
          dbClient: tx,
        });
        updateData.version = createdVersion.version; // 回填，保持 Policy.version ↔ PolicyVersion.version 一致
      }
      const [updated] = await tx
        .update(policies)
        .set(updateData)
        .where(eq(policies.id, id))
        .returning();
      return updated;
    });

    // 失效策略缓存（异步，不阻塞响应）
    invalidatePolicyCache(id).catch(err =>
      console.warn('[Cache] Failed to invalidate policy cache:', err)
    );

    return NextResponse.json(policy);
  } catch (error) {
    console.error('Error updating policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/policies/[id] - Soft delete a policy (move to trash)
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 解析可选的删除原因
    let reason: string | undefined;
    try {
      const body = await req.json();
      reason = body?.reason;
    } catch {
      // 无请求体，忽略
    }

    // 使用软删除
    const result = await softDeletePolicy(id, session.user.id, reason);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    // 失效策略缓存（异步，不阻塞响应）
    invalidatePolicyCache(id).catch(err =>
      console.warn('[Cache] Failed to invalidate policy cache:', err)
    );

    return NextResponse.json({
      success: true,
      message: 'Policy moved to trash. It will be permanently deleted after 30 days.',
    });
  } catch (error) {
    console.error('Error deleting policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
