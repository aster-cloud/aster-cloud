import { prisma } from '@/lib/prisma';
import { ComplianceReporter } from '@/services/compliance/reporter';
import { ComplianceScorer } from '@/services/compliance/scorer';
import type { ComplianceReportData, ComplianceType, ReportOptions } from '@/services/compliance/types';

export type { ComplianceType } from '@/services/compliance/types';

const reporter = new ComplianceReporter(prisma, new ComplianceScorer());

export async function generateComplianceReport(
  userId: string,
  type: ComplianceType,
  policyIds?: string[]
): Promise<{
  id: string;
  type: ComplianceType;
  data: ComplianceReportData;
}> {
  const reportRecord = await prisma.complianceReport.create({
    data: {
      userId,
      type,
      title: `${type.toUpperCase()} Compliance Report`,
      status: 'generating',
      policyIds: policyIds ?? [],
    },
  });

  try {
    const data = await reporter.generateReport(userId, normaliseOptions(type, policyIds));

    await prisma.complianceReport.update({
      where: { id: reportRecord.id },
      data: {
        status: 'completed',
        data: data as object,
        completedAt: new Date(),
      },
    });

    return {
      id: reportRecord.id,
      type,
      data,
    };
  } catch (error) {
    await prisma.complianceReport.update({
      where: { id: reportRecord.id },
      data: {
        status: 'failed',
      },
    });

    throw error;
  }
}

export async function getComplianceReports(userId: string, limit = 10) {
  return prisma.complianceReport.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getComplianceReport(userId: string, reportId: string) {
  return prisma.complianceReport.findFirst({
    where: {
      id: reportId,
      userId,
    },
  });
}

function normaliseOptions(type: ComplianceType, policyIds?: string[]): ReportOptions {
  return {
    type,
    policyIds: policyIds && policyIds.length > 0 ? policyIds : undefined,
  };
}
