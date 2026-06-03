#!/usr/bin/env node
/**
 * Docs PII scan — refuses to ship docs HTML that contains
 * session-derived personal data.
 *
 * Architecture invariant (see .claude/plan/docs-enterprise-ux.md §1):
 *   /docs/* RSC must never read `auth()` server-side. All session
 *   awareness happens client-side via `useDocsSession()` after the
 *   page hydrates. This script enforces that invariant by grepping
 *   the built RSC payloads / chunks under `.next/server/app/`
 *   restricted to the docs route tree for traces of personal data.
 *
 * Why post-build vs lint: the invariant is about the *built output*,
 * not the source. Source can legitimately reference `auth()` from
 * places like the dashboard layout next door; what matters is that
 * none of those references survive into the docs chunk.
 *
 * Failure semantics:
 *   - Any forbidden pattern found in docs build artifacts → exit 1
 *   - Soft warnings (e.g., binaries we cannot decode) → log, continue
 *
 * Allow-list: technical strings that happen to contain forbidden
 * substrings but are not PII (e.g., the literal regex `\\w+@\\w+` in
 * the PII scan source itself). Maintain narrowly — every entry needs
 * a comment.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const BUILD_ROOT = resolve(REPO_ROOT, '.next/server/app');

/**
 * Forbidden patterns. Each entry has a regex and a human-readable
 * label. The regex is applied to every chunk file's text content.
 */
const FORBIDDEN = [
  {
    label: 'email-like literal',
    // Match an email-shaped string that contains a known TLD list to
    // avoid catching things like "user@example.com" doc placeholders.
    // We use a permissive shape and rely on the allow-list to silence
    // sample addresses inside MDX content.
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/g,
  },
  {
    label: 'session.user.email reference',
    re: /session\.user\.email/g,
  },
  {
    label: 'session.user.name reference',
    re: /session\.user\.name/g,
  },
  {
    label: 'team.name reference',
    re: /\bteam\.name\b/g,
  },
  {
    label: 'tenant.name reference',
    re: /\btenant\.name\b/g,
  },
];

/**
 * Allow-list of literal substrings that may legitimately appear in
 * MDX content despite matching a forbidden pattern. Every entry needs
 * a justification.
 */
const ALLOW = [
  // Documentation prose may reference these constants when explaining
  // how clients should send auth headers.
  'X-Aster-Signature',
  'X-Aster-Nonce',
  'X-Aster-Timestamp',
];

/**
 * Domain allow-list for email-shaped matches. Emails ending in these
 * domains are sample/placeholder values inside MDX code blocks
 * (curl/JS examples) and are not PII. We allow whole domains here
 * rather than each email so adding a new MDX example doesn't require
 * touching the scan script. Real production user addresses are NEVER
 * in these domains.
 */
const SAMPLE_DOMAINS = [
  'example.com',
  'example.org',
  'acme.com',
  'acme-corp.com',
  'aster-lang.dev', // support@aster-lang.dev in prose
  'localhost',
];

function isAllowed(match) {
  if (ALLOW.some((needle) => match.includes(needle))) return true;
  // For email-shaped matches, allow if the domain is a known sample.
  const at = match.indexOf('@');
  if (at >= 0) {
    const domain = match.slice(at + 1).toLowerCase();
    if (SAMPLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      return true;
    }
  }
  return false;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isTextFile(path) {
  return (
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.mjs') ||
    path.endsWith('.json') ||
    path.endsWith('.rsc') ||
    path.endsWith('.body') ||
    path.endsWith('.txt')
  );
}

function scanFile(path) {
  const findings = [];
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return findings;
  }
  for (const { label, re } of FORBIDDEN) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isAllowed(m[0])) continue;
      findings.push({ label, match: m[0], offset: m.index });
    }
  }
  return findings;
}

function main() {
  // Restrict scan to docs build artifacts. The docs route tree is
  // app/[locale]/docs/**, so any file path containing /[locale]/docs/
  // (or its compiled form `(locale)/docs/` in some Next versions) is
  // in scope.
  if (!existsSync(BUILD_ROOT)) {
    console.error(`[docs-pii-scan] no build output at ${BUILD_ROOT} — run pnpm build:next first`);
    process.exit(2);
  }

  const allFiles = walk(BUILD_ROOT);
  const docsFiles = allFiles.filter((p) => {
    const norm = p.replace(/\\/g, '/');
    return (
      isTextFile(norm) &&
      (norm.includes('/[locale]/docs/') || norm.includes('/(locale)/docs/'))
    );
  });

  if (docsFiles.length === 0) {
    console.error(
      '[docs-pii-scan] scanned 0 docs build artifacts — build layout may have changed',
    );
    process.exit(2);
  }

  let total = 0;
  const violations = [];
  for (const f of docsFiles) {
    const findings = scanFile(f);
    if (findings.length === 0) continue;
    total += findings.length;
    violations.push({ file: f.replace(REPO_ROOT + '/', ''), findings });
  }

  if (violations.length === 0) {
    console.log(`[docs-pii-scan] OK — scanned ${docsFiles.length} files, 0 violations`);
    process.exit(0);
  }

  console.error(`[docs-pii-scan] FAIL — ${total} forbidden matches across ${violations.length} files`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  ${v.file}`);
    for (const f of v.findings.slice(0, 5)) {
      console.error(`    [${f.label}] @${f.offset}: ${JSON.stringify(f.match)}`);
    }
    if (v.findings.length > 5) console.error(`    … and ${v.findings.length - 5} more`);
  }
  if (violations.length > 20) {
    console.error(`  … and ${violations.length - 20} more files`);
  }
  console.error(
    '\nRemediation: ensure docs RSC never reads session/auth/tenant state. ' +
      'Session awareness must go through `useDocsSession()` (client-only).',
  );
  process.exit(1);
}

main();
