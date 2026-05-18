// Dual-project meta-test — proves the vitest projects setup actually
// switches DEPLOYMENT_MODE between runs.
//
// 这个测试故意 **不** vi.mock '@/lib/deployment-mode'，依赖 project-
// level env (PR-10 设的 DEPLOYMENT_MODE / NEXT_PUBLIC_DEPLOYMENT_MODE)
// 来观察 helper 真实返回的 mode。
//
// 在 saas project 跑时：expect mode === 'saas'
// 在 on-prem project 跑时：expect mode === 'on-prem'
//
// 用 it.skipIf 模式分支：每个 project 只跑自己那一支断言。这是 PR-10
// 文档化的标准模式感知测试 pattern；后续如果有任何 *真实 runtime 行为
// 因 mode 不同* 的测试都可以照搬这个模板。

import { describe, it, expect } from 'vitest';
import { getDeploymentMode, IS_SAAS, IS_ONPREM } from '@/lib/deployment-mode';

const projectMode = process.env.DEPLOYMENT_MODE;
const inSaasProject = projectMode === 'saas';
const inOnPremProject = projectMode === 'on-prem';

describe('vitest dual-project: deployment-mode env injection', () => {
  it.skipIf(!inSaasProject)(
    'saas project: getDeploymentMode() returns "saas"',
    () => {
      expect(getDeploymentMode()).toBe('saas');
      expect(IS_SAAS).toBe(true);
      expect(IS_ONPREM).toBe(false);
    },
  );

  it.skipIf(!inOnPremProject)(
    'on-prem project: getDeploymentMode() returns "on-prem"',
    () => {
      expect(getDeploymentMode()).toBe('on-prem');
      expect(IS_SAAS).toBe(false);
      expect(IS_ONPREM).toBe(true);
    },
  );

  it('process.env.DEPLOYMENT_MODE matches project name in both runs', () => {
    // 无 skipIf —— 这个 invariant 在两种 project 都应成立
    expect(projectMode === 'saas' || projectMode === 'on-prem').toBe(true);
  });

  it('NEXT_PUBLIC_DEPLOYMENT_MODE mirror matches DEPLOYMENT_MODE', () => {
    // PR-10 vitest config 同时设两个 env；客户端代码用 NEXT_PUBLIC_ 镜像。
    expect(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE).toBe(projectMode);
  });
});
