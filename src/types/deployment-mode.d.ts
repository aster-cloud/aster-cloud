// 全局 ambient: `__DEPLOYMENT_MODE__` 字面量由 next.config.ts 的
// webpack.DefinePlugin 在构建期替换。
//
// **使用约束**：除 `src/lib/deployment-mode.ts` 与显式标注的 hot-gate
// 文件（顶部含 `/* @deployment-mode-hot-gate reason: ... */` 注释）外，
// 任何文件都禁止直接引用 `__DEPLOYMENT_MODE__`。由 PR-9 的 ESLint
// `no-restricted-syntax` 规则强制。
//
// 普通 gate 用 `import { IS_SAAS, CAN_BILLING } from '@/lib/deployment-mode'`。
//
// 详见 .claude/plan/deployment-mode-flag-v2.md + deployment-mode-spike-report.md。

declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';
