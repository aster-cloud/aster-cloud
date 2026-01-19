// 自定义 Worker 入口点
// 简单包装 OpenNext 生成的 handler
// middleware 现在已正确编译到 src/middleware.ts，无需额外的路由逻辑

// 动态导入 OpenNext 生成的 worker
import openNextWorker from "./.open-next/worker.js";

// 重新导出 OpenNext 的 Durable Objects
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    // 所有请求交给 OpenNext 处理（包含 middleware）
    return openNextWorker.fetch(request, env, ctx);
  },
};
