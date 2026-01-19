import { db, complianceReports } from '@/lib/prisma';
import { eq, desc, and } from 'drizzle-orm';
import { ComplianceReporter } from '@/services/compliance/reporter';
import { ComplianceScorer } from '@/services/compliance/scorer';
import type { ComplianceReportData, ComplianceType, ReportOptions } from '@/services/compliance/types';

export type { ComplianceType } from '@/services/compliance/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reporter = new ComplianceReporter(db as any, new ComplianceScorer());

export async function generateComplianceReport(
  userId: string,
  type: ComplianceType,
  policyIds?: string[]
): Promise<{
  id: string;
  type: ComplianceType;
  data: ComplianceReportData;
}> {
  const [reportRecord] = await db.insert(complianceReports).values({
    id: crypto.randomUUID(),
    userId,
    type,
    title: `${type.toUpperCase()} Compliance Report`,
    status: 'generating',
    policyIds: policyIds ?? [],
  }).returning();

  try {
    const data = await reporter.generateReport(userId, normaliseOptions(type, policyIds));

    await db.update(complianceReports)
      .set({
        status: 'completed',
        data: data as object,
        completedAt: new Date(),
      })
      .where(eq(complianceReports.id, reportRecord.id));

    return {
      id: reportRecord.id,
      type,
      data,
    };
  } catch (error) {
    await db.update(complianceReports)
      .set({
        status: 'failed',
      })
      .where(eq(complianceReports.id, reportRecord.id));

    throw error;
  }
}

export async function getComplianceReports(userId: string, limit = 10) {
  return db.query.complianceReports.findMany({
    where: eq(complianceReports.userId, userId),
    orderBy: [desc(complianceReports.createdAt)],
    limit,
  });
}

export async function getComplianceReport(userId: string, reportId: string) {
  return db.query.complianceReports.findFirst({
    where: and(eq(complianceReports.id, reportId), eq(complianceReports.userId, userId)),
  });
}

function normaliseOptions(type: ComplianceType, policyIds?: string[]): ReportOptions {
  return {
    type,
    policyIds: policyIds && policyIds.length > 0 ? policyIds : undefined,
  };
}
