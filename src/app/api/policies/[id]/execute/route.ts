import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/policies/[id]/execute - Execute a policy
export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // Check usage limits
    const limitCheck = await checkUsageLimit(session.user.id, 'execution');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Usage limit exceeded',
          message: limitCheck.message,
          upgrade: true,
        },
        { status: 429 }
      );
    }

    // Execute policy (simulated - in production, call aster-lang runtime)
    const output = executePolicy(policy.content, input);
    const durationMs = Date.now() - startTime;

    // Record execution
    const execution = await prisma.execution.create({
      data: {
        userId: session.user.id,
        policyId: id,
        input,
        output: output.result,
        error: output.error,
        durationMs,
        success: !output.error,
        source: 'dashboard',
      },
    });

    // Record usage
    await recordUsage(session.user.id, 'execution');

    return NextResponse.json({
      executionId: execution.id,
      success: !output.error,
      output: output.result,
      error: output.error,
      durationMs,
    });
  } catch (error) {
    console.error('Error executing policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Simulated policy execution
// In production, this would call the aster-lang runtime API
function executePolicy(policyContent: string, input: Record<string, unknown>): {
  result?: Record<string, unknown>;
  error?: string;
} {
  try {
    // Simple rule engine simulation
    // Parse policy content for rules
    const rules = parsePolicyRules(policyContent);

    // Evaluate rules against input
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
  // Very basic rule parsing for demo
  // Format: "if <field> <condition> <value> then <action>"
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
