/**
 * @module lib/__internal__/lexicon-availability-test-helpers
 *
 * **TESTS ONLY.** Re-exports the cache reset helper under a clean name.
 *
 * R8-FE-2 防御：
 *  - 路径 `__internal__/*` 由 ESLint `no-restricted-imports` 拦截
 *    （见 eslint config）—— 非测试代码 import 此模块直接报错
 *  - 底层 `__TEST_ONLY__resetCache` 在 production NODE_ENV 下抛运行时异常
 */
import { __TEST_ONLY__resetCache } from '../lexicon-availability';

export function resetLexiconAvailabilityCacheForTests(): void {
  __TEST_ONLY__resetCache();
}
