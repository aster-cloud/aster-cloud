import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  generateComplianceReport,
  getComplianceReports,
  type ComplianceType,
} from '@/lib/compliance';
import { hasFeatureAccess, recordUsage } from '@/lib/usage';

// GET /api/reports - List compliance reports
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reports = await getComplianceReports(session.user.id);

    return NextResponse.json(reports);
  } catch (error) {
    console.error('Error fetching reports:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/reports - Generate a new compliance report
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has compliance reports feature
    const hasAccess = await hasFeatureAccess(session.user.id, 'complianceReports');
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'Compliance reports require Pro or Team subscription',
          upgrade: true,
        },
        { status: 403 }
      );
    }

    const { type, policyIds } = await req.json();

    if (!type || !['gdpr', 'hipaa', 'soc2', 'pci_dss', 'custom'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid compliance type' },
        { status: 400 }
      );
    }

    const report = await generateComplianceReport(
      session.user.id,
      type as ComplianceType,
      policyIds
    );

    // Record usage
    await recordUsage(session.user.id, 'compliance_report');

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
