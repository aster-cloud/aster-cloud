'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from 'next-themes';
import {
  getLexicon,
  getKeywordsByCategory,
  getVocabulary,
  extractVocabularyTerms,
  initBuiltinVocabularies,
  type Lexicon,
  type DomainVocabulary,
} from '@/lib/aster-lexicon';
import { useAsterCompiler, type CNLLocale } from '@/hooks/useAsterCompiler';

// Monaco 语言 ID
const ASTER_LANG_ID = 'aster-cnl';

// 模块级初始化内置词汇表（幂等，仅执行一次）
initBuiltinVocabularies();

// 语言注册状态
let languageRegistered = false;

interface MonacoPolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  locale?: string;
  /** 领域标识符（如 'insurance.auto'），启用领域术语补全和高亮 */
  domain?: string;
  height?: string;
  readOnly?: boolean;
  placeholder?: string;
  /** Debounce delay for validation in ms (default: 300) */
  debounceDelay?: number;
}

// 注册 Aster Lang 语言
function registerAsterLanguage(
  monaco: typeof import('monaco-editor'),
  lexicon: Lexicon,
  vocabulary?: DomainVocabulary
) {
  // 只注册一次语言
  if (!languageRegistered) {
    monaco.languages.register({ id: ASTER_LANG_ID });
    languageRegistered = true;
  }

  const keywords = getKeywordsByCategory(lexicon);

  // 提取领域词汇表术语
  const domainTerms = vocabulary ? extractVocabularyTerms(vocabulary) : [];

  // 设置语言的 Token 规则
  monaco.languages.setMonarchTokensProvider(ASTER_LANG_ID, {
    // 关键词分类
    moduleKeywords: keywords.module,
    typeKeywords: keywords.type,
    functionKeywords: keywords.function,
    controlKeywords: keywords.control,
    variableKeywords: keywords.variable,
    booleanKeywords: keywords.boolean,
    operatorKeywords: keywords.operator,
    literalKeywords: keywords.literal,
    primitiveTypeKeywords: keywords.primitiveType,
    workflowKeywords: keywords.workflow,
    asyncKeywords: keywords.async,
    domainTerms,

    // Token 化规则
    tokenizer: {
      root: [
        // 注释 (// 或 # 开头)
        [/\/\/.*$/, 'comment'],
        [/#.*$/, 'comment'],

        // 字符串 (支持多种引号)
        [/"([^"\\]|\\.)*$/, 'string.invalid'], // 未闭合的字符串
        [/"/, 'string', '@string_double'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/'/, 'string', '@string_single'],
        [/「/, 'string', '@string_chinese'],

        // 数字
        [/\d+\.\d*/, 'number.float'],
        [/\.\d+/, 'number.float'],
        [/\d+/, 'number'],

        // 标识符和关键词
        [
          /[a-zA-Z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*/,
          {
            cases: {
              '@moduleKeywords': 'keyword.module',
              '@typeKeywords': 'keyword.type',
              '@functionKeywords': 'keyword.function',
              '@controlKeywords': 'keyword.control',
              '@variableKeywords': 'keyword.variable',
              '@booleanKeywords': 'keyword.boolean',
              '@operatorKeywords': 'keyword.operator',
              '@literalKeywords': 'constant.language',
              '@primitiveTypeKeywords': 'type',
              '@workflowKeywords': 'keyword.workflow',
              '@asyncKeywords': 'keyword.async',
              '@domainTerms': 'variable.domain',
              '@default': 'identifier',
            },
          },
        ],

        // 多词关键词匹配
        [/as one of/i, 'keyword.type'],
        [/it performs/i, 'keyword.function'],
        [/for each/i, 'keyword.control'],
        [/divided by/i, 'keyword.operator'],
        [/less than/i, 'keyword.operator'],
        [/greater than/i, 'keyword.operator'],
        [/equals to/i, 'keyword.operator'],
        [/option of/i, 'keyword.type'],
        [/result of/i, 'keyword.type'],
        [/ok of/i, 'keyword.type'],
        [/err of/i, 'keyword.type'],
        [/some of/i, 'keyword.type'],
        [/wait for/i, 'keyword.async'],
        [/max attempts/i, 'keyword.workflow'],

        // 中文多词关键词
        [/为以下之一/, 'keyword.type'],
        [/对每个/, 'keyword.control'],
        [/最多尝试/, 'keyword.workflow'],
        [/输入输出/, 'keyword.effect'],

        // 运算符
        [/[+\-*/<>=!]+/, 'operator'],

        // 标点符号
        [/[{}()\[\]]/, 'delimiter.bracket'],
        [/[;,.:：。，、]/, 'delimiter'],

        // 空白
        [/\s+/, 'white'],
      ],

      // 双引号字符串
      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      // 单引号字符串
      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],

      // 中文引号字符串
      string_chinese: [
        [/[^」]+/, 'string'],
        [/」/, 'string', '@pop'],
      ],
    },
  });

  // 设置语言配置（括号匹配、注释等）
  monaco.languages.setLanguageConfiguration(ASTER_LANG_ID, {
    comments: {
      lineComment: '//',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['【', '】'],
      ['「', '」'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '【', close: '】' },
      { open: '「', close: '」' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '【', close: '】' },
      { open: '「', close: '」' },
    ],
    indentationRules: {
      increaseIndentPattern: /:\s*$/,
      decreaseIndentPattern: /^\s*(otherwise|否则|when|当)/,
    },
  });
}

// 定义主题
function defineAsterTheme(monaco: typeof import('monaco-editor'), isDark: boolean) {
  const themeName = isDark ? 'aster-dark' : 'aster-light';

  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      // 关键词颜色
      { token: 'keyword.module', foreground: isDark ? 'C586C0' : '7B3AA4', fontStyle: 'bold' },
      { token: 'keyword.type', foreground: isDark ? '4EC9B0' : '267F99', fontStyle: 'bold' },
      { token: 'keyword.function', foreground: isDark ? 'DCDCAA' : '795E26', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: isDark ? 'C586C0' : 'AF00DB' },
      { token: 'keyword.variable', foreground: isDark ? '569CD6' : '0000FF' },
      { token: 'keyword.boolean', foreground: isDark ? '569CD6' : '0000FF' },
      { token: 'keyword.operator', foreground: isDark ? 'D4D4D4' : '000000' },
      { token: 'keyword.workflow', foreground: isDark ? 'CE9178' : 'A31515', fontStyle: 'bold' },
      { token: 'keyword.async', foreground: isDark ? '4FC1FF' : '0070C1' },
      { token: 'keyword.effect', foreground: isDark ? 'B5CEA8' : '098658' },

      // 类型
      { token: 'type', foreground: isDark ? '4EC9B0' : '267F99' },

      // 常量和字面量
      { token: 'constant.language', foreground: isDark ? '569CD6' : '0000FF' },

      // 字符串
      { token: 'string', foreground: isDark ? 'CE9178' : 'A31515' },
      { token: 'string.escape', foreground: isDark ? 'D7BA7D' : 'EE0000' },
      { token: 'string.invalid', foreground: isDark ? 'F44747' : 'CD3131' },

      // 数字
      { token: 'number', foreground: isDark ? 'B5CEA8' : '098658' },
      { token: 'number.float', foreground: isDark ? 'B5CEA8' : '098658' },

      // 注释
      { token: 'comment', foreground: isDark ? '6A9955' : '008000', fontStyle: 'italic' },

      // 标识符
      { token: 'identifier', foreground: isDark ? '9CDCFE' : '001080' },

      // 领域术语（青绿色斜体，与函数色 DCDCAA/795E26 区分）
      { token: 'variable.domain', foreground: isDark ? '4EC9B0' : '267F99', fontStyle: 'italic' },

      // 运算符和分隔符
      { token: 'operator', foreground: isDark ? 'D4D4D4' : '000000' },
      { token: 'delimiter', foreground: isDark ? 'D4D4D4' : '000000' },
      { token: 'delimiter.bracket', foreground: isDark ? 'FFD700' : 'AF9500' },
    ],
    colors: {
      'editor.background': isDark ? '#1e1e1e' : '#ffffff',
      'editor.foreground': isDark ? '#d4d4d4' : '#000000',
      'editorLineNumber.foreground': isDark ? '#858585' : '#237893',
      'editorCursor.foreground': isDark ? '#aeafad' : '#000000',
      'editor.selectionBackground': isDark ? '#264f78' : '#add6ff',
      'editor.inactiveSelectionBackground': isDark ? '#3a3d41' : '#e5ebf1',
    },
  });

  return themeName;
}

export function MonacoPolicyEditor({
  value,
  onChange,
  locale = 'en',
  domain,
  height = '400px',
  readOnly = false,
  placeholder,
  debounceDelay = 300,
}: MonacoPolicyEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const { resolvedTheme } = useTheme();
  const [isEditorReady, setIsEditorReady] = useState(false);

  const isDark = resolvedTheme === 'dark';
  const lexicon = getLexicon(locale);

  // Map locale string to CNLLocale type for compiler
  // Handle both short ('zh', 'de') and full ('zh-CN', 'de-DE') locale formats
  const compilerLocale: CNLLocale = locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('de') ? 'de-DE' : 'en-US';

  // 获取领域词汇表
  const vocabulary = domain ? getVocabulary(domain, compilerLocale) : undefined;

  // Local compiler for real-time validation with accurate error positions
  useAsterCompiler({
    editor: isEditorReady ? editorRef.current : null,
    monaco: isEditorReady ? monacoRef.current : null,
    locale: compilerLocale,
    domain,
    debounceDelay,
    enableValidation: true,
  });

  // 编辑器挂载回调
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // 注册 Aster Lang 语言
      registerAsterLanguage(monaco, lexicon, vocabulary);

      // 定义并应用主题
      const themeName = defineAsterTheme(monaco, isDark);
      monaco.editor.setTheme(themeName);

      setIsEditorReady(true);
    },
    [lexicon, isDark, vocabulary]
  );

  // 主题切换时更新
  useEffect(() => {
    if (monacoRef.current && isEditorReady) {
      const themeName = defineAsterTheme(monacoRef.current, isDark);
      monacoRef.current.editor.setTheme(themeName);
    }
  }, [isDark, isEditorReady]);

  // 语言或领域切换时更新词法
  useEffect(() => {
    if (monacoRef.current && isEditorReady) {
      registerAsterLanguage(monacoRef.current, lexicon, vocabulary);
    }
  }, [locale, lexicon, domain, vocabulary, isEditorReady]);

  // 内容变更回调
  const handleChange: OnChange = useCallback(
    (value) => {
      onChange(value || '');
    },
    [onChange]
  );

  return (
    <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 [&_.monaco-editor]:rounded-lg">
      <Editor
        height={height}
        language={ASTER_LANG_ID}
        value={value}
        onChange={handleChange}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, monospace",
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          padding: { top: 12, bottom: 12 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
          // 修复 hover tooltip 超出边界被裁剪的问题
          fixedOverflowWidgets: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
            Loading editor...
          </div>
        }
      />
      {!value && placeholder && (
        <div className="absolute top-3 left-14 text-gray-500 pointer-events-none text-sm font-mono">
          {placeholder}
        </div>
      )}
    </div>
  );
}

// 注意：示例策略模板已迁移至 @/config/aster-policy-templates.ts
// 以避免静态导入导致 Monaco 编辑器动态加载失效
