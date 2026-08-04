/**
 * SSE 代理：浏览器 → aster-api `/api/v1/ai/assistant`（站内助手 RAG 问答）。
 *
 * <p>与 suggest/generate 走同一个 {@link proxyLlmSse}——auth、配额校验、
 * BYOK 透传都在那里，**不要**为助手另开裸通路。
 */
import { NextRequest } from 'next/server';
import { proxyLlmSse } from '@/lib/llm-sse-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return proxyLlmSse(req, { upstreamPath: '/api/v1/ai/assistant' });
}
