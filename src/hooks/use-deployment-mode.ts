// 客户端 deployment-mode 访问
//
// 服务端组件请 import `@/lib/deployment-mode` 的常量 / 函数；
// 客户端组件用本 hook + CLIENT_CAPABILITIES。
//
// 数据流：next.config.ts 把 `DEPLOYMENT_MODE` 镜像到 `NEXT_PUBLIC_DEPLOYMENT_MODE`
// 让客户端 bundle 也能拿到字面量值（编译期注入；不读 runtime env）。
//
// 注意：客户端能力值与服务端必须一致 —— 否则 hydration mismatch。
// 因为两者都来自同一 build 的同一字面量，所以保证一致。

'use client';

import type { DeploymentMode } from '@/lib/deployment-mode';

const _MODE: DeploymentMode =
  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';

export function useDeploymentMode(): DeploymentMode {
  // 防御性归一化 —— 即使有人手改环境变量到非法值也回退 saas。
  // next.config.ts 也归一化一遍，这里是双保险。
  return _MODE;
}

export const CLIENT_CAPABILITIES = {
  billing: _MODE === 'saas',
  pricing: _MODE === 'saas',
  riskTier: _MODE === 'saas',
  dunning: _MODE === 'saas',
  signup: _MODE === 'saas',
  mixpanel: _MODE === 'saas',
  resend: _MODE === 'saas',
  license: _MODE === 'on-prem',
  sso: _MODE === 'on-prem',
} as const;
