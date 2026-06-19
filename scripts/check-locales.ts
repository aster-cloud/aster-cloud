/**
 * check-locales.ts
 *
 * 校验 messages/*.json 之间的 key 完整性。
 *
 * 规则：
 * - en.json 是 backbone（fallback 默认语言）
 * - 其他 locale 缺 key → warn（运行时由 deepMergeMessages 兜底，但仍提示翻译团队）
 * - 其他 locale 多 key（en 没有的 key）→ error（说明 schema 不一致 / 拼写错误）
 * - 类型不匹配（string vs object）→ error
 *
 * 退出码：
 *   0 = 全部对齐（或仅有 warn 且未传 --strict）
 *   1 = 发现 error 或在 --strict 模式下发现 warn
 *
 * 用法：
 *   pnpm tsx scripts/check-locales.ts            # 容忍 warn
 *   pnpm tsx scripts/check-locales.ts --strict   # CI 模式，warn 即失败
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const BACKBONE = 'en';
// hi 现已全量翻译（2154/2154，覆盖率 100%），纳入 strict 对比以捕获未来 key 漂移。
const COMPARE = ['zh', 'de', 'hi'];

interface Finding {
  level: 'error' | 'warn';
  locale: string;
  path: string;
  message: string;
}

type Tree = Record<string, unknown>;

function loadLocale(code: string): Tree {
  const file = join(PROJECT_ROOT, 'messages', `${code}.json`);
  return JSON.parse(readFileSync(file, 'utf-8')) as Tree;
}

/**
 * 递归收集 backbone vs target 的差异。
 *
 * @param backbone - en.json 的子树
 * @param target   - 当前 locale 的子树
 * @param locale   - 当前 locale 代号（用于报告）
 * @param prefix   - 当前 key 路径（点分）
 * @param findings - 输出累积数组
 */
function diff(
  backbone: Tree,
  target: Tree,
  locale: string,
  prefix: string,
  findings: Finding[],
): void {
  // backbone 中存在但 target 缺失 / 类型不符
  for (const key of Object.keys(backbone)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const b = backbone[key];
    const t = target[key];

    if (t === undefined) {
      findings.push({
        level: 'warn',
        locale,
        path,
        message: `missing translation (will fall back to ${BACKBONE})`,
      });
      continue;
    }

    const bIsObj = b !== null && typeof b === 'object' && !Array.isArray(b);
    const tIsObj = t !== null && typeof t === 'object' && !Array.isArray(t);

    if (bIsObj !== tIsObj) {
      findings.push({
        level: 'error',
        locale,
        path,
        message: `type mismatch (backbone=${bIsObj ? 'object' : typeof b}, target=${tIsObj ? 'object' : typeof t})`,
      });
      continue;
    }

    if (bIsObj && tIsObj) {
      diff(b as Tree, t as Tree, locale, path, findings);
    } else if (typeof t === 'string' && t.trim() === '') {
      findings.push({
        level: 'warn',
        locale,
        path,
        message: `empty string (will fall back to ${BACKBONE})`,
      });
    }
  }

  // target 中存在但 backbone 没有 → 多余 key，schema drift
  for (const key of Object.keys(target)) {
    if (!(key in backbone)) {
      const path = prefix ? `${prefix}.${key}` : key;
      findings.push({
        level: 'error',
        locale,
        path,
        message: `extra key not present in backbone (${BACKBONE}.json)`,
      });
    }
  }
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const backbone = loadLocale(BACKBONE);
  const findings: Finding[] = [];

  for (const code of COMPARE) {
    let target: Tree;
    try {
      target = loadLocale(code);
    } catch (e) {
      findings.push({
        level: 'error',
        locale: code,
        path: '<file>',
        message: `failed to load messages/${code}.json: ${(e as Error).message}`,
      });
      continue;
    }
    diff(backbone, target, code, '', findings);
  }

  const errors = findings.filter(f => f.level === 'error');
  const warns = findings.filter(f => f.level === 'warn');

  for (const f of findings) {
    const icon = f.level === 'error' ? '✗' : '⚠';
    console.log(`${icon} [${f.locale}] ${f.path} — ${f.message}`);
  }

  console.log(
    `\nSummary: ${errors.length} error(s), ${warns.length} warning(s) across locales [${COMPARE.join(', ')}].`,
  );

  if (errors.length > 0 || (strict && warns.length > 0)) {
    process.exit(1);
  }
}

main();
