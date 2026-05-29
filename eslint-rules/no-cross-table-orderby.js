/**
 * ESLint rule: no-cross-table-orderby
 *
 * Forbid {@code orderBy: <OtherTable>.col} in
 * {@code db.query.<RootTable>.findMany({...})} /
 * {@code .findFirst({...})}.
 *
 * <p>Why: Drizzle's relational query API generates SQL with only the
 * root table in the top-level {@code FROM} clause. Joined tables added
 * via {@code with: { ... }} are resolved through nested subqueries for
 * hydration, NOT joined into the root SELECT. An {@code orderBy} that
 * references a column from the {@code with} table compiles to
 * {@code ORDER BY "OtherTable"."col"} against a query that doesn't
 * include {@code OtherTable} in its scope, so Postgres throws
 * {@code 42703 column "col" does not exist} (or "missing FROM-clause
 * entry"). The route handler's catch block returns 500.
 *
 * <p>This bug already shipped to production once
 * (commit aster-cloud/c6f8f5a, {@code api/teams} GET 500). The pattern
 * is invisible to TypeScript because Drizzle's orderBy typedef accepts
 * any column from any schema table — only runtime SQL generation
 * complains.
 *
 * <p>What this rule catches:
 * <pre>
 *   db.query.teamMembers.findMany({
 *     where: ...,
 *     with:  { team: { ... } },
 *     orderBy: desc(teams.updatedAt),   // ← flagged
 *   });
 *
 *   db.query.teamMembers.findMany({
 *     orderBy: [asc(teams.name), desc(teamMembers.createdAt)],  // ← teams.name flagged
 *   });
 * </pre>
 *
 * <p>What this rule explicitly allows:
 * <ul>
 *   <li>{@code orderBy: desc(<rootTable>.col)} — root column is always fine.</li>
 *   <li>{@code orderBy: (fields, ops) => ops.desc(fields.col)} — the
 *       fields-callback form receives only root-table columns, safe by
 *       construction.</li>
 *   <li>{@code orderBy: someVar} — opaque identifier; the rule can't
 *       know what it points to without type info, so we skip rather
 *       than false-flag.</li>
 * </ul>
 *
 * <p>Severity: error (default). Set {@code { severity: 'warn' }} to
 * downgrade during migration.
 */

'use strict';

/** Visit any ordering value (single expression or array literal) and
 *  collect MemberExpression nodes shaped like {@code Foo.bar}.
 *  These are the candidates that could reference a non-root column. */
function collectColumnRefs(node, sink) {
  if (!node) return;
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) {
      if (el) collectColumnRefs(el, sink);
    }
    return;
  }
  // Common pattern: desc(table.col) / asc(table.col) / sql`...table.col...`
  // We unwrap CallExpression to look at args.
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      collectColumnRefs(arg, sink);
    }
    return;
  }
  // Direct member access: foo.bar (where foo is presumably a Drizzle table)
  if (node.type === 'MemberExpression' && !node.computed
      && node.object && node.object.type === 'Identifier'
      && node.property && node.property.type === 'Identifier') {
    sink.push({ tableName: node.object.name, columnName: node.property.name, node });
    return;
  }
  // Unwrap TS type assertion wrappers: foo.bar as any
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion'
      || node.type === 'TSNonNullExpression') {
    collectColumnRefs(node.expression, sink);
    return;
  }
}

/** Detects whether the receiver chain looks like
 *  {@code db.query.<rootTable>.findMany} /
 *  {@code db.query.<rootTable>.findFirst}.
 *  Returns the root table identifier name when matched, else null. */
function matchDbQueryRoot(callee) {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null;
  if (callee.property.type !== 'Identifier') return null;
  const methodName = callee.property.name;
  if (methodName !== 'findMany' && methodName !== 'findFirst') return null;

  const tableAccess = callee.object;
  if (!tableAccess || tableAccess.type !== 'MemberExpression' || tableAccess.computed) return null;
  if (tableAccess.property.type !== 'Identifier') return null;
  const rootTable = tableAccess.property.name;

  const queryRoot = tableAccess.object;
  if (!queryRoot || queryRoot.type !== 'MemberExpression' || queryRoot.computed) return null;
  if (queryRoot.property.type !== 'Identifier' || queryRoot.property.name !== 'query') return null;
  // We accept any LHS for the `db` part (db, tx, this.db, etc.) — the
  // .query.X.findMany shape is what matters.
  return rootTable;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid orderBy referencing a non-root table in Drizzle relational queries.',
      recommended: true,
    },
    messages: {
      crossTableOrderBy:
        '`orderBy: {{table}}.{{column}}` references a table other than the query root `{{root}}`. ' +
        'Drizzle relational queries can only orderBy root-table columns; this compiles to invalid SQL ' +
        '(see commit c6f8f5a for the api/teams 500 incident). ' +
        'Either orderBy a column on `{{root}}`, or sort in JS after the hydrated rows return.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Allowlist of root table names that this rule should ignore.
           *  Use sparingly — usually only for code that intentionally
           *  consumes a Drizzle proxy with a custom shape. */
          allowlist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const opts = context.options[0] || {};
    const allowlist = new Set(opts.allowlist || []);

    return {
      CallExpression(call) {
        const rootTable = matchDbQueryRoot(call.callee);
        if (!rootTable || allowlist.has(rootTable)) return;
        if (call.arguments.length < 1) return;
        const arg = call.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') return;

        const orderByProp = arg.properties.find((p) =>
          p.type === 'Property'
          && !p.computed
          && p.key
          && ((p.key.type === 'Identifier' && p.key.name === 'orderBy')
              || (p.key.type === 'Literal' && p.key.value === 'orderBy'))
        );
        if (!orderByProp) return;

        // The fields-callback form receives only root columns, safe.
        // Skip: (fields, ops) => ops.desc(fields.col)
        if (orderByProp.value.type === 'ArrowFunctionExpression'
            || orderByProp.value.type === 'FunctionExpression') {
          return;
        }

        const refs = [];
        collectColumnRefs(orderByProp.value, refs);
        for (const ref of refs) {
          // Heuristic: a table-shaped identifier starts with a lower-case
          // letter (Drizzle convention: `export const teams = pgTable(...)`).
          // Identifiers starting with upper-case are likely sql tags, enum
          // values, or local helpers and shouldn't be flagged. This trades
          // off some recall for low false-positive rate. The known-bad
          // pattern in this repo always involves lowercase table consts.
          if (!/^[a-z]/.test(ref.tableName)) continue;
          if (ref.tableName === rootTable) continue;
          context.report({
            node: ref.node,
            messageId: 'crossTableOrderBy',
            data: {
              table: ref.tableName,
              column: ref.columnName,
              root: rootTable,
            },
          });
        }
      },
    };
  },
};
