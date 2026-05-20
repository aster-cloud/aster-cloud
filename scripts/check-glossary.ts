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
import { fileURLToPath } from 'node:url';
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

function loadConfig(repoRoot: string): GlossaryConfig {
  const path = join(repoRoot, 'glossary.config.yaml');
  if (!existsSync(path)) {
    throw new Error(`[check-glossary] glossary.config.yaml not found at ${path}`);
  }
  return parseYaml(readFileSync(path, 'utf8')) as GlossaryConfig;
}

// ─────────── Tiny scanner subset (no package install required for Stage 1) ───────────

interface Issue {
  severity: 'error' | 'warning';
  rule: string;
  path: string;
  locale?: string;
  termId?: string;
  anchor?: string;
  detail: string;
}

function normalize(s: string, ops: Array<string>): string {
  let out = s.normalize('NFC');
  out = out.replace(/[​-‏‪-‮⁠﻿]/g, '');
  if (ops.includes('width')) {
    out = out.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }
  if (ops.includes('whitespace')) {
    out = out.replace(/\s+/g, ' ').trim();
  }
  if (ops.includes('punctuation')) {
    out = out
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, '-')
      .replace(/　/g, ' ');
  }
  return out;
}

function hasMatch(haystack: string, needle: string, match: MatchSpec): boolean {
  if (!haystack || !needle) return false;
  if (match.mode === 'literal') {
    const cs = match['case-sensitive'] ?? false;
    return cs ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase());
  }
  if (match.mode === 'reviewed-regex') {
    const flags = (match['case-sensitive'] ?? false) ? 'u' : 'iu';
    try { return new RegExp(needle, flags).test(haystack); } catch { return false; }
  }
  // phrase
  const ops = match.normalize ?? [];
  const cs = match['case-sensitive'] ?? false;
  const nh = normalize(haystack, ops);
  const nn = normalize(needle, ops);
  const ch = cs ? nh : nh.toLowerCase();
  const cn = cs ? nn : nn.toLowerCase();
  const idx = ch.indexOf(cn);
  if (idx === -1) return false;
  // Word-boundary check (cheap approximation; full Intl.Segmenter is in @aster-cloud/glossary/scanner)
  const wordChar = /[\p{L}\p{N}_]/u;
  const before = idx > 0 ? ch[idx - 1]! : ' ';
  const after = idx + cn.length < ch.length ? ch[idx + cn.length]! : ' ';
  return !wordChar.test(before) && !wordChar.test(after) ||
         (wordChar.test(before) !== wordChar.test(ch[idx]!) && wordChar.test(after) !== wordChar.test(ch[idx + cn.length - 1]!));
}

function flattenJson(obj: unknown, prefix = ''): Array<{ keyPath: string; value: string }> {
  const out: Array<{ keyPath: string; value: string }> = [];
  const walk = (n: unknown, p: string): void => {
    if (typeof n === 'string') { out.push({ keyPath: p, value: n }); return; }
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (n !== null && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(obj, prefix);
  return out;
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

function main(): void {
  const strict = process.argv.includes('--strict');
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = resolvePath(dirname(__filename), '..');

  const glossary = resolveGlossary();
  const config = loadConfig(repoRoot);

  console.log(`[check-glossary] glossary v${glossary.localesVersion} loaded ${Object.keys(glossary.terms).length} terms × ${glossary.locales.length} locales`);
  console.log(`[check-glossary] config tier=${config.tier} strict=${strict}`);

  const issues: Issue[] = [];
  const backboneLocale = glossary.locales.find((l) => l.role === 'backbone')?.id ?? 'en-US';
  const backboneShort = shortLocale(backboneLocale);

  // Iterate surfaces.
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
      // Group by locale (filename-derived).
      const byLocale = new Map<string, Array<{ path: string; flat: ReturnType<typeof flattenJson> }>>();
      for (const f of files) {
        const localeFull = surface['locale-from-filename'] ? localeFromFilename(f) : null;
        if (!localeFull) continue;
        const content = JSON.parse(readFileSync(join(repoRoot, f), 'utf8'));
        const arr = byLocale.get(localeFull) ?? [];
        arr.push({ path: f, flat: flattenJson(content) });
        byLocale.set(localeFull, arr);
      }

      // 1. Forbidden-alias scan across every locale present.
      for (const [localeFull, surfs] of byLocale) {
        for (const { path, flat } of surfs) {
          for (const { keyPath, value } of flat) {
            for (const term of Object.values(glossary.terms)) {
              const aliases = term['forbidden-aliases']?.[localeFull] ?? [];
              for (const alias of aliases) {
                if (hasMatch(value, alias.text, alias.match)) {
                  issues.push({
                    severity: 'error',
                    rule: 'forbidden-alias',
                    path,
                    locale: localeFull,
                    termId: term.id,
                    anchor: keyPath,
                    detail: `forbidden alias "${alias.text}" of term "${term.id}" found in ${localeFull} (registered: "${term.translations[localeFull] ?? '???'}")`,
                  });
                }
              }
            }
          }
        }
      }

      // 2. Term-mention parity (backbone → target). Use the SHORT locale to look up files,
      //    since aster-cloud's filenames are en.json, zh.json, de.json — not en-US.json.
      const localeMap = new Map<string, string>();      // short → full
      for (const l of glossary.locales) localeMap.set(shortLocale(l.id), l.id);

      const backboneSurfs = byLocale.get(localeMap.get(backboneShort) ?? backboneLocale) ?? [];
      for (const backboneSurf of backboneSurfs) {
        // Match each backbone file to its sibling in other locales by directory + basename pattern.
        const sameDir = dirname(backboneSurf.path);
        for (const [targetFull, targetSurfs] of byLocale) {
          if (targetFull === (localeMap.get(backboneShort) ?? backboneLocale)) continue;
          const targetShort = shortLocale(targetFull);
          const targetPath = join(sameDir, `${targetShort}.json`);
          const target = targetSurfs.find((s) => s.path === targetPath);
          if (!target) continue;
          const targetByKey = new Map(target.flat.map((s) => [s.keyPath, s.value]));

          for (const { keyPath, value } of backboneSurf.flat) {
            for (const term of Object.values(glossary.terms)) {
              const backboneTrans = term.translations[localeMap.get(backboneShort) ?? backboneLocale];
              const targetTrans = term.translations[targetFull];
              if (!backboneTrans || !targetTrans) continue;
              if (!hasMatch(value, backboneTrans, term.match)) continue;
              const targetValue = targetByKey.get(keyPath);
              if (targetValue === undefined) continue;          // missing-key handled by check-locales
              if (!hasMatch(targetValue, targetTrans, term.match)) {
                issues.push({
                  severity: 'error',
                  rule: 'term-mention-parity',
                  path: target.path,
                  locale: targetFull,
                  termId: term.id,
                  anchor: keyPath,
                  detail: `term "${term.id}" in backbone but ${targetFull} value "${truncate(targetValue)}" lacks registered translation "${targetTrans}"`,
                });
              }
            }
          }
        }
      }
    }

    if (surface.type === 'markdown') {
      // Stage 1 inventory: for now just verify ignored-surfaces glob hygiene + count files.
      // Block-id pairing is exercised after the markdown tree has been annotated by
      // `glossary-fmt insert` (planned for Stage 2).
      console.log(`[check-glossary] markdown surface "${surfaceName}" matched ${files.length} files (block-id annotation deferred to Stage 2)`);
    }
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

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

main();
