import type {
  ParsedRule,
  PolicyExecutionResult,
  RuleEvaluationResult,
  RuleOperator,
} from './types';

const OPERATOR_MAP: Record<string, RuleOperator> = {
  '==': 'eq',
  '=': 'eq',
  eq: 'eq',
  '!=': 'ne',
  ne: 'ne',
  '>': 'gt',
  gt: 'gt',
  '<': 'lt',
  lt: 'lt',
  '>=': 'gte',
  gte: 'gte',
  '<=': 'lte',
  lte: 'lte',
  contains: 'contains',
  includes: 'contains',
  match: 'matches',
  matches: 'matches',
};

const ACTION_MAP: Record<string, 'allow' | 'deny'> = {
  allow: 'allow',
  approve: 'allow',
  grant: 'allow',
  permit: 'allow',
  deny: 'deny',
  reject: 'deny',
  block: 'deny',
  forbid: 'deny',
};

const DENY_KEYWORDS = ['deny', 'reject', 'block', 'forbid'];

export function parseRules(rulesText: string): ParsedRule[] {
  const lines = (rulesText || '').split('\n');
  const rules: ParsedRule[] = [];

  lines.forEach((rawLine, index) => {
    const source = rawLine.trim();
    if (!source || source.startsWith('#')) {
      return;
    }

    const match = source.match(
      /^if\s+([\w.]+)\s+(>=|<=|>|<|==|=|!=|matches|match|contains|includes)\s+(.+?)\s+then\s+(.+)$/i
    );

    if (!match) {
      return;
    }

    const [, field, operatorToken, valueToken, actionToken] = match;
    const operator = normaliseOperator(operatorToken);
    const action = normaliseAction(actionToken);

    if (!operator || !action) {
      return;
    }

    rules.push({
      name: `rule-${index + 1}`,
      field,
      operator,
      value: parseValue(valueToken),
      action,
      rawAction: actionToken.trim(),
      source,
    });
  });

  return rules;
}

export function evaluateRules(
  rules: ParsedRule[],
  input: Record<string, unknown>
): RuleEvaluationResult[] {
  return rules.map((rule) => {
    const actual = resolveValue(input, rule.field);
    const matched = applyOperator(actual, rule.value, rule.operator);
    const passed = rule.action === 'deny' ? !matched : true;
    const reason =
      passed || rule.action === 'allow'
        ? undefined
        : extractDenyReason(rule) ??
          `规则 ${rule.name} 触发拒绝：${rule.field} ${describeOperator(rule.operator)} ${String(
            rule.value
          )}`;

    return {
      ruleName: rule.name,
      matched,
      passed,
      reason,
      action: rule.action,
      field: rule.field,
      operator: rule.operator,
      expected: formatValue(rule.value),
      actual: formatValue(actual),
    };
  });
}

export function toExecutionResult(
  evaluations: RuleEvaluationResult[],
  context: { evaluatedAt: Date; policyId: string; policyName: string }
): PolicyExecutionResult {
  return {
    allowed: evaluations.every((evaluation) => evaluation.passed),
    matchedRules: evaluations.filter((evaluation) => evaluation.matched).map((evaluation) => evaluation.ruleName),
    deniedReasons: evaluations
      .filter((evaluation) => !evaluation.passed)
      .map((evaluation) => evaluation.reason || `${evaluation.ruleName} 未通过`),
    metadata: {
      evaluatedAt: context.evaluatedAt.toISOString(),
      policyId: context.policyId,
      policyName: context.policyName,
      ruleCount: evaluations.length,
      matchedRuleCount: evaluations.filter((evaluation) => evaluation.matched).length,
      denyCount: evaluations.filter((evaluation) => !evaluation.passed).length,
      rules: evaluations.map((evaluation) => ({
        name: evaluation.ruleName,
        action: evaluation.action,
        field: evaluation.field,
        operator: evaluation.operator,
        expected: evaluation.expected,
        actual: evaluation.actual,
        matched: evaluation.matched,
      })),
    },
  };
}

function normaliseOperator(token: string): RuleOperator | undefined {
  return OPERATOR_MAP[token.toLowerCase()];
}

function normaliseAction(token: string): 'allow' | 'deny' | undefined {
  const cleaned = token.trim().toLowerCase();
  const keyword = cleaned.split(/\s+/)[0];
  return ACTION_MAP[keyword];
}

function parseValue(token: string): unknown {
  const trimmed = token.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1);
    return new RegExp(pattern, flags);
  }

  if (!Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }

  if (trimmed.toLowerCase() === 'true') {
    return true;
  }

  if (trimmed.toLowerCase() === 'false') {
    return false;
  }

  return trimmed;
}

function resolveValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function applyOperator(actual: unknown, expected: unknown, operator: RuleOperator): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      if (typeof actual === 'string') {
        return actual.includes(String(expected));
      }
      return false;
    case 'matches':
      if (expected instanceof RegExp) {
        return typeof actual === 'string' && expected.test(actual);
      }
      try {
        const regex =
          typeof expected === 'string' && expected.startsWith('/') && expected.lastIndexOf('/') > 0
            ? parseValue(expected)
            : new RegExp(String(expected), 'i');
        if (regex instanceof RegExp) {
          return typeof actual === 'string' && regex.test(actual);
        }
      } catch {
        return false;
      }
      return false;
    default:
      return false;
  }
}

function extractDenyReason(rule: ParsedRule): string | undefined {
  const raw = rule.rawAction?.trim();
  if (!raw) {
    return undefined;
  }

  const rawLower = raw.toLowerCase();
  for (const keyword of DENY_KEYWORDS) {
    if (rawLower.startsWith(keyword)) {
      const message = raw.slice(keyword.length).trim();
      return message.length > 0 ? message : undefined;
    }
  }

  return undefined;
}

function describeOperator(operator: RuleOperator): string {
  switch (operator) {
    case 'eq':
      return '等于';
    case 'ne':
      return '不等于';
    case 'gt':
      return '大于';
    case 'lt':
      return '小于';
    case 'gte':
      return '大于等于';
    case 'lte':
      return '小于等于';
    case 'contains':
      return '包含';
    case 'matches':
      return '匹配';
  }
}

function formatValue(value: unknown): unknown {
  if (value instanceof RegExp) {
    return value.toString();
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.parse(JSON.stringify(value));
  }

  return value;
}
