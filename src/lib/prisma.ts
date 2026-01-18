import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * 获取数据库连接字符串
 *
 * 通过 USE_HYPERDRIVE 环境变量控制使用哪个数据库:
 * - USE_HYPERDRIVE=true  → 使用 HYPERDRIVE_DATABASE_URL (k3s PostgreSQL via Cloudflare Hyperdrive)
 * - USE_HYPERDRIVE=false → 使用 DATABASE_URL (Vercel Postgres / Prisma Accelerate)
 *
 * 默认使用 DATABASE_URL 以保持向后兼容
 */
function getDatabaseUrl(): string {
  const useHyperdrive = process.env.USE_HYPERDRIVE === 'true';

  if (useHyperdrive) {
    const hyperdriveUrl = process.env.HYPERDRIVE_DATABASE_URL;
    if (!hyperdriveUrl) {
      throw new Error('HYPERDRIVE_DATABASE_URL environment variable is not set (USE_HYPERDRIVE=true)');
    }
    return hyperdriveUrl;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return databaseUrl;
}

function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseUrl();

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

// Lazy initialization to avoid build-time errors
let prismaInstance: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = globalForPrisma.prisma ?? createPrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = prismaInstance;
    }
  }
  return prismaInstance;
}

// Proxy for lazy initialization
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    return getPrisma()[prop as keyof PrismaClient];
  },
});
