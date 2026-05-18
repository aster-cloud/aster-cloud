/**
 * GET /api/license/revoked.json — 公开签名 revocation list（SaaS only）。
 *
 * 设计意图：
 *   - 任何 on-prem 部署都通过此 endpoint 拉取最新签名 manifest
 *   - 公开 GET，无认证（manifest 自身用 Ed25519 签名提供完整性 + 真实性）
 *   - CDN 友好：strong ETag 基于 publication version，max-age 1h
 *   - On-prem fetcher 用 If-None-Match 实现 304 节流
 *   - on-prem build 返回 404（路由不该出现在 on-prem ingress）
 */

import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, revocationPublications } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!IS_SAAS) {
    return new NextResponse(null, { status: 404 });
  }

  const latest = await db.query.revocationPublications.findFirst({
    orderBy: [desc(revocationPublications.version)],
  });
  if (!latest) {
    return NextResponse.json(
      { error: 'no-revocation-manifest-published-yet' },
      { status: 503 },
    );
  }

  const etag = `"v${latest.version.toString()}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=3600, must-revalidate',
      },
    });
  }

  return new NextResponse(latest.signedDoc, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, must-revalidate',
      ETag: etag,
      'Last-Modified': latest.publishedAt.toUTCString(),
    },
  });
}
