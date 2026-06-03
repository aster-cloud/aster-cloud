/**
 * rehype-snippet-meta — extracts code-fence metadata into HAST `data-*`
 * attributes so the client-side `<EnhancedCodeGroup>` can decide which
 * snippet toolbar buttons to render.
 *
 * Build-time only. Adds zero runtime cost to the Worker bundle; the
 * extracted metadata travels as static HTML attributes in the
 * pre-rendered docs HTML.
 *
 * Input shape (MDX author writes):
 *   ```bash {playground=true,id=policy-evaluate-curl} [curl]
 *   curl -X POST ...
 *   ```
 *
 * The fence's info string is split by `rehype-pretty-code` into a
 * language token (`bash`) plus a `meta` string containing the rest.
 * We parse two flavors of meta:
 *
 *   1. KV pairs inside `{...}` — our additions: `playground`, `id`,
 *      `language` (override the language for the snippet registry).
 *   2. Bracketed labels `[curl]` / `[JavaScript]` — the existing
 *      tab-label convention from `rehype-pretty-code`. We don't
 *      touch these.
 *
 * Output on the `<pre data-language="bash" ...>` element:
 *   - `data-snippet-playground="true"` when `playground=true`
 *   - `data-snippet-id="policy-evaluate-curl"` when an id is set
 *   - `data-snippet-lang="bash"` always (mirrors the fence lang)
 *
 * IDs are author-controlled. The Playground template registry uses
 * them as primary keys, so an MDX author cannot inject arbitrary
 * source into Playground — the registry has the final say on what
 * template is loaded.
 *
 * Idempotent: re-running the plugin on already-transformed HAST is
 * a no-op (data attrs are written verbatim).
 */

/**
 * Local typing — `unified` / `hast` are not declared top-level deps
 * (they come transitively through @next/mdx + rehype-pretty-code), so
 * pulling their types in here would require adding them to package.json
 * just for this build-time plugin. We instead lean on structural
 * minimums that match the actual runtime shape: `unified` calls
 * `plugin()(tree)` where `tree` is a HAST root.
 *
 * NB: rehype-pretty-code stashes the original code-fence info string
 * on `<code>.data.meta` (not on `<pre>.properties['data-meta']`) — see
 * the package's source at @0.14.3. We expose `data` here so our
 * decorator can read from the actual location.
 */
type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  data?: Record<string, unknown>;
};
type RehypePlugin = () => (tree: HastNode) => void;

const META_KV_RE = /\{\s*([^{}]*?)\s*\}/;

/**
 * Parse a meta string like `playground=true,id=foo` into a record.
 * Quoted values not supported on purpose — keep author-facing syntax
 * minimal. Values are tokenized by `,` then split on first `=`.
 */
function parseMeta(meta: string | null | undefined): Record<string, string> {
  if (!meta) return {};
  const match = meta.match(META_KV_RE);
  if (!match) return {};
  const body = match[1];
  const out: Record<string, string> = {};
  for (const part of body.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Walk the HAST tree and decorate every `<pre>` whose child is a
 * `<code>` element with the matching `data-snippet-*` attributes.
 * `rehype-pretty-code` runs before us and emits `pre > code` for
 * every fenced block, attaching the original meta string under
 * either `pre.properties['data-meta']` (custom) or as the parsed
 * `meta` field. We tolerate both.
 */
export const rehypeSnippetMeta: RehypePlugin = () => {
  return (tree) => {
    visit(tree);
  };

  function visit(node: HastNode | undefined): void {
    if (!node) return;
    if (node.type === 'element' && node.tagName === 'pre') {
      decoratePre(node);
    }
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  function decoratePre(pre: HastNode): void {
    pre.properties = pre.properties ?? {};
    const props = pre.properties;
    // The raw fence info string can live in three places depending on
    // which plugin produced the tree:
    //   - `code.data.meta`   — rehype-pretty-code @0.14.x (current).
    //   - `pre.properties['data-meta']` — older / hand-built trees.
    //   - `pre.properties['metastring']` — legacy.
    // We check the code child first (the canonical post-pretty-code
    // location), then fall back to the historic property names. This
    // makes the plugin tolerant of both real builds and synthetic
    // unit-test inputs.
    const codeChild = pre.children?.find(
      (c) => c.type === 'element' && c.tagName === 'code',
    );
    const codeMeta =
      (codeChild?.data && typeof codeChild.data.meta === 'string'
        ? (codeChild.data.meta as string)
        : '') || '';
    const rawMeta =
      codeMeta ||
      (typeof props['data-meta'] === 'string' && (props['data-meta'] as string)) ||
      (typeof props['metastring'] === 'string' && (props['metastring'] as string)) ||
      '';
    const meta = parseMeta(rawMeta);

    if (meta.playground === 'true') {
      props['data-snippet-playground'] = 'true';
    }
    if (meta.id) {
      props['data-snippet-id'] = meta.id;
    }
    // Mirror the fence language as a stable attribute. rehype-pretty-code
    // already sets `data-language`, but we duplicate for consumer
    // simplicity. Prefer explicit `language=` meta when present (lets
    // authors override the highlight lang for registry lookups).
    const language =
      meta.language ||
      (typeof props['data-language'] === 'string' && (props['data-language'] as string)) ||
      '';
    if (language) {
      props['data-snippet-lang'] = language;
    }
  }
};

export default rehypeSnippetMeta;
