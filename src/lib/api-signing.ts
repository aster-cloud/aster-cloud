/**
 * HMAC-SHA256 请求签名
 *
 * 为发往 aster-api 的请求添加签名头，与 RequestSignatureFilter 协议兼容。
 * canonical 格式: method|path|query|timestamp|nonce|bodyHash
 */

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface SignedHeaders {
  'X-Aster-Timestamp': string;
  'X-Aster-Nonce': string;
  'X-Aster-Signature': string;
}

export async function signRequest(
  method: string,
  url: string,
  body: string | undefined
): Promise<SignedHeaders> {
  const secret = process.env.ASTER_HMAC_SECRET;
  if (!secret) {
    throw new Error('ASTER_HMAC_SECRET not configured');
  }

  const parsed = new URL(url);
  const path = parsed.pathname;
  const query = parsed.search ? parsed.search.slice(1) : '';

  const timestamp = Date.now().toString();
  const nonce = generateNonce();

  const encoder = new TextEncoder();
  const bodyBytes = body ? encoder.encode(body) : new Uint8Array(0);
  const bodyHash = await sha256Hex(bodyBytes.buffer as ArrayBuffer);

  const canonical = `${method}|${path}|${query}|${timestamp}|${nonce}|${bodyHash}`;
  const signature = await hmacSha256(secret, canonical);

  return {
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    'X-Aster-Signature': signature,
  };
}

export interface InternalCallerHeaders {
  'X-Internal-Caller': string;
  'X-Aster-Timestamp': string;
  'X-Internal-Signature': string;
}

/**
 * 为调用 aster-api 的"内部专用"路径生成签名头（如 /evaluate-source）
 *
 * 协议：HMAC-SHA256(`POST\n${path}\n${unixSeconds}`)，密钥 = ASTER_PLAN_GATE_HMAC_KEY
 * （与 PlanCacheResource / ApiKeyCacheResource 同一套）
 *
 * 注意：与 signRequest 不同——不带 body hash / nonce，是更轻量的"内部 caller 标识"，
 * 由 InternalCallerFilter 在 aster-api 端校验。
 */
export async function signInternalCallerHeaders(
  method: string,
  path: string
): Promise<InternalCallerHeaders> {
  const secret = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (!secret) {
    throw new Error('ASTER_PLAN_GATE_HMAC_KEY not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${method}\n${path}\n${timestamp}`;
  const signature = await hmacSha256(secret, message);
  return {
    'X-Internal-Caller': 'cloud-bff',
    'X-Aster-Timestamp': timestamp,
    'X-Internal-Signature': signature,
  };
}
