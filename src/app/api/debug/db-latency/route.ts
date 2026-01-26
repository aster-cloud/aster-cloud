import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

// 尝试获取 Hyperdrive 连接字符串
function getHyperdriveConnectionString(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const context = getCloudflareContext({ async: false });
    return context.env?.HYPERDRIVE?.connectionString || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const results: Array<{
    test: string;
    latencyMs: number;
    result?: unknown;
  }> = [];

  // ========== 测试组1: 当前实现 (每次调用 db 创建新连接) ==========

  // Test 1: Current implementation - first query
  const t1 = Date.now();
  await db.execute(sql`SELECT 1 as ping`);
  results.push({
    test: '[Current] First query (new connection)',
    latencyMs: Date.now() - t1,
  });

  // Test 2: Current implementation - second query (still creates new connection due to Proxy)
  const t2 = Date.now();
  await db.execute(sql`SELECT 1 as ping`);
  results.push({
    test: '[Current] Second query (new connection via Proxy)',
    latencyMs: Date.now() - t2,
  });

  // ========== 测试组2: 单一客户端复用 (推荐模式) ==========

  const connectionString = getHyperdriveConnectionString();

  if (connectionString) {
    // 创建单一客户端，复用于整个请求
    const client = postgres(connectionString, {
      max: 5,           // Cloudflare Workers 限制
      prepare: false,   // Hyperdrive 不支持 prepared statements
    });
    const singleDb = drizzle(client, { schema });

    // Test 3: Single client - first query (establishes connection)
    const t3 = Date.now();
    await singleDb.execute(sql`SELECT 1 as ping`);
    results.push({
      test: '[SingleClient] First query (connection establishment)',
      latencyMs: Date.now() - t3,
    });

    // Test 4: Single client - second query (reuses connection)
    const t4 = Date.now();
    await singleDb.execute(sql`SELECT 1 as ping`);
    results.push({
      test: '[SingleClient] Second query (connection reuse)',
      latencyMs: Date.now() - t4,
    });

    // Test 5: Single client - third query
    const t5 = Date.now();
    await singleDb.execute(sql`SELECT 1 as ping`);
    results.push({
      test: '[SingleClient] Third query (connection reuse)',
      latencyMs: Date.now() - t5,
    });

    // Test 6: Single client - complex query
    const t6 = Date.now();
    await singleDb.execute(sql`
      SELECT p.id, p.name, u.id as user_id
      FROM "Policy" p
      CROSS JOIN "User" u
      LIMIT 1
    `);
    results.push({
      test: '[SingleClient] Complex JOIN query (connection reuse)',
      latencyMs: Date.now() - t6,
    });

    // Test 7: Single client - 3 sequential queries
    const t7 = Date.now();
    await singleDb.execute(sql`SELECT 1`);
    await singleDb.execute(sql`SELECT 2`);
    await singleDb.execute(sql`SELECT 3`);
    results.push({
      test: '[SingleClient] 3 sequential queries',
      latencyMs: Date.now() - t7,
    });

    // 关闭客户端
    await client.end();
  } else {
    results.push({
      test: '[SingleClient] Skipped - not in Cloudflare environment',
      latencyMs: 0,
    });
  }

  // ========== 分析结果 ==========

  const currentFirstQuery = results[0].latencyMs;
  const currentSecondQuery = results[1].latencyMs;
  const singleClientFirstQuery = results[2]?.latencyMs || 0;
  const singleClientSecondQuery = results[3]?.latencyMs || 0;
  const singleClientThirdQuery = results[4]?.latencyMs || 0;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    summary: {
      current: {
        firstQueryMs: currentFirstQuery,
        secondQueryMs: currentSecondQuery,
        note: 'Each db.execute() creates new postgres client via Proxy',
      },
      singleClient: {
        firstQueryMs: singleClientFirstQuery,
        secondQueryMs: singleClientSecondQuery,
        thirdQueryMs: singleClientThirdQuery,
        note: 'Single postgres client reused for all queries',
      },
      improvement: {
        connectionOverheadMs: currentSecondQuery - singleClientSecondQuery,
        percentImprovement: singleClientSecondQuery > 0
          ? Math.round((1 - singleClientSecondQuery / currentSecondQuery) * 100)
          : 0,
      },
    },
    details: results,
    recommendation: connectionString
      ? 'Use single postgres client per request for connection reuse'
      : 'Running in non-Cloudflare environment',
    hyperdrive: {
      connected: !!connectionString,
      host: 'postgres.aster-lang.dev',
      database: 'aster_cloud',
    },
  });
}
