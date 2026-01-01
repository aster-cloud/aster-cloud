import type { ComplianceAggregate, ComplianceScores } from './types';

export class ComplianceScorer {
  calculate(data: ComplianceAggregate): ComplianceScores {
    const overall = this.calculateOverallScore(data);

    return {
      overall,
      categories: {
        dataProtection: this.scoreDataProtection(data),
        accessControl: this.scoreAccessControl(data),
        auditLogging: this.scoreAuditLogging(data),
      },
    };
  }

  private calculateOverallScore(data: ComplianceAggregate): number {
    let score = 100;
    score -= data.policiesWithPII * 5;

    if (data.highRiskFields.length > 0) {
      score -= 15;
    }

    return clampScore(score);
  }

  private scoreDataProtection(data: ComplianceAggregate): number {
    let score = 100;
    score -= data.highRiskFields.length * 10;
    score -= Math.max(0, data.piiFields.length - 3) * 2;
    return clampScore(score);
  }

  private scoreAccessControl(data: ComplianceAggregate): number {
    if (data.totalPolicies === 0) {
      return 100;
    }

    const piiRatio = data.policiesWithPII / data.totalPolicies;
    let score = 100 - Math.round(piiRatio * 40);
    score -= data.piiFields.length > 5 ? 5 : 0;
    return clampScore(score);
  }

  private scoreAuditLogging(data: ComplianceAggregate): number {
    const baseline = Math.min(90, 60 + Math.floor(data.totalExecutions / 5));
    return clampScore(baseline);
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
