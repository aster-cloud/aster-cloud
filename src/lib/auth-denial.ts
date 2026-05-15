/**
 * Auth signIn 拒绝原因传递机制。
 *
 * 背景：NextAuth v5 当 signIn callback 返回 false 时，统一重定向到
 * /login?error=AccessDenied，丢失了具体的拒绝原因。用户看到的是泛化错误，
 * 无法判断是触发了哪条守卫（disposable email / 注册限流 / 账号已删除）。
 *
 * 设计：
 *   - 在 signIn callback return false 之前调用 markDenial(reason, context)
 *   - 通过短期 HttpOnly cookie 把 {reason, ref, exp} 传给 /login 页面
 *   - 同时 console.warn 一条结构化日志，含 ref 便于运维 grep
 *   - /login 页面调用 readAndClearDenial() 读取并立即清除（一次性）
 *
 * 为什么用 cookie 而不是 URL query：
 *   - NextAuth v5 的 signIn callback 控制不了重定向 URL（v5 强制 error=AccessDenied）
 *   - cookie 不会出现在 referer header / 浏览器历史中，更适合敏感原因
 *   - 一次性消费避免老错误"粘"在页面上
 *
 * Cookie 名：aster_auth_denial（HttpOnly + Secure + SameSite=Lax + 60s）
 */
import { createHash, randomBytes } from 'node:crypto';

/**
 * 拒绝原因枚举。新增时同步更新：
 *   - messages/{en,zh,de}.json 里的 login.errors.accessDenied.<reason>
 *   - login-content.tsx 的 reasonMessageKey() switch
 */
export type DenialReason =
  | 'signup_rate_limit'   // IP/24h 注册次数超限
  | 'disposable_email'    // 一次性邮箱
  | 'account_deleted'     // 账号已彻底删除（grace 期已过）
  | 'oauth_link_blocked'  // OAuth 链接被守卫拒绝（兜底）
  | 'unknown';            // 未分类（防御性兜底）

export interface DenialPayload {
  reason: DenialReason;
  ref: string;        // 8 字节 hex 关联 ID，便于跨 client/server 排查
  ts: number;         // unix seconds，cookie 写入时间
}

const COOKIE_NAME = 'aster_auth_denial';
const COOKIE_TTL_SECONDS = 60; // 用户从被拒到看到 /login 通常 <5s，60s 足够+容错

/**
 * 生成 8 字节 hex 关联 ID。短到不污染 URL，足以在 24h 日志窗口内唯一。
 */
export function newDenialRef(): string {
  return randomBytes(8).toString('hex');
}

/**
 * 在 server context（signIn callback）里调用：
 *   1. 生成 ref
 *   2. 写 HttpOnly cookie 给浏览器
 *   3. console.warn 一条结构化日志（含 ref + 哈希后的 email/ip）
 *
 * 返回 ref，调用方可选地把它写进自己的日志里。
 *
 * @param ctx 仅用于日志关联，不会写入 cookie。
 */
export async function markDenial(
  reason: DenialReason,
  ctx?: { email?: string | null; ip?: string | null; provider?: string | null }
): Promise<string> {
  const ref = newDenialRef();
  const payload: DenialPayload = {
    reason,
    ref,
    ts: Math.floor(Date.now() / 1000),
  };

  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    store.set(COOKIE_NAME, JSON.stringify(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_TTL_SECONDS,
    });
  } catch (e) {
    // cookies() 在某些上下文不可用（例如 OAuth 回调里的早期阶段）。
    // 此时 fallback：只打日志，用户仍会看到泛化错误。
    console.warn(`[auth-denial] cookies() unavailable, ref=${ref} reason=${reason}: ${e}`);
  }

  // 结构化日志：哈希后的 PII 用于聚合，不可逆。
  console.warn(
    `[auth-denial] ref=${ref} reason=${reason} ` +
      `email_h=${ctx?.email ? hashPii(ctx.email) : '-'} ` +
      `ip_h=${ctx?.ip ? hashPii(ctx.ip) : '-'} ` +
      `provider=${ctx?.provider ?? '-'}`
  );

  return ref;
}

/**
 * 在 /login 页面 server-side 调用：读取 denial cookie。
 * 客户端拿到 reason/ref 后渲染对应的本地化错误。
 *
 * <p>关于"一次性消费"：Next.js 15 的 Server Component 上下文里
 * **不能** 调用 cookies().set() —— 只有 Server Action / Route Handler 才能写
 * cookie。如果在这里尝试 set() 会抛 "Cookies can only be modified in a
 * Server Action or Route Handler." —— 导致整个 read 路径走 catch 返回 null，
 * 用户始终看不到具体原因。
 *
 * <p>所以这里只读不清；cookie 本身 maxAge=60s 会自然过期。用户在 60s 内
 * 刷新会看到同一条 actionable error，这其实比"刷新后回到 generic 错误"
 * 体验更好。60s 后浏览器自动清除。
 *
 * @returns 有效的 payload 或 null（无 cookie / JSON 损坏 / 超 TTL）
 */
export async function readDenial(): Promise<DenialPayload | null> {
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const c = store.get(COOKIE_NAME);
    if (!c?.value) return null;

    const parsed = JSON.parse(c.value) as Partial<DenialPayload>;
    if (
      typeof parsed.reason !== 'string' ||
      typeof parsed.ref !== 'string' ||
      typeof parsed.ts !== 'number'
    ) {
      return null;
    }
    // 防御性：cookie maxAge 已 60s，但万一时钟漂移也兜底
    if (Math.floor(Date.now() / 1000) - parsed.ts > COOKIE_TTL_SECONDS) {
      return null;
    }
    return parsed as DenialPayload;
  } catch {
    return null;
  }
}

/**
 * @deprecated 旧 API：Server Component 里 cookies().set() 会抛异常，导致整条
 * 路径返回 null。请使用 {@link readDenial}。保留导出仅为兼容已发布的 page.tsx，
 * 行为已退化为"只读不清"。
 */
export const readAndClearDenial = readDenial;

function hashPii(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}
