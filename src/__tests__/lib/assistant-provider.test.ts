// 站内助手「联网应答器」注册点测试。
//
// 这些测试锁住**接入数字人时不能被破坏的契约**：
//   1. 默认无应答器 → 纯离线检索（不会有任何出站请求）
//   2. 注册/注销可逆，且是模块级单例
//   3. 应答器抛错不影响检索结果本身（联网只做增强）

import { describe, it, expect, afterEach } from 'vitest';
import {
  registerAssistantAnswerProvider,
  getAssistantAnswerProvider,
  type AssistantAnswerProvider,
} from '@/lib/assistant/provider';
import { retrieve } from '@/lib/assistant/retrieval';
import type { SearchIndex } from '@/lib/docs/search-runtime';

const docsIndex: SearchIndex = {
  locale: 'zh',
  entries: [
    { slug: 'policies/versions', title: '版本与审批', description: '审批闸门决定哪些版本可执行。', headings: [] },
  ],
};
const opts = { docsIndex, commands: [], docsPrefix: '/zh' };

/** 一个只吐两段文字的假应答器。 */
const fake: AssistantAnswerProvider = {
  id: 'test-provider',
  async *answer() {
    yield { delta: '版本' };
    yield { delta: '与审批' };
  },
};

afterEach(() => registerAssistantAnswerProvider(null));

describe('assistant answer provider 注册点', () => {
  it('默认无应答器 → 纯离线检索模式', () => {
    expect(getAssistantAnswerProvider()).toBeNull();
  });

  it('注册后可取回；传 null 可恢复离线', () => {
    registerAssistantAnswerProvider(fake);
    expect(getAssistantAnswerProvider()?.id).toBe('test-provider');
    registerAssistantAnswerProvider(null);
    expect(getAssistantAnswerProvider()).toBeNull();
  });

  it('应答器产出可按增量拼接', async () => {
    registerAssistantAnswerProvider(fake);
    const p = getAssistantAnswerProvider()!;
    let acc = '';
    for await (const c of p.answer({
      query: '版本',
      groundingHits: [],
      locale: 'zh',
      signal: new AbortController().signal,
    })) {
      acc += c.delta;
    }
    expect(acc).toBe('版本与审批');
  });

  it('★应答器抛错不影响站内检索：检索是独立的纯函数', async () => {
    registerAssistantAnswerProvider({
      id: 'broken',
      async *answer() {
        throw new Error('network down');
      },
    });
    // 即便应答器坏了，检索照常给出可点击结果（面板据此降级展示）。
    const hits = retrieve('版本与审批', opts);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].href).toBe('/zh/docs/policies/versions');
  });

  it('检索本身不依赖应答器：注册前后结果完全一致', () => {
    const before = retrieve('版本与审批', opts);
    registerAssistantAnswerProvider(fake);
    const after = retrieve('版本与审批', opts);
    expect(after).toEqual(before);
  });
});
