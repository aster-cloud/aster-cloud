/**
 * SSE 代理：浏览器 → aster-api `/api/v1/ai/suggest`。
 * 见 src/lib/llm-sse-proxy.ts 的设计说明。
 */
import { NextRequest } from 'next/server';
import { proxyLlmSse } from '@/lib/llm-sse-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return proxyLlmSse(req, { upstreamPath: '/api/v1/ai/suggest' });
}
