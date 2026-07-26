#!/usr/bin/env node
/**
 * Convert VitePress `:::tip`/`:::warning`/`:::code-group` container
 * markers in migrated MDX into the project's React equivalents
 * (`<Callout>` / `<CodeGroup>`).
 *
 * VitePress containers parse via `markdown-it-container`; raw `:::`
 * passed to MDX renders as literal text, not a wrapper. This script
 * is idempotent — re-running on already-converted MDX is a no-op
 * because there are no `:::` markers left.
 *
 * Stack semantics: open markers push the component name onto a stack;
 * each `:::` close pops the top and emits the matching closing tag.
 * Mismatched nesting will throw with a file:line to fix.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');

const CALLOUT_TYPES = ['tip', 'warning', 'danger', 'info', 'note'];

function convert(content, filePath) {
  const stack = []; // tag names on the stack
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // close marker — just `:::` (no further content)
    if (/^:::\s*$/.test(line)) {
      const top = stack.pop();
      if (!top) {
        throw new Error(`${filePath}:${i + 1} — unmatched closing ::: with no opener`);
      }
      out.push(`</${top}>`);
      continue;
    }
    // open: ::: code-group
    const codeGroup = line.match(/^:::\s*code-group\s*$/);
    if (codeGroup) {
      stack.push('CodeGroup');
      out.push('<CodeGroup>');
      continue;
    }
    // open: ::: <type> [title]
    const typed = line.match(/^:::\s*(tip|warning|danger|info|note)(?:\s+(.+))?$/);
    if (typed) {
      const [, type, title] = typed;
      if (!CALLOUT_TYPES.includes(type)) {
        out.push(line);
        continue;
      }
      stack.push('Callout');
      // JSX 属性值完整实体编码（原 `\"` 反斜杠转义对 JSX/HTML 属性不正确、且漏了 & < >）
      // （CodeQL incomplete-html-attribute-sanitization）：& → &amp; 先行，再 < > "。
      const titleAttr = title
        ? ` title="${title
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')}"`
        : '';
      out.push(`<Callout type="${type}"${titleAttr}>`);
      continue;
    }
    out.push(line);
  }
  if (stack.length) {
    throw new Error(
      `${filePath} — unclosed container(s): ${stack.join(', ')}`,
    );
  }
  return out.join('\n');
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (full.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

const files = walk(DOCS_ROOT);
let convertedCount = 0;
let errorCount = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(':::')) continue;
  try {
    const after = convert(before, file);
    if (after !== before) {
      writeFileSync(file, after);
      convertedCount += 1;
    }
  } catch (e) {
    console.error(e.message);
    errorCount += 1;
  }
}
console.log(`[convert-containers] converted ${convertedCount} files, ${errorCount} errors`);
if (errorCount > 0) process.exit(1);
