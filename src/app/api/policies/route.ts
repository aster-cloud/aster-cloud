import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit } from '@/lib/usage';
import { getPlanLimit, isUnlimited, PlanType, PLANS } from '@/lib/plans';
import { detectPII } from '@/services/pii/detector';
import { addFreezeStatusToPolicies, getPolicyFreezeStatus } from '@/lib/policy-freeze';

// GET /api/policies - List user's policies
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [policies, freezeStatus] = await Promise.all([
      prisma.policy.findMany({
        where: { userId: session.user.id },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: { executions: true },
          },
        },
      }),
      getPolicyFreezeStatus(session.user.id),
    ]);

    // 添加冻结状态到每个策略
    const policiesWithFreeze = policies.map((policy) => ({
      ...policy,
      isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
    }));

    return NextResponse.json({
      policies: policiesWithFreeze,
      freezeInfo: {
        limit: freezeStatus.limit,
        total: freezeStatus.totalPolicies,
        frozenCount: freezeStatus.frozenCount,
      },
    });
  } catch (error) {
    console.error('Error fetching policies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/policies - Create a new policy
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, content, description, isPublic } = await req.json();

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    // Check policy limit for free users
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { plan: true, trialEndsAt: true },
    });

    if (user) {
      const plan = (user.plan && user.plan in PLANS ? user.plan : 'free') as PlanType;
      const trialExpired =
        plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date();
      const effectivePlan = trialExpired ? 'free' : plan;

      if (trialExpired) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { plan: 'free' },
        });
      }

      const policyLimit = getPlanLimit(effectivePlan, 'policies');
      const policyCount = await prisma.policy.count({
        where: { userId: session.user.id },
      });

      if (!isUnlimited(policyLimit) && policyCount >= policyLimit) {
        return NextResponse.json(
          {
            error: 'Policy limit reached',
            message: `Current plan allows ${policyLimit} policies. Upgrade for higher limits.`,
            upgrade: true,
          },
          { status: 403 }
        );
      }
    }

    const piiResult = detectPII(content);

    const policy = await prisma.policy.create({
      data: {
        userId: session.user.id,
        name,
        content,
        description,
        isPublic: isPublic || false,
        piiFields: piiResult.detectedTypes,
      },
    });

    // Create initial version
    await prisma.policyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        content,
        comment: 'Initial version',
      },
    });

    return NextResponse.json(policy, { status: 201 });
  } catch (error) {
    console.error('Error creating policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
