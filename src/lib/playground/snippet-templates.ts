/**
 * Playground snippet template registry.
 *
 * Source-of-truth for what content the policy editor pre-fills when a
 * user lands on `/policies/new?template=<id>` from a docs code block.
 *
 * Why a server-side allow-list:
 *   - The docs URL only carries a *template id* — never raw source.
 *     That keeps URLs short, prevents arbitrary-payload injection via
 *     bookmarks/links, and stops the audit-log resource id from
 *     carrying unbounded user content.
 *   - Unknown ids resolve to `null`, and `policies/new` then renders
 *     the empty editor as a fallback — never an error page.
 *   - Editing a template happens here, alongside the docs MDX fences
 *     it accompanies, so the docs → editor flow stays in sync.
 *
 * Naming convention:
 *   `<feature>-<flavor>` — e.g. `policy-evaluate-basic`, `policy-batch`.
 *   Stable across releases (changing an id breaks any bookmarked link
 *   that pre-fills it).
 */

export type SnippetTemplate = {
  /** Stable id matched in URL `?template=<id>`. */
  id: string;
  /** Source text loaded into the editor. */
  source: string;
  /** Optional one-line description (i18n key); future use by the
   *  editor's "loaded from docs" notice. */
  descriptionKey?: string;
};

/**
 * The registry. Adding a new entry requires:
 *   1. Picking a stable `id` (kebab-case, no leading slash).
 *   2. Authoring a complete, self-contained `source` that runs in
 *      the public preview tenant without external resources.
 *   3. Updating the matching MDX code fence with
 *      `{playground=true,id=<the id>}` so the docs Open-in-Playground
 *      button targets it.
 *
 * Order: keep grouped by feature so future audits can scan it.
 */
const TEMPLATES: ReadonlyArray<SnippetTemplate> = [
  // Policy evaluation — the most-used template. Demonstrates the
  // minimal request shape; the curl example in
  // docs/api/policies/evaluate-source pairs with this template.
  {
    id: 'policy-evaluate-basic',
    source: [
      '# A minimal policy — evaluates true when the request carries',
      '# an `amount` field less than the configured ceiling.',
      'package examples.basic',
      '',
      'default allow := false',
      '',
      'allow if {',
      '    input.amount < 100',
      '}',
      '',
    ].join('\n'),
  },
  // Batch — short multi-rule example used by docs/api/policies/batch.
  {
    id: 'policy-batch',
    source: [
      '# Batch-friendly rule set. The Playground will run the same',
      "# policy against every request the user provides.",
      'package examples.batch',
      '',
      'default allow := false',
      '',
      'allow if {',
      '    input.tenant == "preview"',
      '    input.tier in {"free", "pro"}',
      '}',
      '',
    ].join('\n'),
  },
  // Schema extraction — the docs/api/policies/schema fence shows a
  // policy whose input shape the user can ask the engine to enumerate.
  {
    id: 'policy-schema',
    source: [
      '# Source for schema extraction. Inputs referenced as',
      '# `input.<field>` are surfaced by the schema endpoint.',
      'package examples.schema',
      '',
      'allow if {',
      '    input.user.id != ""',
      '    input.resource.kind == "policy"',
      '    input.action in {"read", "list"}',
      '}',
      '',
    ].join('\n'),
  },
  // Versioning — used by docs/api/policies/versions to demonstrate a
  // minimal policy that the user iterates on while exercising the
  // version-history endpoint.
  {
    id: 'policy-versions',
    source: [
      '# Versioned policy — change a value, save, and inspect the',
      '# revision history via the versions endpoint.',
      'package examples.versioning',
      '',
      'default allow := false',
      '',
      'allow if {',
      '    input.role == "owner"',
      '}',
      '',
    ].join('\n'),
  },
] as const;

/**
 * O(1) lookup map built once at module-load.
 */
const TEMPLATE_BY_ID = new Map<string, SnippetTemplate>(
  TEMPLATES.map((t) => [t.id, t]),
);

/**
 * Look up a template by id. Returns null for unknown ids so callers
 * can fall back to the empty editor instead of throwing.
 *
 * The lookup is exact-match. Ids are author-controlled (chosen when
 * authoring the docs fence) so they're already constrained; the
 * registry does no normalization.
 */
export function getSnippetTemplate(id: string): SnippetTemplate | null {
  return TEMPLATE_BY_ID.get(id) ?? null;
}

/**
 * Enumerate the registry — used by tests + the docs registry-coverage
 * audit script to assert every advertised template id actually exists.
 */
export function listSnippetTemplates(): ReadonlyArray<SnippetTemplate> {
  return TEMPLATES;
}
