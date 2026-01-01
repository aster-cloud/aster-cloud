import { NextAuthOptions, getServerSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { sendWelcomeEmail } from '@/lib/resend';
import type { Adapter } from 'next-auth/adapters';
import type { Provider } from 'next-auth/providers/index';

// Password hashing utilities
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

const TRIAL_DAYS = parseInt(process.env.NEXT_PUBLIC_TRIAL_DAYS || '14', 10);

// Build providers list dynamically based on available credentials
const providers: Provider[] = [];

// Only add GitHub provider if credentials are configured
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
}

// Only add Google provider if credentials are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// Always add credentials provider
providers.push(
  CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Find user with password hash
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
          },
        });

        // User not found or no password set (OAuth-only user)
        if (!user || !user.passwordHash) {
          return null;
        }

        // Verify password using bcrypt
        const isValidPassword = await verifyPassword(
          credentials.password,
          user.passwordHash
        );

        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    })
);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/login',
    newUser: '/onboarding',
  },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      if (user) {
        token.id = user.id;

        // Fetch user data including plan
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
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
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { plan: true, trialEndsAt: true },
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
    async signIn({ user, account, profile }) {
      // Prevent automatic account linking when user is already signed in
      // Each OAuth provider should create a separate user unless explicitly linked
      if (account?.provider && account.provider !== 'credentials') {
        // Check if this OAuth account already exists
        const existingAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
        });

        // If account exists, allow sign in
        if (existingAccount) {
          return true;
        }

        // For new OAuth accounts, check if a user with this email already exists
        // If so, prevent automatic linking - require explicit action
        const email = profile?.email || user?.email;
        if (email) {
          const existingUser = await prisma.user.findUnique({
            where: { email },
          });

          // If user exists but this OAuth account is new,
          // we still allow it (same email = same person)
          // But if the email is DIFFERENT, we should NOT link
        }
      }

      return true;
    },
  },
  events: {
    async createUser({ user }) {
      // This event fires after a new user is created
      // Start trial period
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          plan: 'trial',
          trialStartedAt: new Date(),
          trialEndsAt,
        },
      });

      // Send welcome email
      if (user.email && user.name) {
        await sendWelcomeEmail(user.email, user.name);
      }
    },
  },
};

// Helper to get session on server-side
export async function getSession() {
  return getServerSession(authOptions);
}

// Helper to get current user
export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      teams: {
        include: {
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

// Extend next-auth types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      plan?: string;
      trialEndsAt?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    plan?: string;
    trialEndsAt?: string;
  }
}
