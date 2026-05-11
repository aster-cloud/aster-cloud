// Next.js Instrumentation hook — 服务器启动时执行一次
// 详见 https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// 用途：production 启动时校验关键 env，缺失立即 throw 让 K8s readiness probe 失败，
// 避免缺 env 的实例进流量池。

import { validateEnvOrThrow } from './lib/env-validation';

export async function register() {
  // 仅 Node.js runtime 跑（Edge runtime / Cloudflare Workers 跳过，避免在那里报错）
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  validateEnvOrThrow();
}
