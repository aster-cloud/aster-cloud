/**
 * Auth.js v5 配置
 *
 * Auth.js v5 使用 fetch API 而非 Node.js https 模块，
 * 完全兼容 Cloudflare Workers 边缘运行时。
 */
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@/lib/prisma';
import { DrizzleAdapter } from '@/db/adapter';
import { IS_SAAS } from '@/lib/deployment-mode';
import { sendWelcomeEmail } from '@/lib/resend';
import { checkAccountLockout, recordFailedAttempt, resetFailedAttempts } from '@/lib/account-lockout';
import { markDenial } from '@/lib/auth-denial';
import type { NextAuthConfig } from 'next-auth';

// Password utilities
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * Auth.js v5 配置
 * 在 Cloudflare Workers 中，环境变量在运行时可用
 */
const config: NextAuthConfig = {
  // 使用自定义 Drizzle adapter
  adapter: DrizzleAdapter(getDb),

  // OAuth 和 Credentials providers
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // OAuth provider 已验证邮箱所有权 → 允许把新 GitHub 账户 link 到
      // 已有同邮箱 user（避免 Auth.js v5 默认抛 OAuthAccountNotLinked）。
      // 风险：若 OAuth provider 允许未验证邮箱，攻击者可借此接管账户。
      // GitHub 默认要求邮箱验证才暴露给应用，故此处可接受。
      allowDangerousEmailAccountLinking: true,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // 同上。Google 始终只返回已验证邮箱。
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Cold-start safety net: the credentials callback can be the
        // very first server request after a deploy (a brand-new visitor
        // hitting /login). The dashboard layout's bootstrap won't have
        // run yet, so the admin row may not exist + the
        // mustChangePassword column may be missing. Run the bootstrap
        // here too — it's idempotent + advisory-locked, so a parallel
        // call from the dashboard layout is a no-op.
        try {
          const { ensureSchemaApplied, ensureAdminSeeded } = await import(
            '@/lib/db-bootstrap'
          );
          await ensureSchemaApplied();
          // Block on the admin seed too — otherwise the very first
          // login attempt races the in-flight insert and the user
          // lookup below sees no row.
          await ensureAdminSeeded();
        } catch (err) {
          console.warn('[auth] ensureSchemaApplied failed:', err);
        }

        const email = (credentials.email as string).toLowerCase().trim();

        // 检查账户锁定状态
        const lockoutStatus = await checkAccountLockout(email);
        if (lockoutStatus.locked) {
          console.warn(`[Auth] 账户被锁定: ${email}, 解锁时间: ${lockoutStatus.lockedUntil}`);
          throw new Error('ACCOUNT_LOCKED');
        }

        // Find user with password hash
        const db = getDb();
        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
          columns: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
          },
        });

        // User not found or no password set (OAuth-only user)
        if (!user || !user.passwordHash) {
          // Diagnostic logging — minified worker.js swallows the
          // distinction between "no user" / "no password" / "bad
          // password" and surfaces all three as the generic
          // CredentialsSignin error. Logging lets the operator
          // inspect Worker output to tell them apart.
          console.warn(
            `[auth] credentials reject: email=${email} found=${!!user} hasPasswordHash=${!!user?.passwordHash}`,
          );
          await recordFailedAttempt(email);
          return null;
        }

        // Verify password
        const isValidPassword = await verifyPassword(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValidPassword) {
          console.warn(
            `[auth] credentials reject: email=${email} reason=invalid-password`,
          );
          const failedResult = await recordFailedAttempt(email);
          if (failedResult.nowLocked) {
            console.warn(`[Auth] 账户因多次失败被锁定: ${email}`);
            throw new Error('ACCOUNT_LOCKED');
          }
          return null;
        }

        // 登录成功，重置失败计数
        await resetFailedAttempts(email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],

  // 使用 JWT session 策略
  session: {
    strategy: 'jwt',
  },

  // 自定义页面
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/login',
    newUser: '/onboarding',
  },

  // Callbacks
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;

        // Fetch user data including plan
        const db = getDb();
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id!),
          columns: {
            plan: true,
            trialEndsAt: true,
            stripeCustomerId: true,
          },
        });

        if (dbUser) {
          token.plan = dbUser.plan;
          token.trialEndsAt = dbUser.trialEndsAt?.toISOString();
        }
      }

      // Refresh plan data periodically
      if (trigger === 'update' && token.id) {
        const db = getDb();
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, token.id as string),
          columns: { plan: true, trialEndsAt: true },
        });

        if (dbUser) {
          token.plan = dbUser.plan;
          token.trialEndsAt = dbUser.trialEndsAt?.toISOString();
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.plan = token.plan as string;
        session.user.trialEndsAt = token.trialEndsAt as string | undefined;
      }
      return session;
    },

    async signIn({ user, account, profile: _profile }) {
      const db = getDb();

      // Credentials provider: 已在 authorize() 里查过 user 并验证密码。
      // 这里仅复查"是否处于墓碑"——如是，触发 grace 期内复活。
      if (account?.provider === 'credentials') {
        if (user.id) {
          const row = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, user.id!),
            columns: { id: true, email: true, deletedAt: true, purgePendingUntil: true, emailNormalized: true },
          });
          if (row?.deletedAt) {
            const stillInGrace = row.purgePendingUntil && row.purgePendingUntil > new Date();
            if (stillInGrace && row.email) {
              const { normalizeEmail } = await import('@/lib/email-normalize');
              const { reactivateUser } = await import('@/lib/user-lifecycle');
              await reactivateUser(db, row.id, normalizeEmail(row.email));
              console.warn(`[auth] reactivated tombstoned user via credentials: ${row.id}`);
              return true;
            }
            // 已过 grace 或异常状态 → 拒绝（authorize 应该没让密码通过，但兜底）
            await markDenial('account_deleted', {
              email: row.email ?? user.email,
              provider: 'credentials',
            });
            return false;
          }
        }
        return true;
      }

      if (account?.provider) {
        const existingAccount = await db.query.accounts.findFirst({
          where: (accounts, { and, eq }) => and(
            eq(accounts.provider, account.provider),
            eq(accounts.providerAccountId, account.providerAccountId)
          ),
        });

        if (existingAccount) {
          // 已绑 account 的同时还要查 owning user 是否被软删
          const owner = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, existingAccount.userId),
            columns: { id: true, email: true, deletedAt: true, purgePendingUntil: true },
          });
          if (owner?.deletedAt) {
            const stillInGrace = owner.purgePendingUntil && owner.purgePendingUntil > new Date();
            if (stillInGrace && owner.email) {
              const { normalizeEmail } = await import('@/lib/email-normalize');
              const { reactivateUser } = await import('@/lib/user-lifecycle');
              await reactivateUser(db, owner.id, normalizeEmail(owner.email));
              console.warn(`[auth] reactivated tombstoned user via OAuth: ${owner.id}`);
              return true;
            }
            await markDenial('account_deleted', {
              email: owner.email ?? user.email,
              provider: account.provider,
            });
            return false;
          }
          return true;
        }

        // 反多重注册 + 一次性邮箱 + IP 限流
        if (user.email) {
          const [
            { normalizeEmail },
            { isDisposableEmail },
            { checkSignupRateLimit, recordSignupAttempt },
            { findTombstonedUserByNormalizedEmail, reactivateUser },
          ] = await Promise.all([
            import('@/lib/email-normalize'),
            import('@/lib/email-disposable'),
            import('@/lib/signup-rate-limit'),
            import('@/lib/user-lifecycle'),
          ]);

          // 取请求 IP（仅在 signIn 触发的请求上下文中可用）
          let clientIp: string | null = null;
          try {
            const { headers } = await import('next/headers');
            const h = await headers();
            clientIp =
              h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
              h.get('x-real-ip') ||
              h.get('cf-connecting-ip') ||
              null;
          } catch {
            // headers() 在某些上下文不可用，不影响其他守卫
          }

          if (isDisposableEmail(user.email)) {
            await recordSignupAttempt(clientIp, false);
            await markDenial('disposable_email', {
              email: user.email,
              ip: clientIp,
              provider: account.provider,
            });
            return false;
          }

          const normalized = normalizeEmail(user.email);

          // 1) 优先看 grace 期内的墓碑用户 → 复活（user.id 保持不变，所有
          //    业务数据原路恢复，新 OAuth account 由 adapter 后续 linkAccount）
          const tombstoned = await findTombstonedUserByNormalizedEmail(db, normalized);
          if (tombstoned) {
            await reactivateUser(db, tombstoned.id, normalized);
            console.warn(`[auth] reactivated tombstoned user via OAuth (new provider): ${tombstoned.id}`);
            await recordSignupAttempt(clientIp, true);
            return true;
          }

          // 2) 同 normalized email 的活用户：允许 adapter linkAccount
          //    （getUserByEmail 在 adapter 里已 fallback 到 emailNormalized）
          const dup = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.emailNormalized, normalized),
            columns: { id: true },
          });
          if (dup) {
            await recordSignupAttempt(clientIp, true);
            return true;
          }

          const allowed = await checkSignupRateLimit(clientIp);
          if (!allowed) {
            await recordSignupAttempt(clientIp, false);
            await markDenial('signup_rate_limit', {
              email: user.email,
              ip: clientIp,
              provider: account.provider,
            });
            return false;
          }

          // 通过所有守卫；signIn 返回 true 后由 createUser event 记录成功
          await recordSignupAttempt(clientIp, true);
        }
      }

      return true;
    },
  },

  // Events
  events: {
    async createUser({ user }) {
      // SaaS-only：trial 期限、欢迎邮件、risk-tier policy 这一整套都是
      // SaaS 计费模型派生的。On-prem 客户用 enterprise license 决定
      // 权限，新用户由 admin 邀请进入；无 trial 概念。
      if (!IS_SAAS) {
        return;
      }

      const db = getDb();

      // 读 adapter 已经计算好的 riskTier，按 policy 给 trial 天数
      // tier ≥ 2 直接 free 计划（无 trial），阻止"注册→自删→重注"白嫖循环
      const row = await db.query.users.findFirst({
        where: eq(users.id, user.id!),
        columns: { riskTier: true },
      });
      const { policyForTier } = await import('@/lib/risk-tier');
      // 默认 trusted（schema default = 0）
      const tier = (row?.riskTier ?? 0) as 0 | 1 | 2 | 3 | 4;
      const policy = policyForTier(tier);

      const envTrialDays = parseInt(process.env.NEXT_PUBLIC_TRIAL_DAYS || '14', 10);
      // policy.trialDays 与 env 取较小值（env 是产品调节，policy 是风控护栏）
      const trialDays = Math.min(envTrialDays, policy.trialDays);

      if (trialDays > 0) {
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);
        await db.update(users)
          .set({
            plan: 'trial',
            trialStartedAt: new Date(),
            trialEndsAt,
          })
          .where(eq(users.id, user.id!));
      } else {
        // 无 trial，保持 schema 默认 plan=free
        console.warn(`[auth.createUser] user ${user.id} starts on free plan (riskTier=${tier})`);
      }

      // Send welcome email
      if (user.email && user.name) {
        await sendWelcomeEmail(user.email, user.name);
      }
    },
  },

  trustHost: true,

  // Auth.js v5 strictly reads process.env.AUTH_SECRET; the CF Worker
  // secret is named NEXTAUTH_SECRET (legacy v4 name). Pass it through
  // explicitly so v5 picks up either name. Same for AUTH_URL.
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};

// 导出 auth 函数和 handlers
export const { handlers, auth, signIn, signOut } = NextAuth(config);

// 兼容性导出 - getSession 现在使用 auth()
export async function getSession() {
  return auth();
}

// Helper to get current user
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    with: {
      teamMembers: {
        with: {
          team: true,
        },
      },
    },
  });

  return user;
}

// Helper to require authentication
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

// 类型扩展定义在 src/types/next-auth.d.ts
