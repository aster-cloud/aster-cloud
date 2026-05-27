/**
 * Runtime-safe environment access (P0-R9, codex round 9 review)
 *
 * 设计意图：模块加载阶段裸读 `process.env.X` 在无 process 全局的 runtime
 * （Cloudflare Workers、严格 browser bundle、Edge functions）下会抛
 * `ReferenceError: process is not defined`，**整个模块拒绝加载** —— 而非
 * 降级到无 env 的 warning 路径。
 *
 * 解决方案：所有非 Node-only 路径上的 env 读取必须通过本模块的 helper，
 * 由 `typeof process !== 'undefined'` 静态判定 + try/catch 双重隔离。
 *
 * 何时直接用 `process.env`：
 *   - next.config.ts / *.config.* 等纯 build-time 配置（Node only，永远不进 worker bundle）
 *   - test/spec 文件
 *   - 明确标注 `// @node-only` 且不会被 middleware/edge code transitively import 的服务
 *
 * 何时必须用 safeEnv：
 *   - middleware.ts 及其 transitive import 链（CSP、i18n、auth、telemetry）
 *   - browser-shipped bundle 中的任意模块
 *   - 任何 isomorphic helper（client + server 都能 import）
 *
 * 设计依据：codex round 9 review 在 src/lib/security/csp.ts 发现
 * middleware import chain 仍有 module-load-time `process.env` 裸读，
 * 等于上一轮 env-validation/deployment-mode 修复留下的等价盲点。
 */

/**
 * 读取单个 env 变量，no-process runtime 下返回 undefined 而非抛错。
 *
 * @param key env 变量名
 * @returns env 值 / undefined
 */
export function safeEnv(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process?.env) {
      return process.env[key];
    }
  } catch {
    /* process 是 throwing getter / sandbox 隔离场景 */
  }
  return undefined;
}

/**
 * 读取整个 env 字典，no-process runtime 下返回空对象。
 *
 * 用于 validateEnvOrWarn / checkEnv 等需要"整张表"的场景；逐条迭代场景请用 safeEnv()。
 */
export function safeProcessEnv(): NodeJS.ProcessEnv {
  try {
    if (typeof process !== 'undefined' && process?.env) {
      return process.env;
    }
  } catch {
    /* process 不可访问 */
  }
  return {} as NodeJS.ProcessEnv;
}

/**
 * 判断当前 runtime 是否有 process 全局（用于条件性走 Node-only 路径）。
 *
 * 不要把这个当 "isServer / isBrowser" 用 —— Cloudflare Workers 没有 process
 * 但仍然是 server-side。仅用于"能不能直接 process.env"的判断。
 */
export function hasProcessGlobal(): boolean {
  try {
    return typeof process !== 'undefined' && Boolean(process?.env);
  } catch {
    return false;
  }
}
