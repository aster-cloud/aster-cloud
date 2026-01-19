import type { Database } from '@/lib/prisma';
import { db as defaultDb, policies, executions } from '@/lib/prisma';
import { eq, inArray, desc, sql } from 'drizzle-orm';
import { ComplianceScorer } from './scorer';
import type {
  ComplianceAggregate,
  ComplianceReportData,
  ComplianceType,
  PolicyInfo,
  ReportOptions,
} from './types';

type PolicyRecord = {
  id: string;
  name: string;
  piiFields: unknown;
  _count: { executions: number };
  executions: Array<{ createdAt: Date }>;
};

export class ComplianceReporter {
  constructor(
    private readonly db: Database = defaultDb,
    private readonly scorer: ComplianceScorer
  ) {}

  async generateReport(userId: string, options: ReportOptions): Promise<ComplianceReportData> {
    const policies = await this.fetchComplianceData(userId, options);
    const policyInfos = this.mapPolicies(policies);
    const aggregate = this.computeAggregate(policyInfos);
    const riskLevel = this.resolveRiskLevel(aggregate);
    const scores = this.scorer.calculate(aggregate);
    const piiRecommendations = this.generatePIIRecommendations(aggregate.piiFields);
    const recommendations = this.generateRecommendations(options.type, aggregate.piiFields, riskLevel);

    return {
      summary: {
        totalPolicies: aggregate.totalPolicies,
        policiesWithPII: aggregate.policiesWithPII,
        totalExecutions: aggregate.totalExecutions,
        complianceScore: scores.overall,
      },
      policies: policyInfos,
      piiAnalysis: {
        fieldsDetected: aggregate.piiFields,
        riskLevel,
        recommendations: piiRecommendations,
      },
      auditTrail: {
        recentExecutions: aggregate.totalExecutions,
        dataRetentionDays: 365,
        lastAuditDate: new Date(),
      },
      recommendations,
      scores,
    };
  }

  private async fetchComplianceData(userId: string, options: ReportOptions): Promise<PolicyRecord[]> {
    const whereClause = options.policyIds && options.policyIds.length > 0
      ? sql`${eq(policies.userId, userId)} AND ${inArray(policies.id, options.policyIds)}`
      : eq(policies.userId, userId);

    const policyList = await this.db.query.policies.findMany({
      where: whereClause,
      with: {
        executions: {
          orderBy: [desc(executions.createdAt)],
          limit: 1,
          columns: { createdAt: true },
        },
      },
    });

    // 获取每个策略的执行数量
    const result: PolicyRecord[] = await Promise.all(
      policyList.map(async (policy) => {
        const countResult = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(executions)
          .where(eq(executions.policyId, policy.id));

        return {
          id: policy.id,
          name: policy.name,
          piiFields: policy.piiFields,
          _count: { executions: countResult[0]?.count || 0 },
          executions: policy.executions,
        };
      })
    );

    return result;
  }

  private mapPolicies(policies: PolicyRecord[]): PolicyInfo[] {
    return policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      piiFields: this.extractPiiFields(policy.piiFields),
      executionCount: policy._count.executions,
      lastExecuted: policy.executions[0]?.createdAt || null,
    }));
  }

  private extractPiiFields(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.map((value) => String(value));
    }

    if (typeof raw === 'string' && raw.length > 0) {
      return raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }

    return [];
  }

  private computeAggregate(policyInfos: PolicyInfo[]): ComplianceAggregate {
    const piiSet = new Set<string>();
    let totalExecutions = 0;
    let policiesWithPII = 0;

    policyInfos.forEach((policy) => {
      if (policy.piiFields.length > 0) {
        policiesWithPII += 1;
        policy.piiFields.forEach((field) => piiSet.add(field));
      }

      totalExecutions += policy.executionCount;
    });

    const highRiskFields = ['ssn', 'credit_card'].filter((field) => piiSet.has(field));

    return {
      totalPolicies: policyInfos.length,
      policiesWithPII,
      totalExecutions,
      piiFields: Array.from(piiSet),
      highRiskFields,
    };
  }

  private resolveRiskLevel(aggregate: ComplianceAggregate): 'low' | 'medium' | 'high' {
    if (aggregate.highRiskFields.length > 0) {
      return 'high';
    }

    if (aggregate.policiesWithPII > 3) {
      return 'medium';
    }

    return 'low';
  }

  private generateRecommendations(
    type: ComplianceType,
    piiFields: string[],
    riskLevel: 'low' | 'medium' | 'high'
  ): string[] {
    const recommendations: string[] = [];

    switch (type) {
      case 'gdpr':
        recommendations.push('确保在处理个人数据前获取数据主体同意');
        recommendations.push('实现被遗忘权相关流程，并记录删除记录');
        if (piiFields.length > 0) {
          recommendations.push('为每类个人数据明确合法处理依据');
        }
        break;
      case 'hipaa':
        recommendations.push('对所有 PHI 进行传输与静态加密');
        recommendations.push('实施访问控制与审计日志，确保最小权限');
        if (piiFields.includes('dob') || piiFields.includes('ssn')) {
          recommendations.push('严格限制 PHI 收集并定期审核员工培训');
        }
        break;
      case 'soc2':
        recommendations.push('补齐安全政策与流程文档，覆盖变更、访问与监控');
        recommendations.push('上线持续监控告警，确保关键事件实时通知');
        recommendations.push('安排定期第三方安全评估并记录整改措施');
        break;
      case 'pci_dss':
        if (piiFields.includes('credit_card')) {
          recommendations.push('信用卡数据需使用令牌化并限制访问');
          recommendations.push('所有支付流程执行 PCI DSS 扫描与渗透测试');
        }
        recommendations.push('维护季度漏洞扫描机制并保留报告');
        break;
      default:
        recommendations.push('检查数据采集表单，仅保留业务必需字段');
        recommendations.push('确认数据处理位置满足地区合规要求');
    }

    if (riskLevel === 'high') {
      recommendations.push('高风险数据需立即审查收集目的，必要时暂停处理');
      recommendations.push('优先为高风险字段补齐加密、脱敏与访问审计，确保闭环');
    } else if (riskLevel === 'medium') {
      recommendations.push('针对多 PII 政策建立专项监控与异常预警');
    }

    return recommendations;
  }

  private generatePIIRecommendations(piiFields: string[]): string[] {
    const recommendations: string[] = [];

    if (piiFields.includes('ssn')) {
      recommendations.push('社保号需要在所有展示与日志中脱敏');
      recommendations.push('评估是否可以移除社保号收集，或添加额外审批流程');
    }

    if (piiFields.includes('credit_card')) {
      recommendations.push('信用卡号必须采用令牌化或专用保管库');
      recommendations.push('在支付流程中强制执行 PCI 合规要求');
    }

    if (piiFields.includes('email')) {
      recommendations.push('邮件地址需要保留同意记录并支持撤回');
    }

    if (piiFields.includes('phone')) {
      recommendations.push('电话号码统一转换为 E.164，并限制运营用途');
    }

    if (piiFields.includes('address')) {
      recommendations.push('地址数据应当进行区域化存储并加密硬盘');
    }

    if (recommendations.length === 0) {
      recommendations.push('未检测到高风险 PII，继续保持现有管控措施');
    }

    return recommendations;
  }
}
