// ★这是 stub/契约参考实现：真验独立 HMAC key，返回固定 ReplayMetadata（Slice-2a 验接线）。
//   Slice-2b 真 launcher 复用同一 HMAC 验证契约，但用真 runner Job 产 ReplayMetadata。
// sha256Hex/hmacSha256 已在 api-signing.ts 导出（DRY），保证 stub 验的 hash/canonical
// 与 client（signRunnerLauncherHeaders）签的逐字节一致。
import { sha256Hex, hmacSha256 } from '../../lib/api-signing';

let stubReplayMetadata: Record<string, unknown> = {
  canonicalInputHash: 'stub-i', canonicalOutputHash: 'stub-o',
  canonicalizationVersion: 'stub-v', replayabilityStatus: 'REPLAYABLE', traceHash: 'stub-t',
};
/** 测试注入固定 ReplayMetadata（生产/真 launcher 不用）。 */
export function __setStubReplayMetadata(rm: Record<string, unknown>) { stubReplayMetadata = rm; }

/**
 * 处理 runner launch 请求。★真验 HMAC（重算 7 行 canonical 比 X-Internal-Signature，用独立 key）。
 * 验签失败 → 401/403；通过 → 返回 SUCCESS envelope（stub 固定 metadata）。
 */
export async function handleRunnerLaunch(request: Request): Promise<Response> {
  const key = process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY;
  if (!key) return new Response('launcher key 未配置', { status: 500 });

  const sig = request.headers.get('X-Internal-Signature');
  const timestamp = request.headers.get('X-Aster-Timestamp');
  const nonce = request.headers.get('X-Aster-Nonce');
  const caller = request.headers.get('X-Internal-Caller');
  const tenant = request.headers.get('X-Aster-Tenant');   // ★client 现放 header（Task 1 修复）
  const role = request.headers.get('X-Aster-Role');
  if (!sig || !timestamp || !nonce || caller !== 'cloud-runner-launcher' || tenant == null || role == null) {
    return new Response('缺签名头/caller 不符', { status: 401 });
  }
  const body = await request.text();
  const url = new URL(request.url);

  // ★重建与 client 逐字一致的 7 行 canonical（同 signRunnerLauncherHeaders）：
  //   method\npath\nts\nnonce\nbodyHash\ntenant\nrole。tenant/role 从 header 取（现已放 header）。
  const encoder = new TextEncoder();
  const bodyHash = await sha256Hex(encoder.encode(body).buffer as ArrayBuffer);   // ★同 client 的 body 处理
  const canonical = `${request.method}\n${url.pathname}\n${timestamp}\n${nonce}\n${bodyHash}\n${tenant}\n${role}`;
  const expected = await hmacSha256(key, canonical);

  // 常数时间比对（防时序侧信）；失败 → 403（密钥隔离验证：错 key 签的 sig 对不上真 key 重算的）。
  if (!timingSafeEqualHex(sig, expected)) return new Response('HMAC 验证失败', { status: 403 });
  // ★时间戳窗口（5min）+ nonce 去重（生产/真 launcher 须做；stub 可简化为仅窗口校验）。
  //   ★先校验 timestamp 是纯数字——Number('abc')=NaN，Math.abs(NaN)>300=false 会误放行（Codex 抓）。
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return new Response('时间戳无效或过期', { status: 401 });
  }

  return new Response(JSON.stringify({ outcome: 'SUCCESS', replayMetadata: stubReplayMetadata }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** 常数时间十六进制比对。 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
