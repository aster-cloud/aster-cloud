import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

    const policy = await prisma.policy.findFirst({
      where: {
        id,
        OR: [
          { userId: session.user.id },
          { isPublic: true },
          {
            team: {
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        ],
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
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    return NextResponse.json(policy);
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
    const { name, content, description, isPublic } = await req.json();

    // Check ownership
    const existingPolicy = await prisma.policy.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!existingPolicy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // Update policy and create new version if content changed
    const newVersion = content !== existingPolicy.content;

    const policy = await prisma.policy.update({
      where: { id },
      data: {
        name,
        content,
        description,
        isPublic,
        version: newVersion ? { increment: 1 } : undefined,
        piiFields: newVersion ? detectPII(content) : undefined,
      },
    });

    if (newVersion) {
      await prisma.policyVersion.create({
        data: {
          policyId: id,
          version: policy.version,
          content,
        },
      });
    }

    return NextResponse.json(policy);
  } catch (error) {
    console.error('Error updating policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/policies/[id] - Delete a policy
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Check ownership
    const policy = await prisma.policy.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    await prisma.policy.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Basic PII detection
function detectPII(content: string): string[] {
  const patterns: { name: string; pattern: RegExp }[] = [
    { name: 'email', pattern: /\bemail\b/i },
    { name: 'phone', pattern: /\b(phone|mobile|tel)\b/i },
    { name: 'ssn', pattern: /\b(ssn|social.?security)\b/i },
    { name: 'address', pattern: /\baddress\b/i },
    { name: 'name', pattern: /\b(first.?name|last.?name|full.?name)\b/i },
    { name: 'dob', pattern: /\b(date.?of.?birth|dob|birthday)\b/i },
    { name: 'credit_card', pattern: /\b(credit.?card|card.?number)\b/i },
  ];

  const detected: string[] = [];
  for (const { name, pattern } of patterns) {
    if (pattern.test(content)) {
      detected.push(name);
    }
  }

  return detected;
}
