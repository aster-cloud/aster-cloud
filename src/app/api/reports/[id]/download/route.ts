import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEvidenceExportBundle } from '@/lib/evidence';

// GET /api/reports/[id]/download — 下载证据包字节（仓内首个 Content-Disposition attachment）。
//
// 重下载稳定：同一导出多次下载字节完全一致（bundle 已持久化，非按需重生）。
// 归属校验：只返回本人已完成的导出，miss/越权/未完成统一 404。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const bundle = await getEvidenceExportBundle(session.user.id, id);
  if (!bundle) {
    return NextResponse.json({ error: 'Export not found' }, { status: 404 });
  }

  const ext = bundle.format === 'jsonl' ? 'jsonl' : 'json';
  const contentType = bundle.format === 'jsonl' ? 'application/x-ndjson' : 'application/json';
  // 文件名含短 bundleHash（防混淆 + 自识别）；ASCII fallback + RFC5987 filename* 兼容非 ASCII。
  const shortHash = bundle.manifest.bundleHash.slice(0, 12);
  const asciiName = `aster-evidence-${shortHash}.${ext}`;

  return new NextResponse(bundle.body, {
    status: 200,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(asciiName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
