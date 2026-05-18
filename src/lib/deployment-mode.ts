// 部署模式开关：编译期常量 + 运行期回退 + 生产 fail-closed 断言
//
// 设计依据：.claude/plan/deployment-mode-flag-v2.md + spike 报告。
//
// 三种使用场景：
//   1. 普通页面 / API gate：`if (!CAN_BILLING) notFound()` —— import 常量即可
//   2. UI 渲染：`CAPABILITIES.billing && <Item/>` —— 运行期可读
//   3. Hot gate（拉重 SDK 的入口）：DO NOT import from this file.
//      该文件**不 export macro**——经 import 的常量在跨模块场景下不能可靠
//      消除 dynamic import 表达式（spike route 2 已验证）。
//      正确做法：hot gate 文件自己写 `declare const __DEPLOYMENT_MODE__`
//      ambient + 文件顶部 `/* @deployment-mode-hot-gate reason: ... */`
//      注释（PR-9 的 ESLint 规则只允许带此注释的文件直接引用 macro）。
//
// Tree-shake 保证（双保险）：
//   - 编译期：next.config.ts 的 DefinePlugin 把 `__DEPLOYMENT_MODE__`
//     替换成字面量 'saas' | 'on-prem'，terser 折叠死分支
//   - 链接期：on-prem 模式下 webpack.resolve.alias 把
//     stripe / resend / mixpanel-browser 设 false，保证 SaaS-only npm
//     包物理上不进 on-prem bundle（即使 hot gate 漏标）
//
// `__DEPLOYMENT_MODE__` 的 ambient 类型在 src/types/deployment-mode.d.ts。

export type DeploymentMode = 'saas' | 'on-prem';

// Fail-closed 启动断言：production 环境必须由 DefinePlugin 注入 macro。
// 走到这里说明编译期注入失败 —— 绝不能 fallback 到 SaaS 偷偷开启计费路径。
//
// 触发的真实场景（spike report §11 总结）：
//   - vitest / tsx 脚本 import 此模块（dev/test 走下面的 env 回退，OK）
//   - 未来 Turbopack / 构建配置漂移导致 DefinePlugin 失效
//   - middleware / edge bundle 未收到 plugin（PR-1b 之后需验证）
//   - 自定义 worker.js 直接 import 此模块绕过 Next pipeline
//
// dev / test 用 env 回退；production 缺 macro 直接 throw。
if (
  typeof __DEPLOYMENT_MODE__ === 'undefined' &&
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    '[deployment-mode] __DEPLOYMENT_MODE__ was not compiled into the build. ' +
      'Check next.config.ts DefinePlugin wiring.',
  );
}

const _RUNTIME: DeploymentMode =
  typeof __DEPLOYMENT_MODE__ !== 'undefined'
    ? __DEPLOYMENT_MODE__
    : process.env.DEPLOYMENT_MODE === 'on-prem'
      ? 'on-prem'
      : 'saas';

// ─── 编译期常量（普通 gate 用）─────────────────────────────────────
export const IS_SAAS = _RUNTIME === 'saas';
export const IS_ONPREM = _RUNTIME === 'on-prem';

export const CAN_BILLING = IS_SAAS;
export const CAN_PRICING = IS_SAAS;
export const CAN_RISKTIER = IS_SAAS;
export const CAN_DUNNING = IS_SAAS;
export const CAN_SIGNUP = IS_SAAS;
export const CAN_MIXPANEL = IS_SAAS;
export const CAN_RESEND = IS_SAAS;
export const CAN_LICENSE = IS_ONPREM;
export const CAN_SSO = IS_ONPREM;

// ─── CAPABILITIES 对象（UI / runtime 语义用）─────────────────────
// 同样的值，便于把多个能力批量传递给客户端组件。
export const CAPABILITIES = {
  billing: CAN_BILLING,
  pricing: CAN_PRICING,
  riskTier: CAN_RISKTIER,
  dunning: CAN_DUNNING,
  signup: CAN_SIGNUP,
  mixpanel: CAN_MIXPANEL,
  resend: CAN_RESEND,
  license: CAN_LICENSE,
  sso: CAN_SSO,
} as const;

// 测试 / 兜底访问（vi.mock 友好）。生产代码应优先用上面的常量。
export function getDeploymentMode(): DeploymentMode {
  return _RUNTIME;
}
