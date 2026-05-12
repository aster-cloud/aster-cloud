/**
 * One-shot drizzle baseline script
 *
 * 用途：把 0001-0003 这些**已经手动应用过**的 SQL 标记为"drizzle 已知应用"，
 * 让首次 drizzle-kit migrate 跳过它们直接从 0004+ 开始。
 *
 * 行为：
 *   1) 在目标 DB 创建 drizzle.__drizzle_migrations 表（若不存在）
 *   2) 计算 drizzle/0001.sql / 0002.sql / 0003.sql 的 SHA-256（drizzle 用同样算法）
 *   3) 把三条记录插入 __drizzle_migrations（id 自动，hash + created_at 由我们填）
 *
 * 幂等：用 INSERT ... ON CONFLICT DO NOTHING（基于 hash 唯一）
 *
 * 调用：
 *   DATABASE_URL=postgresql://user:pwd@host:5432/aster_cloud \
 *     pnpm tsx scripts/baseline-drizzle.ts
 *
 * 仅运行一次，之后删除（或保留为文档）。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(__dirname, '..', 'drizzle');

// 必须与 drizzle/meta/_journal.json 中 entries 严格一一对应，
// when 字段也要一致以保证后续 drizzle 比对 hash 时不报歧义。
const ENTRIES = [
  { tag: '0001_grandfather_legacy_tier', when: 1760000000000 },
  { tag: '0002_ai_billing',              when: 1760000010000 },
  { tag: '0003_user_columns_resync',     when: 1760000020000 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });

  try {
    console.log('[baseline] ensuring drizzle.__drizzle_migrations exists');
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS drizzle;
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      );
    `);

    for (const e of ENTRIES) {
      const file = join(DRIZZLE_DIR, `${e.tag}.sql`);
      const content = readFileSync(file, 'utf8');
      const hash = createHash('sha256').update(content).digest('hex');

      const existing = await sql`
        SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
      `;
      if (existing.length > 0) {
        console.log(`[baseline] ${e.tag} already baselined (hash ${hash.slice(0, 8)}…)`);
        continue;
      }

      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${e.when})
      `;
      console.log(`[baseline] ${e.tag} marked applied (hash ${hash.slice(0, 8)}…)`);
    }

    const count = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    console.log(`[baseline] done. __drizzle_migrations now has ${count[0].n} row(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[baseline] FAILED:', err);
  process.exit(2);
});
