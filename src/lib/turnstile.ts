/**
 * Cloudflare Turnstile CAPTCHA 验证服务
 *
 * 用于防止恶意注册和自动化攻击。
 * 服务端验证 Turnstile token 的有效性。
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

export interface TurnstileVerifyResult {
  success: boolean;
  /** 错误码列表 */
  errorCodes: string[];
  /** 验证时间 */
  challengeTs?: string;
  /** 验证来源主机 */
  hostname?: string;
  /** 操作标识 */
  action?: string;
  /** 自定义数据 */
  cdata?: string;
}

/**
 * 验证 Turnstile token
 *
 * @param token 客户端提交的 Turnstile token
 * @param remoteIp 可选的客户端 IP 地址
 * @returns 验证结果
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  // 开发环境跳过验证
  if (process.env.NODE_ENV === 'development' && !TURNSTILE_SECRET_KEY) {
    console.warn('[Turnstile] 开发环境跳过验证（未配置 TURNSTILE_SECRET_KEY）');
    return { success: true, errorCodes: [] };
  }

  if (!TURNSTILE_SECRET_KEY) {
    console.error('[Turnstile] TURNSTILE_SECRET_KEY 未配置');
    return { success: false, errorCodes: ['missing-secret-key'] };
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      console.error('[Turnstile] API 响应错误:', response.status);
      return { success: false, errorCodes: ['api-error'] };
    }

    const result = await response.json();

    return {
      success: result.success === true,
      errorCodes: result['error-codes'] || [],
      challengeTs: result.challenge_ts,
      hostname: result.hostname,
      action: result.action,
      cdata: result.cdata,
    };
  } catch (error) {
    console.error('[Turnstile] 验证失败:', error);
    return { success: false, errorCodes: ['network-error'] };
  }
}

/**
 * 获取 Turnstile Site Key（用于客户端）
 */
export function getTurnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
}

/**
 * 检查 Turnstile 是否已配置
 */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}
