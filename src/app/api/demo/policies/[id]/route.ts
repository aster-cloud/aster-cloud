/**
 * Demo Policy Detail API
 *
 * GET /api/demo/policies/[id] - 获取单个 Demo 策略详情
 * PUT /api/demo/policies/[id] - 更新 Demo 策略
 * DELETE /api/demo/policies/[id] - 删除 Demo 策略
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDemoSession, logDemoAudit } from '@/lib/demo-session';
import { detectPII } from '@/services/pii/detector';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/demo/policies/[id] - 获取单个 Demo 策略详情
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await requireDemoSession();
    const { id } = await params;

    const policy = await prisma.demoPolicy.findFirst({
      where: {
        id,
        sessionId: session.id,
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
    console.error('Error fetching demo policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/demo/policies/[id] - 更新 Demo 策略
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await requireDemoSession();
    const { id } = await params;

    const existingPolicy = await prisma.demoPolicy.findFirst({
      where: {
        id,
        sessionId: session.id,
      },
    });

    if (!existingPolicy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 解析 JSON 请求体，处理格式错误
    let body: { name?: string; content?: string; description?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { name, content, description } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    // PII 检测
    const piiResult = detectPII(content);
    const newVersion = existingPolicy.version + 1;

    // 更新策略
    const policy = await prisma.demoPolicy.update({
      where: { id },
      data: {
        name,
        content,
        description,
        version: newVersion,
        piiFields: piiResult.detectedTypes,
      },
    });

    // 创建新版本记录
    await prisma.demoPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: newVersion,
        content,
        comment: `Version ${newVersion}`,
      },
    });

    // 记录审计日志
    await logDemoAudit(session.id, 'update_policy', 'policy', policy.id, {
      name,
      version: newVersion,
      piiFields: piiResult.detectedTypes,
    });

    return NextResponse.json(policy);
  } catch (error) {
    console.error('Error updating demo policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/demo/policies/[id] - 删除 Demo 策略
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await requireDemoSession();
    const { id } = await params;

    const existingPolicy = await prisma.demoPolicy.findFirst({
      where: {
        id,
        sessionId: session.id,
      },
    });

    if (!existingPolicy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 删除策略（级联删除 versions 和 executions）
    await prisma.demoPolicy.delete({
      where: { id },
    });

    // 记录审计日志
    await logDemoAudit(session.id, 'delete_policy', 'policy', id, {
      name: existingPolicy.name,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting demo policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
