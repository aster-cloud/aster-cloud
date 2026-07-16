import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEvidenceExportMetadata } from '@/lib/evidence';

// GET /api/reports/[id] — 单个证据导出的**元数据 + manifest**（不含 bundle.entries；下载走 /download）。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const meta = await getEvidenceExportMetadata(session.user.id, id);
  if (!meta) {
    return NextResponse.json({ error: 'Export not found' }, { status: 404 });
  }

  return NextResponse.json(meta);
}
