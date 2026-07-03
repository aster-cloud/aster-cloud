/**
 * 用户自定义关键词别名 —— **服务端** 信封哈希 + 工具链身份（ADR 0022 方案 D）。
 *
 * <p>校验/规范化核心（validateUserAliases / canonicalAliasJson / normalize / 合并）已抽到
 * client-safe 的 {@link ./policy-alias-shared}（不含 node:crypto，可浏览器 import 做前端预校验）。
 * 本模块只保留依赖 Node 内建/环境的部分：
 * <ul>
 *   <li>{@link computeSourceEnvelope} —— 长度前缀分帧 SHA-256（node:crypto），与 Java
 *       PolicyVersion.computeSourceEnvelope 逐字节对齐（防别名替换篡改 C1）</li>
 *   <li>{@link cloudToolchainId} —— 读 process.env 构建 sha，进 source envelope</li>
 * </ul>
 * 并 re-export shared 符号以保持既有导入路径向后兼容。
 *
 * <p><b>跨引擎一致性铁律</b>：envelope/canonical 算法与 Java 侧必须逐字节一致。parity 由
 * policy-alias.test.ts 钉住。任一侧改算法，两侧同步改 + 更新 parity。
 */
import { createHash } from 'node:crypto';
import { USER_ALIAS_VALIDATOR_VERSION } from './policy-alias-shared';

// re-export client-safe 核心（向后兼容既有 `import { validateUserAliases, ... } from './policy-alias'`）。
export {
  ALLOWED_KINDS,
  OPERATOR_KINDS,
  STRUCTURAL_KINDS,
  USER_ALIAS_VALIDATOR_VERSION,
  normalizeAliasToken,
  validateUserAliases,
  canonicalAliasJson,
  mergeAliasSets,
} from './policy-alias-shared';
export type {
  AliasSet,
  AliasValidationResult,
  AliasValidationOptions,
  ReservedSets,
} from './policy-alias-shared';

/**
 * 工具链身份串（单一来源，进 source envelope）。两条创建路径（POST /api/policies 与
 * version-manager.createVersion）必须用同一拼法，否则同内容在两路径算出不同 envelope。
 * 格式与 Java toolchainIdentity 对齐：abi/core/validator/build。build 由 env 注入（部署 sha）。
 */
export function cloudToolchainId(): string {
  const build = process.env.ASTER_RUNTIME_BUILD ?? 'dev';
  return `abi=1.0;core=ts;validator=${USER_ALIAS_VALIDATOR_VERSION};build=${build}`;
}

/**
 * 计算完整编译输入的 SHA-256 信封哈希（与 Java PolicyVersion.computeSourceEnvelope 逐字节对齐）。
 *
 * 长度前缀分帧：每段 `<byteLen>:<utf8bytes>|`（byteLen 用 UTF-8 字节数，非字符数）。
 * 字段顺序：content, aliasSetJson, locale, toolchainId。null → 空串。
 */
export function computeSourceEnvelope(
  content: string | null,
  aliasSetJson: string | null,
  locale: string | null,
  toolchainId: string | null,
): string {
  const hash = createHash('sha256');
  const fields = [content ?? '', aliasSetJson ?? '', locale ?? '', toolchainId ?? ''];
  for (const field of fields) {
    const bytes = Buffer.from(field, 'utf8');
    hash.update(Buffer.from(String(bytes.length), 'ascii'));
    hash.update(Buffer.from(':', 'ascii'));
    hash.update(bytes);
    hash.update(Buffer.from('|', 'ascii'));
  }
  return hash.digest('hex');
}
