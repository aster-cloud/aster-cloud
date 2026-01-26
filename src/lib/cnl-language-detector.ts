/**
 * CNL 语言自动检测
 *
 * 根据策略内容自动识别使用的 CNL 语言（en-US, zh-CN, de-DE）
 * 通过识别各语言特有的关键字来判断
 */

import type { SupportedLocale } from '@/data/policy-examples';

// ============================================
// 语言关键字定义
// ============================================

interface LanguageKeywords {
  locale: SupportedLocale;
  // 模块声明关键字
  moduleKeywords: string[];
  // 定义关键字
  defineKeywords: string[];
  // 函数关键字
  functionKeywords: string[];
  // 控制流关键字
  controlFlowKeywords: string[];
  // 变量关键字
  variableKeywords: string[];
  // 运算符关键字
  operatorKeywords: string[];
  // 布尔值关键字
  booleanKeywords: string[];
  // 字符串分隔符特征
  stringDelimiters: RegExp[];
}

const ENGLISH_KEYWORDS: LanguageKeywords = {
  locale: 'en-US',
  moduleKeywords: ['This module is'],
  defineKeywords: ['Define', 'with'],
  functionKeywords: ['To', 'produce:', 'produce:'],
  controlFlowKeywords: ['If', 'Otherwise', 'Return'],
  variableKeywords: ['Let', 'be'],
  operatorKeywords: ['equals', 'greater than', 'less than', 'plus', 'minus', 'times', 'divided by', 'not'],
  booleanKeywords: ['true', 'false'],
  stringDelimiters: [/"[^"]*"/],
};

const CHINESE_KEYWORDS: LanguageKeywords = {
  locale: 'zh-CN',
  moduleKeywords: ['【模块】'],
  defineKeywords: ['【定义】', '包含'],
  functionKeywords: ['【函数】', '包含', '产出：', '产出:'],
  controlFlowKeywords: ['如果', '否则', '返回'],
  variableKeywords: ['令', '为'],
  operatorKeywords: ['等于', '大于', '小于', '加', '减', '乘', '除以', '非'],
  booleanKeywords: ['真', '假'],
  stringDelimiters: [/「[^」]*」/],
};

const GERMAN_KEYWORDS: LanguageKeywords = {
  locale: 'de-DE',
  moduleKeywords: ['Dieses Modul ist'],
  defineKeywords: ['Definiere', 'mit'],
  functionKeywords: ['liefert:', 'liefert:'],
  controlFlowKeywords: ['Falls', 'Sonst', 'gib zurueck'],
  variableKeywords: ['sei', 'gleich'],
  operatorKeywords: ['gleich', 'größer als', 'kleiner als', 'plus', 'minus', 'mal', 'geteilt durch', 'nicht'],
  booleanKeywords: ['wahr', 'falsch'],
  stringDelimiters: [/"[^"]*"/],
};

const ALL_LANGUAGE_KEYWORDS: LanguageKeywords[] = [
  ENGLISH_KEYWORDS,
  CHINESE_KEYWORDS,
  GERMAN_KEYWORDS,
];

// ============================================
// 检测结果类型
// ============================================

export interface DetectionResult {
  detected: SupportedLocale;
  confidence: number; // 0-100
  scores: Record<SupportedLocale, number>;
  matchedKeywords: Record<SupportedLocale, string[]>;
}

// ============================================
// 检测函数
// ============================================

/**
 * 检测单个语言的匹配分数
 */
function scoreLanguage(content: string, keywords: LanguageKeywords): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  // 检测模块声明关键字（权重高）
  for (const kw of keywords.moduleKeywords) {
    if (content.includes(kw)) {
      score += 30;
      matched.push(kw);
    }
  }

  // 检测定义关键字
  for (const kw of keywords.defineKeywords) {
    if (content.includes(kw)) {
      score += 15;
      matched.push(kw);
    }
  }

  // 检测函数关键字
  for (const kw of keywords.functionKeywords) {
    if (content.includes(kw)) {
      score += 15;
      matched.push(kw);
    }
  }

  // 检测控制流关键字
  for (const kw of keywords.controlFlowKeywords) {
    if (content.includes(kw)) {
      score += 10;
      matched.push(kw);
    }
  }

  // 检测变量关键字
  for (const kw of keywords.variableKeywords) {
    if (content.includes(kw)) {
      score += 8;
      matched.push(kw);
    }
  }

  // 检测运算符关键字
  for (const kw of keywords.operatorKeywords) {
    if (content.includes(kw)) {
      score += 5;
      matched.push(kw);
    }
  }

  // 检测布尔值关键字
  for (const kw of keywords.booleanKeywords) {
    // 使用正则确保完整匹配（避免部分匹配）
    const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b|[=\\s]${escapeRegExp(kw)}[,.]`, 'i');
    if (regex.test(content)) {
      score += 5;
      matched.push(kw);
    }
  }

  // 检测字符串分隔符特征
  for (const pattern of keywords.stringDelimiters) {
    const matches = content.match(new RegExp(pattern, 'g'));
    if (matches && matches.length > 0) {
      score += matches.length * 3;
      matched.push(`String pattern (${matches.length})`);
    }
  }

  return { score, matched: [...new Set(matched)] };
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检测 CNL 策略内容的语言
 *
 * @param content 策略源码内容
 * @returns 检测结果，包含检测到的语言、置信度和详细分数
 */
export function detectCNLLanguage(content: string): DetectionResult {
  if (!content || content.trim().length === 0) {
    return {
      detected: 'en-US',
      confidence: 0,
      scores: { 'en-US': 0, 'zh-CN': 0, 'de-DE': 0 },
      matchedKeywords: { 'en-US': [], 'zh-CN': [], 'de-DE': [] },
    };
  }

  const scores: Record<SupportedLocale, number> = {
    'en-US': 0,
    'zh-CN': 0,
    'de-DE': 0,
  };

  const matchedKeywords: Record<SupportedLocale, string[]> = {
    'en-US': [],
    'zh-CN': [],
    'de-DE': [],
  };

  // 计算每种语言的分数
  for (const keywords of ALL_LANGUAGE_KEYWORDS) {
    const { score, matched } = scoreLanguage(content, keywords);
    scores[keywords.locale] = score;
    matchedKeywords[keywords.locale] = matched;
  }

  // 找到最高分
  const maxScore = Math.max(...Object.values(scores));
  const detected: SupportedLocale =
    (Object.entries(scores).find(([, score]) => score === maxScore)?.[0] as SupportedLocale) || 'en-US';

  // 计算置信度（基于最高分与第二高分的差距）
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const scoreDiff = sortedScores[0] - sortedScores[1];
  const confidence = maxScore > 0 ? Math.min(100, Math.round((scoreDiff / maxScore) * 100 + 50)) : 0;

  return {
    detected,
    confidence: Math.max(0, Math.min(100, confidence)),
    scores,
    matchedKeywords,
  };
}

/**
 * 快速检测语言（仅返回检测到的语言）
 */
export function quickDetectLanguage(content: string): SupportedLocale {
  return detectCNLLanguage(content).detected;
}

/**
 * 判断是否高置信度检测
 */
export function isHighConfidence(result: DetectionResult): boolean {
  return result.confidence >= 70;
}

/**
 * 获取检测建议文本
 */
export function getDetectionSuggestion(
  result: DetectionResult,
  uiLocale: string
): string {
  const isZh = uiLocale.startsWith('zh');
  const isDe = uiLocale.startsWith('de');

  const langNames: Record<SupportedLocale, Record<string, string>> = {
    'en-US': { en: 'English', zh: '英语', de: 'Englisch' },
    'zh-CN': { en: 'Chinese', zh: '中文', de: 'Chinesisch' },
    'de-DE': { en: 'German', zh: '德语', de: 'Deutsch' },
  };

  const lang = langNames[result.detected];
  const langName = isDe ? lang.de : isZh ? lang.zh : lang.en;

  if (result.confidence >= 70) {
    if (isZh) return `检测到 ${langName} CNL 语法`;
    if (isDe) return `${langName} CNL-Syntax erkannt`;
    return `Detected ${langName} CNL syntax`;
  } else if (result.confidence >= 40) {
    if (isZh) return `可能是 ${langName} CNL 语法`;
    if (isDe) return `Moeglicherweise ${langName} CNL-Syntax`;
    return `Possibly ${langName} CNL syntax`;
  } else {
    if (isZh) return '无法确定 CNL 语言';
    if (isDe) return 'CNL-Sprache konnte nicht ermittelt werden';
    return 'Could not determine CNL language';
  }
}
