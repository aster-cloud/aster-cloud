// Redis 客户端单例（仅 server-side）
//
// 在 Vercel/edge 部署上，Redis 由 REDIS_URL env 提供（aster-deploy/podman 本地已含）。
// 缺省 / 未配置时，Rate Limiter 会 fail-open + 监控告警。
import IORedis from 'ioredis';

let client: IORedis | null = null;

export function getRedis(): IORedis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      // 1s 内连不上视为不可用
      connectTimeout: 1000,
    });
    client.on('error', (err) => {
      // 仅日志；上层 fail-open
      console.warn('[redis] error:', err.message);
    });
    return client;
  } catch (e) {
    console.warn('[redis] init failed:', (e as Error).message);
    return null;
  }
}
