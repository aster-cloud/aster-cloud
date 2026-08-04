#!/usr/bin/env node
/**
 * 抓取 aster-lang.dev 的文档搜索索引，落盘为 `src/lib/docs/external-index.<locale>.json`。
 *
 * <p><b>为什么是构建期抓、且产物入库</b>：站内助手要能引用 aster-lang.dev 的内容，
 * 但**不能运行时抓站**——那样站点改版就静默失效、网络抖动就答不出，与"答案可溯源"
 * 的产品承诺相悖。构建期抓 + 产物提交，意味着索引随发版固化、可审计、可回滚，
 * 且离线也能构建。
 *
 * <p><b>失败即保留旧产物</b>：抓不到时不清空、不写空索引，只告警。上游临时挂掉
 * 不应该让助手悄悄失去一半知识——那种"看起来正常但答不出"的降级最难排查。
 * 只有显式传 --require-fresh（CI 定期任务用）才在失败时非零退出。
 *
 * <p>用法：
 *   node scripts/docs-migration/fetch-external-docs-index.mjs
 *   node scripts/docs-migration/fetch-external-docs-index.mjs --require-fresh
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'src/lib/docs');
const BASE = process.env.ASTER_DEV_BASE_URL || 'https://www.aster-lang.dev';
const LOCALES = ['en', 'zh', 'de', 'hi'];
const REQUIRE_FRESH = process.argv.includes('--require-fresh');
const TIMEOUT_MS = 15_000;

/** 校验抓到的东西确实是索引，而不是 404 页面或 HTML。 */
function isValidIndex(v, locale) {
  return (
    v &&
    typeof v === 'object' &&
    v.locale === locale &&
    Array.isArray(v.entries) &&
    v.entries.every(
      (e) =>
        e &&
        typeof e.slug === 'string' &&
        e.slug.length > 0 &&
        typeof e.title === 'string' &&
        Array.isArray(e.headings),
    )
  );
}

async function fetchOne(locale) {
  const url = `${BASE}/search-index.${locale}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!isValidIndex(json, locale)) {
      throw new Error('响应不是合法索引（schema 不匹配）');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let failures = 0;
  for (const locale of LOCALES) {
    const outFile = join(OUTPUT_DIR, `external-index.${locale}.json`);
    try {
      const index = await fetchOne(locale);
      writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
      console.log(`[fetch-external-docs-index] ${locale}: ${index.entries.length} entries`);
    } catch (e) {
      failures++;
      const detail = e instanceof Error ? e.message : String(e);
      if (existsSync(outFile)) {
        const kept = JSON.parse(readFileSync(outFile, 'utf8'));
        console.warn(
          `[fetch-external-docs-index] ${locale}: 抓取失败（${detail}），` +
            `保留既有产物 ${kept.entries?.length ?? 0} 条`,
        );
      } else {
        // 首次抓取失败且无既有产物 → 写空索引让构建能继续，
        // 但明确告警：助手会少掉站外来源，而不是整个挂掉。
        writeFileSync(outFile, `${JSON.stringify({ locale, entries: [] }, null, 2)}\n`);
        console.warn(
          `[fetch-external-docs-index] ${locale}: 抓取失败（${detail}）且无既有产物，` +
            '写入空索引——助手将暂时没有站外结果',
        );
      }
    }
  }
  if (failures > 0 && REQUIRE_FRESH) {
    throw new Error(
      `[fetch-external-docs-index] ${failures} 个 locale 抓取失败，` +
        '且指定了 --require-fresh',
    );
  }
}

await main();
