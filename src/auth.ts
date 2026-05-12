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
import { sendWelcomeEmail } from '@/lib/resend';
import { checkAccountLockout, recordFailedAttempt, resetFailedAttempts } from '@/lib/account-lockout';
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
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
          await recordFailedAttempt(email);
          return null;
        }

        // Verify password
        const isValidPassword = await verifyPassword(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValidPassword) {
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
      if (account?.provider && account.provider !== 'credentials') {
        const db = getDb();
        const existingAccount = await db.query.accounts.findFirst({
          where: (accounts, { and, eq }) => and(
            eq(accounts.provider, account.provider),
            eq(accounts.providerAccountId, account.providerAccountId)
          ),
        });

        if (existingAccount) {
          return true;
        }

        // 反多重注册 + 一次性邮箱 + IP 限流
        if (user.email) {
          const [
            { normalizeEmail },
            { isDisposableEmail },
            { checkSignupRateLimit, recordSignupAttempt },
          ] = await Promise.all([
            import('@/lib/email-normalize'),
            import('@/lib/email-disposable'),
            import('@/lib/signup-rate-limit'),
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
            return false;
          }

          const normalized = normalizeEmail(user.email);
          const dup = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.emailNormalized, normalized),
            columns: { id: true },
          });
          if (dup) {
            await recordSignupAttempt(clientIp, false);
            return false;
          }

          const allowed = await checkSignupRateLimit(clientIp);
          if (!allowed) {
            await recordSignupAttempt(clientIp, false);
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
      // Start trial period for new users
      const TRIAL_DAYS = parseInt(process.env.NEXT_PUBLIC_TRIAL_DAYS || '14', 10);
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

      const db = getDb();
      await db.update(users)
        .set({
          plan: 'trial',
          trialStartedAt: new Date(),
          trialEndsAt,
        })
        .where(eq(users.id, user.id!));

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
