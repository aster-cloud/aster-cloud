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

// ─────────── Glossary package resolution (single root) ───────────
//
// Resolve the @aster-cloud/glossary package root ONCE so every artifact
// (export.json, scanner.js, schema.js, locale-utils.js) comes from the
// same package version. Loading them from independent candidate paths
// (the pre-Round-4 pattern) could silently mix versions when node_modules
// and the sibling checkout disagreed.

interface ScanInput {
  jsonSurfaces: Array<{ path: string; locale: string; content: unknown; pairKey?: string }>;
  markdownSurfaces: Array<{ path: string; locale: string; content: string; pairKey?: string }>;
}

type CanonicalScan = (input: ScanInput, config: { glossary: GlossaryExport; strict?: boolean }) => {
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

interface GlossaryPackage {
  root: string;
  scan: CanonicalScan;
  glossaryExport: GlossaryExport;
  configSchema: { safeParse: (raw: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } };
  localeUtils: {
    parseLocaleTag: (tag: string) => null | { language: string; script?: string; region?: string };
    matchLocaleSegment: (segment: string, locales: ReadonlyArray<{ id: string }>) => string | null;
    stripLocaleSegment: (path: string, rootDir: string, locales: ReadonlyArray<{ id: string }>) => string;
  };
}

async function resolveGlossaryPackage(repoRoot: string): Promise<GlossaryPackage> {
  const roots = [
    join(repoRoot, 'node_modules', '@aster-cloud', 'glossary'),
    join(repoRoot, '..', 'aster-design-system', 'packages', 'glossary'),
  ];
  for (const root of roots) {
    if (!existsSync(join(root, 'dist', 'scanner.js'))) continue;
    if (root.includes('aster-design-system')) {
      console.warn(
        `[check-glossary] Stage 1: resolving @aster-cloud/glossary from ${relative(repoRoot, root)}. ` +
        `Once G8a publishes the package to npm, pin the version in package.json.`,
      );
    }
    return loadPackageArtifacts(root);
  }
  throw new Error(
    `[check-glossary] @aster-cloud/glossary not found. ` +
    `Expected node_modules/@aster-cloud/glossary OR ` +
    `../aster-design-system/packages/glossary built. ` +
    `Run \`pnpm install\` or \`pnpm build\` in the design system.`,
  );
}

async function loadPackageArtifacts(root: string): Promise<GlossaryPackage> {
  const dist = join(root, 'dist');
  const requirements = {
    exportPath: join(dist, 'glossary.export.json'),
    scannerPath: join(dist, 'scanner.js'),
    schemaPath: join(dist, 'schema.js'),
    localeUtilsPath: join(dist, 'locale-utils.js'),
    loaderPath: join(dist, 'loader.js'),
  };
  for (const [label, p] of Object.entries(requirements)) {
    if (!existsSync(p)) {
      throw new Error(`[check-glossary] @aster-cloud/glossary at ${root} is missing ${label} (${p}); rebuild the package.`);
    }
  }
  const rawExport = JSON.parse(readFileSync(requirements.exportPath, 'utf8'));
  const scannerMod = await import(pathToFileURL(requirements.scannerPath).href);
  const schemaMod = await import(pathToFileURL(requirements.schemaPath).href);
  const localeUtilsMod = await import(pathToFileURL(requirements.localeUtilsPath).href);
  const loaderMod = await import(pathToFileURL(requirements.loaderPath).href);

  // Runtime contract checks — names + types must match expectations.
  assertExport(scannerMod, 'scan', 'function', `${root}/dist/scanner.js`);
  assertExport(schemaMod, 'GlossaryConfigSchema', 'object', `${root}/dist/schema.js`);
  if (typeof schemaMod.GlossaryConfigSchema?.safeParse !== 'function') {
    throw new Error(`[check-glossary] ${root}/dist/schema.js exports GlossaryConfigSchema but it is not a Zod schema`);
  }
  for (const fn of ['parseLocaleTag', 'matchLocaleSegment', 'stripLocaleSegment']) {
    assertExport(localeUtilsMod, fn, 'function', `${root}/dist/locale-utils.js`);
  }
  assertExport(loaderMod, 'validateGlossaryExportShape', 'function', `${root}/dist/loader.js`);
  // Shape guard before casting — surfaces a contract diagnostic instead of
  // a downstream TypeError if glossary.export.json gets out of sync.
  loaderMod.validateGlossaryExportShape(rawExport, requirements.exportPath);
  const glossaryExport = rawExport as GlossaryExport;

  return {
    root,
    scan: scannerMod.scan as CanonicalScan,
    glossaryExport,
    configSchema: schemaMod.GlossaryConfigSchema,
    localeUtils: {
      parseLocaleTag: localeUtilsMod.parseLocaleTag,
      matchLocaleSegment: localeUtilsMod.matchLocaleSegment,
      stripLocaleSegment: localeUtilsMod.stripLocaleSegment,
    },
  };
}

function assertExport(mod: Record<string, unknown>, name: string, kind: 'function' | 'object', source: string): void {
  const v = mod[name];
  const ok = kind === 'function' ? typeof v === 'function' : (v !== null && typeof v === 'object');
  if (!ok) {
    throw new Error(
      `[check-glossary] contract break: ${source} does not export ${kind} '${name}'. ` +
      `Likely a stale build or an incompatible @aster-cloud/glossary version.`,
    );
  }
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

function loadConfig(pkg: GlossaryPackage, repoRoot: string): GlossaryConfig {
  const path = join(repoRoot, 'glossary.config.yaml');
  if (!existsSync(path)) {
    throw new Error(`[check-glossary] glossary.config.yaml not found at ${path}`);
  }
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const parsed = pkg.configSchema.safeParse(raw) as { success: boolean; data?: GlossaryConfig; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  if (!parsed.success) {
    throw new Error(
      `[check-glossary] glossary.config.yaml failed schema validation:\n  ${parsed.error!.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('\n  ')}`,
    );
  }
  return parsed.data as GlossaryConfig;
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

// Locale segment stripping now lives in @aster-cloud/glossary/locale-utils.
// See resolveGlossaryPackage().localeUtils.stripLocaleSegment — that version
// uses full BCP-47 parsing (so `zh-CN` and `zh-TW` no longer collapse to the
// same token, and `docs/api/` stays intact).

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

  const pkg = await resolveGlossaryPackage(repoRoot);
  const glossary = pkg.glossaryExport;
  const config = loadConfig(pkg, repoRoot);
  const { scan } = pkg;
  const { stripLocaleSegment } = pkg.localeUtils;

  console.log(`[check-glossary] glossary v${glossary.localesVersion} loaded ${Object.keys(glossary.terms).length} terms × ${glossary.locales.length} locales`);
  console.log(`[check-glossary] config tier=${config.tier} strict=${strict}`);

  const issues: Issue[] = [];
  const backboneLocale = glossary.locales.find((l) => l.role === 'backbone')?.id ?? 'en-US';

  // Build ScanInput from config surfaces. The canonical scan() does all
  // matching, normalisation, pairing, parity. This driver only does I/O.
  const shortToFull = new Map<string, string>();
  for (const l of glossary.locales) shortToFull.set(shortLocale(l.id), l.id);
  const registeredFullLocales = new Set(glossary.locales.map((l) => l.id));
  const officialTier = config.tier === 'official';
  const localeMismatchSeverity: 'error' | 'warning' = (strict || officialTier) ? 'error' : 'warning';

  const jsonSurfaces: Array<{ path: string; locale: string; content: unknown; pairKey?: string }> = [];
  const markdownSurfaces: Array<{ path: string; locale: string; content: string; pairKey?: string }> = [];

  for (const [surfaceName, surface] of Object.entries(config.surfaces)) {
    const files = listMatches(repoRoot, surface.paths).filter((f) => !isIgnored(f, config));
    if (files.length === 0) {
      issues.push({
        severity: officialTier ? 'error' : 'warning',
        rule: 'surface-coverage',
        path: '(config)',
        detail: `surface "${surfaceName}" matched zero files (paths=${JSON.stringify(surface.paths)})`,
      });
      continue;
    }

    if (surface.type === 'json') {
      for (const f of files) {
        if (!surface['locale-from-filename']) continue;
        // 文件名可能是短码（en.json）或全码（en-US.json，npm 包 @aster-cloud/ui-messages）。
        // 统一归一到短码再查 glossary.locales（其 key 是短码）。
        const fromName = localeFromFilename(f);
        if (!fromName) continue;
        const short = shortLocale(fromName);
        const full = shortToFull.get(short);
        if (!full) {
          issues.push({
            severity: localeMismatchSeverity,
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
        const declared = extractFrontmatterLocale(content) ?? surface['fallback-locale'] ?? null;
        const candidate = declared ?? null;
        const fileLocale = candidate && registeredFullLocales.has(candidate)
          ? candidate
          : backboneLocale;
        if (candidate && !registeredFullLocales.has(candidate)) {
          // Surface the typo; DO NOT skip the file — fall back to backbone so
          // alias/parity findings are still produced. (Round-4 codex finding.)
          issues.push({
            severity: localeMismatchSeverity,
            rule: 'surface-coverage',
            path: f,
            detail: `markdown locale "${candidate}" not registered in glossary.locales (known: ${[...registeredFullLocales].join(', ')}); falling back to backbone for scanning`,
          });
        }
        // pairKey scope: `<surfaceName>:<relative path with locale segment stripped>`.
        // stripLocaleSegment now uses canonical full-BCP-47 matching from
        // @aster-cloud/glossary/locale-utils.
        const pairKey = `${surfaceName}:${stripLocaleSegment(f, 'docs', glossary.locales)}`;
        markdownSurfaces.push({ path: f, locale: fileLocale, content, pairKey });
      }
    }
  }
  // (matchLocaleSegment is exported by @aster-cloud/glossary/locale-utils and
  // validated by assertExport above; aster-cloud's surfaces declare locale
  // explicitly via filename or frontmatter, so we don't need it at runtime.)

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
