// 内容安全：调用 LLM 前的同步阻断（regex-based，<10ms）
//
// 拦截范围（v1）：
//   - 经典 prompt injection 关键词（"ignore previous instructions"、system prompt 泄漏类）
//   - 已知 jailbreak 模板（DAN、developer mode、grandma exploit）
//   - 模型角色扮演越权（"you are now …"、"pretend you have no rules"）
//
// 设计取舍：
//   - 初期 regex-only：成本接近 0，<10ms，不依赖任何外部 service
//   - 漏检不阻塞业务，由后置的 anomaly detection 兜底（safetyFlags 入库后聚合分析）
//   - 命中即拒绝；连续 3 次命中由 ai-anomaly-detection 触发 24h 自动封禁
//   - 接口预留 PromptInjectionDetector，将来可换成小模型分类器
//
// 详见 aster-deploy/docs/pm/07-ai-billing.md "内容安全" 章节

export interface PromptInjectionDetector {
  detect(prompt: string): SafetyVerdict;
}

export interface SafetyVerdict {
  /** 是否判定为不安全（应拒绝调用 LLM） */
  blocked: boolean;
  /** 命中的规则名（用于 safetyFlags 入库） */
  ruleId?: string;
  /** 给用户看的简短提示（脱敏，不暴露具体规则） */
  message?: string;
}

/**
 * v1 默认实现：基于关键词的 regex 匹配
 */
export class RegexInjectionDetector implements PromptInjectionDetector {
  // 单一来源：每条规则 id + pattern + 简短描述
  private static readonly RULES: ReadonlyArray<{
    id: string;
    pattern: RegExp;
  }> = [
    {
      id: 'ignore-previous',
      pattern:
        /\b(ignore|disregard|forget)\s+(all\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)+(instructions?|prompts?|rules?|system\s+prompt)\b/i,
    },
    {
      id: 'system-prompt-leak',
      pattern: /\b(reveal|show|print|repeat|leak|tell\s+me)\s+(your\s+|the\s+)?(system\s+prompt|initial\s+instructions?|hidden\s+instructions?)\b/i,
    },
    {
      id: 'dan-mode',
      pattern: /\b(DAN|do\s+anything\s+now)\s+(mode|prompt)?\b/i,
    },
    {
      id: 'developer-mode',
      pattern: /\b(enter|enable|activate)\s+(developer|jailbroken|unrestricted|god)\s+mode\b/i,
    },
    {
      id: 'pretend-no-rules',
      pattern: /\b(pretend|imagine|act\s+as\s+if)\s+(you\s+(are|have)|there\s+(are|is))\s+(no|without\s+any?)\s+(rules?|restrictions?|filters?|guidelines?)\b/i,
    },
    {
      id: 'role-override',
      pattern: /\byou\s+are\s+now\s+(an?\s+)?(unrestricted|jailbroken|evil|amoral|uncensored|unfiltered)\b/i,
    },
    {
      id: 'grandma-exploit',
      pattern: /\bmy\s+(dead\s+)?(grand(ma|mother)|grandpa|grandfather)\s+(used\s+to\s+)?(tell|read|recite|whisper)/i,
    },
    {
      id: 'override-safety',
      pattern: /\b(override|bypass|circumvent|disable)\s+(safety|content)\s+(filters?|policy|policies|guidelines?)\b/i,
    },
  ];

  detect(prompt: string): SafetyVerdict {
    if (!prompt || typeof prompt !== 'string') {
      return { blocked: false };
    }
    for (const rule of RegexInjectionDetector.RULES) {
      if (rule.pattern.test(prompt)) {
        return {
          blocked: true,
          ruleId: rule.id,
          message: '请求被内容安全策略拦截',
        };
      }
    }
    return { blocked: false };
  }
}

/** 默认导出单例 — 业务路径直接调用 */
export const defaultInjectionDetector: PromptInjectionDetector =
  new RegexInjectionDetector();

/** 业务路径便捷函数 */
export function detectPromptInjection(
  prompt: string,
  detector: PromptInjectionDetector = defaultInjectionDetector
): SafetyVerdict {
  return detector.detect(prompt);
}
