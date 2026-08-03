/**
 * 站内助手的**可插拔应答器**接口（联网能力预留位）。
 *
 * <p><b>当前状态</b>：默认不注册任何应答器 —— 助手是纯站内检索
 * （见 {@link retrieve}），不联网、不调 LLM、不读用户数据。本文件只定义
 * 契约与注册点，**不含任何网络调用**，也不引入运行时依赖。
 *
 * <p><b>为什么现在就留这个缝</b>：以后要接「数字人」（流式对话 + 语音/形象）。
 * 若那时才改，面板要从"同步检索"翻成"异步流式"，UI 状态机、错误路径、
 * i18n 文案会一起动。现在把接口固定下来，接入时**只新增一个实现 + 一行注册**，
 * 面板与检索核心都不用改。
 *
 * <p><b>检索永远保底</b>：注册应答器后，面板仍先跑本地检索并把结果作为
 * `groundingHits` 传给应答器（RAG 的 grounding），且在应答失败/超时时
 * 原样展示检索结果。也就是说——**联网只做增强，不做替代**；断网、配额耗尽、
 * 熔断打开时助手都还能用。
 *
 * <p><b>接入时必须复用既有护栏</b>，不要另开一条裸的 LLM 通路：
 * <ul>
 *   <li>{@code src/lib/llm-sse-proxy.ts} —— 已内建 auth + 配额校验，SSE 转发</li>
 *   <li>{@code src/lib/ai-pii-redactor.ts} —— 出站前脱敏</li>
 *   <li>{@code src/lib/ai-content-safety.ts} / {@code ai-circuit-breaker.ts}</li>
 *   <li>BYOK：{@code ai-key-vault.ts}（用户自带 key 时不烧平台额度）</li>
 * </ul>
 * 换言之，数字人应当是 `/api/llm/*` 下的**新路由**，而非绕过这些模块的新客户端。
 */

import type { AssistantHit } from './retrieval';

/** 应答器产出的一段增量文本（流式）。 */
export interface AssistantChunk {
  /** 增量文本片段；调用方负责按到达顺序拼接。 */
  delta: string;
}

export interface AssistantAnswerRequest {
  /** 用户原始问句。 */
  query: string;
  /**
   * 本地检索命中的站内结果，作为 grounding 上下文传给模型。
   *
   * <p>★这是"答案可溯源"的关键：数字人应当基于这些站内条目作答并给出引用，
   * 而不是自由生成。面板无论如何都会把这些命中显示出来。
   */
  groundingHits: readonly AssistantHit[];
  /** 当前界面语言（模型应以该语言作答）。 */
  locale: string;
  /** 取消信号：用户关闭面板或再次提问时中止在途请求。 */
  signal: AbortSignal;
}

/**
 * 联网应答器契约。
 *
 * <p>实现方返回一个异步可迭代的增量流；抛错或超时都由面板兜底
 * （降级为纯检索结果），因此实现**不需要**自己做"失败时回退"。
 */
export interface AssistantAnswerProvider {
  /** 用于日志/诊断的稳定标识，例如 `'digital-human-v1'`。 */
  readonly id: string;
  answer(req: AssistantAnswerRequest): AsyncIterable<AssistantChunk>;
}

/**
 * 当前注册的应答器；null 表示**纯离线检索模式**（默认）。
 *
 * <p>用模块级单例而非 React context：应答器是进程级能力，
 * 与组件树无关；注册点在应用启动处调用一次即可。
 */
let provider: AssistantAnswerProvider | null = null;

/**
 * 注册联网应答器（接入数字人时调用）。传 null 可恢复纯离线模式。
 *
 * <p>接入示例（届时新增，本文件不需要改）：
 * <pre>
 *   registerAssistantAnswerProvider(createDigitalHumanProvider());
 * </pre>
 */
export function registerAssistantAnswerProvider(
  next: AssistantAnswerProvider | null,
): void {
  provider = next;
}

/** 取当前应答器；null 表示不联网。面板据此决定是否走流式分支。 */
export function getAssistantAnswerProvider(): AssistantAnswerProvider | null {
  return provider;
}
