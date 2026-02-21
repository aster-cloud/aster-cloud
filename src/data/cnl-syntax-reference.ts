/**
 * CNL 语法参考数据
 *
 * 定义三种语言的 CNL 语法关键字和示例
 * 用于语法参考面板和编辑器提示
 */

import type { SupportedLocale } from './policy-examples';

// ============================================
// 类型定义
// ============================================

export type SyntaxCategory =
  | 'module'
  | 'definition'
  | 'function'
  | 'control-flow'
  | 'variable'
  | 'operators'
  | 'literals'
  | 'patterns';

export interface SyntaxItem {
  category: SyntaxCategory;
  keywords: Record<SupportedLocale, string[]>;
  description: Record<SupportedLocale, string>;
  example: Record<SupportedLocale, string>;
}

export interface SyntaxCategoryDef {
  id: SyntaxCategory;
  name: Record<SupportedLocale, string>;
  icon: string;
}

// ============================================
// 语法类别定义
// ============================================

export const SYNTAX_CATEGORIES: SyntaxCategoryDef[] = [
  {
    id: 'module',
    name: { 'en-US': 'Module', 'zh-CN': '模块', 'de-DE': 'Modul' },
    icon: 'box',
  },
  {
    id: 'definition',
    name: { 'en-US': 'Definition', 'zh-CN': '定义', 'de-DE': 'Definition' },
    icon: 'type',
  },
  {
    id: 'function',
    name: { 'en-US': 'Function', 'zh-CN': '函数', 'de-DE': 'Funktion' },
    icon: 'function',
  },
  {
    id: 'control-flow',
    name: { 'en-US': 'Control Flow', 'zh-CN': '控制流', 'de-DE': 'Kontrollfluss' },
    icon: 'git-branch',
  },
  {
    id: 'variable',
    name: { 'en-US': 'Variable', 'zh-CN': '变量', 'de-DE': 'Variable' },
    icon: 'variable',
  },
  {
    id: 'operators',
    name: { 'en-US': 'Operators', 'zh-CN': '运算符', 'de-DE': 'Operatoren' },
    icon: 'calculator',
  },
  {
    id: 'literals',
    name: { 'en-US': 'Literals', 'zh-CN': '字面量', 'de-DE': 'Literale' },
    icon: 'hash',
  },
  {
    id: 'patterns',
    name: { 'en-US': 'Patterns', 'zh-CN': '模式', 'de-DE': 'Muster' },
    icon: 'layers',
  },
];

// ============================================
// 语法参考数据
// ============================================

export const SYNTAX_REFERENCE: SyntaxItem[] = [
  // 模块声明
  {
    category: 'module',
    keywords: {
      'en-US': ['Module'],
      'zh-CN': ['模块'],
      'de-DE': ['Modul'],
    },
    description: {
      'en-US': 'Declares the module namespace for the policy',
      'zh-CN': '声明策略的模块命名空间',
      'de-DE': 'Deklariert den Modul-Namensraum fuer die Policy',
    },
    example: {
      'en-US': 'Module finance.loan.',
      'zh-CN': '模块 金融.贷款。',
      'de-DE': 'Modul finanz.kredit.',
    },
  },

  // 类型定义
  {
    category: 'definition',
    keywords: {
      'en-US': ['Define', 'has'],
      'zh-CN': ['定义', '包含'],
      'de-DE': ['Definiere', 'hat'],
    },
    description: {
      'en-US': 'Defines a new data type (struct) with fields',
      'zh-CN': '定义一个包含字段的新数据类型（结构体）',
      'de-DE': 'Definiert einen neuen Datentyp (Struct) mit Feldern',
    },
    example: {
      'en-US': `Define Person has
  name,
  age,
  email.`,
      'zh-CN': `定义 人员 包含
  姓名，
  年龄，
  邮箱。`,
      'de-DE': `Definiere Person hat
  name,
  alter,
  email.`,
    },
  },

  // 函数定义
  {
    category: 'function',
    keywords: {
      'en-US': ['Rule', 'given', 'produce:'],
      'zh-CN': ['规则', '给定', '产出：'],
      'de-DE': ['Regel', 'gegeben'],
    },
    description: {
      'en-US': 'Defines a function with parameters and return value',
      'zh-CN': '定义一个带参数和返回值的函数',
      'de-DE': 'Definiert eine Funktion mit Parametern und Rueckgabewert',
    },
    example: {
      'en-US': `Rule calculateTotal given order:
  Return order.price times order.quantity.`,
      'zh-CN': `规则 计算总额 给定 订单：
  返回 订单.价格 乘 订单.数量。`,
      'de-DE': `Regel berechneSumme gegeben bestellung:
  gib zurueck bestellung.preis mal bestellung.menge.`,
    },
  },

  // 条件语句
  {
    category: 'control-flow',
    keywords: {
      'en-US': ['If', 'Otherwise'],
      'zh-CN': ['如果', '否则'],
      'de-DE': ['Falls', 'Sonst'],
    },
    description: {
      'en-US': 'Conditional branching for decision logic',
      'zh-CN': '用于决策逻辑的条件分支',
      'de-DE': 'Bedingte Verzweigung fuer Entscheidungslogik',
    },
    example: {
      'en-US': `If user.age less than 18:
  Return "Minor".
Otherwise:
  Return "Adult".`,
      'zh-CN': `如果 用户.年龄 小于 18：
  返回 「未成年」。
否则：
  返回 「成年」。`,
      'de-DE': `Falls benutzer.alter kleiner als 18:
  gib zurueck "Minderjaehrig".
Sonst:
  gib zurueck "Erwachsen".`,
    },
  },

  // 返回语句
  {
    category: 'control-flow',
    keywords: {
      'en-US': ['Return'],
      'zh-CN': ['返回'],
      'de-DE': ['gib zurueck'],
    },
    description: {
      'en-US': 'Returns a value from a function',
      'zh-CN': '从函数返回一个值',
      'de-DE': 'Gibt einen Wert aus einer Funktion zurueck',
    },
    example: {
      'en-US': 'Return Result with status = "approved", amount = 1000.',
      'zh-CN': '返回 结果(状态 = 「已批准」, 金额 = 1000)。',
      'de-DE': 'gib zurueck Ergebnis mit status = "genehmigt", betrag = 1000.',
    },
  },

  // 变量绑定
  {
    category: 'variable',
    keywords: {
      'en-US': ['Let', 'be'],
      'zh-CN': ['令', '为'],
      'de-DE': ['sei', 'gleich'],
    },
    description: {
      'en-US': 'Binds a value to a variable name',
      'zh-CN': '将一个值绑定到变量名',
      'de-DE': 'Bindet einen Wert an einen Variablennamen',
    },
    example: {
      'en-US': 'Let total be price times quantity.',
      'zh-CN': '令 总额 为价格 乘 数量。',
      'de-DE': 'sei summe gleich preis mal menge.',
    },
  },

  // 比较运算符
  {
    category: 'operators',
    keywords: {
      'en-US': ['equals', 'greater than', 'less than', 'not'],
      'zh-CN': ['等于', '大于', '小于', '非'],
      'de-DE': ['gleich', 'größer als', 'kleiner als', 'nicht'],
    },
    description: {
      'en-US': 'Comparison operators for conditions',
      'zh-CN': '用于条件的比较运算符',
      'de-DE': 'Vergleichsoperatoren fuer Bedingungen',
    },
    example: {
      'en-US': `If score greater than 90:
  Return "A".
If score equals 0:
  Return "F".`,
      'zh-CN': `如果 分数 大于 90：
  返回 「A」。
如果 分数 等于 0：
  返回 「F」。`,
      'de-DE': `Falls punkte größer als 90:
  gib zurueck "A".
Falls punkte gleich 0:
  gib zurueck "F".`,
    },
  },

  // 算术运算符
  {
    category: 'operators',
    keywords: {
      'en-US': ['plus', 'minus', 'times', 'divided by'],
      'zh-CN': ['加', '减', '乘', '除以'],
      'de-DE': ['plus', 'minus', 'mal', 'geteilt durch'],
    },
    description: {
      'en-US': 'Arithmetic operators for calculations',
      'zh-CN': '用于计算的算术运算符',
      'de-DE': 'Arithmetische Operatoren fuer Berechnungen',
    },
    example: {
      'en-US': 'Let result be a plus b times c divided by d.',
      'zh-CN': '令 结果 为a 加 b 乘 c 除以 d。',
      'de-DE': 'sei ergebnis gleich a plus b mal c geteilt durch d.',
    },
  },

  // 布尔值
  {
    category: 'literals',
    keywords: {
      'en-US': ['true', 'false'],
      'zh-CN': ['真', '假'],
      'de-DE': ['wahr', 'falsch'],
    },
    description: {
      'en-US': 'Boolean literal values',
      'zh-CN': '布尔字面量值',
      'de-DE': 'Boolesche Literalwerte',
    },
    example: {
      'en-US': 'Return Decision with approved = true, rejected = false.',
      'zh-CN': '返回 决定(批准 = 真, 拒绝 = 假)。',
      'de-DE': 'gib zurueck Entscheidung mit genehmigt = wahr, abgelehnt = falsch.',
    },
  },

  // 字符串
  {
    category: 'literals',
    keywords: {
      'en-US': ['"..."'],
      'zh-CN': ['「...」'],
      'de-DE': ['"..."'],
    },
    description: {
      'en-US': 'String literal values',
      'zh-CN': '字符串字面量值',
      'de-DE': 'String-Literalwerte',
    },
    example: {
      'en-US': 'Return "Hello, World!".',
      'zh-CN': '返回 「你好，世界！」。',
      'de-DE': 'gib zurueck "Hallo, Welt!".',
    },
  },

  // 结构体实例化
  {
    category: 'patterns',
    keywords: {
      'en-US': ['with'],
      'zh-CN': ['(', ')'],
      'de-DE': ['mit'],
    },
    description: {
      'en-US': 'Creates an instance of a defined type',
      'zh-CN': '创建已定义类型的实例',
      'de-DE': 'Erstellt eine Instanz eines definierten Typs',
    },
    example: {
      'en-US': 'Return Person with name = "John", age = 30.',
      'zh-CN': '返回 人员(姓名 = 「张三」, 年龄 = 30)。',
      'de-DE': 'gib zurueck Person mit name = "Hans", alter = 30.',
    },
  },

  // 成员访问
  {
    category: 'patterns',
    keywords: {
      'en-US': ['.'],
      'zh-CN': ['.'],
      'de-DE': ['.'],
    },
    description: {
      'en-US': 'Accesses a field of a struct',
      'zh-CN': '访问结构体的字段',
      'de-DE': 'Greift auf ein Feld einer Struktur zu',
    },
    example: {
      'en-US': 'Let name be user.firstName.',
      'zh-CN': '令 姓名 为用户.名字。',
      'de-DE': 'sei name gleich benutzer.vorname.',
    },
  },

  // 函数调用
  {
    category: 'patterns',
    keywords: {
      'en-US': ['with'],
      'zh-CN': ['(', ')'],
      'de-DE': ['mit'],
    },
    description: {
      'en-US': 'Calls a function with arguments',
      'zh-CN': '使用参数调用函数',
      'de-DE': 'Ruft eine Funktion mit Argumenten auf',
    },
    example: {
      'en-US': 'Let result be calculateTotal with order.',
      'zh-CN': '令 结果 为计算总额(订单)。',
      'de-DE': 'sei ergebnis gleich berechneSumme mit bestellung.',
    },
  },
];

// ============================================
// 辅助函数
// ============================================

/**
 * 获取指定类别的语法项
 */
export function getSyntaxByCategory(category: SyntaxCategory): SyntaxItem[] {
  return SYNTAX_REFERENCE.filter((item) => item.category === category);
}

/**
 * 获取类别名称
 */
export function getCategoryName(categoryId: SyntaxCategory, locale: SupportedLocale): string {
  const category = SYNTAX_CATEGORIES.find((c) => c.id === categoryId);
  return category?.name[locale] || categoryId;
}

/**
 * 获取所有关键字（用于搜索）
 */
export function getAllKeywords(locale: SupportedLocale): string[] {
  const keywords = new Set<string>();
  for (const item of SYNTAX_REFERENCE) {
    for (const keyword of item.keywords[locale]) {
      keywords.add(keyword);
    }
  }
  return Array.from(keywords);
}

/**
 * 搜索语法项
 */
export function searchSyntax(query: string, locale: SupportedLocale): SyntaxItem[] {
  const lowerQuery = query.toLowerCase();
  return SYNTAX_REFERENCE.filter((item) => {
    // 搜索关键字
    const keywordMatch = item.keywords[locale].some((k) =>
      k.toLowerCase().includes(lowerQuery)
    );
    // 搜索描述
    const descMatch = item.description[locale].toLowerCase().includes(lowerQuery);
    return keywordMatch || descMatch;
  });
}

/**
 * 获取快速参考卡片数据
 */
export function getQuickReferenceCards(locale: SupportedLocale): {
  category: SyntaxCategoryDef;
  items: SyntaxItem[];
}[] {
  return SYNTAX_CATEGORIES.map((category) => ({
    category,
    items: getSyntaxByCategory(category.id),
  }));
}
