/**
 * check-glossary.ts — consumer-side scanner driver for the Glossary
 * Contract (v7). Stage 1 of the 4-stage remediation flow: runs the
 * scanner in REPORT-ONLY mode, uploads findings as a CI artifact, never
 * blocks the build until Stage 4 strict-mode flip.
 *
 * Plan reference: .claude/plan/glossary-contract.md §4.4 + §4.5.
 *
 * Usage:
 *   pnpm tsx scripts/check-glossary.ts            # report-only; exit 0 regardless of findings
 *   pnpm tsx scripts/check-glossary.ts --strict   # Stage 4: errors fail CI
 *
 * Source-of-truth:
 *   - glossary.config.yaml — which surfaces to scan, ignored paths,
 *     untranslated-tokens allowlist.
 *   - @aster-cloud/glossary — schema, scanner, term data. During Stage 1
 *     we resolve the package via a workspace-relative file path; once
 *     G8a publishes to npm, the resolver picks up the published version
 *     from node_modules automatically.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ─────────── Glossary package resolution ───────────

interface GlossaryExport {
  version: 1;
  localesVersion: number;
  locales: Array<{ id: string; role?: 'backbone'; bcp47: string }>;
  terms: Record<string, {
    id: string;
    translations: Record<string, string>;
    'forbidden-aliases'?: Record<string, Array<{ text: string; match: MatchSpec }>>;
    match: MatchSpec;
    'user-facing': boolean;
    lifecycle: {
      'backbone-revision': number;
      'backbone-change-type'?: string;
      'reviewed-backbone-revision': Record<string, number>;
    };
  }>;
}

interface MatchSpec {
  mode: 'literal' | 'phrase' | 'reviewed-regex';
  'case-sensitive'?: boolean;
  boundary?: 'unicode-word' | 'none';
  normalize?: Array<'case' | 'width' | 'punctuation' | 'whitespace'>;
}

function resolveGlossary(): GlossaryExport {
  // Resolution order:
  //   1. node_modules (post-G8a, the production path)
  //   2. workspace-relative aster-design-system checkout (Stage 1 dev path)
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = resolvePath(dirname(__filename), '..');

  const nodeModulesPath = join(repoRoot, 'node_modules', '@aster-cloud', 'glossary', 'dist', 'glossary.export.json');
  if (existsSync(nodeModulesPath)) {
    return JSON.parse(readFileSync(nodeModulesPath, 'utf8')) as GlossaryExport;
  }

  const designSystemPath = join(
    repoRoot, '..', 'aster-design-system', 'packages', 'glossary', 'dist', 'glossary.export.json',
  );
  if (existsSync(designSystemPath)) {
    console.warn(
      `[check-glossary] Stage 1: resolving glossary from ${relative(repoRoot, designSystemPath)}. ` +
      `Once G8a publishes @aster-cloud/glossary to npm, pin the version in package.json and this branch goes away.`,
    );
    return JSON.parse(readFileSync(designSystemPath, 'utf8')) as GlossaryExport;
  }

  throw new Error(
    `[check-glossary] @aster-cloud/glossary not found in node_modules and ` +
    `../aster-design-system/packages/glossary/dist/glossary.export.json does not exist. ` +
    `Run \`pnpm install\` in aster-cloud, or \`pnpm build\` in aster-design-system/packages/glossary.`,
  );
}

/**
 * Resolve the canonical scanner module. Returns `scan` (the full scanner
 * pipeline) so this driver can build a `ScanInput` and delegate the entire
 * pass — not just the matcher. This closes the Round-2 contract-drift gap:
 * previously consumers re-implemented surface extraction + parity locally.
 */
type CanonicalScanModule = {
  scan: (input: any, config: { glossary: GlossaryExport; strict?: boolean }) => {
    issues: Array<{
      severity: 'error' | 'warning';
      rule: string;
      surfacePath: string;
      locale?: string;
      termId?: string;
      anchor?: string;
      detail: string;
    }>;
    errorCount: number;
    warningCount: number;
  };
};

async function resolveScanner(): Promise<CanonicalScanModule> {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = resolvePath(dirname(__filename), '..');
  const candidates = [
    join(repoRoot, 'node_modules', '@aster-cloud', 'glossary', 'dist', 'scanner.js'),
    join(repoRoot, '..', 'aster-design-system', 'packages', 'glossary', 'dist', 'scanner.js'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const mod = await import(pathToFileURL(path).href);
      return { scan: mod.scan };
    }
  }
  throw new Error('[check-glossary] canonical scanner not found; run `pnpm build` in aster-design-system/packages/glossary');
}

// ─────────── Config + surfaces ───────────

interface GlossaryConfig {
  version: 1;
  tier: 'official' | 'community';
  localesVersion: number;
  surfaces: Record<string, {
    type: 'json' | 'markdown';
    paths: string | string[];
    'backbone-locale'?: string;
    'locale-from-filename'?: boolean;
    'locale-from-frontmatter'?: boolean;
    'fallback-locale'?: string;
    alignment?: 'block-id';
  }>;
  'ignored-surfaces'?: Array<{ path: string; reason: string; expires?: string }>;
  'untranslated-tokens'?: string[];
}

async function loadConfig(repoRoot: string): Promise<GlossaryConfig> {
  const path = join(repoRoot, 'glossary.config.yaml');
  if (!existsSync(path)) {
    throw new Error(`[check-glossary] glossary.config.yaml not found at ${path}`);
  }
  const raw = parseYaml(readFileSync(path, 'utf8'));
  // Validate via the canonical Zod schema. Fail closed if the schema
  // module isn't built — silently degrading to raw parse defeats the
  // purpose of contract validation.
  const schemaCandidates = [
    join(repoRoot, 'node_modules', '@aster-cloud', 'glossary', 'dist', 'schema.js'),
    join(repoRoot, '..', 'aster-design-system', 'packages', 'glossary', 'dist', 'schema.js'),
  ];
  for (const sp of schemaCandidates) {
    if (existsSync(sp)) {
      const mod = await import(pathToFileURL(sp).href);
      const parsed = mod.GlossaryConfigSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `[check-glossary] glossary.config.yaml failed schema validation:\n  ${parsed.error.issues
            .map((i: any) => `${i.path.join('.')}: ${i.message}`)
            .join('\n  ')}`,
        );
      }
      return parsed.data as GlossaryConfig;
    }
  }
  throw new Error(
    '[check-glossary] @aster-cloud/glossary dist/schema.js not found; ' +
    'cannot validate glossary.config.yaml. Run `pnpm build` in ' +
    'aster-design-system/packages/glossary before invoking this script.',
  );
}

// ─────────── Issue model + driver helpers ───────────
//
// IMPORTANT: contract semantics — matching, forbidden-alias, parity,
// pairing, freshness — all live in `@aster-cloud/glossary/scanner.scan()`.
// This script only handles I/O: glob-walking, locale inference, surface
// collection into `ScanInput`, then artifact output. Previously this file
// contained a hand-written matcher subset that drifted from the canonical
// implementation (different word-boundary heuristic, no Unicode segmenter,
// no parity logic). That drift allowed CI passes that the source scanner
// would have failed. Do NOT re-introduce a local scanner — call `scan()`.

interface Issue {
  severity: 'error' | 'warning';
  rule: string;
  path: string;
  locale?: string;
  termId?: string;
  anchor?: string;
  detail: string;
}

/** Extract `locale:` from YAML frontmatter, if present. */
function extractFrontmatterLocale(markdown: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!m) return null;
  const fm = m[1]!;
  const localeLine = /^locale:\s*(\S+)\s*$/m.exec(fm);
  return localeLine ? localeLine[1]! : null;
}

function localeFromFilename(p: string): string | null {
  const m = /\b([a-z]{2,3})(-([A-Z][a-zA-Z0-9]+))?\.json$/.exec(p);
  if (!m) return null;
  return m[3] ? `${m[1]}-${m[3]}` : m[1]!.toLowerCase();
}

function shortLocale(full: string): string {
  // "en-US" → "en" (because aster-cloud's messages/*.json files are named en.json, not en-US.json)
  return full.split('-')[0]!;
}

/**
 * Strip a locale directory segment from a path so cross-locale mirrors
 * produce identical pairKeys. Known locales are derived from the glossary
 * (full locale id → short token, e.g. `zh-CN` → `zh`). This removes the
 * previous hardcoded list that had to be hand-edited every time a locale
 * was added.
 *
 * Example: with glossary locales = [en-US, zh-CN, de-DE], known set =
 * {en, zh, de}; `docs/on-prem/zh/intro.md` → `docs/on-prem/intro.md`,
 * but `docs/api/intro.md` stays unchanged.
 */
function stripLocaleSegment(p: string, knownLocaleTokens: ReadonlySet<string>): string {
  return p.replace(/(^|\/)([a-z]{2,3}(-[a-z]{2,4})?)\//i, (m, pre, code) => {
    const base = code.toLowerCase().split('-')[0];
    return knownLocaleTokens.has(base) ? `${pre}` : m;
  });
}

function isIgnored(path: string, config: GlossaryConfig): boolean {
  for (const ign of config['ignored-surfaces'] ?? []) {
    const re = globToRegex(ign.path);
    if (re.test(path)) return true;
  }
  return false;
}

function globToRegex(glob: string): RegExp {
  // Normalize "**/" → "(.*/)?" so `docs/on-prem/**/*.md` matches both
  // `docs/on-prem/foo.md` (zero subdirs) and `docs/on-prem/sub/foo.md`.
  // Plain "**" inside a segment becomes ".*".
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '__DOUBLESTAR_SLASH__')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR_SLASH__/g, '(.*/)?')
    .replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// ─────────── Main scan ───────────

function listMatches(repoRoot: string, glob: string | string[]): string[] {
  const patterns = Array.isArray(glob) ? glob : [glob];
  const results: string[] = [];
  for (const pat of patterns) {
    if (!pat.includes('*')) {
      const abs = join(repoRoot, pat);
      if (existsSync(abs)) results.push(pat);
      continue;
    }
    // Simple recursive walk for `**/*.md` style
    const re = globToRegex(pat);
    const walk = (dir: string): void => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const abs = join(dir, name);
        let s; try { s = statSync(abs); } catch { continue; }
        if (s.isDirectory()) walk(abs);
        else {
          const rel = relative(repoRoot, abs);
          if (re.test(rel)) results.push(rel);
        }
      }
    };
    walk(repoRoot);
  }
  return [...new Set(results)];
}

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = resolvePath(dirname(__filename), '..');

  const glossary = resolveGlossary();
  const config = await loadConfig(repoRoot);
  const { scan } = await resolveScanner();

  console.log(`[check-glossary] glossary v${glossary.localesVersion} loaded ${Object.keys(glossary.terms).length} terms × ${glossary.locales.length} locales`);
  console.log(`[check-glossary] config tier=${config.tier} strict=${strict}`);

  const issues: Issue[] = [];
  const backboneLocale = glossary.locales.find((l) => l.role === 'backbone')?.id ?? 'en-US';

  // Build ScanInput from config surfaces. The canonical scan() does all
  // matching, normalisation, pairing, parity. This driver only does I/O.
  const shortToFull = new Map<string, string>();
  for (const l of glossary.locales) shortToFull.set(shortLocale(l.id), l.id);
  // Known locale tokens derived from glossary — single source of truth.
  // stripLocaleSegment uses this to strip ONLY registered locale dirs.
  const knownLocaleTokens = new Set(shortToFull.keys());
  // Full locale id set for typo detection in Markdown frontmatter.
  const registeredFullLocales = new Set(glossary.locales.map((l) => l.id));

  const jsonSurfaces: Array<{ path: string; locale: string; content: unknown; pairKey?: string }> = [];
  const markdownSurfaces: Array<{ path: string; locale: string; content: string; pairKey?: string }> = [];

  for (const [surfaceName, surface] of Object.entries(config.surfaces)) {
    const files = listMatches(repoRoot, surface.paths).filter((f) => !isIgnored(f, config));
    if (files.length === 0) {
      issues.push({
        severity: config.tier === 'official' ? 'error' : 'warning',
        rule: 'surface-coverage',
        path: '(config)',
        detail: `surface "${surfaceName}" matched zero files (paths=${JSON.stringify(surface.paths)})`,
      });
      continue;
    }

    if (surface.type === 'json') {
      for (const f of files) {
        if (!surface['locale-from-filename']) continue;
        const short = localeFromFilename(f);
        if (!short) continue;
        const full = shortToFull.get(short);
        if (!full) {
          issues.push({
            severity: 'warning',
            rule: 'surface-coverage',
            path: f,
            detail: `file locale "${short}" not registered in glossary.locales (known: ${[...shortToFull.keys()].join(', ')})`,
          });
          continue;
        }
        const content = JSON.parse(readFileSync(join(repoRoot, f), 'utf8'));
        // pairKey = parent directory (messages/), so messages/en.json + messages/de.json pair.
        jsonSurfaces.push({ path: f, locale: full, content, pairKey: dirname(f) });
      }
    }

    if (surface.type === 'markdown') {
      const annotated = files.filter((f) => /<!--\s*glossary:block\s+id=/.test(readFileSync(join(repoRoot, f), 'utf8')));
      console.log(`[check-glossary] markdown surface "${surfaceName}" matched ${files.length} files (${annotated.length} annotated)`);
      for (const f of annotated) {
        const content = readFileSync(join(repoRoot, f), 'utf8');
        const fileLocale = extractFrontmatterLocale(content) ?? surface['fallback-locale'] ?? backboneLocale;
        // Round-3 codex finding: frontmatter typos (e.g. `locale: zh-cn` lower-case
        // region) silently bypassed scanner because they don't match any registered
        // locale id. Flag unregistered locales so the typo is visible.
        if (!registeredFullLocales.has(fileLocale)) {
          issues.push({
            severity: 'warning',
            rule: 'surface-coverage',
            path: f,
            detail: `markdown frontmatter/path locale "${fileLocale}" not registered in glossary.locales (known: ${[...registeredFullLocales].join(', ')}) — possible typo`,
          });
          continue;
        }
        // pairKey scope: `<surfaceName>:<relative path with locale segment stripped>`.
        // Bare basename was ambiguous across surfaces — docs/on-prem/foo/intro.md
        // and docs/saas/bar/intro.md would have shared 'intro.md' and been falsely
        // paired across product lines.
        const pairKey = `${surfaceName}:${stripLocaleSegment(f, knownLocaleTokens)}`;
        markdownSurfaces.push({ path: f, locale: fileLocale, content, pairKey });
      }
    }
  }

  // Single delegated scan pass — canonical surface.
  const scanResult = scan(
    { jsonSurfaces, markdownSurfaces },
    { glossary, strict },
  );
  for (const i of scanResult.issues) {
    issues.push({
      severity: i.severity,
      rule: i.rule,
      path: i.surfacePath,
      locale: i.locale,
      termId: i.termId,
      anchor: i.anchor,
      detail: i.detail,
    });
  }

  // ───── Reporting ─────
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  // Print to stdout (CI artifacts the log).
  if (issues.length > 0) {
    console.log('');
    console.log(`[check-glossary] findings (${errorCount} errors, ${warningCount} warnings):`);
    for (const i of issues.slice(0, 200)) {
      const loc = i.locale ? ` [${i.locale}]` : '';
      const term = i.termId ? ` term=${i.termId}` : '';
      const anchor = i.anchor ? ` @${i.anchor}` : '';
      console.log(`  [${i.severity}] ${i.rule}${loc}${term} ${i.path}${anchor}: ${i.detail}`);
    }
    if (issues.length > 200) {
      console.log(`  … and ${issues.length - 200} more (truncated)`);
    }
  } else {
    console.log('[check-glossary] no findings');
  }

  // Always write a JSON artifact for CI upload.
  const artifactPath = join(repoRoot, 'glossary-findings.json');
  writeFileSync(artifactPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: { tier: config.tier, localesVersion: config.localesVersion },
    glossary: { localesVersion: glossary.localesVersion, termCount: Object.keys(glossary.terms).length },
    counts: { error: errorCount, warning: warningCount },
    issues,
  }, null, 2));
  console.log(`[check-glossary] wrote ${relative(repoRoot, artifactPath)}`);

  // Exit code (matches check-locales.ts contract):
  //   community tier: always exit 0 (report-only)
  //   official tier + non-strict: 1 on errors only
  //   official tier + strict: 1 on errors OR warnings
  if (config.tier === 'community') {
    process.exit(0);
  }
  const failable = strict ? issues.length > 0 : errorCount > 0;
  process.exit(failable ? 1 : 0);
}

main().catch((err) => {
  console.error('[check-glossary] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
