import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/**
 * POST /api/user/onboarding
 * 保存 onboarding 偏好（待数据库迁移后启用）
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 读取请求体以避免客户端错误
  await req.json();

  // 数据库尚未添加 onboarding 列，暂时返回成功
  return NextResponse.json({ success: true });
}

/**
 * GET /api/user/onboarding
 * 获取 onboarding 偏好（待数据库迁移后启用）
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    useCase: null,
    goals: null,
    completedAt: null,
  });
}
