/**
 * Aster Lang 多语言词法配置
 *
 * 从 Aster Lang 项目镜像的词法定义，用于 Monaco Editor 语法高亮。
 * 支持英文 (en-US) 和中文 (zh-CN) CNL 语法。
 */

// 语义化 Token 类型枚举（与 Aster Lang 保持一致）
export enum SemanticTokenKind {
  // 模块声明
  MODULE_DECL = 'MODULE_DECL',
  IMPORT = 'IMPORT',
  IMPORT_ALIAS = 'IMPORT_ALIAS',

  // 类型定义
  TYPE_DEF = 'TYPE_DEF',
  TYPE_WITH = 'TYPE_WITH',
  TYPE_ONE_OF = 'TYPE_ONE_OF',

  // 函数定义
  FUNC_TO = 'FUNC_TO',
  FUNC_PRODUCE = 'FUNC_PRODUCE',
  FUNC_PERFORMS = 'FUNC_PERFORMS',

  // 控制流
  IF = 'IF',
  OTHERWISE = 'OTHERWISE',
  MATCH = 'MATCH',
  WHEN = 'WHEN',
  RETURN = 'RETURN',
  FOR_EACH = 'FOR_EACH',
  IN = 'IN',

  // 变量操作
  LET = 'LET',
  BE = 'BE',
  SET = 'SET',
  TO_WORD = 'TO_WORD',

  // 布尔运算
  OR = 'OR',
  AND = 'AND',
  NOT = 'NOT',

  // 算术运算
  PLUS = 'PLUS',
  MINUS_WORD = 'MINUS_WORD',
  TIMES = 'TIMES',
  DIVIDED_BY = 'DIVIDED_BY',

  // 比较运算
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  EQUALS_TO = 'EQUALS_TO',
  IS = 'IS',

  // 类型构造
  MAYBE = 'MAYBE',
  OPTION_OF = 'OPTION_OF',
  RESULT_OF = 'RESULT_OF',
  OK_OF = 'OK_OF',
  ERR_OF = 'ERR_OF',
  SOME_OF = 'SOME_OF',
  NONE = 'NONE',

  // 字面量
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  NULL = 'NULL',

  // 基础类型
  TEXT = 'TEXT',
  INT_TYPE = 'INT_TYPE',
  FLOAT_TYPE = 'FLOAT_TYPE',
  BOOL_TYPE = 'BOOL_TYPE',

  // 效果声明
  IO = 'IO',
  CPU = 'CPU',

  // 工作流
  WORKFLOW = 'WORKFLOW',
  STEP = 'STEP',
  DEPENDS = 'DEPENDS',
  ON = 'ON',
  COMPENSATE = 'COMPENSATE',
  RETRY = 'RETRY',
  TIMEOUT = 'TIMEOUT',
  MAX_ATTEMPTS = 'MAX_ATTEMPTS',
  BACKOFF = 'BACKOFF',

  // 异步操作
  WITHIN = 'WITHIN',
  SCOPE = 'SCOPE',
  START = 'START',
  ASYNC = 'ASYNC',
  AWAIT = 'AWAIT',
  WAIT_FOR = 'WAIT_FOR',
}

// 词法配置接口
export interface LexiconConfig {
  id: string;
  name: string;
  keywords: Record<SemanticTokenKind, string>;
  punctuation: {
    statementEnd: string;
    listSeparator: string;
    blockStart: string;
    stringQuotes: { open: string; close: string };
  };
}

// 英文词法配置
export const EN_US_LEXICON: LexiconConfig = {
  id: 'en-US',
  name: 'English (US)',
  keywords: {
    [SemanticTokenKind.MODULE_DECL]: 'this module is',
    [SemanticTokenKind.IMPORT]: 'use',
    [SemanticTokenKind.IMPORT_ALIAS]: 'as',
    [SemanticTokenKind.TYPE_DEF]: 'define',
    [SemanticTokenKind.TYPE_WITH]: 'with',
    [SemanticTokenKind.TYPE_ONE_OF]: 'as one of',
    [SemanticTokenKind.FUNC_TO]: 'to',
    [SemanticTokenKind.FUNC_PRODUCE]: 'produce',
    [SemanticTokenKind.FUNC_PERFORMS]: 'it performs',
    [SemanticTokenKind.IF]: 'if',
    [SemanticTokenKind.OTHERWISE]: 'otherwise',
    [SemanticTokenKind.MATCH]: 'match',
    [SemanticTokenKind.WHEN]: 'when',
    [SemanticTokenKind.RETURN]: 'return',
    [SemanticTokenKind.FOR_EACH]: 'for each',
    [SemanticTokenKind.IN]: 'in',
    [SemanticTokenKind.LET]: 'let',
    [SemanticTokenKind.BE]: 'be',
    [SemanticTokenKind.SET]: 'set',
    [SemanticTokenKind.TO_WORD]: 'to',
    [SemanticTokenKind.OR]: 'or',
    [SemanticTokenKind.AND]: 'and',
    [SemanticTokenKind.NOT]: 'not',
    [SemanticTokenKind.PLUS]: 'plus',
    [SemanticTokenKind.MINUS_WORD]: 'minus',
    [SemanticTokenKind.TIMES]: 'times',
    [SemanticTokenKind.DIVIDED_BY]: 'divided by',
    [SemanticTokenKind.LESS_THAN]: 'less than',
    [SemanticTokenKind.GREATER_THAN]: 'greater than',
    [SemanticTokenKind.EQUALS_TO]: 'equals to',
    [SemanticTokenKind.IS]: 'is',
    [SemanticTokenKind.MAYBE]: 'maybe',
    [SemanticTokenKind.OPTION_OF]: 'option of',
    [SemanticTokenKind.RESULT_OF]: 'result of',
    [SemanticTokenKind.OK_OF]: 'ok of',
    [SemanticTokenKind.ERR_OF]: 'err of',
    [SemanticTokenKind.SOME_OF]: 'some of',
    [SemanticTokenKind.NONE]: 'none',
    [SemanticTokenKind.TRUE]: 'true',
    [SemanticTokenKind.FALSE]: 'false',
    [SemanticTokenKind.NULL]: 'null',
    [SemanticTokenKind.TEXT]: 'text',
    [SemanticTokenKind.INT_TYPE]: 'int',
    [SemanticTokenKind.FLOAT_TYPE]: 'float',
    [SemanticTokenKind.BOOL_TYPE]: 'bool',
    [SemanticTokenKind.IO]: 'io',
    [SemanticTokenKind.CPU]: 'cpu',
    [SemanticTokenKind.WORKFLOW]: 'workflow',
    [SemanticTokenKind.STEP]: 'step',
    [SemanticTokenKind.DEPENDS]: 'depends',
    [SemanticTokenKind.ON]: 'on',
    [SemanticTokenKind.COMPENSATE]: 'compensate',
    [SemanticTokenKind.RETRY]: 'retry',
    [SemanticTokenKind.TIMEOUT]: 'timeout',
    [SemanticTokenKind.MAX_ATTEMPTS]: 'max attempts',
    [SemanticTokenKind.BACKOFF]: 'backoff',
    [SemanticTokenKind.WITHIN]: 'within',
    [SemanticTokenKind.SCOPE]: 'scope',
    [SemanticTokenKind.START]: 'start',
    [SemanticTokenKind.ASYNC]: 'async',
    [SemanticTokenKind.AWAIT]: 'await',
    [SemanticTokenKind.WAIT_FOR]: 'wait for',
  },
  punctuation: {
    statementEnd: '.',
    listSeparator: ',',
    blockStart: ':',
    stringQuotes: { open: '"', close: '"' },
  },
};

// 中文词法配置
export const ZH_CN_LEXICON: LexiconConfig = {
  id: 'zh-CN',
  name: '简体中文',
  keywords: {
    [SemanticTokenKind.MODULE_DECL]: '【模块】',
    [SemanticTokenKind.IMPORT]: '引用',
    [SemanticTokenKind.IMPORT_ALIAS]: '作为',
    [SemanticTokenKind.TYPE_DEF]: '【定义】',
    [SemanticTokenKind.TYPE_WITH]: '包含',
    [SemanticTokenKind.TYPE_ONE_OF]: '为以下之一',
    [SemanticTokenKind.FUNC_TO]: '入参',
    [SemanticTokenKind.FUNC_PRODUCE]: '产出',
    [SemanticTokenKind.FUNC_PERFORMS]: '执行',
    [SemanticTokenKind.IF]: '若',
    [SemanticTokenKind.OTHERWISE]: '否则',
    [SemanticTokenKind.MATCH]: '把',
    [SemanticTokenKind.WHEN]: '当',
    [SemanticTokenKind.RETURN]: '返回',
    [SemanticTokenKind.FOR_EACH]: '对每个',
    [SemanticTokenKind.IN]: '在',
    [SemanticTokenKind.LET]: '令',
    [SemanticTokenKind.BE]: '为',
    [SemanticTokenKind.SET]: '将',
    [SemanticTokenKind.TO_WORD]: '设为',
    [SemanticTokenKind.OR]: '或',
    [SemanticTokenKind.AND]: '且',
    [SemanticTokenKind.NOT]: '非',
    [SemanticTokenKind.PLUS]: '加',
    [SemanticTokenKind.MINUS_WORD]: '减',
    [SemanticTokenKind.TIMES]: '乘',
    [SemanticTokenKind.DIVIDED_BY]: '除以',
    [SemanticTokenKind.LESS_THAN]: '小于',
    [SemanticTokenKind.GREATER_THAN]: '大于',
    [SemanticTokenKind.EQUALS_TO]: '等于',
    [SemanticTokenKind.IS]: '是',
    [SemanticTokenKind.MAYBE]: '可选',
    [SemanticTokenKind.OPTION_OF]: '选项',
    [SemanticTokenKind.RESULT_OF]: '结果',
    [SemanticTokenKind.OK_OF]: '成功',
    [SemanticTokenKind.ERR_OF]: '失败',
    [SemanticTokenKind.SOME_OF]: '有值',
    [SemanticTokenKind.NONE]: '无',
    [SemanticTokenKind.TRUE]: '真',
    [SemanticTokenKind.FALSE]: '假',
    [SemanticTokenKind.NULL]: '空',
    [SemanticTokenKind.TEXT]: '文本',
    [SemanticTokenKind.INT_TYPE]: '整数',
    [SemanticTokenKind.FLOAT_TYPE]: '小数',
    [SemanticTokenKind.BOOL_TYPE]: '布尔',
    [SemanticTokenKind.IO]: '输入输出',
    [SemanticTokenKind.CPU]: '计算',
    [SemanticTokenKind.WORKFLOW]: '【流程】',
    [SemanticTokenKind.STEP]: '【步骤】',
    [SemanticTokenKind.DEPENDS]: '依赖',
    [SemanticTokenKind.ON]: '于',
    [SemanticTokenKind.COMPENSATE]: '补偿',
    [SemanticTokenKind.RETRY]: '重试',
    [SemanticTokenKind.TIMEOUT]: '超时',
    [SemanticTokenKind.MAX_ATTEMPTS]: '最多尝试',
    [SemanticTokenKind.BACKOFF]: '退避',
    [SemanticTokenKind.WITHIN]: '范围',
    [SemanticTokenKind.SCOPE]: '域',
    [SemanticTokenKind.START]: '启动',
    [SemanticTokenKind.ASYNC]: '异步',
    [SemanticTokenKind.AWAIT]: '等待',
    [SemanticTokenKind.WAIT_FOR]: '等候',
  },
  punctuation: {
    statementEnd: '。',
    listSeparator: '，',
    blockStart: '：',
    stringQuotes: { open: '「', close: '」' },
  },
};

// 德语词法配置
export const DE_DE_LEXICON: LexiconConfig = {
  id: 'de-DE',
  name: 'Deutsch',
  keywords: {
    [SemanticTokenKind.MODULE_DECL]: 'dieses modul ist',
    [SemanticTokenKind.IMPORT]: 'verwende',
    [SemanticTokenKind.IMPORT_ALIAS]: 'als',
    [SemanticTokenKind.TYPE_DEF]: 'definiere',
    [SemanticTokenKind.TYPE_WITH]: 'mit',
    [SemanticTokenKind.TYPE_ONE_OF]: 'als eines von',
    [SemanticTokenKind.FUNC_TO]: 'um',
    [SemanticTokenKind.FUNC_PRODUCE]: 'erzeuge',
    [SemanticTokenKind.FUNC_PERFORMS]: 'es führt aus',
    [SemanticTokenKind.IF]: 'falls',
    [SemanticTokenKind.OTHERWISE]: 'sonst',
    [SemanticTokenKind.MATCH]: 'prüfe',
    [SemanticTokenKind.WHEN]: 'wenn',
    [SemanticTokenKind.RETURN]: 'gib zurück',
    [SemanticTokenKind.FOR_EACH]: 'für jedes',
    [SemanticTokenKind.IN]: 'in',
    [SemanticTokenKind.LET]: 'sei',
    [SemanticTokenKind.BE]: 'gleich',
    [SemanticTokenKind.SET]: 'setze',
    [SemanticTokenKind.TO_WORD]: 'auf',
    [SemanticTokenKind.OR]: 'oder',
    [SemanticTokenKind.AND]: 'und',
    [SemanticTokenKind.NOT]: 'nicht',
    [SemanticTokenKind.PLUS]: 'plus',
    [SemanticTokenKind.MINUS_WORD]: 'minus',
    [SemanticTokenKind.TIMES]: 'mal',
    [SemanticTokenKind.DIVIDED_BY]: 'geteilt durch',
    [SemanticTokenKind.LESS_THAN]: 'kleiner als',
    [SemanticTokenKind.GREATER_THAN]: 'größer als',
    [SemanticTokenKind.EQUALS_TO]: 'gleich',
    [SemanticTokenKind.IS]: 'ist',
    [SemanticTokenKind.MAYBE]: 'vielleicht',
    [SemanticTokenKind.OPTION_OF]: 'option von',
    [SemanticTokenKind.RESULT_OF]: 'ergebnis von',
    [SemanticTokenKind.OK_OF]: 'ok von',
    [SemanticTokenKind.ERR_OF]: 'fehler von',
    [SemanticTokenKind.SOME_OF]: 'einige von',
    [SemanticTokenKind.NONE]: 'keine',
    [SemanticTokenKind.TRUE]: 'wahr',
    [SemanticTokenKind.FALSE]: 'falsch',
    [SemanticTokenKind.NULL]: 'null',
    [SemanticTokenKind.TEXT]: 'text',
    [SemanticTokenKind.INT_TYPE]: 'ganzzahl',
    [SemanticTokenKind.FLOAT_TYPE]: 'dezimal',
    [SemanticTokenKind.BOOL_TYPE]: 'bool',
    [SemanticTokenKind.IO]: 'io',
    [SemanticTokenKind.CPU]: 'cpu',
    [SemanticTokenKind.WORKFLOW]: 'arbeitsablauf',
    [SemanticTokenKind.STEP]: 'schritt',
    [SemanticTokenKind.DEPENDS]: 'hängt ab',
    [SemanticTokenKind.ON]: 'von',
    [SemanticTokenKind.COMPENSATE]: 'kompensiere',
    [SemanticTokenKind.RETRY]: 'wiederhole',
    [SemanticTokenKind.TIMEOUT]: 'zeitüberschreitung',
    [SemanticTokenKind.MAX_ATTEMPTS]: 'max versuche',
    [SemanticTokenKind.BACKOFF]: 'verzögerung',
    [SemanticTokenKind.WITHIN]: 'innerhalb',
    [SemanticTokenKind.SCOPE]: 'bereich',
    [SemanticTokenKind.START]: 'starte',
    [SemanticTokenKind.ASYNC]: 'async',
    [SemanticTokenKind.AWAIT]: 'warte',
    [SemanticTokenKind.WAIT_FOR]: 'warte auf',
  },
  punctuation: {
    statementEnd: '.',
    listSeparator: ',',
    blockStart: ':',
    stringQuotes: { open: '"', close: '"' },
  },
};

// 获取词法配置
export function getLexicon(locale: string): LexiconConfig {
  if (locale === 'zh' || locale === 'zh-CN') {
    return ZH_CN_LEXICON;
  }
  if (locale === 'de' || locale === 'de-DE') {
    return DE_DE_LEXICON;
  }
  return EN_US_LEXICON;
}

// 获取所有关键词（用于 Monaco 语法高亮）
export function getAllKeywords(lexicon: LexiconConfig): string[] {
  return Object.values(lexicon.keywords);
}

// 按类别获取关键词
export function getKeywordsByCategory(lexicon: LexiconConfig) {
  return {
    module: [
      lexicon.keywords[SemanticTokenKind.MODULE_DECL],
      lexicon.keywords[SemanticTokenKind.IMPORT],
      lexicon.keywords[SemanticTokenKind.IMPORT_ALIAS],
    ],
    type: [
      lexicon.keywords[SemanticTokenKind.TYPE_DEF],
      lexicon.keywords[SemanticTokenKind.TYPE_WITH],
      lexicon.keywords[SemanticTokenKind.TYPE_ONE_OF],
    ],
    function: [
      lexicon.keywords[SemanticTokenKind.FUNC_TO],
      lexicon.keywords[SemanticTokenKind.FUNC_PRODUCE],
      lexicon.keywords[SemanticTokenKind.FUNC_PERFORMS],
    ],
    control: [
      lexicon.keywords[SemanticTokenKind.IF],
      lexicon.keywords[SemanticTokenKind.OTHERWISE],
      lexicon.keywords[SemanticTokenKind.MATCH],
      lexicon.keywords[SemanticTokenKind.WHEN],
      lexicon.keywords[SemanticTokenKind.RETURN],
      lexicon.keywords[SemanticTokenKind.FOR_EACH],
      lexicon.keywords[SemanticTokenKind.IN],
    ],
    variable: [
      lexicon.keywords[SemanticTokenKind.LET],
      lexicon.keywords[SemanticTokenKind.BE],
      lexicon.keywords[SemanticTokenKind.SET],
      lexicon.keywords[SemanticTokenKind.TO_WORD],
    ],
    boolean: [
      lexicon.keywords[SemanticTokenKind.OR],
      lexicon.keywords[SemanticTokenKind.AND],
      lexicon.keywords[SemanticTokenKind.NOT],
    ],
    operator: [
      lexicon.keywords[SemanticTokenKind.PLUS],
      lexicon.keywords[SemanticTokenKind.MINUS_WORD],
      lexicon.keywords[SemanticTokenKind.TIMES],
      lexicon.keywords[SemanticTokenKind.DIVIDED_BY],
      lexicon.keywords[SemanticTokenKind.LESS_THAN],
      lexicon.keywords[SemanticTokenKind.GREATER_THAN],
      lexicon.keywords[SemanticTokenKind.EQUALS_TO],
      lexicon.keywords[SemanticTokenKind.IS],
    ],
    literal: [
      lexicon.keywords[SemanticTokenKind.TRUE],
      lexicon.keywords[SemanticTokenKind.FALSE],
      lexicon.keywords[SemanticTokenKind.NULL],
      lexicon.keywords[SemanticTokenKind.NONE],
    ],
    primitiveType: [
      lexicon.keywords[SemanticTokenKind.TEXT],
      lexicon.keywords[SemanticTokenKind.INT_TYPE],
      lexicon.keywords[SemanticTokenKind.FLOAT_TYPE],
      lexicon.keywords[SemanticTokenKind.BOOL_TYPE],
    ],
    workflow: [
      lexicon.keywords[SemanticTokenKind.WORKFLOW],
      lexicon.keywords[SemanticTokenKind.STEP],
      lexicon.keywords[SemanticTokenKind.DEPENDS],
      lexicon.keywords[SemanticTokenKind.ON],
      lexicon.keywords[SemanticTokenKind.COMPENSATE],
      lexicon.keywords[SemanticTokenKind.RETRY],
      lexicon.keywords[SemanticTokenKind.TIMEOUT],
      lexicon.keywords[SemanticTokenKind.MAX_ATTEMPTS],
      lexicon.keywords[SemanticTokenKind.BACKOFF],
    ],
    async: [
      lexicon.keywords[SemanticTokenKind.WITHIN],
      lexicon.keywords[SemanticTokenKind.SCOPE],
      lexicon.keywords[SemanticTokenKind.START],
      lexicon.keywords[SemanticTokenKind.ASYNC],
      lexicon.keywords[SemanticTokenKind.AWAIT],
      lexicon.keywords[SemanticTokenKind.WAIT_FOR],
    ],
  };
}
