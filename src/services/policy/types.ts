import type { Policy } from '@prisma/client';

export type RuleOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'matches';

export interface ParsedRule {
  name: string;
  field: string;
  operator: RuleOperator;
  value: unknown;
  action: 'allow' | 'deny';
  rawAction: string;
  source: string;
}

export interface RuleEvaluationResult {
  ruleName: string;
  matched: boolean;
  passed: boolean;
  reason?: string;
  action: 'allow' | 'deny';
  field: string;
  operator: RuleOperator;
  expected: unknown;
  actual: unknown;
}

export interface PolicyExecutionContext {
  policy: Policy & { rules?: string | null };
  input: Record<string, unknown>;
  userId: string;
}

export interface PolicyExecutionResult {
  allowed: boolean;
  matchedRules: string[];
  deniedReasons: string[];
  metadata: Record<string, unknown>;
}
