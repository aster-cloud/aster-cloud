import { NextResponse } from 'next/server';

/**
 * 调试端点：检查环境变量
 * 警告：仅用于调试，生产环境应删除
 */
export async function GET() {
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    authVersion: 'Auth.js v5',
    environment: {
      hasGithubClientId: !!process.env.GITHUB_CLIENT_ID,
      hasGithubClientSecret: !!process.env.GITHUB_CLIENT_SECRET,
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasAuthSecret: !!process.env.AUTH_SECRET || !!process.env.NEXTAUTH_SECRET,
      authUrl: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
      nodeEnv: process.env.NODE_ENV,
      // 显示前8个字符来验证值存在（不暴露完整密钥）
      githubIdPrefix: process.env.GITHUB_CLIENT_ID?.substring(0, 8) || 'NOT_SET',
      githubSecretPrefix: process.env.GITHUB_CLIENT_SECRET?.substring(0, 4) || 'NOT_SET',
    },
    providers: ['github', 'google', 'credentials'].filter(p => {
      if (p === 'github') return process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET;
      if (p === 'google') return process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
      return true;
    }),
  });
}
