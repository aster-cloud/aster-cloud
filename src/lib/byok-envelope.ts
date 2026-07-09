/**
 * BYOK 推理接入（Phase 2）：为一次 AI 请求解析用户的 BYOK 凭证，构造转发给 aster-api 的
 * `_byok` envelope。
 *
 * 设计（Codex 审查）：
 *   - 只在服务端（cloud BFF）解密 BYOK key；浏览器 body 里的任何 `_byok` 一律不可信、被覆盖。
 *   - envelope 只带 { provider, apiKey }，**不带 baseUrl**——baseUrl 由 aster-api 按 provider
 *     查固定 allowlist（防 SSRF）。
 *   - 仅支持 openai / anthropic（Vertex 非简单 API-key 模型，Phase 2 排除）。
 *   - 注入 envelope 必须在 body 里，且调用方必须在注入【之后】再签名（HMAC 覆盖含 envelope 的
 *     最终 body），否则 aster-api 验签失败（fail-closed）。
 */
import { db, aiKeyBindings } from '@/lib/prisma';
import { and, eq } from 'drizzle-orm';
import { getDecryptedBYOKKey } from '@/lib/ai-key-vault';

/** Phase 2 支持的 BYOK provider（与 aster-api LlmRuntimeOptionsResolver allowlist 一致）。 */
const SUPPORTED_BYOK_PROVIDERS = new Set(['openai', 'anthropic']);

export interface ByokEnvelope {
  provider: string;
  apiKey: string;
  /** AiKeyBinding.id —— 用于 Phase 3 精确 stamp lastUsedAt / usage 归类。不注入转发 body。 */
  bindingId: string;
}

/**
 * 解析用户当前可用的 BYOK envelope。
 *   - 无 active 绑定 / provider 不支持（如 vertex）/ 解密返回空 → null（走平台配额路径）。
 *   - 解密【抛异常】（密钥系统/配置故障）→ 原样抛出，由路由 fail-closed 返回 503，而不是静默
 *     回退平台 key（否则 BYOK 用户会在密钥系统故障时偷偷消耗平台预算，Codex 审查）。
 */
export async function resolveByokEnvelope(userId: string): Promise<ByokEnvelope | null> {
  const binding = await db.query.aiKeyBindings.findFirst({
    where: and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.active, true)),
    columns: { id: true, provider: true, expiresAt: true },
  });
  if (!binding) return null;

  // 失效日期 enforcement：已过期的 BYOK key 不再提供给推理层（回退平台配额路径）。
  // 这是当前**能干净生效**的一层（不依赖 BYOK 接入推理）——过期 key 直接不被解析/使用。
  if (binding.expiresAt && binding.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const provider = binding.provider.trim().toLowerCase();
  if (!SUPPORTED_BYOK_PROVIDERS.has(provider)) {
    // Vertex 等暂不支持推理接入——走平台配额路径。
    return null;
  }

  // 解密失败=cloud 侧密钥系统/配置问题（非"用户没绑 key"）。fail-closed：抛错让路由返回 503，
  // 而不是静默回退平台 key（否则 BYOK 用户会在密钥系统故障时偷偷消耗平台预算）（Codex 审查）。
  const apiKey = await getDecryptedBYOKKey(userId, binding.provider);
  if (!apiKey) return null;

  return { provider, apiKey, bindingId: binding.id };
}

/**
 * 把服务端 envelope 注入请求 body 顶层：`_byok`（BYOK 凭证）+ `_usage`（issue #185 的
 * requestId，供 aster-api 回填真实 token 关联同一笔 usage）。先移除 caller 传入的任何 `_byok`/
 * `_usage`（防浏览器伪造），再写入服务端值。返回 { body, injected }：body 是最终字符串（供签名 +
 * 转发共用同一份），injected 表示是否真的注入了 BYOK envelope——调用方据此决定配额/记账（权威
 * usedByok），避免 body 非 JSON 导致"以为注入了实际没注入"的偏差（Codex 审查）。
 *
 * @param rawBody 原始请求 body 文本
 * @param envelope 服务端解析的 BYOK 凭证；null 则只剥离 caller 的 `_byok` 不注入
 * @param requestId issue #185 的请求关联 id；非空则注入 `_usage.requestId`
 */
export function injectByokEnvelope(
  rawBody: string,
  envelope: ByokEnvelope | null,
  requestId?: string | null
): { body: string; injected: boolean } {
  let parsed: Record<string, unknown>;
  try {
    parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    // body 非 JSON：无法注入（aster-api 也解析不了 envelope），原样返回、injected=false
    return { body: rawBody, injected: false };
  }
  // 红队：无论如何先删掉 caller 提交的 _byok / _usage（浏览器不可自带这些内部 envelope）
  delete parsed._byok;
  delete parsed._usage;
  const injected = envelope != null;
  if (envelope) {
    parsed._byok = { provider: envelope.provider, apiKey: envelope.apiKey };
  }
  if (requestId) {
    parsed._usage = { requestId };
  }
  return { body: JSON.stringify(parsed), injected };
}
