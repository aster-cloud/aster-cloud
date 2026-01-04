/**
 * 登录预验证 API
 *
 * 在调用 NextAuth 登录前，验证：
 * 1. Turnstile CAPTCHA
 * 2. 速率限制
 * 3. 账户锁定状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyTurnstileToken, isTurnstileConfigured } from '@/lib/turnstile';
import { checkRateLimit, RateLimitPresets, getClientIp, getRateLimitHeaders } from '@/lib/rate-limit';
import { checkAccountLockout } from '@/lib/account-lockout';

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  // 1. 速率限制检查
  const rateLimitResult = checkRateLimit(`login:${clientIp}`, RateLimitPresets.LOGIN);
  const rateLimitHeaders = getRateLimitHeaders(rateLimitResult, RateLimitPresets.LOGIN);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many login attempts. Please try again later.',
        code: 'RATE_LIMITED',
        retryAfter: rateLimitResult.retryAfterSeconds,
      },
      {
        status: 429,
        headers: rateLimitHeaders,
      }
    );
  }

  try {
    const body = await request.json();
    const { email, turnstileToken } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required', code: 'MISSING_EMAIL' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // 2. Turnstile 验证（如果已配置）
    if (isTurnstileConfigured()) {
      if (!turnstileToken) {
        return NextResponse.json(
          { success: false, error: 'CAPTCHA verification required', code: 'MISSING_CAPTCHA' },
          { status: 400, headers: rateLimitHeaders }
        );
      }

      const turnstileResult = await verifyTurnstileToken(turnstileToken, clientIp);
      if (!turnstileResult.success) {
        console.warn(`[VerifyLogin] Turnstile 验证失败: ${email}, IP: ${clientIp}, 错误: ${turnstileResult.errorCodes.join(', ')}`);
        return NextResponse.json(
          { success: false, error: 'CAPTCHA verification failed', code: 'CAPTCHA_FAILED' },
          { status: 400, headers: rateLimitHeaders }
        );
      }
    }

    // 3. 账户锁定状态检查
    const lockoutStatus = await checkAccountLockout(email);
    if (lockoutStatus.locked) {
      return NextResponse.json(
        {
          success: false,
          error: `Account is temporarily locked. Please try again in ${lockoutStatus.lockoutSecondsRemaining} seconds.`,
          code: 'ACCOUNT_LOCKED',
          lockedUntil: lockoutStatus.lockedUntil?.toISOString(),
          retryAfter: lockoutStatus.lockoutSecondsRemaining,
        },
        { status: 403, headers: rateLimitHeaders }
      );
    }

    // 所有检查通过
    return NextResponse.json(
      {
        success: true,
        remainingAttempts: lockoutStatus.remainingAttempts,
      },
      { status: 200, headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error('[VerifyLogin] 验证失败:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed', code: 'INTERNAL_ERROR' },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
