# 站内助手（Aster Assistant）

全站驻留的检索助手。检索本身**不联网**；登录用户额外获得基于检索结果的 RAG 自然语言答复。

## 组成

| 文件 | 职责 |
| --- | --- |
| `retrieval.ts` | 检索核心（纯函数）。把问句映射到文档索引 + 命令面板两个既有事实源 |
| `provider.ts` | 联网应答器契约与注册点 |
| `digital-human.ts` | RAG 应答器实现（打 `/api/llm/assistant`） |
| `../../components/assistant/assistant-provider-bootstrap.tsx` | 按登录态注册/注销应答器 |
| `../../components/assistant/assistant-context.tsx` | 全站共享状态（挂在 `[locale]/layout.tsx`） |
| `../../components/assistant/assistant-panel.tsx` | 面板 UI + 启动按钮 |

## 为什么答案不会是幻觉

检索结果全部来自站内已有内容，每条都带可点击的站内链接。无命中时返回空数组并显示
「没找到」，**不编造**。

## 联网 RAG 问答（已接入）

链路：面板 → `provider.answer()` → `/api/llm/assistant`（薄代理，内建 auth+配额）
→ aster-api `/api/v1/ai/assistant`（内容安全 + BYOK + 计量）→ LLM。

**只对登录用户启用**：`proxyLlmSse` 无 session 直接 401，若无条件注册，
未登录访客每问一句都会看到"未能连接助手服务"——那是误导（服务没坏，只是没登录）。
未登录时保持纯离线检索，面板照常可用。

### 若要换一个应答器（如接入数字人形象/语音）

不需要改面板，也不需要改检索核心，只做两件事：

### 1. 实现应答器

```ts
import type { AssistantAnswerProvider } from '@/lib/assistant/provider';

export function createDigitalHumanProvider(): AssistantAnswerProvider {
  return {
    id: 'digital-human-v1',
    async *answer({ query, groundingHits, locale, signal }) {
      const res = await fetch('/api/llm/assistant', {   // ← 新路由，见下
        method: 'POST',
        body: JSON.stringify({ query, groundingHits, locale }),
        signal,
      });
      // 解析 SSE，逐段 yield
      for await (const delta of readSse(res)) yield { delta };
    },
  };
}
```

### 2. 注册一次

```ts
registerAssistantAnswerProvider(createDigitalHumanProvider());
```

### 铁律：必须复用既有 AI 护栏，不要另开裸通路

服务端应当在 `src/app/api/llm/` 下新增路由，并走既有模块——这些能力已经建好了，
绕过去等于把认证、配额、脱敏、熔断全部丢掉：

| 模块 | 作用 |
| --- | --- |
| `lib/llm-sse-proxy.ts` | **已内建 auth + 配额校验**，SSE 转发 |
| `lib/ai-pii-redactor.ts` | 出站前脱敏 |
| `lib/ai-content-safety.ts` | 内容安全 |
| `lib/ai-circuit-breaker.ts` | 熔断 |
| `lib/ai-key-vault.ts` | BYOK：用户自带 key 时不烧平台额度 |

### 设计约束（改动时不要破坏）

1. **联网只做增强，不做替代。** 本地检索**始终**先跑并照常显示；应答器失败、超时、
   配额耗尽、熔断打开时，助手降级为纯检索仍然可用。相关测试见
   `__tests__/lib/assistant-provider.test.ts`。
2. **grounding 而非自由生成。** 检索命中通过 `groundingHits` 传给模型，答复应基于这些
   站内条目并给出引用——这是「答案可溯源」的前提。
3. **默认关闭联网。** 不注册应答器时，`turn.answer` 恒为 undefined，相关 DOM 完全不渲染。
4. **文案先行。** 新增用户可见文案要进 `assistant` 命名空间的 4 个语言包
   （en/zh/de 在 `aster-lang-locales`，hi 在 `aster-lang-hi`），并走 ui-messages 发版链
   （含 aster-api classpath 同步那一步），否则线上后端会覆盖 npm 包、界面漏出原始 key。
