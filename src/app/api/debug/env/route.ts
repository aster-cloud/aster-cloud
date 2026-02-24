import { NextResponse } from 'next/server';

export async function GET(_request: Request) {

  let cfInfo: Record<string, unknown> = {};
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    cfInfo = {
      colo: (context.cf as Record<string, unknown>)?.colo,
      country: (context.cf as Record<string, unknown>)?.country,
      city: (context.cf as Record<string, unknown>)?.city,
      region: (context.cf as Record<string, unknown>)?.region,
    };
  } catch {
    cfInfo = { error: 'Not in Cloudflare environment' };
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    authVersion: 'Auth.js v5',
    cloudflare: cfInfo,
    environment: {
      hasGithubClientId: !!process.env.GITHUB_CLIENT_ID,
      hasGithubClientSecret: !!process.env.GITHUB_CLIENT_SECRET,
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasAuthSecret: !!process.env.AUTH_SECRET || !!process.env.NEXTAUTH_SECRET,
      authUrl: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
      nodeEnv: process.env.NODE_ENV,
    },
    providers: ['github', 'google', 'credentials'].filter(p => {
      if (p === 'github') return process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET;
      if (p === 'google') return process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
      return true;
    }),
  });
}
