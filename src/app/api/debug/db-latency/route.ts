import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { sql } from 'drizzle-orm';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results: Array<{ test: string; latencyMs: number }> = [];

  const t1 = Date.now();
  await db.execute(sql`SELECT 1 as ping`);
  results.push({ test: 'First query', latencyMs: Date.now() - t1 });

  const t2 = Date.now();
  await db.execute(sql`SELECT 1 as ping`);
  results.push({ test: 'Second query', latencyMs: Date.now() - t2 });

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    details: results,
  });
}
