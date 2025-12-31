import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, FEATURE_LIMITS } from '@/lib/usage';

// GET /api/policies - List user's policies
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const policies = await prisma.policy.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { executions: true },
        },
      },
    });

    return NextResponse.json(policies);
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
      select: { plan: true },
    });

    if (user) {
      const limits = FEATURE_LIMITS[user.plan as keyof typeof FEATURE_LIMITS];
      const policyCount = await prisma.policy.count({
        where: { userId: session.user.id },
      });

      if (limits.savedPolicies !== Infinity && policyCount >= limits.savedPolicies) {
        return NextResponse.json(
          {
            error: 'Policy limit reached',
            message: `Free plan allows only ${limits.savedPolicies} policies. Upgrade to Pro for unlimited policies.`,
            upgrade: true,
          },
          { status: 403 }
        );
      }
    }

    // Detect PII in policy content (basic detection)
    const piiFields = detectPII(content);

    const policy = await prisma.policy.create({
      data: {
        userId: session.user.id,
        name,
        content,
        description,
        isPublic: isPublic || false,
        piiFields,
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

// Basic PII detection (in production, use ML-based detection)
function detectPII(content: string): string[] {
  const patterns: { name: string; pattern: RegExp }[] = [
    { name: 'email', pattern: /\bemail\b/i },
    { name: 'phone', pattern: /\b(phone|mobile|tel)\b/i },
    { name: 'ssn', pattern: /\b(ssn|social.?security)\b/i },
    { name: 'address', pattern: /\baddress\b/i },
    { name: 'name', pattern: /\b(first.?name|last.?name|full.?name)\b/i },
    { name: 'dob', pattern: /\b(date.?of.?birth|dob|birthday)\b/i },
    { name: 'credit_card', pattern: /\b(credit.?card|card.?number)\b/i },
    { name: 'passport', pattern: /\bpassport\b/i },
    { name: 'driver_license', pattern: /\b(driver.?licen[cs]e|dl.?number)\b/i },
    { name: 'bank_account', pattern: /\b(bank.?account|account.?number|iban)\b/i },
  ];

  const detected: string[] = [];
  for (const { name, pattern } of patterns) {
    if (pattern.test(content)) {
      detected.push(name);
    }
  }

  return detected;
}
