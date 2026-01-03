/**
 * Aster Policy API 客户端
 *
 * 连接到部署在 K3S 上的 Quarkus Policy API 服务。
 * 支持 REST 和 WebSocket 两种调用方式。
 */

// 环境变量配置
const getApiConfig = () => ({
  baseUrl: process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL || 'https://policy.aster-lang.cloud',
  wsUrl: process.env.NEXT_PUBLIC_ASTER_POLICY_WS_URL || 'wss://policy.aster-lang.cloud/ws/preview',
  timeout: parseInt(process.env.ASTER_POLICY_API_TIMEOUT || '30000', 10),
});

// 请求类型定义
export interface PolicyEvaluateRequest {
  /** 策略模块名称 (如 "aster.finance.loan") */
  policyModule: string;
  /** 策略函数名称 (如 "evaluateLoanEligibility") */
  policyFunction: string;
  /** 评估上下文数据 */
  context: Record<string, unknown>[];
  /** CNL 语言 (可选，默认 en-US) */
  locale?: string;
}

export interface PolicyEvaluateBatchRequest {
  /** 策略模块名称 */
  policyModule: string;
  /** 策略函数名称 */
  policyFunction: string;
  /** 批量评估上下文数据 */
  contexts: Record<string, unknown>[][];
  /** CNL 语言 */
  locale?: string;
}

export interface PolicyCompileRequest {
  /** 策略源代码 (CNL 格式) */
  source: string;
  /** CNL 语言 */
  locale?: string;
}

// 响应类型定义
export interface PolicyEvaluateResponse {
  /** 是否成功 */
  success: boolean;
  /** 评估结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间 (毫秒) */
  executionTime?: number;
  /** 策略版本 */
  policyVersion?: string;
}

export interface PolicyCompileResponse {
  /** 是否成功 */
  success: boolean;
  /** 编译后的模块信息 */
  module?: {
    name: string;
    functions: string[];
    types: string[];
  };
  /** 诊断信息 */
  diagnostics?: PolicyDiagnostic[];
  /** 错误信息 */
  error?: string;
}

export interface PolicyDiagnostic {
  /** 严重级别 */
  severity: 'error' | 'warning' | 'info' | 'hint';
  /** 消息内容 */
  message: string;
  /** 开始行号 (1-based) */
  startLine: number;
  /** 开始列号 (1-based) */
  startColumn: number;
  /** 结束行号 */
  endLine: number;
  /** 结束列号 */
  endColumn: number;
  /** 错误代码 */
  code?: string;
}

export interface HealthCheckResponse {
  status: 'UP' | 'DOWN';
  checks?: Array<{
    name: string;
    status: 'UP' | 'DOWN';
  }>;
}

// WebSocket 消息类型
export interface PreviewMessage {
  type: 'preview' | 'error' | 'diagnostics';
  data: unknown;
}

/**
 * Policy API 客户端类
 */
export class PolicyApiClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly timeout: number;
  private ws: WebSocket | null = null;

  constructor(
    private readonly tenantId: string,
    private readonly userId: string
  ) {
    const config = getApiConfig();
    this.baseUrl = config.baseUrl;
    this.wsUrl = config.wsUrl;
    this.timeout = config.timeout;
  }

  /**
   * 创建请求头
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Tenant-Id': this.tenantId,
      'X-User-Id': this.userId,
    };
  }

  /**
   * 发送 HTTP 请求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PolicyApiError(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorData.code
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof PolicyApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PolicyApiError('Request timeout', 408, 'TIMEOUT');
      }
      throw new PolicyApiError(
        error instanceof Error ? error.message : 'Unknown error',
        500,
        'UNKNOWN'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 评估单个策略
   */
  async evaluate(request: PolicyEvaluateRequest): Promise<PolicyEvaluateResponse> {
    return this.request<PolicyEvaluateResponse>('POST', '/api/policies/evaluate', request);
  }

  /**
   * 批量评估策略
   */
  async evaluateBatch(request: PolicyEvaluateBatchRequest): Promise<PolicyEvaluateResponse[]> {
    return this.request<PolicyEvaluateResponse[]>('POST', '/api/policies/evaluate/batch', request);
  }

  /**
   * 编译策略 (验证语法)
   */
  async compile(request: PolicyCompileRequest): Promise<PolicyCompileResponse> {
    return this.request<PolicyCompileResponse>('POST', '/api/policies/compile', request);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    return this.request<HealthCheckResponse>('GET', '/q/health/live');
  }

  /**
   * 就绪检查
   */
  async readinessCheck(): Promise<HealthCheckResponse> {
    return this.request<HealthCheckResponse>('GET', '/q/health/ready');
  }

  /**
   * 连接 WebSocket 进行实时预览
   */
  connectPreview(
    onMessage: (message: PreviewMessage) => void,
    onError?: (error: Error) => void,
    onClose?: () => void
  ): () => void {
    if (this.ws) {
      this.ws.close();
    }

    const wsUrlWithParams = `${this.wsUrl}?tenantId=${encodeURIComponent(this.tenantId)}&userId=${encodeURIComponent(this.userId)}`;
    this.ws = new WebSocket(wsUrlWithParams);

    this.ws.onopen = () => {
      console.log('[PolicyAPI] WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as PreviewMessage;
        onMessage(message);
      } catch (error) {
        console.error('[PolicyAPI] Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (event) => {
      console.error('[PolicyAPI] WebSocket error:', event);
      onError?.(new Error('WebSocket connection error'));
    };

    this.ws.onclose = () => {
      console.log('[PolicyAPI] WebSocket disconnected');
      onClose?.();
    };

    // 返回断开连接的函数
    return () => {
      this.ws?.close();
      this.ws = null;
    };
  }

  /**
   * 发送预览请求
   */
  sendPreview(source: string, context: Record<string, unknown>, locale?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[PolicyAPI] WebSocket not connected');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'preview',
      source,
      context,
      locale: locale || 'en-US',
    }));
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Policy API 错误类
 */
export class PolicyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PolicyApiError';
  }
}

/**
 * 创建 Policy API 客户端 (服务端使用)
 */
export function createPolicyApiClient(tenantId: string, userId: string): PolicyApiClient {
  return new PolicyApiClient(tenantId, userId);
}

/**
 * 将 API 诊断转换为 Monaco 诊断格式
 */
export function toMonacoDiagnostics(diagnostics: PolicyDiagnostic[]) {
  return diagnostics.map((d) => ({
    severity: d.severity === 'error' ? 8 : d.severity === 'warning' ? 4 : 2, // Monaco.MarkerSeverity
    message: d.message,
    startLineNumber: d.startLine,
    startColumn: d.startColumn,
    endLineNumber: d.endLine,
    endColumn: d.endColumn,
    code: d.code,
  }));
}
