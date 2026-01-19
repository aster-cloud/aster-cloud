/**
 * 数据库连接配置
 * 支持 Cloudflare Workers/Pages 环境（通过 Hyperdrive）和本地开发环境
 *
 * 性能说明：
 * - Cloudflare Workers: Hyperdrive 负责连接池，每次 getDb() 获取预热连接
 * - 本地开发：使用模块级单例避免连接泄漏
 * - 使用 AsyncLocalStorage 实现请求级别的连接复用
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { AsyncLocalStorage } from 'async_hooks';

// 类型导出
export * from './schema';
export type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// Hyperdrive 类型定义
interface HyperdriveBinding {
  connectionString: string;
}

interface CloudflareEnv {
  HYPERDRIVE?: HyperdriveBinding;
}

// 请求级别的数据库连接存储
const requestDbStorage = new AsyncLocalStorage<ReturnType<typeof createDb>>();

// 本地开发环境的单例连接（避免热重载时连接泄漏）
let localDevDb: ReturnType<typeof createDb> | null = null;

/**
 * 尝试从 OpenNext 获取 Cloudflare 上下文（同步版本）
 * 注意：只能在请求处理期间调用，不能在模块初始化时调用
 */
function getCloudflareEnvSync(): CloudflareEnv | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const context = getCloudflareContext({ async: false });
    return context.env as CloudflareEnv;
  } catch {
    // 非 Cloudflare 环境或不在请求上下文中
    return null;
  }
}

/**
 * 尝试从 OpenNext 获取 Cloudflare 上下文（异步版本）
 */
async function getCloudflareEnv(): Promise<CloudflareEnv | null> {
  try {
    // 动态导入以避免在非 Cloudflare 环境中报错
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    return context.env as CloudflareEnv;
  } catch {
    // 非 Cloudflare 环境或导入失败
    return null;
  }
}

/**
 * 获取数据库连接字符串
 * 优先级：HYPERDRIVE > DATABASE_URL
 */
function getConnectionString(env?: CloudflareEnv): string {
  // Cloudflare Workers/Pages 环境：使用 Hyperdrive binding
  if (env?.HYPERDRIVE?.connectionString) {
    return env.HYPERDRIVE.connectionString;
  }

  // 本地开发环境：使用环境变量
  const url = process.env.HYPERDRIVE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Database connection string not found. ' +
        'Set DATABASE_URL environment variable or provide HYPERDRIVE binding.'
    );
  }
  return url;
}

/**
 * 创建数据库客户端
 * Hyperdrive 负责连接池，这里只是创建客户端包装器
 */
export function createDb(env?: CloudflareEnv) {
  const connectionString = getConnectionString(env);

  const client = postgres(connectionString, {
    // Hyperdrive 处理连接池，Workers 限制并发连接数
    max: 1,
    // 禁用 prepared statements（Hyperdrive 不支持）
    prepare: false,
  });

  return drizzle(client, { schema });
}

/**
 * 获取数据库实例（自动检测 Cloudflare 环境）
 * 在 Cloudflare Workers 中会自动使用 Hyperdrive
 */
export async function getDbAsync(): Promise<ReturnType<typeof createDb>> {
  const env = await getCloudflareEnv();
  return createDb(env ?? undefined);
}

/**
 * 获取数据库实例
 * - 在 Cloudflare Workers 中：每次调用创建新实例（Hyperdrive 管理实际连接池）
 * - 在本地开发中：使用单例避免连接泄漏
 *
 * 性能说明：
 * - Hyperdrive 在边缘维护连接池，"创建连接"实际上是获取预热连接
 * - createDb() 的开销主要是 JavaScript 对象创建，非常轻量
 * - 如果需要在单个请求中复用，可以在请求入口处获取一次并传递
 */
export function getDb() {
  // 检查是否在请求上下文中已有缓存的连接
  const cachedDb = requestDbStorage.getStore();
  if (cachedDb) {
    return cachedDb;
  }

  // 尝试获取 Cloudflare 上下文
  const env = getCloudflareEnvSync();

  // Cloudflare Workers 环境：每次创建新实例（Hyperdrive 管理连接池）
  if (env?.HYPERDRIVE) {
    return createDb(env);
  }

  // 本地开发环境：使用单例避免连接泄漏
  if (!localDevDb) {
    localDevDb = createDb();
  }
  return localDevDb;
}

/**
 * 在请求上下文中运行函数，复用同一数据库连接
 * 用于需要在单个请求中多次访问数据库的场景
 *
 * @example
 * await withRequestDb(async (db) => {
 *   const user = await db.query.users.findFirst(...);
 *   const posts = await db.query.posts.findMany(...);
 *   return { user, posts };
 * });
 */
export async function withRequestDb<T>(
  fn: (db: ReturnType<typeof createDb>) => Promise<T>
): Promise<T> {
  const env = getCloudflareEnvSync();
  const db = createDb(env ?? undefined);
  return requestDbStorage.run(db, () => fn(db));
}

/**
 * 数据库类型
 */
export type Database = ReturnType<typeof createDb>;
