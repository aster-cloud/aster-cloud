import { prisma } from '@/lib/prisma';

export type ComplianceType = 'gdpr' | 'hipaa' | 'soc2' | 'pci_dss' | 'custom';

interface PolicyInfo {
  id: string;
  name: string;
  piiFields: string[];
  executionCount: number;
  lastExecuted: Date | null;
}

interface ComplianceData {
  summary: {
    totalPolicies: number;
    policiesWithPII: number;
    totalExecutions: number;
    complianceScore: number;
  };
  policies: PolicyInfo[];
  piiAnalysis: {
    fieldsDetected: string[];
    riskLevel: 'low' | 'medium' | 'high';
    recommendations: string[];
  };
  auditTrail: {
    recentExecutions: number;
    dataRetentionDays: number;
    lastAuditDate: Date;
  };
  recommendations: string[];
}

// Generate a compliance report
export async function generateComplianceReport(
  userId: string,
  type: ComplianceType,
  policyIds?: string[]
): Promise<{
  id: string;
  type: ComplianceType;
  data: ComplianceData;
}> {
  // Create report record
  const report = await prisma.complianceReport.create({
    data: {
      userId,
      type,
      title: `${type.toUpperCase()} Compliance Report`,
      status: 'generating',
      policyIds: policyIds || [],
    },
  });

  try {
    // Fetch policies
    const policies = await prisma.policy.findMany({
      where: {
        userId,
        ...(policyIds && policyIds.length > 0 ? { id: { in: policyIds } } : {}),
      },
      include: {
        _count: {
          select: { executions: true },
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    // Analyze policies
    const policyInfos: PolicyInfo[] = policies.map((p) => ({
      id: p.id,
      name: p.name,
      piiFields: (p.piiFields as string[]) || [],
      executionCount: p._count.executions,
      lastExecuted: p.executions[0]?.createdAt || null,
    }));

    // Aggregate PII fields
    const allPiiFields = new Set<string>();
    policies.forEach((p) => {
      ((p.piiFields as string[]) || []).forEach((field) => allPiiFields.add(field));
    });

    // Calculate compliance score
    const policiesWithPII = policies.filter(
      (p) => p.piiFields && (p.piiFields as string[]).length > 0
    ).length;

    const totalExecutions = policies.reduce(
      (sum, p) => sum + p._count.executions,
      0
    );

    // Simple scoring: penalize for PII without proper handling
    let score = 100;
    if (policiesWithPII > 0) {
      // Deduct points for PII exposure
      score -= policiesWithPII * 5;
    }
    if (allPiiFields.has('ssn') || allPiiFields.has('credit_card')) {
      score -= 15; // High-risk PII
    }
    score = Math.max(0, Math.min(100, score));

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (allPiiFields.has('ssn') || allPiiFields.has('credit_card')) {
      riskLevel = 'high';
    } else if (policiesWithPII > 3) {
      riskLevel = 'medium';
    }

    // Generate recommendations based on type
    const recommendations = generateRecommendations(
      type,
      Array.from(allPiiFields),
      riskLevel
    );

    const data: ComplianceData = {
      summary: {
        totalPolicies: policies.length,
        policiesWithPII,
        totalExecutions,
        complianceScore: score,
      },
      policies: policyInfos,
      piiAnalysis: {
        fieldsDetected: Array.from(allPiiFields),
        riskLevel,
        recommendations: generatePIIRecommendations(Array.from(allPiiFields)),
      },
      auditTrail: {
        recentExecutions: totalExecutions,
        dataRetentionDays: 365,
        lastAuditDate: new Date(),
      },
      recommendations,
    };

    // Update report with data
    await prisma.complianceReport.update({
      where: { id: report.id },
      data: {
        status: 'completed',
        data,
        completedAt: new Date(),
      },
    });

    return {
      id: report.id,
      type,
      data,
    };
  } catch (error) {
    // Mark report as failed
    await prisma.complianceReport.update({
      where: { id: report.id },
      data: {
        status: 'failed',
      },
    });
    throw error;
  }
}

function generateRecommendations(
  type: ComplianceType,
  piiFields: string[],
  riskLevel: string
): string[] {
  const recommendations: string[] = [];

  // Type-specific recommendations
  switch (type) {
    case 'gdpr':
      recommendations.push('Ensure data subject consent is obtained before processing');
      recommendations.push('Implement right to erasure (right to be forgotten) procedures');
      if (piiFields.length > 0) {
        recommendations.push('Document lawful basis for processing personal data');
      }
      break;

    case 'hipaa':
      recommendations.push('Ensure all PHI is encrypted at rest and in transit');
      recommendations.push('Implement access controls and audit logging');
      if (piiFields.includes('dob') || piiFields.includes('ssn')) {
        recommendations.push('Review and minimize PHI collection');
      }
      break;

    case 'soc2':
      recommendations.push('Document security policies and procedures');
      recommendations.push('Implement continuous monitoring and alerting');
      recommendations.push('Conduct regular security assessments');
      break;

    case 'pci_dss':
      if (piiFields.includes('credit_card')) {
        recommendations.push('Ensure credit card data is properly tokenized');
        recommendations.push('Implement PCI-compliant data handling procedures');
      }
      recommendations.push('Regular vulnerability scanning required');
      break;

    default:
      recommendations.push('Review data handling procedures');
      recommendations.push('Implement data minimization practices');
  }

  // Risk-based recommendations
  if (riskLevel === 'high') {
    recommendations.push('URGENT: High-risk data detected - immediate review required');
    recommendations.push('Consider implementing additional encryption measures');
  }

  return recommendations;
}

function generatePIIRecommendations(piiFields: string[]): string[] {
  const recommendations: string[] = [];

  if (piiFields.includes('ssn')) {
    recommendations.push('SSN should be masked in all outputs');
    recommendations.push('Consider if SSN collection is necessary');
  }

  if (piiFields.includes('credit_card')) {
    recommendations.push('Credit card numbers must be tokenized');
    recommendations.push('Ensure PCI DSS compliance for card data');
  }

  if (piiFields.includes('email')) {
    recommendations.push('Email addresses should be validated and consented');
  }

  if (piiFields.includes('phone')) {
    recommendations.push('Phone numbers should be stored in E.164 format');
  }

  if (piiFields.includes('address')) {
    recommendations.push('Physical addresses should be securely stored');
  }

  if (recommendations.length === 0) {
    recommendations.push('No high-risk PII detected - maintain current practices');
  }

  return recommendations;
}

// Get compliance reports for a user
export async function getComplianceReports(userId: string, limit = 10) {
  return prisma.complianceReport.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// Get a specific compliance report
export async function getComplianceReport(userId: string, reportId: string) {
  return prisma.complianceReport.findFirst({
    where: {
      id: reportId,
      userId,
    },
  });
}
