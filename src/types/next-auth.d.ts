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
    };
  }

  interface User {
    id: string;
    plan?: string;
    trialEndsAt?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    plan?: string;
    trialEndsAt?: string;
  }
}
