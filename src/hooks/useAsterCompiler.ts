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
  validateSyntax,
  extractSchema,
  generateInputValues,
  EN_US,
  ZH_CN,
  DE_DE,
  type CompileResult,
  type SchemaResult,
  type ParameterInfo,
  type Lexicon,
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
  /** Manually compile the current source */
  compileSource: () => CompileResult | null;
  /** Manually validate the current source */
  validate: () => string[];
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
  locale = 'en-US',
  debounceDelay = 300,
  enableValidation = true,
}: UseAsterCompilerOptions): UseAsterCompilerResult {
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

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
   * Apply diagnostics to Monaco editor as markers
   */
  const applyDiagnostics = useCallback(
    async (diagnosticErrors: string[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const model = currentEditor.getModel();
      if (!model) return;

      // Dynamic import to avoid SSR issues
      const monaco = await import('monaco-editor');

      if (diagnosticErrors.length === 0) {
        // Clear markers
        monaco.editor.setModelMarkers(model, 'aster-compiler', []);
        return;
      }

      // Convert error messages to Monaco markers
      // For now, show errors at line 1 since we don't have position info
      // TODO: Parse error messages to extract line/column info
      const markers = diagnosticErrors.map((message, index) => ({
        severity: monaco.MarkerSeverity.Error,
        message,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: model.getLineMaxColumn(1),
        // Use index to make markers unique
        source: `aster-compiler-${index}`,
      }));

      monaco.editor.setModelMarkers(model, 'aster-compiler', markers);
    },
    []
  );

  /**
   * Validate the current source
   */
  const validate = useCallback((): string[] => {
    const source = getSource();
    if (!source) return [];

    const validationErrors = validateSyntax(source, lexicon);
    setErrors(validationErrors);
    return validationErrors;
  }, [getSource, lexicon]);

  /**
   * Compile the current source
   */
  const compileSource = useCallback((): CompileResult | null => {
    const source = getSource();
    if (!source) return null;

    setCompiling(true);
    try {
      const result = compile(source, { lexicon });
      setCompileResult(result);

      // Extract errors from result
      const allErrors = [
        ...(result.parseErrors || []),
        ...(result.loweringErrors || []),
      ];
      setErrors(allErrors);

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
      const validationErrors = validate();
      applyDiagnostics(validationErrors);
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
    compileSource,
    validate,
    clearErrors,
    getSchema,
    getSampleInputs,
  };
}

// Re-export types for convenience
export type { SchemaResult, ParameterInfo } from '@aster-cloud/aster-lang-ts/browser';
