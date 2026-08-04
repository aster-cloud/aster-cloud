'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { registerAssistantAnswerProvider } from '@/lib/assistant/provider';
import { createDigitalHumanProvider } from '@/lib/assistant/digital-human';

/**
 * 按登录态注册/注销 RAG 应答器。
 *
 * <p><b>为什么必须按登录态开关</b>：助手是**全站驻留**的，营销页、文档页在
 * 未登录状态也会显示。而 `/api/llm/assistant` 经 `proxyLlmSse` 强制要求
 * 登录（无 session 直接 401）。若无条件注册，未登录访客每问一句都会看到
 * "未能连接助手服务"的降级提示——那是误导：服务没坏，只是他没登录。
 *
 * <p>未登录时保持**纯离线检索**：面板照常可用、结果照常可点，只是没有
 * 自然语言答复。这也符合"联网只做增强，不做替代"的既定约束。
 *
 * <p>渲染 null——只做副作用，不占 DOM。
 */
export function AssistantProviderBootstrap() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') {
      // 登出后要注销，否则上一个会话留下的应答器会继续被调用并 401。
      registerAssistantAnswerProvider(null);
      return;
    }
    registerAssistantAnswerProvider(createDigitalHumanProvider());
    return () => registerAssistantAnswerProvider(null);
  }, [status]);

  return null;
}
