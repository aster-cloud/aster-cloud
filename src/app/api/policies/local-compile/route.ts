/**
 * POST /api/policies/local-compile
 *
 * Local compilation endpoint for CNL policy validation.
 * Compiles policy source code locally without executing it.
 *
 * Request body:
 * - source: string (required) - CNL source code
 * - locale: string (optional) - Language locale ('en-US', 'zh-CN', 'de-DE')
 * - functionName: string (optional) - Target function for schema extraction
 *
 * Response:
 * - success: boolean - Whether compilation succeeded
 * - diagnostics: LocalDiagnostic[] - Compilation errors/warnings
 * - schema: object | null - Extracted function schema
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  compileLocally,
  type CNLLocale,
  type CompilerStage,
} from '@/services/policy/local-compiler';

const SUPPORTED_LOCALES: CNLLocale[] = ['en-US', 'zh-CN', 'de-DE'];
const DEFAULT_STAGE: CompilerStage = 'canonicalize';

function isSupportedLocale(value: string): value is CNLLocale {
  return SUPPORTED_LOCALES.includes(value as CNLLocale);
}

function buildErrorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          message,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
          stage: DEFAULT_STAGE,
        },
      ],
      schema: null,
    },
    { status }
  );
}

export async function POST(req: Request) {
  // Authentication check
  const session = await getSession();
  if (!session?.user?.id) {
    return buildErrorResponse('Unauthorized', 401);
  }

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return buildErrorResponse('Invalid JSON body', 400);
  }

  // Validate body is an object
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return buildErrorResponse('Request body must be an object', 400);
  }

  const { source, locale, functionName } = body as {
    source?: unknown;
    locale?: unknown;
    functionName?: unknown;
  };

  // Validate source
  if (typeof source !== 'string' || source.trim().length === 0) {
    return buildErrorResponse('Source code is required', 400);
  }

  // Normalize optional parameters
  const normalizedLocale =
    typeof locale === 'string' && isSupportedLocale(locale)
      ? locale
      : undefined;

  const normalizedFunctionName =
    typeof functionName === 'string' && functionName.trim().length > 0
      ? functionName.trim()
      : undefined;

  try {
    // Run local compilation
    const compilation = await compileLocally({
      source,
      locale: normalizedLocale,
      functionName: normalizedFunctionName,
      collectSchema: true,
    });

    return NextResponse.json({
      success: compilation.success,
      diagnostics: compilation.diagnostics,
      schema: compilation.schema ?? null,
      moduleName: compilation.moduleName ?? null,
      functionNames: compilation.functionNames ?? [],
      cacheHit: compilation.cacheHit ?? false,
    });
  } catch (error) {
    // Log detailed error server-side, return generic message to client
    console.error('[LocalCompile] Compilation failed:', error);
    return NextResponse.json(
      {
        success: false,
        diagnostics: [
          {
            severity: 'error',
            message: 'Internal compilation error. Please try again or contact support.',
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 1,
            stage: DEFAULT_STAGE,
          },
        ],
        schema: null,
        moduleName: null,
        functionNames: [],
        cacheHit: false,
      },
      { status: 500 }
    );
  }
}
