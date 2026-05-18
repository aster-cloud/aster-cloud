/**
 * ESLint rule: no-direct-macro
 *
 * Forbid scattered references to the `__DEPLOYMENT_MODE__` ambient macro
 * and to `process.env.DEPLOYMENT_MODE` / `process.env.NEXT_PUBLIC_DEPLOYMENT_MODE`
 * environment variables. All deployment-mode access must go through the helper:
 *
 *   import { IS_SAAS, CAN_BILLING, ... } from '@/lib/deployment-mode';
 *
 * Allowlist:
 *   1. The helper itself: src/lib/deployment-mode.ts, src/hooks/use-deployment-mode.ts
 *   2. The global ambient declaration: src/types/deployment-mode.d.ts
 *   3. The config file: next.config.ts (must read env to inject the macro)
 *   4. Hot-gate files: a top-of-file block comment of the shape
 *      /* @deployment-mode-hot-gate
 *       * reason: <non-empty justification>
 *       *\/
 *      The `reason:` clause must be non-empty so future maintainers can
 *      audit why this file bypasses the helper (DCE rationale, dynamic
 *      SDK import, etc.). See deployment-mode-spike-report.md §8.
 *
 * Severity: error (default). Set `{ severity: 'warn' }` to downgrade.
 *
 * Source of truth: .claude/plan/deployment-mode-flag-v2.md PR-9.
 */

'use strict';

/** @type {ReadonlyArray<string>} */
const ALLOWED_FILE_SUFFIXES = [
  '/src/lib/deployment-mode.ts',
  '/src/hooks/use-deployment-mode.ts',
  '/src/types/deployment-mode.d.ts',
  '/next.config.ts',
];

/** Hot-gate marker detection — two-phase to correctly distinguish
 *  "no `reason:` clause at all" from "`reason:` present but empty".
 *  - HAS_MARKER_RE: just looks for the `@deployment-mode-hot-gate` token
 *  - REASON_RE: extracts whatever follows `reason:` up to end of line
 *    or end of comment (0+ chars), so `reason:\n` correctly captures ''
 *    and triggers hotGateEmptyReason.
 */
const HAS_MARKER_RE = /@deployment-mode-hot-gate/;
const REASON_RE = /reason\s*:\s*([^\n*]*)/;

const RESTRICTED_PROCESS_ENV_KEYS = new Set([
  'DEPLOYMENT_MODE',
  'NEXT_PUBLIC_DEPLOYMENT_MODE',
]);

function isAllowedFile(filename) {
  if (!filename) return false;
  // Normalize Windows backslash paths to forward slashes so suffix matching
  // works on every platform. ESLint can return either form depending on
  // shell + ESLint version + IDE plugin.
  const normalized = filename.replace(/\\/g, '/');
  return ALLOWED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * Check if the source file carries a valid hot-gate marker comment.
 *  - must be a block comment near the top of the file (line <= 50)
 *  - must include `reason:` followed by non-empty text
 *
 * Returns:
 *   { ok: true }                          -> valid marker, allow direct macro
 *   { ok: false, emptyReason: true }      -> marker found but `reason:` empty
 *   { ok: false }                         -> no marker
 */
function hasHotGateMarker(sourceCode) {
  const allComments = sourceCode.getAllComments
    ? sourceCode.getAllComments()
    : [];
  for (const c of allComments) {
    if (c.type !== 'Block') continue;
    // Only consider top-of-file comments. Hot-gate markers must be the
    // very first block comment so they survive code reorganizing.
    if (c.loc && c.loc.start.line > 50) break;
    if (!HAS_MARKER_RE.test(c.value)) continue;
    // Marker present — now check for `reason:` separately. Missing
    // `reason:` entirely vs present-but-empty are different failures.
    const reasonMatch = REASON_RE.exec(c.value);
    if (!reasonMatch) {
      // marker but no `reason:` clause at all → still invalid
      return { ok: false, emptyReason: true };
    }
    const reason = reasonMatch[1].trim();
    if (reason.length > 0) return { ok: true };
    return { ok: false, emptyReason: true };
  }
  return { ok: false };
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid direct use of __DEPLOYMENT_MODE__ macro and process.env.DEPLOYMENT_MODE outside the deployment-mode helper and explicitly-marked hot-gate files.',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          severity: {
            type: 'string',
            enum: ['error', 'warn'],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      directMacro:
        "Direct reference to `__DEPLOYMENT_MODE__` is forbidden outside `src/lib/deployment-mode.ts` and hot-gate files. " +
        "Import IS_SAAS / CAN_BILLING / etc. from '@/lib/deployment-mode' instead. " +
        "If this file legitimately needs the macro for DCE (e.g. dynamic SDK import), add a top-of-file `/* @deployment-mode-hot-gate\\n * reason: <why this file needs direct macro>\\n */` comment.",
      processEnvAccess:
        "Direct read of `process.env.{{key}}` is forbidden. Import IS_SAAS / IS_ONPREM from '@/lib/deployment-mode' (server) or use useDeploymentMode() / CLIENT_CAPABILITIES from '@/hooks/use-deployment-mode' (client).",
      hotGateEmptyReason:
        "Hot-gate marker `@deployment-mode-hot-gate` is present but `reason:` is empty. Document why this file needs the direct macro (DCE rationale, SDK dynamic import, etc.). Empty reasons defeat audit value.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAllowedFile(filename)) {
      // helper / types / next.config: free to use, no checks
      return {};
    }

    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const markerCheck = hasHotGateMarker(sourceCode);

    // Empty `reason:` -> report once on the Program node and stop
    // checking individual nodes (the marker is broken, fix that first).
    if (markerCheck.emptyReason) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: 'hotGateEmptyReason',
          });
        },
      };
    }

    // Valid marker -> direct macro allowed; still check process.env access
    const allowDirectMacro = markerCheck.ok === true;

    return {
      Identifier(node) {
        if (allowDirectMacro) return;
        if (node.name !== '__DEPLOYMENT_MODE__') return;
        // Skip type-space references (declare const, typeof, etc.) that
        // never lower to runtime code. These are rare outside allowed
        // files but we want a soft tolerance.
        const parent = node.parent;
        if (
          parent &&
          parent.type === 'VariableDeclarator' &&
          parent.parent &&
          parent.parent.type === 'VariableDeclaration' &&
          parent.parent.declare === true
        ) {
          return;
        }
        context.report({
          node,
          messageId: 'directMacro',
        });
      },

      MemberExpression(node) {
        // Detect process.env.X access. Covers both dot form (`process.env.X`)
        // and computed string-literal form (`process.env['X']`).
        if (
          !node.object ||
          node.object.type !== 'MemberExpression' ||
          !node.object.object ||
          node.object.object.type !== 'Identifier' ||
          node.object.object.name !== 'process' ||
          !node.object.property ||
          node.object.property.type !== 'Identifier' ||
          node.object.property.name !== 'env'
        ) {
          return;
        }

        // Extract property name: `process.env.X` -> Identifier 'X'.
        //                        `process.env['X']` -> Literal 'X'.
        let key = null;
        if (
          !node.computed &&
          node.property &&
          node.property.type === 'Identifier'
        ) {
          key = node.property.name;
        } else if (
          node.computed &&
          node.property &&
          node.property.type === 'Literal' &&
          typeof node.property.value === 'string'
        ) {
          key = node.property.value;
        }

        if (key && RESTRICTED_PROCESS_ENV_KEYS.has(key)) {
          context.report({
            node,
            messageId: 'processEnvAccess',
            data: { key },
          });
        }
      },

      // Detect destructured access:
      //   const { DEPLOYMENT_MODE } = process.env;
      //   const { NEXT_PUBLIC_DEPLOYMENT_MODE: alias } = process.env;
      VariableDeclarator(node) {
        if (
          !node.id ||
          node.id.type !== 'ObjectPattern' ||
          !node.init ||
          node.init.type !== 'MemberExpression' ||
          !node.init.object ||
          node.init.object.type !== 'Identifier' ||
          node.init.object.name !== 'process' ||
          !node.init.property ||
          node.init.property.type !== 'Identifier' ||
          node.init.property.name !== 'env'
        ) {
          return;
        }
        for (const prop of node.id.properties) {
          if (
            prop.type !== 'Property' ||
            !prop.key ||
            prop.key.type !== 'Identifier'
          ) {
            continue;
          }
          if (RESTRICTED_PROCESS_ENV_KEYS.has(prop.key.name)) {
            context.report({
              node: prop,
              messageId: 'processEnvAccess',
              data: { key: prop.key.name },
            });
          }
        }
      },
    };
  },
};
