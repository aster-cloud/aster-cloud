/**
 * useAsterCompiler Hook
 *
 * Provides local CNL compilation using the aster-lang-ts browser bundle.
 * This is a lightweight alternative to the LSP hook that works in:
 * - Browser environments
 * - Cloudflare Workers/Pages
 * - Edge runtimes
 *
 * Features:
 * - Real-time syntax validation
 * - Local compilation to Core IR
 * - No external server required
 * - Debounced validation for performance
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import {
  compile,
  compileAndTypecheck,
  extractSchema,
  generateInputValues,
  EN_US,
  ZH_CN,
  DE_DE,
  type CompileResult,
  type SchemaResult,
  type ParameterInfo,
  type Lexicon,
  type TypecheckDiagnostic,
} from '@aster-cloud/aster-lang-ts/browser';

export type CNLLocale = 'en-US' | 'zh-CN' | 'de-DE';

/** Map locale strings to Lexicon objects */
const LEXICON_MAP: Record<CNLLocale, Lexicon> = {
  'en-US': EN_US,
  'zh-CN': ZH_CN,
  'de-DE': DE_DE,
};

export interface UseAsterCompilerOptions {
  /** Monaco editor instance */
  editor: editor.IStandaloneCodeEditor | null;
  /** Monaco instance (from @monaco-editor/react) */
  monaco: typeof import('monaco-editor') | null;
  /** CNL language locale */
  locale?: CNLLocale;
  /** Debounce delay for validation in ms */
  debounceDelay?: number;
  /** Enable real-time validation */
  enableValidation?: boolean;
}

export interface UseAsterCompilerResult {
  /** Last compilation result */
  compileResult: CompileResult | null;
  /** Whether currently compiling */
  compiling: boolean;
  /** Validation errors (for display) */
  errors: string[];
  /** Type check diagnostics with position information */
  diagnostics: TypecheckDiagnostic[];
  /** Manually compile the current source */
  compileSource: () => CompileResult | null;
  /** Manually validate the current source (includes type checking) */
  validate: () => TypecheckDiagnostic[];
  /** Clear all errors */
  clearErrors: () => void;
  /** Extract schema from source (for dynamic form generation) */
  getSchema: (functionName?: string) => SchemaResult | null;
  /** Generate sample input values from schema */
  getSampleInputs: (functionName?: string) => Record<string, unknown> | null;
}

/**
 * Hook for local CNL compilation without external LSP server
 *
 * @example
 * ```typescript
 * const { compileResult, errors, compileSource } = useAsterCompiler({
 *   editor: monacoEditor,
 *   locale: 'en-US',
 * });
 *
 * // Compile on demand
 * const result = compileSource();
 * if (result?.success) {
 *   console.log('Core IR:', result.core);
 * }
 * ```
 */
export function useAsterCompiler({
  editor,
  monaco,
  locale = 'en-US',
  debounceDelay = 300,
  enableValidation = true,
}: UseAsterCompilerOptions): UseAsterCompilerResult {
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<TypecheckDiagnostic[]>([]);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const monacoRef = useRef(monaco);
  monacoRef.current = monaco;

  const lexicon = LEXICON_MAP[locale];

  /**
   * Get the current source code from the editor
   */
  const getSource = useCallback((): string | null => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return null;
    const model = currentEditor.getModel();
    if (!model) return null;
    return model.getValue();
  }, []);

  /**
   * Apply diagnostics to Monaco editor as markers with proper position info
   */
  const applyDiagnostics = useCallback(
    (typecheckDiagnostics: TypecheckDiagnostic[]) => {
      const currentEditor = editorRef.current;
      const currentMonaco = monacoRef.current;

      if (!currentEditor || !currentMonaco) {
        return;
      }

      const model = currentEditor.getModel();
      if (!model) {
        return;
      }

      if (typecheckDiagnostics.length === 0) {
        // Clear markers
        currentMonaco.editor.setModelMarkers(model, 'aster-compiler', []);
        return;
      }

      // Convert TypecheckDiagnostic to Monaco markers with proper positions
      const markers = typecheckDiagnostics.map((diag) => {
        // Get severity
        const severity =
          diag.severity === 'error'
            ? currentMonaco.MarkerSeverity.Error
            : diag.severity === 'warning'
              ? currentMonaco.MarkerSeverity.Warning
              : currentMonaco.MarkerSeverity.Info;

        // Extract position from span (1-indexed for Monaco)
        // Aster uses 1-indexed positions, which matches Monaco
        const hasSpan = diag.span && diag.span.start && diag.span.end;
        const startLine = hasSpan ? diag.span!.start.line : 1;
        const startCol = hasSpan ? diag.span!.start.col : 1;
        const endLine = hasSpan ? diag.span!.end.line : startLine;
        const endCol = hasSpan ? diag.span!.end.col : model.getLineMaxColumn(startLine);

        return {
          severity,
          message: diag.message,
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
          code: diag.code,
          source: 'aster-compiler',
        };
      });

      currentMonaco.editor.setModelMarkers(model, 'aster-compiler', markers);
    },
    []
  );

  /**
   * Validate the current source (compile + typecheck)
   */
  const validate = useCallback((): TypecheckDiagnostic[] => {
    const source = getSource();
    if (!source) return [];

    try {
      const result = compileAndTypecheck(source, { lexicon });

      // Collect all diagnostics
      const allDiagnostics: TypecheckDiagnostic[] = [];

      // Add parse errors as diagnostics (now with position info)
      if (result.parseErrors && result.parseErrors.length > 0) {
        for (const err of result.parseErrors) {
          // ParseError is now an object with message and optional span
          const parseError = err as { message: string; span?: { start: { line: number; col: number }; end: { line: number; col: number } } };
          allDiagnostics.push({
            severity: 'error',
            code: 'E000' as import('@aster-cloud/aster-lang-ts/browser').TypecheckDiagnostic['code'],
            message: parseError.message,
            span: parseError.span,
          });
        }
      }

      // Add lowering errors as diagnostics
      if (result.loweringErrors && result.loweringErrors.length > 0) {
        for (const err of result.loweringErrors) {
          allDiagnostics.push({
            severity: 'error',
            code: 'E000' as import('@aster-cloud/aster-lang-ts/browser').TypecheckDiagnostic['code'],
            message: err,
          });
        }
      }

      // Add type check diagnostics (these have proper span info)
      if (result.typeErrors && result.typeErrors.length > 0) {
        allDiagnostics.push(...result.typeErrors);
      }

      setDiagnostics(allDiagnostics);
      setErrors(allDiagnostics.map((d) => d.message));
      return allDiagnostics;
    } catch (error) {
      const errorDiag: TypecheckDiagnostic = {
        severity: 'error',
        code: 'E000' as import('@aster-cloud/aster-lang-ts/browser').TypecheckDiagnostic['code'],
        message: error instanceof Error ? error.message : String(error),
      };
      setDiagnostics([errorDiag]);
      setErrors([errorDiag.message]);
      return [errorDiag];
    }
  }, [getSource, lexicon]);

  /**
   * Compile the current source
   */
  const compileSource = useCallback((): CompileResult | null => {
    const source = getSource();
    if (!source) return null;

    setCompiling(true);
    try {
      const result = compileAndTypecheck(source, { lexicon });
      setCompileResult(result);

      // Collect all diagnostics
      const allDiagnostics: TypecheckDiagnostic[] = [];

      // Add parse errors (now with position info)
      if (result.parseErrors && result.parseErrors.length > 0) {
        for (const err of result.parseErrors) {
          // ParseError is now an object with message and optional span
          const parseError = err as { message: string; span?: { start: { line: number; col: number }; end: { line: number; col: number } } };
          allDiagnostics.push({
            severity: 'error',
            code: 'E000' as import('@aster-cloud/aster-lang-ts/browser').TypecheckDiagnostic['code'],
            message: parseError.message,
            span: parseError.span,
          });
        }
      }

      // Add lowering errors
      if (result.loweringErrors && result.loweringErrors.length > 0) {
        for (const err of result.loweringErrors) {
          allDiagnostics.push({
            severity: 'error',
            code: 'E000' as import('@aster-cloud/aster-lang-ts/browser').TypecheckDiagnostic['code'],
            message: err,
          });
        }
      }

      // Add type check diagnostics
      if (result.typeErrors && result.typeErrors.length > 0) {
        allDiagnostics.push(...result.typeErrors);
      }

      setDiagnostics(allDiagnostics);
      setErrors(allDiagnostics.map((d) => d.message));

      return result;
    } finally {
      setCompiling(false);
    }
  }, [getSource, lexicon]);

  /**
   * Clear all errors
   */
  const clearErrors = useCallback(() => {
    setErrors([]);
    setDiagnostics([]);
    applyDiagnostics([]);
  }, [applyDiagnostics]);

  /**
   * Extract schema from source code for dynamic form generation
   */
  const getSchema = useCallback(
    (functionName?: string): SchemaResult | null => {
      const source = getSource();
      if (!source) return null;

      return extractSchema(source, { lexicon, functionName });
    },
    [getSource, lexicon]
  );

  /**
   * Generate sample input values from schema
   */
  const getSampleInputs = useCallback(
    (functionName?: string): Record<string, unknown> | null => {
      const schema = getSchema(functionName);
      if (!schema?.success || !schema.parameters) return null;

      return generateInputValues(schema.parameters);
    },
    [getSchema]
  );

  /**
   * Debounced validation on content change
   */
  const debouncedValidate = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      const validationDiagnostics = validate();
      applyDiagnostics(validationDiagnostics);
    }, debounceDelay);
  }, [validate, applyDiagnostics, debounceDelay]);

  // Set up content change listener for real-time validation
  useEffect(() => {
    if (!editor || !enableValidation) return;

    const model = editor.getModel();
    if (!model) return;

    // Initial validation
    const initialErrors = validate();
    applyDiagnostics(initialErrors);

    // Listen for content changes
    const disposable = model.onDidChangeContent(() => {
      debouncedValidate();
    });

    return () => {
      disposable.dispose();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [editor, enableValidation, validate, applyDiagnostics, debouncedValidate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    compileResult,
    compiling,
    errors,
    diagnostics,
    compileSource,
    validate,
    clearErrors,
    getSchema,
    getSampleInputs,
  };
}

// Re-export types for convenience
export type { SchemaResult, ParameterInfo } from '@aster-cloud/aster-lang-ts/browser';
