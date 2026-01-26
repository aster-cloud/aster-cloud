/**
 * Monaco Editor Configuration for Aster CNL
 *
 * Registers the Aster CNL language with Monaco editor, providing:
 * - Language registration
 * - Basic syntax highlighting (Monarch tokenizer)
 * - Language configuration (brackets, comments, etc.)
 *
 * Note: Full LSP features (diagnostics, completion, hover) are provided
 * by the LSP server connection via useAsterLSP hook.
 */

import type { Monaco } from '@monaco-editor/react';

/**
 * Register Aster CNL language with Monaco editor
 */
export function registerAsterLanguage(monaco: Monaco): void {
  // Check if already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((lang: { id: string }) => lang.id === 'aster-cnl')) {
    return;
  }

  // Register the language
  monaco.languages.register({
    id: 'aster-cnl',
    extensions: ['.aster', '.cnl'],
    aliases: ['Aster CNL', 'aster', 'cnl'],
    mimetypes: ['text/x-aster-cnl'],
  });

  // Set language configuration
  monaco.languages.setLanguageConfiguration('aster-cnl', {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['「', '」'], // Chinese quotes
      ['【', '】'], // Chinese brackets
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '「', close: '」' },
      { open: '【', close: '】' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '「', close: '」' },
    ],
    folding: {
      offSide: true, // Indent-based folding
    },
    indentationRules: {
      increaseIndentPattern: /:\s*$/,
      decreaseIndentPattern: /^\s*(Return|return|返回|Gib zurück)\b/,
    },
  });

  // Set Monarch tokenizer for syntax highlighting
  monaco.languages.setMonarchTokensProvider('aster-cnl', {
    defaultToken: 'invalid',

    // English keywords
    keywords: [
      'This',
      'module',
      'is',
      'Define',
      'with',
      'To',
      'produce',
      'Return',
      'Match',
      'When',
      'If',
      'Then',
      'Else',
      'And',
      'Or',
      'Not',
      'It',
      'performs',
      'use',
      'capability',
      'greater',
      'less',
      'than',
      'equal',
      'to',
      'at',
      'least',
      'most',
      'between',
      'and',
      'or',
      'not',
      'true',
      'false',
      'null',
      'otherwise',
      'For',
      'each',
      'in',
      'Set',
      'as',
    ],

    // Chinese keywords
    chineseKeywords: [
      '模块',
      '定义',
      '函数',
      '当',
      '则',
      '如果',
      '那么',
      '否则',
      '返回',
      '并且',
      '或者',
      '不',
      '真',
      '假',
      '空',
      '包含',
      '令',
      '为',
      '产出',
      '大于',
      '小于',
      '等于',
      '至少',
      '至多',
      '介于',
      '之间',
      '遍历',
      '设置',
      '若',
      '能力',
      '使用',
      '执行',
    ],

    // German keywords
    germanKeywords: [
      'Dieses',
      'Modul',
      'ist',
      'Definiere',
      'mit',
      'Um',
      'erzeuge',
      'Gib',
      'zurück',
      'Falls',
      'Dann',
      'Sonst',
      'Und',
      'Oder',
      'Nicht',
      'Prüfe',
      'Wenn',
      'wahr',
      'falsch',
      'null',
      'größer',
      'kleiner',
      'als',
      'gleich',
      'mindestens',
      'höchstens',
      'zwischen',
      'Für',
      'jedes',
      'in',
      'Setze',
      'auf',
    ],

    // Type keywords (all languages)
    typeKeywords: [
      // English
      'Int',
      'Text',
      'Bool',
      'Decimal',
      'List',
      'Option',
      'Date',
      'DateTime',
      'Duration',
      'Money',
      'Percentage',
      // Chinese
      '整数',
      '文本',
      '布尔',
      '小数',
      '列表',
      '可选',
      '日期',
      '时间',
      '时长',
      '金额',
      '百分比',
      // German
      'Ganzzahl',
      'Dezimal',
      'Wahrheitswert',
      'Liste',
      'Optional',
      'Datum',
      'Zeitstempel',
      'Dauer',
      'Geld',
      'Prozent',
    ],

    operators: [
      '=',
      '>',
      '<',
      '>=',
      '<=',
      '!=',
      '==',
      '+',
      '-',
      '*',
      '/',
      '%',
      ':',
      '.',
      ',',
      '，', // Chinese comma
      '。', // Chinese period
      '：', // Chinese colon
      '、', // Chinese enumeration comma
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // Chinese bracket markers 【模块】【定义】
        [/【[^】]+】/, 'keyword.control'],

        // Identifiers and keywords
        [
          /[a-zA-Z_\u4e00-\u9fa5\u00C0-\u024F][\w\u4e00-\u9fa5\u00C0-\u024F]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@chineseKeywords': 'keyword',
              '@germanKeywords': 'keyword',
              '@typeKeywords': 'type',
              '@default': 'identifier',
            },
          },
        ],

        // Whitespace
        { include: '@whitespace' },

        // Delimiters and operators
        [/[{}()\[\]]/, '@brackets'],
        [/[「」【】]/, '@brackets'], // Chinese brackets
        [
          /@symbols/,
          {
            cases: {
              '@operators': 'operator',
              '@default': '',
            },
          },
        ],

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/\d+/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-terminated string
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
        [/'([^'\\]|\\.)*$/, 'string.invalid'], // non-terminated string
        [/'/, { token: 'string.quote', bracket: '@open', next: '@stringSingle' }],
        // Chinese strings
        [/「/, { token: 'string.quote', bracket: '@open', next: '@stringChinese' }],
      ],

      comment: [
        [/[^#]+/, 'comment'],
        [/#/, 'comment'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      stringSingle: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      stringChinese: [
        [/[^」\\]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/」/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/#.*$/, 'comment'],
      ],
    },
  });
}

/**
 * Configure Monaco editor theme for Aster CNL
 */
export function configureAsterTheme(monaco: Monaco): void {
  // Define custom theme colors for Aster CNL
  monaco.editor.defineTheme('aster-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '0000FF', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: 'AF00DB', fontStyle: 'bold' },
      { token: 'type', foreground: '267F99' },
      { token: 'identifier', foreground: '001080' },
      { token: 'number', foreground: '098658' },
      { token: 'string', foreground: 'A31515' },
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'operator', foreground: '000000' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
    },
  });

  monaco.editor.defineTheme('aster-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'identifier', foreground: '9CDCFE' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'operator', foreground: 'D4D4D4' },
    ],
    colors: {
      'editor.background': '#1E1E1E',
    },
  });
}

/**
 * Get recommended editor options for Aster CNL
 */
export function getAsterEditorOptions(): import('monaco-editor').editor.IStandaloneEditorConstructionOptions {
  return {
    language: 'aster-cnl',
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: true,
      bracketPairs: true,
    },
    suggest: {
      showKeywords: true,
      showSnippets: true,
    },
    quickSuggestions: {
      other: true,
      comments: false,
      strings: false,
    },
  };
}
