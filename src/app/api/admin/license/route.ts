/**
 * GET /api/admin/license — returns parsed LICENSE_KEY status for the
 * on-prem admin console. SaaS mode: 404 (route doesn't exist).
 *
 * 鉴权：必须是 admin 用户。on-prem 部署的 admin 也是单个组织的 IT/owner，
 * 与 SaaS admin gate 共用 isAdminFromSession（PR-3 已建立的语义）。
 *
 * 响应 shape：与 src/lib/license.ts LicenseResult 一致 —— 客户端组件
 * 可以直接消费同样的 discriminated union。
 */

import { NextResponse } from 'next/server';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { parseLicenseKey } from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // SaaS build 不该有此路由；优先于 admin 检查不泄露端点存在。
  if (!CAN_LICENSE) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = await isAdminFromSession();
  if (!admin) {
    // 与 admin/layout.tsx 一致 —— 非 admin 不该感知此 API 存在
    return new NextResponse(null, { status: 404 });
  }

  const result = parseLicenseKey(process.env.LICENSE_KEY);
  return NextResponse.json(result, {
    // 运营敏感配置 —— 不允许任何中间层缓存（即使 force-dynamic 已经
    // 让 Next 不缓存，也显式声明给反向代理 / CDN）
    headers: { 'Cache-Control': 'no-store' },
  });
}
