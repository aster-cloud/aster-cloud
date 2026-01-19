/**
 * Drizzle 适配器 for NextAuth
 * 基于 @auth/drizzle-adapter 的实现，但直接使用我们的 schema
 *
 * 支持两种模式：
 * 1. 静态 db 实例（本地开发）
 * 2. 动态 db 获取函数（Cloudflare Workers，每次请求获取新连接）
 */
import { and, eq } from 'drizzle-orm';
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser, VerificationToken } from 'next-auth/adapters';
import type { Database } from './index';
import { users, accounts, sessions, verificationTokens } from './schema';

// 支持传入 db 实例或获取 db 的函数
type DbOrGetter = Database | (() => Database);

function resolveDb(dbOrGetter: DbOrGetter): Database {
  return typeof dbOrGetter === 'function' ? dbOrGetter() : dbOrGetter;
}

export function DrizzleAdapter(dbOrGetter: DbOrGetter): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, 'id'>) {
      const db = resolveDb(dbOrGetter);
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(users).values({
        id,
        email: data.email,
        emailVerified: data.emailVerified,
        name: data.name,
        image: data.image,
        createdAt: now,
        updatedAt: now,
      });

      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!user) throw new Error('User not found after creation');
      return {
        id: user.id,
        email: user.email!,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
      };
    },

    async getUser(id: string) {
      const db = resolveDb(dbOrGetter);
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!user) return null;
      return {
        id: user.id,
        email: user.email!,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
      };
    },

    async getUserByEmail(email: string) {
      const db = resolveDb(dbOrGetter);
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) return null;
      return {
        id: user.id,
        email: user.email!,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
      };
    },

    async getUserByAccount({ providerAccountId, provider }: Pick<AdapterAccount, 'provider' | 'providerAccountId'>) {
      const db = resolveDb(dbOrGetter);
      const account = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.providerAccountId, providerAccountId),
          eq(accounts.provider, provider)
        ),
        with: {
          user: true,
        },
      });

      if (!account?.user) return null;
      return {
        id: account.user.id,
        email: account.user.email!,
        emailVerified: account.user.emailVerified,
        name: account.user.name,
        image: account.user.image,
      };
    },

    async updateUser(data: Partial<AdapterUser> & Pick<AdapterUser, 'id'>) {
      const db = resolveDb(dbOrGetter);
      if (!data.id) throw new Error('User ID is required');

      await db.update(users).set({
        name: data.name,
        email: data.email,
        emailVerified: data.emailVerified,
        image: data.image,
        updatedAt: new Date(),
      }).where(eq(users.id, data.id));

      const user = await db.query.users.findFirst({
        where: eq(users.id, data.id),
      });

      if (!user) throw new Error('User not found');
      return {
        id: user.id,
        email: user.email!,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
      };
    },

    async deleteUser(userId: string) {
      const db = resolveDb(dbOrGetter);
      await db.delete(users).where(eq(users.id, userId));
    },

    async linkAccount(data: AdapterAccount) {
      const db = resolveDb(dbOrGetter);
      await db.insert(accounts).values({
        id: crypto.randomUUID(),
        userId: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        refresh_token: data.refresh_token,
        access_token: data.access_token,
        expires_at: data.expires_at,
        token_type: data.token_type,
        scope: data.scope,
        id_token: data.id_token,
        session_state: data.session_state as string | null,
      });
    },

    async unlinkAccount({ providerAccountId, provider }: Pick<AdapterAccount, 'provider' | 'providerAccountId'>) {
      const db = resolveDb(dbOrGetter);
      await db.delete(accounts).where(
        and(
          eq(accounts.providerAccountId, providerAccountId),
          eq(accounts.provider, provider)
        )
      );
    },

    async createSession(data: { sessionToken: string; userId: string; expires: Date }) {
      const db = resolveDb(dbOrGetter);
      await db.insert(sessions).values({
        id: crypto.randomUUID(),
        sessionToken: data.sessionToken,
        userId: data.userId,
        expires: data.expires,
      });

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.sessionToken, data.sessionToken),
      });

      if (!session) throw new Error('Session not found after creation');
      return {
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires,
      };
    },

    async getSessionAndUser(sessionToken: string) {
      const db = resolveDb(dbOrGetter);
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.sessionToken, sessionToken),
        with: {
          user: true,
        },
      });

      if (!session?.user) return null;

      return {
        session: {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        },
        user: {
          id: session.user.id,
          email: session.user.email!,
          emailVerified: session.user.emailVerified,
          name: session.user.name,
          image: session.user.image,
        },
      };
    },

    async updateSession(data: Partial<AdapterSession> & Pick<AdapterSession, 'sessionToken'>) {
      const db = resolveDb(dbOrGetter);
      await db.update(sessions).set({
        expires: data.expires,
      }).where(eq(sessions.sessionToken, data.sessionToken));

      const session = await db.query.sessions.findFirst({
        where: eq(sessions.sessionToken, data.sessionToken),
      });

      if (!session) return null;
      return {
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires,
      };
    },

    async deleteSession(sessionToken: string) {
      const db = resolveDb(dbOrGetter);
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },

    async createVerificationToken(data: VerificationToken) {
      const db = resolveDb(dbOrGetter);
      await db.insert(verificationTokens).values({
        identifier: data.identifier,
        token: data.token,
        expires: data.expires,
      });

      const token = await db.query.verificationTokens.findFirst({
        where: and(
          eq(verificationTokens.identifier, data.identifier),
          eq(verificationTokens.token, data.token)
        ),
      });

      if (!token) throw new Error('Verification token not found after creation');
      return {
        identifier: token.identifier,
        token: token.token,
        expires: token.expires,
      };
    },

    async useVerificationToken({ identifier, token }: { identifier: string; token: string }) {
      const db = resolveDb(dbOrGetter);
      const verificationToken = await db.query.verificationTokens.findFirst({
        where: and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, token)
        ),
      });

      if (!verificationToken) return null;

      await db.delete(verificationTokens).where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, token)
        )
      );

      return {
        identifier: verificationToken.identifier,
        token: verificationToken.token,
        expires: verificationToken.expires,
      };
    },
  };
}
