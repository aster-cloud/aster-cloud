/**
 * 生产数据库迁移入口
 *
 * 调用 drizzle-kit migrate，按 drizzle/__drizzle_migrations 表
 * 已记录的迁移哈希增量应用 drizzle/*.sql 中尚未运行的迁移。
 *
 * 入参：环境变量 DATABASE_URL（Postgres 连接串）
 * 出错：非零退出码 + stderr
 *
 * 在 K8s 中作为 Job 运行（见 k3s/apps/aster-lang/cloud/migrate-job.yaml）
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // 单连接 + 限制超时；migration 顺序敏感，不要并行
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  const db = drizzle(sql);

  console.log('[migrate] starting drizzle migration');
  const start = Date.now();
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log(`[migrate] success in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[migrate] FAILED:', err);
    process.exit(2);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[migrate] unhandled error:', err);
  process.exit(3);
});
