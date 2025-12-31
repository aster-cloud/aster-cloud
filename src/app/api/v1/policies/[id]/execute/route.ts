import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/v1/policies/[id]/execute - Execute a policy (API endpoint)
export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    // Validate API key
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7);
    const validation = await validateApiKey(apiKey);

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { input } = await req.json();

    if (!input || typeof input !== 'object') {
      return NextResponse.json(
        { error: 'Input must be a valid object' },
        { status: 400 }
      );
    }

    // Check policy access
    const policy = await prisma.policy.findFirst({
      where: {
        id,
        OR: [
          { userId: validation.userId },
          { isPublic: true },
        ],
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // Check usage limits
    const limitCheck = await checkUsageLimit(validation.userId!, 'api_call');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Usage limit exceeded',
          message: limitCheck.message,
        },
        { status: 429 }
      );
    }

    // Execute policy
    const output = executePolicy(policy.content, input);
    const durationMs = Date.now() - startTime;

    // Record execution
    await prisma.execution.create({
      data: {
        userId: validation.userId!,
        policyId: id,
        input,
        output: output.result,
        error: output.error,
        durationMs,
        success: !output.error,
        source: 'api',
        apiKeyId: validation.apiKeyId,
      },
    });

    // Record usage
    await recordUsage(validation.userId!, 'api_call');
    await recordUsage(validation.userId!, 'execution');

    return NextResponse.json({
      success: !output.error,
      data: output.result,
      error: output.error,
      meta: {
        policyId: id,
        policyName: policy.name,
        durationMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('API execution error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Policy execution logic (same as dashboard)
function executePolicy(policyContent: string, input: Record<string, unknown>): {
  result?: Record<string, unknown>;
  error?: string;
} {
  try {
    const rules = parsePolicyRules(policyContent);
    const result = evaluateRules(rules, input);
    return { result };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Policy execution failed',
    };
  }
}

interface Rule {
  field: string;
  condition: string;
  value: unknown;
  action: string;
}

function parsePolicyRules(content: string): Rule[] {
  const rules: Rule[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/if\s+(\w+)\s+(>=|<=|>|<|==|!=)\s+(\S+)\s+then\s+(.+)/i);
    if (match) {
      rules.push({
        field: match[1],
        condition: match[2],
        value: isNaN(Number(match[3])) ? match[3] : Number(match[3]),
        action: match[4].trim(),
      });
    }
  }

  return rules;
}

function evaluateRules(
  rules: Rule[],
  input: Record<string, unknown>
): Record<string, unknown> {
  const results: Record<string, unknown> = {
    matchedRules: [] as string[],
    actions: [] as string[],
    approved: true,
  };

  for (const rule of rules) {
    const fieldValue = input[rule.field];

    let matched = false;
    switch (rule.condition) {
      case '>=':
        matched = Number(fieldValue) >= Number(rule.value);
        break;
      case '<=':
        matched = Number(fieldValue) <= Number(rule.value);
        break;
      case '>':
        matched = Number(fieldValue) > Number(rule.value);
        break;
      case '<':
        matched = Number(fieldValue) < Number(rule.value);
        break;
      case '==':
        matched = fieldValue == rule.value;
        break;
      case '!=':
        matched = fieldValue != rule.value;
        break;
    }

    if (matched) {
      (results.matchedRules as string[]).push(
        `${rule.field} ${rule.condition} ${rule.value}`
      );
      (results.actions as string[]).push(rule.action);

      if (rule.action.toLowerCase().includes('reject') ||
          rule.action.toLowerCase().includes('deny')) {
        results.approved = false;
      }
    }
  }

  return results;
}
