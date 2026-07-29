/**
 * HMAC-SHA256 请求签名
 *
 * 为发往 aster-api 的请求添加签名头，与 RequestSignatureFilter 协议兼容。
 * canonical 格式: method|path|query|timestamp|nonce|bodyHash
 */

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256(secret: string, data: string): Promise<string> {
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

/**
 * 用真正的密码学原语 crypto.subtle.verify('HMAC', ...) 验证签名——WebCrypto 的 verify 是
 * 常数时间实现（不像手写 hex 字符串比对会因长度早退/字符逐比泄时序）。
 * secret=HMAC 密钥；data=canonical 串；hexSignature=收到的 X-Internal-Signature（hex）。
 * hex 非法/长度不符直接返回 false（在做 verify 前，无 key 相关时序泄露）。
 */
export async function hmacVerify(secret: string, data: string, hexSignature: string): Promise<boolean> {
  // hex → bytes（长度须为偶数且全 hex；否则签名不可能对，直接 false）。
  if (hexSignature.length === 0 || hexSignature.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hexSignature)) {
    return false;
  }
  const sigBytes = new Uint8Array(hexSignature.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    sigBytes[i] = parseInt(hexSignature.slice(i * 2, i * 2 + 2), 16);
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  // ★crypto.subtle.verify 是常数时间的密码学验证原语（Codex 整支审要求）。
  return crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, encoder.encode(data));
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
  'X-Aster-Nonce': string;
  'X-Internal-Signature': string;
}

/**
 * 为调用 aster-api 的"内部专用"路径生成签名头（如 /evaluate-source、/api/v1/ai/*）
 *
 * 红队 P0-C 加固：canonical 从原来的 `method\npath\nts`（只签方法+路径+时间戳，
 * 5min 窗口内可改 body/tenant/role + 可重放）扩展为 **7 行**：
 * <pre>
 *   method \n path \n ts(秒) \n nonce \n bodySha256(hex) \n tenant \n role
 * </pre>
 * 与 aster-api {@code InternalCallerFilter} 的 canonical 逐字节一致。密钥同 plan-gate
 * （ASTER_PLAN_GATE_HMAC_KEY = 后端 aster.plan-gate.hmac-key）。timestamp 用 unix **秒**。
 * nonce 每次唯一（后端 UsedNonce 原子去重，重放即拒）。
 *
 * @param method   HTTP 方法（须与实际请求一致）
 * @param path     归一化路径（须与后端 PathNormalizer 结果一致）
 * @param body     请求体字符串（GET/无 body 传 undefined/''，两端都按空字节 sha256）
 * @param tenantId 随请求发送的 X-Tenant-Id（不发则传 ''，两端一致）
 * @param role     随请求发送的 X-User-Role（内部调用通常不发，传 ''）
 */
export async function signInternalCallerHeaders(
  method: string,
  path: string,
  body?: string,
  tenantId?: string,
  role?: string
): Promise<InternalCallerHeaders> {
  const secret = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (!secret) {
    throw new Error('ASTER_PLAN_GATE_HMAC_KEY not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const encoder = new TextEncoder();
  const bodyBytes = body ? encoder.encode(body) : new Uint8Array(0);
  const bodyHash = await sha256Hex(bodyBytes.buffer as ArrayBuffer);
  const tenant = tenantId ?? '';
  const roleStr = role ?? '';

  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}\n${tenant}\n${roleStr}`;
  const signature = await hmacSha256(secret, canonical);
  return {
    'X-Internal-Caller': 'cloud-bff',
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    'X-Internal-Signature': signature,
  };
}

export interface LexiconAdminHeaders {
  'X-Aster-Timestamp': string;
  'X-Aster-Nonce': string;
  'X-Internal-Signature': string;
}

/**
 * 为 aster-api 的 LexiconAdminResource 端点（/api/v1/admin/lexicons/{id}/disable|enable）
 * 生成签名头。
 *
 * 后端 verifyHmac 的 canonical 是 **8 行换行拼接**（与 signRequest 的管道格式、
 * signInternalCallerHeaders 的 3 行格式都不同）：
 * <pre>
 *   method + "\n"
 *   path + "\n"
 *   timestamp(秒) + "\n"
 *   nonce + "\n"
 *   content-type-or-empty + "\n"
 *   content-length + "\n"
 *   body-sha256-hex-or-empty + "\n"
 *   sanitized-filename-or-empty
 * </pre>
 * disable/enable 无 body、无 filename → 第 5/7/8 行为空、第 6 行为 0。
 * 密钥同 plan-gate（ASTER_PLAN_GATE_HMAC_KEY = 后端 aster.plan-gate.hmac-key）。
 * timestamp 用 unix **秒**（后端按秒比对 5min 时钟偏移）。nonce 必须每次唯一
 * （后端原子预约，重放即拒）。
 */
export async function signLexiconAdminHeaders(
  method: string,
  path: string
): Promise<LexiconAdminHeaders> {
  const secret = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (!secret) {
    throw new Error('ASTER_PLAN_GATE_HMAC_KEY not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  // 8 行 canonical，无 body/filename：ct=空, len=0, sha=空, fn=空。
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n\n0\n\n`;
  const signature = await hmacSha256(secret, canonical);
  return {
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    'X-Internal-Signature': signature,
  };
}

/**
 * 为 aster-api 的 ByokAllowlistAdminResource（/api/v1/admin/byok-allowlist）生成签名头。
 *
 * ★与 lexicon admin 不同：byok 端点用 {@code AdminHmacVerifier}，canonical 是 **7 段含 body
 * sha256**：`method\npath\nts\nnonce\ncontentType\ncontentLength\nbodySha256`。必须与
 * AdminHmacVerifier.verify 逐字节一致，否则验签失败。GET 无 body（ct=空/len=0/sha=空）；
 * POST 传 JSON body（ct=application/json/len=字节数/sha=body sha256hex）。
 *
 * @param body POST 的原始 body 文本（GET 传 null / 空）
 */
export async function signByokAllowlistHeaders(
  method: string,
  path: string,
  body: string | null = null,
): Promise<LexiconAdminHeaders> {
  const secret = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (!secret) {
    throw new Error('ASTER_PLAN_GATE_HMAC_KEY not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  let contentType = '';
  let contentLength = 0;
  let bodySha = '';
  if (body != null && body.length > 0) {
    const bytes = new TextEncoder().encode(body);
    contentType = 'application/json';
    contentLength = bytes.length;
    bodySha = await sha256Hex(bytes.buffer as ArrayBuffer);
  }
  // AdminHmacVerifier canonical：method\npath\nts\nnonce\ncontentType\ncontentLength\nbodySha256
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${contentType}\n${contentLength}\n${bodySha}`;
  const signature = await hmacSha256(secret, canonical);
  return {
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    'X-Internal-Signature': signature,
  };
}

/**
 * runner-launcher 内部调用签名（独立 HMAC key，密钥隔离——launcher 是新 TCB 成员，
 * 攻破不牵连 aster-api plan-gate key）。逐字节复用 signInternalCallerHeaders 的 7 行
 * canonical（method\npath\nts\nnonce\nbodyHash\ntenant\nrole），仅两处不同：key 与 caller 标识。
 */
export async function signRunnerLauncherHeaders(
  method: string, path: string, body: string, tenantId: string, role: string,
): Promise<Record<string, string>> {
  const key = process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY;
  if (!key) throw new Error('ASTER_RUNNER_LAUNCHER_HMAC_KEY 未配置');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  // ★sha256Hex 签名是 (data: ArrayBuffer)——须先 TextEncoder 编码 body 再取 .buffer
  //   （逐字对齐 signInternalCallerHeaders 的 body 处理，api-signing.ts:113-115）。
  const encoder = new TextEncoder();
  const bodyBytes = body ? encoder.encode(body) : new Uint8Array(0);
  const bodyHash = await sha256Hex(bodyBytes.buffer as ArrayBuffer);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}\n${tenantId}\n${role}`;
  const signature = await hmacSha256(key, canonical);
  return {
    'X-Internal-Caller': 'cloud-runner-launcher',
    'X-Aster-Timestamp': timestamp,
    'X-Aster-Nonce': nonce,
    // ★tenant/role 也放 header——canonical 含 tenant/role，接收端（stub/launcher）须能重建同一
    //   canonical 才能验签。不放 header 则接收端不知 role→永远验签失败（Codex 抓的契约缺口）。
    'X-Aster-Tenant': tenantId,
    'X-Aster-Role': role,
    'X-Internal-Signature': signature,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 入站验签：/api/internal/* 的**单一实现**（2026-07-29 审计修复）
// ─────────────────────────────────────────────────────────────────────────────

/** 入站验签结果。`ok: false` 时 `reason` 用于返回体与日志，不含任何密钥材料。 */
export type InternalVerifyResult =
  | { ok: true; usedLegacyCanonical: boolean }
  | { ok: false; reason: string };

/** 时间戳窗口（秒）。与 aster-api 侧 InternalCallerFilter 的 300s 保持一致。 */
const INTERNAL_TS_WINDOW_SEC = 300;

/**
 * 校验 aster-api → aster-cloud 的内部调用签名。
 *
 * <h3>为什么需要它</h3>
 *
 * 此前 8 个 `/api/internal/*` 路由各自手写验签，canonical 一律是
 * `method\npath\ntimestamp` —— **不绑定 body、不绑定 query、无 nonce**。
 * 后果：攻击者拿到任意一次签名（代理日志、SSRF、镜像流量），可在 300s 窗口内
 * **换掉 body 无限重放**。打 `/api/internal/api/usage` 即可为任意 userId 伪造
 * 用量记录、篡改计费；打 `/api/internal/apikey/verify` 可枚举 key。
 *
 * 与之对照，**出站**签名器（signInternalCallerHeaders）早已加固为 7 字段
 * canonical（含 nonce + bodyHash + tenant + role）——加固只做了发送侧，
 * 接收侧从未同步。本函数补齐接收侧。
 *
 * <h3>为什么支持双接受（migration window）</h3>
 *
 * aster-api 侧同一时刻仍在用旧的 3 字段签名（5 处调用点），且**不发送 nonce 头**。
 * 若接收侧直接只认新格式，跨服务认证会在部署瞬间全断。故本函数按序尝试：
 *
 *   1. **v2**（首选）：`method\npath\ntimestamp\nnonce\nbodyHash` —— 绑定 body 与 nonce；
 *   2. **v1**（兼容）：`method\npath\ntimestamp` —— 仅在 `allowLegacy` 为真时接受。
 *
 * 上线顺序：本函数先随 cloud 发布（双接受）→ aster-api 切到 v2 → 观察
 * `usedLegacyCanonical` 归零 → 把 `ASTER_INTERNAL_ALLOW_LEGACY_SIG` 置 false
 * 下线 v1。★这是**必须的三步**，跳过任何一步都会打断线上认证。
 *
 * 注意：v1 的重放窗口是固有缺陷，兼容期内无法消除——这正是要尽快走完第三步的理由。
 *
 * @param req      入站请求；body 需由调用方先读出（Request body 只能读一次）
 * @param rawBody  已读出的原始 body 文本；GET 传空串
 * @param secret   共享密钥
 */
export async function verifyInternalSignature(
  req: Request,
  rawBody: string,
  secret: string,
  opts?: { allowLegacy?: boolean },
): Promise<InternalVerifyResult> {
  const timestamp = req.headers.get('X-Aster-Timestamp');
  const signature = req.headers.get('X-Internal-Signature')
    ?? req.headers.get('X-Aster-Signature');

  if (!timestamp || !signature) {
    return { ok: false, reason: 'missing_signature_headers' };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > INTERNAL_TS_WINDOW_SEC) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const nonce = req.headers.get('X-Aster-Nonce') ?? '';

  // v2：绑定 body 与 nonce
  if (nonce) {
    const bodyHash = await sha256Hex(new TextEncoder().encode(rawBody).buffer as ArrayBuffer);
    const canonicalV2 = `${method}\n${url.pathname}\n${ts}\n${nonce}\n${bodyHash}`;
    if (await hmacVerify(secret, canonicalV2, signature)) {
      return { ok: true, usedLegacyCanonical: false };
    }
  }

  // v1：兼容窗口内的旧格式（不绑定 body/nonce → 可换 body 重放）
  const allowLegacy = opts?.allowLegacy ?? (process.env.ASTER_INTERNAL_ALLOW_LEGACY_SIG !== 'false');
  if (allowLegacy) {
    const canonicalV1 = `${method}\n${url.pathname}\n${ts}`;
    if (await hmacVerify(secret, canonicalV1, signature)) {
      return { ok: true, usedLegacyCanonical: true };
    }
  }

  return { ok: false, reason: 'invalid_signature' };
}
