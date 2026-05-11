// 注册限流：同 IP/24h ≤ 3 次成功注册
//
// 为什么是 3 而不是 1：
//   - 家庭/小公司 NAT 出口 IP 共享是常态（一家四口注册 4 个号合法）
//   - 3 是经验阈值：合法用户极少超过；脚本化薅羊毛通常 ≥ 5
//
// 存储：Postgres（不引入 Redis 依赖）
// 隐私：IP 不明文落库，存 SHA256(ip + salt) 前 16 字符
//
// 详见 aster-deploy/docs/pm/07-ai-billing.md "反多重注册" 章节

import { createHash, randomUUID } from 'node:crypto';
import { sql, gte, eq, and } from 'drizzle-orm';
import { db, signupAttempts } from '@/lib/prisma';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function ipSalt(): string {
  return process.env.SIGNUP_IP_SALT || 'aster-signup-ip-default-salt-change-me';
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${ip}|${ipSalt()}`).digest('hex').slice(0, 16);
}

/**
 * 检查 IP 是否超出 24h 注册限额
 * @returns true = 允许；false = 已超限，应拒绝
 */
export async function checkSignupRateLimit(ip: string | null | undefined): Promise<boolean> {
  if (!ip) return true; // 没拿到 IP 不阻止（避免 false negative 影响合法用户）
  const ipHash = hashIp(ip);
  const since = new Date(Date.now() - WINDOW_MS);

  const result = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(signupAttempts)
    .where(
      and(
        eq(signupAttempts.ipHash, ipHash),
        gte(signupAttempts.createdAt, since),
        eq(signupAttempts.succeeded, true)
      )
    );

  const count = result[0]?.c ?? 0;
  return count < MAX_ATTEMPTS;
}

/**
 * 记录一次注册尝试（成功或失败均记录，便于事后分析）
 */
export async function recordSignupAttempt(
  ip: string | null | undefined,
  succeeded: boolean
): Promise<void> {
  if (!ip) return;
  const ipHash = hashIp(ip);
  await db.insert(signupAttempts).values({
    id: randomUUID(),
    ipHash,
    succeeded,
    createdAt: new Date(),
  });
}
