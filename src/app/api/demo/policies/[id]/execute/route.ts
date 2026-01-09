/**
 * Demo Policy Execute API
 *
 * POST /api/demo/policies/[id]/execute - 执行 Demo 策略
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDemoSession, logDemoAudit } from '@/lib/demo-session';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/demo/policies/[id]/execute - 执行 Demo 策略
export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    const session = await requireDemoSession();
    const { id } = await params;

    const policy = await prisma.demoPolicy.findFirst({
      where: {
        id,
        sessionId: session.id,
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 解析 JSON 请求体，处理格式错误
    let body: { input?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { input } = body;

    if (!input || typeof input !== 'object') {
      return NextResponse.json(
        { error: 'Valid input object is required' },
        { status: 400 }
      );
    }

    // 调用策略引擎执行策略
    // 这里使用简化的模拟执行，实际实现应调用 Aster Policy Engine
    const result = await executePolicyMock(policy.content, input as Record<string, unknown>);
    const durationMs = Date.now() - startTime;

    // 记录执行结果
    const execution = await prisma.demoExecution.create({
      data: {
        sessionId: session.id,
        policyId: policy.id,
        input: input as object,
        output: (result.output as object) ?? undefined,
        error: result.error,
        durationMs,
        success: result.success,
      },
    });

    // 记录审计日志
    await logDemoAudit(session.id, 'execute_policy', 'execution', execution.id, {
      policyId: policy.id,
      policyName: policy.name,
      success: result.success,
      durationMs,
    });

    return NextResponse.json({
      execution: {
        id: execution.id,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs,
      },
    });
  } catch (error) {
    console.error('Error executing demo policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * 模拟策略执行（原型阶段）
 * 实际实现应调用 Aster Policy Engine API
 */
async function executePolicyMock(
  _content: string,
  input: Record<string, unknown>
): Promise<{
  success: boolean;
  output: Record<string, unknown> | null;
  error: string | null;
}> {
  // 模拟处理延迟
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 简单的模拟逻辑 - 基于常见输入字段返回模拟结果
  const creditScore = input.credit_score || input.creditScore;
  const income = input.income || input.annual_income;
  const amount = input.amount || input.loan_amount;

  // 模拟贷款审批逻辑
  if (creditScore !== undefined && income !== undefined) {
    const approved =
      Number(creditScore) >= 650 && Number(income) >= 30000;
    return {
      success: true,
      output: {
        decision: approved ? 'APPROVED' : 'REJECTED',
        reason: approved
          ? 'Meets minimum credit and income requirements'
          : 'Does not meet minimum requirements',
        matchedRules: approved
          ? ['credit_score_check', 'income_check']
          : ['credit_score_check'],
        actions: approved
          ? ['generate_offer', 'send_notification']
          : ['send_rejection_notice'],
        details: {
          creditScore: Number(creditScore),
          income: Number(income),
          requestedAmount: amount ? Number(amount) : null,
        },
      },
      error: null,
    };
  }

  // 默认返回输入的处理结果
  return {
    success: true,
    output: {
      decision: 'PROCESSED',
      reason: 'Input processed successfully',
      matchedRules: ['default_handler'],
      actions: ['log_result'],
      input,
    },
    error: null,
  };
}
