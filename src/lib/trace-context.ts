// W3C Trace Context — 跨服务 traceId 透传
//
// 详见 https://www.w3.org/TR/trace-context/
// 格式：traceparent: 00-<traceId-32hex>-<spanId-16hex>-<flags-2hex>
//
// 不引入 OTel SDK（避免 Vercel edge runtime 兼容问题），用纯 Web Crypto + 字符串构造。
// aster-api 端已经接 quarkus-opentelemetry，会自动消费 traceparent 头并 propagate。

import { randomBytes } from 'node:crypto';

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface TraceContext {
  traceId: string;   // 32 hex chars
  spanId: string;    // 16 hex chars
  flags: string;     // 2 hex chars (01 = sampled)
  traceparent: string;
}

/**
 * 解析入站 traceparent 头；不合法或缺失返回 null
 */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (!header) return null;
  const m = TRACEPARENT_RE.exec(header.trim());
  if (!m) return null;
  return {
    traceId: m[1],
    spanId: m[2],
    flags: m[3],
    traceparent: header.trim(),
  };
}

/**
 * 生成新的 traceparent（root span）
 *
 * - traceId / spanId 完全随机
 * - flags=01（sampled），让 aster-api 端实际记录这条 trace
 */
export function newTraceContext(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  const flags = '01';
  return {
    traceId,
    spanId,
    flags,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
  };
}

/**
 * 给定一个父 trace context，生成一个新的 child span（用于 fan-out 调用）
 *
 * 主要用途：cloud 在一个请求里同时调多次 aster-api，每次需要不同的 spanId
 * 但共享同一个 traceId。
 */
export function childSpan(parent: TraceContext): TraceContext {
  const spanId = randomBytes(8).toString('hex');
  return {
    traceId: parent.traceId,
    spanId,
    flags: parent.flags,
    traceparent: `00-${parent.traceId}-${spanId}-${parent.flags}`,
  };
}

/**
 * 从入站 Request 解析 traceparent；缺失 / 不合法时新建一个 root context
 */
export function ensureTraceContext(req: Request | { headers: { get(name: string): string | null } }): TraceContext {
  const incoming = req.headers.get('traceparent');
  return parseTraceparent(incoming) ?? newTraceContext();
}
