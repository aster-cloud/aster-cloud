/**
 * Local Compiler Service for Aster CNL
 *
 * Provides local compilation capabilities using @aster-cloud/aster-lang-ts.
 * This service handles parsing, type checking, and schema extraction
 * while keeping actual execution on the remote API.
 *
 * Compilation Pipeline: canonicalize → lex → parse → lowerModule → typecheck
 */

// Type definitions for local compilation
export type CNLLocale = 'en-US' | 'zh-CN' | 'de-DE';
export type CompilerStage = 'canonicalize' | 'lex' | 'parse' | 'lower' | 'typecheck';

export interface LocalCompilationOptions {
  /** CNL source code */
  source: string;
  /** Language locale for lexicon */
  locale?: CNLLocale;
  /** Target function name for schema extraction */
  functionName?: string;
  /** Whether to extract schema from AST */
  collectSchema?: boolean;
}

export interface LocalSchemaFieldInfo {
  /** Field name */
  name: string;
  /** Field type name */
  type: string;
  /** Field type category */
  typeKind: string;
}

export interface LocalSchemaParameter {
  /** Parameter name */
  name: string;
  /** Type name (e.g., "Int", "Text", "LoanApplication") */
  type: string;
  /** Type category (e.g., "primitive", "struct", "enum") */
  typeKind: string;
  /** Whether parameter is optional */
  optional: boolean;
  /** Parameter position (0-based) */
  position: number;
  /** Struct fields (only for struct types) */
  fields?: LocalSchemaFieldInfo[];
}

export interface LocalDiagnostic {
  /** Severity level */
  severity: 'error' | 'warning' | 'info' | 'hint';
  /** Error/warning message */
  message: string;
  /** Start line (1-based) */
  startLine: number;
  /** Start column (1-based) */
  startColumn: number;
  /** End line (1-based) */
  endLine: number;
  /** End column (1-based) */
  endColumn: number;
  /** Error code (optional) */
  code?: string;
  /** Which compiler stage produced this diagnostic */
  stage: CompilerStage;
}

export interface LocalCompilationResult {
  /** Whether compilation succeeded without errors */
  success: boolean;
  /** Canonicalized source code */
  canonicalSource?: string;
  /** Module name from AST */
  moduleName?: string;
  /** List of function names in the module */
  functionNames?: string[];
  /** Extracted schema for the target function */
  schema?: {
    functionName: string;
    parameters: LocalSchemaParameter[];
  };
  /** Compilation diagnostics (errors, warnings, etc.) */
  diagnostics: LocalDiagnostic[];
  /** Whether result came from cache */
  cacheHit?: boolean;
}

// Simple in-memory LRU cache for compilation results
const CACHE_TTL_MS = 30_000; // 30 seconds
const CACHE_MAX_SIZE = 100; // Maximum number of cached entries

interface CacheEntry {
  result: LocalCompilationResult;
  timestamp: number;
}

const compilationCache = new Map<string, CacheEntry>();

/**
 * Evict expired entries and enforce max size (LRU)
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  // Find expired entries
  for (const [key, entry] of compilationCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) {
      expiredKeys.push(key);
    }
  }

  // Remove expired entries
  for (const key of expiredKeys) {
    compilationCache.delete(key);
  }

  // Enforce max size (remove oldest entries)
  while (compilationCache.size > CACHE_MAX_SIZE) {
    const firstKey = compilationCache.keys().next().value;
    if (firstKey) {
      compilationCache.delete(firstKey);
    } else {
      break;
    }
  }
}

/**
 * Custom error class for compiler pipeline failures
 */
class CompilerPipelineError extends Error {
  constructor(
    public readonly stage: CompilerStage,
    public readonly originalError: unknown
  ) {
    super(
      originalError instanceof Error
        ? originalError.message
        : typeof originalError === 'string'
          ? originalError
          : 'Unknown compiler error'
    );
    this.name = 'CompilerPipelineError';
  }
}

/**
 * Compile CNL source code locally.
 *
 * Runs the full compilation pipeline:
 * 1. canonicalize - Normalize source text
 * 2. lex - Tokenize into token stream
 * 3. parse - Build AST
 * 4. lowerModule - Convert to Core IR
 * 5. typecheck - Validate types
 *
 * @param options - Compilation options
 * @returns Compilation result with diagnostics and optional schema
 */
export async function compileLocally(options: LocalCompilationOptions): Promise<LocalCompilationResult> {
  const locale = options.locale ?? 'en-US';
  const shouldCollectSchema = options.collectSchema !== false;

  // Generate cache key
  const cacheKey = JSON.stringify({
    source: options.source,
    locale,
    functionName: options.functionName ?? '',
    collectSchema: shouldCollectSchema,
  });

  // Cleanup expired entries periodically
  cleanupCache();

  // Check cache
  const cached = compilationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Move to end for LRU (delete and re-add)
    compilationCache.delete(cacheKey);
    compilationCache.set(cacheKey, cached);
    return { ...cached.result, cacheHit: true };
  }

  // Dynamic import to handle ESM module
  let Compiler: typeof import('@aster-cloud/aster-lang-ts');
  try {
    Compiler = await import('@aster-cloud/aster-lang-ts');
  } catch (importError) {
    console.error('[LocalCompiler] Failed to import @aster-cloud/aster-lang-ts:', importError);
    return {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          message: 'Compiler module not available. Please ensure @aster-cloud/aster-lang-ts is installed.',
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
          stage: 'canonicalize',
        },
      ],
      cacheHit: false,
    };
  }

  let canonicalSource = options.source;
  const diagnostics: LocalDiagnostic[] = [];

  try {
    // Stage 1: Canonicalize
    const lexicon = await loadLexicon(Compiler, locale);
    canonicalSource = runStage('canonicalize', () => Compiler.canonicalize(options.source, lexicon));

    // Stage 2: Lex
    const tokens = runStage('lex', () => Compiler.lex(canonicalSource, lexicon));

    // Stage 2.5: Keyword Translation (for non-English locales)
    // Translate Chinese/German keywords to English before parsing
    // (parser uses hardcoded English keyword recognition)
    let translatedTokens = tokens;
    if (locale !== 'en-US' && lexicon && Compiler.needsKeywordTranslation && Compiler.createKeywordTranslator) {
      if (Compiler.needsKeywordTranslation(lexicon)) {
        const translator = Compiler.createKeywordTranslator(lexicon);
        translatedTokens = translator.translateTokens(tokens);
      }
    }

    // Stage 3: Parse
    const ast = runStage('parse', () => Compiler.parse(translatedTokens));

    // Stage 4: Lower to Core IR
    const coreModule = runStage('lower', () => Compiler.lowerModule(ast));

    // Note: Typecheck is not exported by aster-lang-ts v0.0.1
    // Type checking happens on the remote API during execution

    // Extract module info
    const moduleName = extractModuleName(coreModule) ?? extractModuleName(ast);
    const functionNames = extractFunctionNames(coreModule) ?? extractFunctionNames(ast);

    // Extract schema if requested
    const schema = shouldCollectSchema
      ? extractSchema(coreModule, ast, options.functionName)
      : undefined;

    // Only errors count as failure
    const hasErrors = diagnostics.some((d) => d.severity === 'error');

    const result: LocalCompilationResult = {
      success: !hasErrors,
      canonicalSource,
      moduleName,
      functionNames,
      schema,
      diagnostics,
      cacheHit: false,
    };

    // Cache the result
    compilationCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  } catch (error) {
    const stage = error instanceof CompilerPipelineError ? error.stage : 'parse';
    diagnostics.push(createErrorDiagnostic(stage, error));

    const result: LocalCompilationResult = {
      success: false,
      canonicalSource,
      diagnostics,
      cacheHit: false,
    };

    // Cache failures too (short-circuit repeated bad compilations)
    compilationCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }
}

// Import lexicon type
type Lexicon = import('@aster-cloud/aster-lang-ts/lexicons/types').Lexicon;

/**
 * Load lexicon for the specified locale
 */
async function loadLexicon(
  _Compiler: typeof import('@aster-cloud/aster-lang-ts'),
  locale: CNLLocale
): Promise<Lexicon | undefined> {
  try {
    // Try to load locale-specific lexicon
    switch (locale) {
      case 'zh-CN': {
        const zhModule = await import('@aster-cloud/aster-lang-ts/lexicons/zh-CN').catch(() => null);
        if (zhModule?.ZH_CN) return zhModule.ZH_CN;
        break;
      }
      case 'de-DE': {
        const deModule = await import('@aster-cloud/aster-lang-ts/lexicons/de-DE').catch(() => null);
        if (deModule?.DE_DE) return deModule.DE_DE;
        break;
      }
      case 'en-US':
      default: {
        const enModule = await import('@aster-cloud/aster-lang-ts/lexicons/en-US').catch(() => null);
        if (enModule?.EN_US) return enModule.EN_US;
        break;
      }
    }
  } catch {
    // Lexicon import failed, use default
  }

  // Fallback: return undefined (lexer will use default)
  return undefined;
}

/**
 * Run a compilation stage with error wrapping
 */
function runStage<T>(stage: CompilerStage, runner: () => T): T {
  try {
    return runner();
  } catch (error) {
    throw new CompilerPipelineError(stage, error);
  }
}

/**
 * Create a diagnostic from an error
 */
function createErrorDiagnostic(stage: CompilerStage, error: unknown): LocalDiagnostic {
  const rootError = error instanceof CompilerPipelineError ? error.originalError : error;
  const range = extractErrorRange(rootError);

  return {
    severity: 'error',
    message: extractErrorMessage(rootError),
    startLine: range.startLine,
    startColumn: range.startColumn,
    endLine: range.endLine,
    endColumn: range.endColumn,
    code: extractErrorCode(rootError),
    stage,
  };
}

/**
 * Extract error message from various error shapes
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string') return e.error;
  }
  return 'Unknown compiler error';
}

/**
 * Extract error code from error object
 */
function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.code === 'string') return e.code;
    if (typeof e.errorCode === 'string') return e.errorCode;
  }
  return undefined;
}

/**
 * Extract line/column range from error or diagnostic
 */
function extractErrorRange(error: unknown): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  const defaultRange = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };

  if (!error || typeof error !== 'object') {
    return defaultRange;
  }

  const e = error as Record<string, unknown>;

  // Try direct properties
  const startLine = getNumberProp(e, ['startLine', 'line', 'lineNumber']) ?? 1;
  const startColumn = getNumberProp(e, ['startColumn', 'column', 'col']) ?? 1;
  const endLine = getNumberProp(e, ['endLine']) ?? startLine;
  const endColumn = getNumberProp(e, ['endColumn']) ?? startColumn;

  // Try nested span/range/location
  const span = e.span ?? e.range ?? e.location;
  if (span && typeof span === 'object') {
    const s = span as Record<string, unknown>;
    const start = s.start as Record<string, unknown> | undefined;
    const end = s.end as Record<string, unknown> | undefined;

    if (start && typeof start === 'object') {
      return {
        startLine: getNumberProp(start, ['line']) ?? startLine,
        startColumn: getNumberProp(start, ['column', 'col']) ?? startColumn,
        endLine: end && typeof end === 'object' ? (getNumberProp(end as Record<string, unknown>, ['line']) ?? startLine) : startLine,
        endColumn: end && typeof end === 'object' ? (getNumberProp(end as Record<string, unknown>, ['column', 'col']) ?? startColumn) : startColumn,
      };
    }
  }

  return { startLine, startColumn, endLine, endColumn };
}

/**
 * Get a numeric property from an object, trying multiple property names
 */
function getNumberProp(obj: Record<string, unknown>, props: string[]): number | undefined {
  for (const prop of props) {
    const val = obj[prop];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return Math.max(1, Math.floor(val));
    }
  }
  return undefined;
}

/**
 * Extract module name from AST or Core IR
 */
function extractModuleName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;

  if (typeof n.name === 'string') return n.name;
  if (typeof n.moduleName === 'string') return n.moduleName;
  if (n.identifier && typeof (n.identifier as Record<string, unknown>).name === 'string') {
    return (n.identifier as Record<string, unknown>).name as string;
  }

  return undefined;
}

/**
 * Extract function names from AST or Core IR
 */
function extractFunctionNames(node: unknown): string[] | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;

  // Try various array properties that might contain declarations
  const declArrays = [n.decls, n.declarations, n.functions, n.items];

  for (const arr of declArrays) {
    if (Array.isArray(arr)) {
      const names: string[] = [];
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const i = item as Record<string, unknown>;
          // Check if it's a function declaration
          const kind = typeof i.kind === 'string' ? i.kind.toLowerCase() : '';
          if (kind === 'func' || kind === 'function' || i.parameters !== undefined || i.params !== undefined) {
            const name = extractModuleName(item);
            if (name) names.push(name);
          }
        }
      }
      if (names.length > 0) return names;
    }
  }

  return undefined;
}

/**
 * Extract schema for a function from AST/Core IR
 */
function extractSchema(
  coreModule: unknown,
  ast: unknown,
  targetFunctionName?: string
): LocalCompilationResult['schema'] | undefined {
  // Try Core IR first, then AST
  const schema = extractSchemaFromNode(coreModule, targetFunctionName);
  if (schema) return schema;
  return extractSchemaFromNode(ast, targetFunctionName);
}

/**
 * 结构体字段信息（用于 schema）
 */
interface StructFieldInfo {
  name: string;
  type: string;
  typeKind: string;
}

/**
 * 结构体定义映射
 */
type StructDefinitions = Map<string, StructFieldInfo[]>;

/**
 * Extract struct (Data) definitions from module
 */
function extractStructDefinitions(node: unknown): StructDefinitions {
  const definitions = new Map<string, StructFieldInfo[]>();

  if (!node || typeof node !== 'object') return definitions;
  const n = node as Record<string, unknown>;

  const declArrays = [n.decls, n.declarations, n.items];

  for (const arr of declArrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const i = item as Record<string, unknown>;
          const kind = typeof i.kind === 'string' ? i.kind.toLowerCase() : '';

          // 查找 Data 声明（结构体定义）
          if (kind === 'data') {
            const name = typeof i.name === 'string' ? i.name : '';
            const fields = i.fields;

            if (name && Array.isArray(fields)) {
              const fieldInfos: StructFieldInfo[] = fields.map((field) => {
                if (field && typeof field === 'object') {
                  const f = field as Record<string, unknown>;
                  const fieldName = typeof f.name === 'string' ? f.name : 'unknown';
                  const resolved = resolveTypeNode(f.type);
                  return {
                    name: fieldName,
                    type: resolved.type,
                    typeKind: resolved.typeKind,
                  };
                }
                return { name: 'unknown', type: 'unknown', typeKind: 'unknown' };
              });

              definitions.set(name, fieldInfos);
            }
          }
        }
      }
    }
  }

  return definitions;
}

/**
 * Extract schema from a single node (Core IR or AST)
 */
function extractSchemaFromNode(
  node: unknown,
  targetFunctionName?: string
): LocalCompilationResult['schema'] | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;

  // 首先提取所有结构体定义
  const structDefs = extractStructDefinitions(node);

  // Find function declarations
  const declArrays = [n.decls, n.declarations, n.functions, n.items];
  const functions: Record<string, unknown>[] = [];

  for (const arr of declArrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const i = item as Record<string, unknown>;
          const kind = typeof i.kind === 'string' ? i.kind.toLowerCase() : '';
          if (kind === 'func' || kind === 'function' || i.parameters !== undefined || i.params !== undefined) {
            functions.push(i);
          }
        }
      }
    }
  }

  if (functions.length === 0) return undefined;

  // Find target function
  let targetFunc: Record<string, unknown> | undefined;

  if (targetFunctionName) {
    const normalizedTarget = targetFunctionName.toLowerCase();
    targetFunc = functions.find((f) => {
      const name = extractModuleName(f);
      return name?.toLowerCase() === normalizedTarget;
    });
  }

  if (!targetFunc) {
    // Default to first function or one named 'evaluate'
    targetFunc = functions.find((f) => {
      const name = extractModuleName(f);
      return name?.toLowerCase() === 'evaluate';
    }) ?? functions[0];
  }

  if (!targetFunc) return undefined;

  const functionName = extractModuleName(targetFunc) ?? targetFunctionName ?? 'evaluate';
  const parameters = extractParameters(targetFunc, structDefs);

  return { functionName, parameters };
}

/**
 * Extract parameters from a function node
 */
function extractParameters(
  func: Record<string, unknown>,
  structDefs: StructDefinitions
): LocalSchemaParameter[] {
  const params = func.params ?? func.parameters ?? func.inputs ?? func.args;

  if (!Array.isArray(params)) return [];

  return params.map((param, index) => normalizeParameter(param, index, structDefs));
}

/**
 * 基础类型白名单
 * 用于判断 TypeName 是否为基础类型（primitive）
 */
const PRIMITIVE_TYPES = new Set([
  // 英文基础类型
  'text', 'string', 'str',
  'int', 'integer', 'long',
  'float', 'double', 'decimal', 'number',
  'bool', 'boolean',
  'date', 'time', 'datetime', 'timestamp',
  // 中文基础类型（多语言支持）
  '文本', '字符串',
  '整数', '长整数',
  '小数', '浮点数', '数值',
  '布尔',
  '日期', '时间',
  // 德语基础类型
  'zeichenkette',
  'ganzzahl', 'langzahl',
  'dezimal', 'gleitkommazahl',
  'wahrheitswert',
  'datum', 'zeit',
]);

/**
 * 判断类型名是否为基础类型
 */
function isPrimitiveType(typeName: string): boolean {
  return PRIMITIVE_TYPES.has(typeName.toLowerCase());
}

/**
 * 解析类型节点，返回类型名称和类型种类
 *
 * 映射规则：
 * - TypeName（基础类型）→ 'primitive'
 * - TypeName（用户定义）→ 'struct'（默认，因为无法在本地判断 Data vs Enum）
 * - List → 'list'
 * - Map → 'map'
 * - Option/Maybe → 'option'
 * - Result → 'result'
 * - FuncType → 'function'
 * - TypeApp → 根据 base 判断
 * - TypeVar/EffectVar/Pii → 'unknown' 或递归解析
 */
function resolveTypeNode(typeNode: unknown): { type: string; typeKind: string } {
  // 字符串类型直接处理
  if (typeof typeNode === 'string') {
    return {
      type: typeNode,
      typeKind: isPrimitiveType(typeNode) ? 'primitive' : 'struct',
    };
  }

  if (!typeNode || typeof typeNode !== 'object') {
    return { type: 'unknown', typeKind: 'unknown' };
  }

  const t = typeNode as Record<string, unknown>;
  const kind = typeof t.kind === 'string' ? t.kind : '';

  switch (kind) {
    case 'TypeName': {
      const name = typeof t.name === 'string' ? t.name : 'unknown';
      return {
        type: name,
        typeKind: isPrimitiveType(name) ? 'primitive' : 'struct',
      };
    }

    case 'List': {
      const inner = resolveTypeNode(t.type);
      return {
        type: `List<${inner.type}>`,
        typeKind: 'list',
      };
    }

    case 'Map': {
      const keyType = resolveTypeNode(t.key);
      const valType = resolveTypeNode(t.val);
      return {
        type: `Map<${keyType.type}, ${valType.type}>`,
        typeKind: 'map',
      };
    }

    case 'Option':
    case 'Maybe': {
      const inner = resolveTypeNode(t.type);
      return {
        type: `Option<${inner.type}>`,
        typeKind: 'option',
      };
    }

    case 'Result': {
      const okType = resolveTypeNode(t.ok);
      const errType = resolveTypeNode(t.err);
      return {
        type: `Result<${okType.type}, ${errType.type}>`,
        typeKind: 'result',
      };
    }

    case 'FuncType': {
      return {
        type: 'Function',
        typeKind: 'function',
      };
    }

    case 'TypeApp': {
      // 泛型应用，如 LoanApplication<Int>
      const base = typeof t.base === 'string' ? t.base : 'unknown';
      const args = Array.isArray(t.args)
        ? t.args.map(arg => resolveTypeNode(arg).type).join(', ')
        : '';
      return {
        type: args ? `${base}<${args}>` : base,
        typeKind: isPrimitiveType(base) ? 'primitive' : 'struct',
      };
    }

    case 'TypePii':
    case 'Pii': {
      // PII 类型：递归解析基础类型
      const baseType = resolveTypeNode(t.baseType);
      return baseType;
    }

    case 'TypeVar':
    case 'EffectVar': {
      // 类型变量，无法在本地确定
      const name = typeof t.name === 'string' ? t.name : 'T';
      return {
        type: name,
        typeKind: 'unknown',
      };
    }

    default: {
      // 尝试从 name 或 type 属性获取
      let typeName = 'unknown';
      if (typeof t.name === 'string') typeName = t.name;
      else if (typeof t.type === 'string') typeName = t.type;

      return {
        type: typeName,
        typeKind: isPrimitiveType(typeName) ? 'primitive' : 'unknown',
      };
    }
  }
}

/**
 * Normalize a parameter to LocalSchemaParameter format
 */
function normalizeParameter(
  param: unknown,
  index: number,
  structDefs: StructDefinitions
): LocalSchemaParameter {
  if (!param || typeof param !== 'object') {
    return {
      name: `arg${index + 1}`,
      type: 'unknown',
      typeKind: 'unknown',
      optional: false,
      position: index,
    };
  }

  const p = param as Record<string, unknown>;

  // Extract name
  let name = `arg${index + 1}`;
  if (typeof p.name === 'string') {
    name = p.name;
  } else if (p.identifier && typeof (p.identifier as Record<string, unknown>).name === 'string') {
    name = (p.identifier as Record<string, unknown>).name as string;
  }

  // Extract type using the new resolver
  const typeNode = p.type ?? p.valueType ?? p.annotation;
  const resolved = resolveTypeNode(typeNode);

  // Infer optional
  let optional = false;
  if (typeof p.optional === 'boolean') optional = p.optional;
  else if (typeof p.isOptional === 'boolean') optional = p.isOptional;
  else if (typeof p.required === 'boolean') optional = !p.required;

  // 如果是结构体类型，查找并包含字段信息
  let fields: LocalSchemaFieldInfo[] | undefined;
  if (resolved.typeKind === 'struct') {
    const structFields = structDefs.get(resolved.type);
    if (structFields && structFields.length > 0) {
      fields = structFields.map((f) => ({
        name: f.name,
        type: f.type,
        typeKind: f.typeKind,
      }));
    }
  }

  return {
    name,
    type: resolved.type,
    typeKind: resolved.typeKind,
    optional,
    position: typeof p.position === 'number' ? p.position : index,
    ...(fields && { fields }),
  };
}

/**
 * Convert local diagnostics to Monaco editor marker format
 */
export function toMonacoMarkers(
  diagnostics: LocalDiagnostic[]
): Array<{
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  code?: string;
}> {
  const MONACO_SEVERITY: Record<LocalDiagnostic['severity'], number> = {
    error: 8,    // MarkerSeverity.Error
    warning: 4,  // MarkerSeverity.Warning
    info: 2,     // MarkerSeverity.Info
    hint: 1,     // MarkerSeverity.Hint
  };

  return diagnostics.map((d) => ({
    severity: MONACO_SEVERITY[d.severity],
    message: d.message,
    startLineNumber: d.startLine,
    startColumn: d.startColumn,
    endLineNumber: d.endLine,
    endColumn: d.endColumn,
    code: d.code,
  }));
}

/**
 * Clear the compilation cache
 */
export function clearCompilationCache(): void {
  compilationCache.clear();
}
