/**
 * Demo Policies API
 *
 * GET /api/demo/policies - 获取 Demo 会话的所有策略
 * POST /api/demo/policies - 创建新的 Demo 策略
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireDemoSession,
  canCreateMorePolicies,
  logDemoAudit,
  DEMO_CONSTANTS,
} from '@/lib/demo-session';
import { detectPII } from '@/services/pii/detector';

// GET /api/demo/policies - 获取 Demo 会话的所有策略
// 支持 ?include=content,defaultInput 参数以包含额外字段
export async function GET(req: Request) {
  try {
    const session = await requireDemoSession();
    const url = new URL(req.url);
    const include = url.searchParams.get('include')?.split(',') || [];

    // 基础字段
    const selectFields: Record<string, boolean> = {
      id: true,
      name: true,
      description: true,
      version: true,
      piiFields: true,
      createdAt: true,
      updatedAt: true,
    };

    // 可选字段
    if (include.includes('content')) {
      selectFields.content = true;
    }
    if (include.includes('defaultInput')) {
      selectFields.defaultInput = true;
    }

    const policies = await prisma.demoPolicy.findMany({
      where: { sessionId: session.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        ...selectFields,
        _count: {
          select: { executions: true },
        },
      },
    });

    return NextResponse.json({
      policies,
      limits: {
        current: policies.length,
        max: DEMO_CONSTANTS.MAX_POLICIES,
      },
    });
  } catch (error) {
    console.error('Error fetching demo policies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/demo/policies - 创建新的 Demo 策略
export async function POST(req: Request) {
  try {
    const session = await requireDemoSession();

    // 检查策略数量限制
    const canCreate = await canCreateMorePolicies(session.id);
    if (!canCreate) {
      return NextResponse.json(
        {
          error: 'Policy limit reached',
          message: `Demo sessions are limited to ${DEMO_CONSTANTS.MAX_POLICIES} policies.`,
        },
        { status: 403 }
      );
    }

    // 解析 JSON 请求体，处理格式错误
    let body: { name?: string; content?: string; description?: string; defaultInput?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { name, content, description, defaultInput } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    // PII 检测
    const piiResult = detectPII(content);

    const policy = await prisma.demoPolicy.create({
      data: {
        sessionId: session.id,
        name,
        content,
        description,
        defaultInput: (defaultInput as object) ?? undefined,
        piiFields: piiResult.detectedTypes,
      },
    });

    // 创建初始版本
    await prisma.demoPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        content,
        comment: 'Initial version',
      },
    });

    // 记录审计日志
    await logDemoAudit(session.id, 'create_policy', 'policy', policy.id, {
      name,
      piiFields: piiResult.detectedTypes,
    });

    return NextResponse.json(policy, { status: 201 });
  } catch (error) {
    console.error('Error creating demo policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
