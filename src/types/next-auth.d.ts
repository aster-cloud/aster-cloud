/**
 * Auth.js v5 类型扩展
 */
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      plan?: string;
      trialEndsAt?: string;
      /**
       * Mirrors the DB `users.isAdmin` column. Granted by DBA only
       * (see lib/admin-auth.ts). Exposed on the session so the
       * client-side login redirect + the (dashboard)/layout can branch
       * without a server roundtrip.
       */
      isAdmin?: boolean;
    };
  }

  interface User {
    id: string;
    plan?: string;
    trialEndsAt?: string;
    isAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    plan?: string;
    trialEndsAt?: string;
    isAdmin?: boolean;
  }
}
