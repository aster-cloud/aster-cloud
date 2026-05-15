/**
 * R21-Critical-2: cron route 鉴权统一入口（fail-closed）。
 *
 * <p>历史 bug：每个 cron route 各自实现 guard，写法 `if (cronSecret && header !== ...)`
 * —— 当 CRON_SECRET 未配置时直接放行，destructive job 可被任意触发。
 * 现统一走此 helper，secret 缺失时 fail-closed 返回 503（"未配置 = 服务不可用"），
 * secret 存在但不匹配返回 401（"配置了但你没权限"）。
 *
 * <p>典型用法：
 * <pre>{@code
 *   export async function POST(req: NextRequest) {
 *     const guard = requireCronAuth(req);
 *     if (guard) return guard;
 *     // ... 真实任务逻辑
 *   }
 * }</pre>
 *
 * <p>开发环境豁免：若 NODE_ENV !== 'production' 且 CRON_SECRET 未设置，允许调用
 *   并打一行 warn。生产环境永远 fail-closed。
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * 校验 cron 鉴权头。
 *
 * @returns 校验通过时返回 null；失败时返回 NextResponse（caller 直接 return）。
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');

  if (!cronSecret) {
    // R21-Critical-2 + R23-Major-3: default fail-closed.
    // 仅在显式 development / test 时 warn-and-allow；NODE_ENV 未设、production
    // 或其他任何值 → 503。这样 OpenNext/Workers 等不设 NODE_ENV 的运行时
    // 也是安全的（fail-closed by default）。
    const env = process.env.NODE_ENV;
    if (env === 'development' || env === 'test') {
      console.warn(
        `[cron-auth] CRON_SECRET not set — allowing call in NODE_ENV=${env}. ` +
          'In production this would return 503.'
      );
      return null;
    }
    return NextResponse.json(
      {
        error: 'cron_secret_not_configured',
        message:
          'CRON_SECRET env var is required but missing. ' +
          'Cron endpoints are disabled until it is set ' +
          '(NODE_ENV=' + (env ?? 'unset') + ').',
      },
      { status: 503 }
    );
  }

  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
