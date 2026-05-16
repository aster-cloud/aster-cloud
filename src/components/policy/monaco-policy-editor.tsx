'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
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
import type { TypecheckDiagnostic } from '@aster-cloud/aster-lang-ts/browser';
import { violet, sky, emerald, amber, rose, zinc } from '@aster-cloud/tokens';

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
  /** 编辑器挂载回调，暴露 editor 实例供外部使用（如 AI Panel） */
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
  /** 启用 AI inline 补全（需要后端 /api/v1/ai/complete 端点） */
  enableAICompletion?: boolean;
  /** 租户 ID（AI 补全请求使用） */
  tenantId?: string;
  /** AI Panel 切换回调（Ctrl+Shift+G 触发） */
  onToggleAIPanel?: () => void;
  /** AI 解释选中代码回调（Ctrl+Shift+E 触发） */
  onExplainSelection?: (selectedText: string) => void;
}

// R23-Critical-2: AI complete 直连 aster-api 已停用。改走 server-side proxy
// `/api/llm/complete`（aster-cloud）做 NextAuth 鉴权 + HMAC 转签。

// NOTE: inlineCompletionTimer and inlineProviderDisposable are managed as
// component-scoped refs inside MonacoPolicyEditor to avoid cross-instance leaks.

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

/**
 * Aster Monaco theme.
 *
 * Replaces the default VS Code palette with a brand-aware scheme keyed on
 * @aster-cloud/tokens. The mapping intentionally surfaces *Aster CNL's
 * structural concepts* rather than mimicking JavaScript/TypeScript token
 * colors — `Module` and `Rule` declarations are the most important visual
 * landmarks in a policy, so they get the violet primary; relational
 * keywords (`has`, `given`, `option of`) lean on the sky accent; control
 * flow uses amber as "branching needs attention" affordance.
 *
 * Why hard-coded hex values rather than CSS variables: Monaco's defineTheme
 * API resolves colors at theme-definition time, not at render time. CSS
 * variables would yield literal "var(--aster-…)" strings to Monaco's
 * internal color parser → it would fall back to black. The tokens package
 * exports the same raw hex strings as `tokens.css`, so this stays in sync
 * with the rest of the brand via a single source.
 *
 * Monaco color string conventions:
 *   - `rules[].foreground`: 6-char hex WITHOUT '#' prefix (Monaco quirk)
 *   - `colors[*]`: 6/8-char hex WITH '#' prefix (8-char includes alpha)
 */

/** Strip leading '#' for use in Monaco's token-color rules. */
const hex = (c: string) => c.replace(/^#/, '');

/**
 * Token role → brand-color mapping. Each entry maps the Monaco token type
 * emitted by `setMonarchTokensProvider` (see registerAsterLanguage above)
 * to a light/dark hex pair pulled from the design tokens.
 *
 *   Module / Rule declarations  → violet (primary, strongest landmark)
 *   has / given / type concepts → sky    (accent, relational)
 *   if / otherwise / for each   → amber  (control flow, "branching")
 *   workflow / max attempts     → emerald (action / commit)
 *   wait for / async            → sky lighter (live / streaming)
 *   booleans + literals         → rose   (literals stand out)
 *   strings                     → amber 700 (warm content)
 *   numbers                     → emerald (quantitative "success")
 *   comments                    → muted neutral italic
 *   identifiers                 → fg (neutral)
 *   domain vocabulary           → sky italic (signals "domain word")
 *   brackets                    → violet (subtle scope anchors)
 */
function defineAsterTheme(monaco: typeof import('monaco-editor'), isDark: boolean) {
  const themeName = isDark ? 'aster-dark' : 'aster-light';

  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      // === Module / Rule declarations — the brand-defining landmarks ===
      { token: 'keyword.module',   foreground: hex(isDark ? violet[400] : violet[700]), fontStyle: 'bold' },
      { token: 'keyword.function', foreground: hex(isDark ? violet[300] : violet[600]), fontStyle: 'bold' },

      // === Type / structural keywords (has, given, as one of, …) ===
      { token: 'keyword.type',     foreground: hex(isDark ? sky[300] : sky[700]), fontStyle: 'bold' },
      { token: 'type',             foreground: hex(isDark ? sky[400] : sky[700]) },
      { token: 'keyword.variable', foreground: hex(isDark ? sky[300] : sky[700]) },

      // === Control flow (if, otherwise, for each) ===
      { token: 'keyword.control',  foreground: hex(isDark ? amber[300] : amber[700]), fontStyle: 'bold' },

      // === Workflow / commit keywords (max attempts, retry) ===
      { token: 'keyword.workflow', foreground: hex(isDark ? emerald[300] : emerald[700]), fontStyle: 'bold' },

      // === Async (wait for, after) — pairs with AI/streaming brand color ===
      { token: 'keyword.async',    foreground: hex(isDark ? sky[200] : sky[600]) },

      // === Effects (input/output, side effect markers) ===
      { token: 'keyword.effect',   foreground: hex(isDark ? emerald[200] : emerald[600]), fontStyle: 'italic' },

      // === Operators (and, or, not, divided by) — quiet neutral ===
      { token: 'keyword.operator', foreground: hex(isDark ? zinc[300] : zinc[700]) },

      // === Booleans + null/none — high-contrast rose so they pop ===
      { token: 'keyword.boolean',     foreground: hex(isDark ? rose[300] : rose[700]) },
      { token: 'constant.language',   foreground: hex(isDark ? rose[300] : rose[700]) },

      // === Strings (warm amber range — "human text") ===
      { token: 'string',          foreground: hex(isDark ? amber[200] : amber[800]) },
      { token: 'string.escape',   foreground: hex(isDark ? amber[400] : amber[600]) },
      { token: 'string.invalid',  foreground: hex(isDark ? rose[400] : rose[700]) },

      // === Numbers (emerald — quantitative truth) ===
      { token: 'number',          foreground: hex(isDark ? emerald[200] : emerald[700]) },
      { token: 'number.float',    foreground: hex(isDark ? emerald[200] : emerald[700]) },

      // === Comments (muted italic) ===
      { token: 'comment',         foreground: hex(isDark ? zinc[500] : zinc[500]), fontStyle: 'italic' },

      // === Identifiers (default neutral text) ===
      { token: 'identifier',      foreground: hex(isDark ? zinc[50] : zinc[900]) },

      // === Domain vocabulary terms — sky italic flags them as "your vocabulary" ===
      { token: 'variable.domain', foreground: hex(isDark ? sky[300] : sky[700]), fontStyle: 'italic' },

      // === Operators / delimiters (quiet so structure breathes) ===
      { token: 'operator',         foreground: hex(isDark ? zinc[300] : zinc[700]) },
      { token: 'delimiter',        foreground: hex(isDark ? zinc[400] : zinc[600]) },
      // Brackets carry subtle violet so scope is glanceable
      { token: 'delimiter.bracket', foreground: hex(isDark ? violet[300] : violet[600]) },
    ],
    colors: {
      // Editor chrome — pulled from semantic surface tokens.
      // Dark uses zinc-950 (matches dashboard dark surface) instead of
      // Monaco's stock #1e1e1e so the editor blends seamlessly with the
      // rest of the app rather than feeling like a foreign panel.
      'editor.background':                     isDark ? '#09090b' : '#ffffff',  // zinc-950 / white
      'editor.foreground':                     isDark ? '#fafafa' : '#18181b',  // zinc-50 / zinc-900
      'editorLineNumber.foreground':           isDark ? '#52525b' : '#a1a1aa',  // zinc-600 / zinc-400
      'editorLineNumber.activeForeground':     isDark ? '#a78bfa' : '#7c3aed',  // violet-400 / violet-600
      'editorCursor.foreground':               isDark ? '#a78bfa' : '#7c3aed',  // violet — brand-tinted caret
      // Selection — primary subtle so the text remains legible underneath.
      // Hex8 (RGBA) so we can dial the alpha and keep selection see-through.
      'editor.selectionBackground':            isDark ? '#7c3aed40' : '#7c3aed30',
      'editor.inactiveSelectionBackground':    isDark ? '#7c3aed20' : '#7c3aed18',
      'editor.lineHighlightBackground':        isDark ? '#27272a80' : '#fafafa', // zinc-800/50 alpha / zinc-50
      // Bracket-pair highlight follows the brand
      'editorBracketMatch.background':         isDark ? '#7c3aed30' : '#7c3aed15',
      'editorBracketMatch.border':             isDark ? '#a78bfa'   : '#7c3aed',
      // Indent guides — quiet
      'editorIndentGuide.background':          isDark ? '#27272a' : '#e4e4e7',
      'editorIndentGuide.activeBackground':    isDark ? '#3f3f46' : '#d4d4d8',
      // Find / replace UI
      'editor.findMatchBackground':            isDark ? '#7c3aed50' : '#7c3aed30',
      'editor.findMatchHighlightBackground':   isDark ? '#7c3aed30' : '#7c3aed18',
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
  onEditorReady,
  enableAICompletion = false,
  tenantId,
  onToggleAIPanel,
  onExplainSelection,
}: MonacoPolicyEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const inlineProviderDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const inlineCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolvedTheme } = useTheme();
  const t = useTranslations('diagnostics');
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  const isDark = resolvedTheme === 'dark';
  const lexicon = getLexicon(locale);

  // Map locale string to CNLLocale type for compiler
  // Handle both short ('zh', 'de') and full ('zh-CN', 'de-DE') locale formats
  const compilerLocale: CNLLocale = locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('de') ? 'de-DE' : 'en-US';

  // 获取领域词汇表
  const vocabulary = domain ? getVocabulary(domain, compilerLocale) : undefined;

  // Local compiler for real-time validation with accurate error positions
  const { diagnostics } = useAsterCompiler({
    editor: isEditorReady ? editorRef.current : null,
    monaco: isEditorReady ? monacoRef.current : null,
    locale: compilerLocale,
    domain,
    debounceDelay,
    enableValidation: true,
  });

  const { errorCount, warningCount } = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const d of diagnostics) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    return { errorCount: errors, warningCount: warnings };
  }, [diagnostics]);

  const revealDiagnostic = useCallback((diag: TypecheckDiagnostic) => {
    const ed = editorRef.current;
    if (!ed) return;
    const line = diag.span?.start?.line ?? 1;
    const col = diag.span?.start?.col ?? 1;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: col });
    ed.focus();
  }, []);

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

      // 注册快捷键：Ctrl+Shift+G / Cmd+Shift+G → 切换 AI Panel
      if (onToggleAIPanel) {
        editor.addAction({
          id: 'ai-toggle-panel',
          label: 'Toggle AI Assistant Panel',
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG,
          ],
          run: () => onToggleAIPanel(),
        });
      }

      // 注册快捷键：Ctrl+Shift+E / Cmd+Shift+E → 解释选中代码
      if (onExplainSelection) {
        editor.addAction({
          id: 'ai-explain-selection',
          label: 'AI Explain Selected Code',
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
          ],
          precondition: 'editorHasSelection',
          run: (ed) => {
            const selection = ed.getSelection();
            if (selection) {
              const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
              if (selectedText.trim()) {
                onExplainSelection(selectedText);
              }
            }
          },
        });
      }

      // 注册 AI inline 补全 provider
      if (enableAICompletion) {
        inlineProviderDisposableRef.current?.dispose();
        inlineProviderDisposableRef.current = monaco.languages.registerInlineCompletionsProvider(ASTER_LANG_ID, {
          provideInlineCompletions: async (model: editor.ITextModel, position: import('monaco-editor').Position, _context: import('monaco-editor').languages.InlineCompletionContext, token: import('monaco-editor').CancellationToken) => {
            // 取消前一个 debounce
            if (inlineCompletionTimerRef.current) clearTimeout(inlineCompletionTimerRef.current);

            // 仅在输入暂停 500ms 后触发
            return new Promise((resolve) => {
              inlineCompletionTimerRef.current = setTimeout(async () => {
                if (token.isCancellationRequested) {
                  resolve({ items: [] });
                  return;
                }

                const prefix = model.getValueInRange({
                  startLineNumber: Math.max(1, position.lineNumber - 10),
                  startColumn: 1,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                });

                if (!prefix.trim()) {
                  resolve({ items: [] });
                  return;
                }

                try {
                  // R23-Critical-2: 不再直连 aster-api，改走 server-side proxy
                  // /api/llm/complete。proxy 端做 NextAuth 鉴权 + HMAC 转签，
                  // 让 aster-api 的 InternalCallerFilter 能区分"已登录用户调用" vs
                  // "匿名公网调用"。caller-supplied X-Tenant-Id 不再被信任 ——
                  // server 端从 session 取真实 tenantId。
                  const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                  };

                  const abortCtrl = new AbortController();
                  token.onCancellationRequested(() => abortCtrl.abort());

                  const resp = await fetch(`/api/llm/complete`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ prefix, locale }),
                    signal: abortCtrl.signal,
                  });

                  if (!resp.ok || token.isCancellationRequested) {
                    resolve({ items: [] });
                    return;
                  }

                  const data = await resp.json();
                  const completion = data.completion;
                  if (!completion) {
                    resolve({ items: [] });
                    return;
                  }

                  resolve({
                    items: [{
                      insertText: completion,
                      range: {
                        startLineNumber: position.lineNumber,
                        startColumn: position.column,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                      },
                    }],
                  });
                } catch {
                  resolve({ items: [] });
                }
              }, 500);
            });
          },
          // Monaco 0.55+ 把旧 `freeInlineCompletions` 重命名为 `disposeInlineCompletions`，
          // 并改成 *必填*。缺它时编辑器 dispose 时报
          // "this.provider.disposeInlineCompletions is not a function" 然后整个 inline
          // completion 子系统崩。两个方法都放上保持向后兼容（旧版用 free，新版用 dispose）。
          freeInlineCompletions: () => {},
          disposeInlineCompletions: () => {},
        });
      }

      setIsEditorReady(true);
      onEditorReady?.(editor);
    },
    [lexicon, isDark, vocabulary, onEditorReady, enableAICompletion, tenantId, locale, onToggleAIPanel, onExplainSelection]
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

  // 组件卸载时释放 inline 补全 provider 及 timer，防止内存泄漏
  useEffect(() => {
    return () => {
      if (inlineCompletionTimerRef.current) clearTimeout(inlineCompletionTimerRef.current);
      inlineProviderDisposableRef.current?.dispose();
    };
  }, []);

  // 内容变更回调
  const handleChange: OnChange = useCallback(
    (value) => {
      onChange(value || '');
    },
    [onChange]
  );

  return (
    <div className="relative rounded-lg border border-border-strong dark:border-gray-600 [&_.monaco-editor]:rounded-lg">
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
          <div className="flex items-center justify-center h-full bg-bg dark:bg-gray-900 text-fg-muted dark:text-fg-subtle">
            Loading editor...
          </div>
        }
      />
      {!value && placeholder && (
        <div aria-hidden="true" className="absolute top-3 left-14 text-fg-muted pointer-events-none text-sm font-mono">
          {placeholder}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          {errorCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-200">
              {t('errors', { count: errorCount })}
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              {t('warnings', { count: warningCount })}
            </span>
          )}
          {errorCount === 0 && warningCount === 0 && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-200">
              {t('noIssues')}
            </span>
          )}
        </div>
        {(errorCount > 0 || warningCount > 0) && (
          <button
            type="button"
            onClick={() => setShowProblems(prev => !prev)}
            aria-expanded={showProblems}
            className="text-xs font-medium text-primary hover:text-primary"
          >
            {showProblems ? t('hideProblems') : t('viewProblems')}
          </button>
        )}
      </div>
      {showProblems && diagnostics.length > 0 && (
        <ul role="list" className="mt-2 rounded-lg border border-border bg-bg divide-y divide-border dark:border-gray-700 dark:bg-gray-900 dark:divide-gray-800">
          {diagnostics
            .filter(d => d.severity === 'error' || d.severity === 'warning')
            .map((diag, i) => (
              <li key={`${diag.message}-${i}`}>
                <button
                  type="button"
                  onClick={() => revealDiagnostic(diag)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-fg hover:bg-bg-subtle dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${diag.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{diag.message}</span>
                  <span className="shrink-0 text-fg-subtle">
                    L{diag.span?.start?.line ?? 1}:{diag.span?.start?.col ?? 1}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// 注意：示例策略模板已迁移至 @/config/aster-policy-templates.ts
// 以避免静态导入导致 Monaco 编辑器动态加载失效
