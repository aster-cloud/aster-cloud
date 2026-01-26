/**
 * CNL 语法转换工具
 *
 * 将 CNL 策略从一种语言转换为另一种语言
 * 支持: en-US (English), zh-CN (中文), de-DE (Deutsch)
 */

import type { SupportedLocale } from '@/data/policy-examples';

// ============================================
// 关键字映射表
// ============================================

interface KeywordMapping {
  id: string;
  'en-US': string | string[];
  'zh-CN': string | string[];
  'de-DE': string | string[];
  // 是否需要特殊处理（如正则匹配）
  pattern?: boolean;
  // 转换时的优先级（数字越大越先处理）
  priority?: number;
}

/**
 * CNL 关键字映射表
 * 按优先级排序，长关键字优先处理以避免部分匹配问题
 */
const KEYWORD_MAPPINGS: KeywordMapping[] = [
  // 模块声明（最高优先级）
  {
    id: 'module',
    'en-US': 'This module is',
    'zh-CN': '【模块】',
    'de-DE': 'Dieses Modul ist',
    priority: 100,
  },

  // 定义关键字
  {
    id: 'define',
    'en-US': 'Define',
    'zh-CN': '【定义】',
    'de-DE': 'Definiere',
    priority: 90,
  },
  {
    id: 'with-fields',
    'en-US': ' with',
    'zh-CN': ' 包含',
    'de-DE': ' mit',
    priority: 85,
  },

  // 函数定义关键字
  {
    id: 'function-decl',
    'en-US': 'To ',
    'zh-CN': '', // 中文函数名直接开头，没有前缀
    'de-DE': '',
    priority: 80,
  },
  {
    id: 'function-params',
    'en-US': ' with ',
    'zh-CN': ' 入参 ',
    'de-DE': ' mit ',
    priority: 75,
  },
  {
    id: 'function-produce',
    'en-US': ', produce:',
    'zh-CN': '，产出：',
    'de-DE': ', liefert:',
    priority: 70,
  },

  // 控制流关键字
  {
    id: 'if',
    'en-US': 'If ',
    'zh-CN': '如果 ',
    'de-DE': 'Falls ',
    priority: 60,
  },
  {
    id: 'otherwise',
    'en-US': 'Otherwise:',
    'zh-CN': '否则：',
    'de-DE': 'Sonst:',
    priority: 60,
  },
  {
    id: 'return',
    'en-US': 'Return ',
    'zh-CN': '返回 ',
    'de-DE': 'gib zurueck ',
    priority: 55,
  },

  // 变量绑定关键字
  {
    id: 'let',
    'en-US': 'Let ',
    'zh-CN': '令 ',
    'de-DE': 'sei ',
    priority: 50,
  },
  {
    id: 'be',
    'en-US': ' be ',
    'zh-CN': ' 为',
    'de-DE': ' gleich ',
    priority: 45,
  },

  // 比较运算符
  {
    id: 'greater-than',
    'en-US': ' greater than ',
    'zh-CN': ' 大于 ',
    'de-DE': ' größer als ',
    priority: 40,
  },
  {
    id: 'less-than',
    'en-US': ' less than ',
    'zh-CN': ' 小于 ',
    'de-DE': ' kleiner als ',
    priority: 40,
  },
  {
    id: 'equals',
    'en-US': ' equals ',
    'zh-CN': ' 等于 ',
    'de-DE': ' gleich ',
    priority: 40,
  },
  {
    id: 'not',
    'en-US': 'not ',
    'zh-CN': '非 ',
    'de-DE': 'nicht ',
    priority: 35,
  },

  // 算术运算符
  {
    id: 'plus',
    'en-US': ' plus ',
    'zh-CN': ' 加 ',
    'de-DE': ' plus ',
    priority: 30,
  },
  {
    id: 'minus',
    'en-US': ' minus ',
    'zh-CN': ' 减 ',
    'de-DE': ' minus ',
    priority: 30,
  },
  {
    id: 'times',
    'en-US': ' times ',
    'zh-CN': ' 乘 ',
    'de-DE': ' mal ',
    priority: 30,
  },
  {
    id: 'divided-by',
    'en-US': ' divided by ',
    'zh-CN': ' 除以 ',
    'de-DE': ' geteilt durch ',
    priority: 30,
  },

  // 布尔值
  {
    id: 'true',
    'en-US': 'true',
    'zh-CN': '真',
    'de-DE': 'wahr',
    priority: 20,
  },
  {
    id: 'false',
    'en-US': 'false',
    'zh-CN': '假',
    'de-DE': 'falsch',
    priority: 20,
  },

  // 标点符号（中文使用不同的标点）
  {
    id: 'colon',
    'en-US': ':',
    'zh-CN': '：',
    'de-DE': ':',
    priority: 10,
  },
  {
    id: 'comma-list',
    'en-US': ',',
    'zh-CN': '，',
    'de-DE': ',',
    priority: 5,
  },
  {
    id: 'period',
    'en-US': '.',
    'zh-CN': '。',
    'de-DE': '.',
    priority: 1,
  },
];

// ============================================
// 字符串字面量转换
// ============================================

interface StringLiteralStyle {
  open: string;
  close: string;
}

const STRING_STYLES: Record<SupportedLocale, StringLiteralStyle> = {
  'en-US': { open: '"', close: '"' },
  'zh-CN': { open: '「', close: '」' },
  'de-DE': { open: '"', close: '"' },
};

/**
 * 提取字符串字面量并用占位符替换
 */
function extractStrings(
  content: string,
  fromLocale: SupportedLocale
): { content: string; strings: string[] } {
  const style = STRING_STYLES[fromLocale];
  const strings: string[] = [];

  // 创建匹配字符串的正则
  const regex = new RegExp(
    `${escapeRegExp(style.open)}([^${escapeRegExp(style.close)}]*)${escapeRegExp(style.close)}`,
    'g'
  );

  const newContent = content.replace(regex, (match, innerContent) => {
    strings.push(innerContent);
    return `__STRING_${strings.length - 1}__`;
  });

  return { content: newContent, strings };
}

/**
 * 还原字符串字面量
 */
function restoreStrings(
  content: string,
  strings: string[],
  toLocale: SupportedLocale
): string {
  const style = STRING_STYLES[toLocale];

  return content.replace(/__STRING_(\d+)__/g, (_, index) => {
    const idx = parseInt(index, 10);
    return `${style.open}${strings[idx]}${style.close}`;
  });
}

// ============================================
// 转换函数
// ============================================

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 获取关键字的值（可能是数组，取第一个）
 */
function getKeyword(mapping: KeywordMapping, locale: SupportedLocale): string {
  const value = mapping[locale];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 获取关键字的所有变体（用于匹配）
 */
function getKeywordVariants(mapping: KeywordMapping, locale: SupportedLocale): string[] {
  const value = mapping[locale];
  return Array.isArray(value) ? value : [value];
}

/**
 * 转换单行内容
 */
function convertLine(
  line: string,
  fromLocale: SupportedLocale,
  toLocale: SupportedLocale,
  sortedMappings: KeywordMapping[]
): string {
  let result = line;

  for (const mapping of sortedMappings) {
    const fromVariants = getKeywordVariants(mapping, fromLocale);
    const toKeyword = getKeyword(mapping, toLocale);

    for (const fromKeyword of fromVariants) {
      if (fromKeyword && fromKeyword.length > 0) {
        // 使用全局替换
        const regex = new RegExp(escapeRegExp(fromKeyword), 'g');
        result = result.replace(regex, toKeyword);
      }
    }
  }

  return result;
}

/**
 * 处理中文函数定义的特殊情况
 * 中文: "funcName 入参 params，产出：" -> 英文: "To funcName with params, produce:"
 */
function handleChineseFunctionDefinition(
  content: string,
  toLocale: SupportedLocale
): string {
  if (toLocale === 'zh-CN') {
    // 英文/德文 -> 中文：移除 "To " 前缀
    return content.replace(/^To\s+/gm, '');
  } else if (toLocale === 'en-US') {
    // 中文 -> 英文：在函数定义行添加 "To " 前缀
    // 匹配：行首 + 标识符 + " 入参 " 或 " with "
    return content.replace(/^(\S+)(\s+入参\s+|\s+with\s+)/gm, 'To $1$2');
  }
  return content;
}

/**
 * 后处理：修复转换后可能出现的问题
 */
function postProcess(content: string, toLocale: SupportedLocale): string {
  let result = content;

  if (toLocale === 'zh-CN') {
    // 中文：确保句末是中文句号，冒号是中文冒号
    // 但保留结构体字段定义中的逗号
  } else {
    // 英文/德文：确保使用英文标点
  }

  // 移除多余的空格
  result = result.replace(/  +/g, ' ');

  // 确保冒号后换行格式正确
  result = result.replace(/：\s*\n/g, '：\n');
  result = result.replace(/:\s*\n/g, ':\n');

  return result;
}

// ============================================
// 主转换函数
// ============================================

export interface ConversionResult {
  success: boolean;
  content: string;
  fromLocale: SupportedLocale;
  toLocale: SupportedLocale;
  warnings: string[];
}

/**
 * 转换 CNL 策略内容
 *
 * @param content 源代码内容
 * @param fromLocale 源语言
 * @param toLocale 目标语言
 * @returns 转换结果
 */
export function convertCNLSyntax(
  content: string,
  fromLocale: SupportedLocale,
  toLocale: SupportedLocale
): ConversionResult {
  const warnings: string[] = [];

  // 如果源语言和目标语言相同，直接返回
  if (fromLocale === toLocale) {
    return {
      success: true,
      content,
      fromLocale,
      toLocale,
      warnings: [],
    };
  }

  try {
    // 1. 提取字符串字面量
    const { content: contentWithPlaceholders, strings } = extractStrings(content, fromLocale);

    // 2. 按优先级排序关键字映射
    const sortedMappings = [...KEYWORD_MAPPINGS].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    // 3. 逐行转换
    const lines = contentWithPlaceholders.split('\n');
    const convertedLines = lines.map((line) =>
      convertLine(line, fromLocale, toLocale, sortedMappings)
    );
    let converted = convertedLines.join('\n');

    // 4. 处理函数定义的特殊情况
    if (fromLocale === 'zh-CN' && toLocale === 'en-US') {
      converted = handleChineseFunctionDefinition(converted, toLocale);
    } else if (fromLocale === 'en-US' && toLocale === 'zh-CN') {
      converted = handleChineseFunctionDefinition(converted, toLocale);
    }

    // 5. 还原字符串字面量
    converted = restoreStrings(converted, strings, toLocale);

    // 6. 后处理
    converted = postProcess(converted, toLocale);

    return {
      success: true,
      content: converted,
      fromLocale,
      toLocale,
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      content,
      fromLocale,
      toLocale,
      warnings: [
        error instanceof Error ? error.message : 'Unknown conversion error',
      ],
    };
  }
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLocales(): SupportedLocale[] {
  return ['en-US', 'zh-CN', 'de-DE'];
}

/**
 * 获取语言显示名称
 */
export function getLocaleName(locale: SupportedLocale, uiLocale: string): string {
  const names: Record<SupportedLocale, Record<string, string>> = {
    'en-US': { en: 'English', zh: '英语', de: 'Englisch' },
    'zh-CN': { en: 'Chinese', zh: '中文', de: 'Chinesisch' },
    'de-DE': { en: 'German', zh: '德语', de: 'Deutsch' },
  };

  const lang = uiLocale.startsWith('zh') ? 'zh' : uiLocale.startsWith('de') ? 'de' : 'en';
  return names[locale][lang];
}

/**
 * 批量预览转换
 * 返回所有语言版本的预览
 */
export function previewAllConversions(
  content: string,
  fromLocale: SupportedLocale
): Record<SupportedLocale, ConversionResult> {
  const results: Record<SupportedLocale, ConversionResult> = {} as Record<
    SupportedLocale,
    ConversionResult
  >;

  for (const toLocale of getSupportedLocales()) {
    results[toLocale] = convertCNLSyntax(content, fromLocale, toLocale);
  }

  return results;
}
