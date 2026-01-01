import { evaluateRules, parseRules, toExecutionResult } from './parser';
import type { PolicyExecutionContext, PolicyExecutionResult } from './types';

export async function executePolicy(
  context: PolicyExecutionContext
): Promise<PolicyExecutionResult> {
  const { policy, input } = context;
  const rulesSource =
    (typeof policy.rules === 'string' && policy.rules.length > 0
      ? policy.rules
      : policy.content) || '';

  const rules = parseRules(rulesSource);

  if (rules.length === 0) {
    return {
      allowed: true,
      matchedRules: [],
      deniedReasons: [],
      metadata: {
        evaluatedAt: new Date().toISOString(),
        policyId: policy.id,
        policyName: policy.name,
        ruleCount: 0,
        matchedRuleCount: 0,
        denyCount: 0,
      },
    };
  }

  const evaluations = evaluateRules(rules, input);

  return toExecutionResult(evaluations, {
    evaluatedAt: new Date(),
    policyId: policy.id,
    policyName: policy.name,
  });
}
