/**
 * 用户自定义关键词别名 —— TypeScript 侧实现（ADR 0022 方案 D）。
 *
 * <p>生产策略创建走 cloud BFF（drizzle 直插 policy_versions），故方案 D 的可信逻辑必须在
 * cloud TS 侧实现。本模块是 aster-api Java 侧（PolicyVersion.computeSourceEnvelope /
 * UserAliasValidator）的**逐字节对齐**移植：
 * <ul>
 *   <li>{@link computeSourceEnvelope} —— 长度前缀分帧 SHA-256，与 Java 同算法（防别名替换篡改 C1）</li>
 *   <li>{@link canonicalAliasJson} —— 确定性序列化（kind 排序 + 别名归一/排序/去重），同 Java canonicalJson</li>
 *   <li>{@link validateUserAliases} —— 白名单/多词/不遮蔽（H3 社会工程防护）</li>
 * </ul>
 *
 * <p><b>跨引擎一致性铁律</b>：envelope/canonical 算法两侧必须逐字节一致，否则同一别名集在
 * Java/TS 算出不同 envelope，破坏"可复现/跨引擎一致"。本文件的 parity 由 policy-alias.test.ts
 * 钉住（对照 Java 参照哈希）。任一侧改算法，两侧同步改 + 更新 parity。
 *
 * 纯函数，不接触数据库。
 */
import { createHash } from 'node:crypto';

/** 允许用户自定义别名的低风险 kind 白名单（与 Java UserAliasValidator.ALLOWED_KINDS 对齐）。 */
const ALLOWED_KINDS: ReadonlySet<string> = new Set([
  'PLUS',
  'MINUS_WORD',
  'TIMES',
  'DIVIDED_BY',
  'INTEGER_DIVIDED_BY',
  'MODULO',
  'LESS_THAN',
  'GREATER_THAN',
  'EQUALS_TO',
  'AT_LEAST',
  'AT_MOST',
]);

/** 校验器版本（进 toolchain identity；与 Java UserAliasValidator.VERSION 对齐）。 */
export const USER_ALIAS_VALIDATOR_VERSION = '1';

export interface AliasValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** 归一：trim + 折叠空白为单个 ASCII 空格 + 小写（与 Java normalize 对齐）。 */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 校验用户 aliasSet（白名单/多词/不遮蔽）。
 *
 * @param aliasSet        kind → 别名列表
 * @param canonicalKeywordsLower 基础 lexicon 全部规范拼写（小写）—— 用于不遮蔽校验。
 *                        调用方从 aster-lang-ts 的 lexicon.keywords 取值传入。
 */
export function validateUserAliases(
  aliasSet: Readonly<Record<string, readonly string[]>> | null | undefined,
  canonicalKeywordsLower: ReadonlySet<string>,
): AliasValidationResult {
  if (!aliasSet || Object.keys(aliasSet).length === 0) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [kind, aliases] of Object.entries(aliasSet)) {
    if (!ALLOWED_KINDS.has(kind)) {
      errors.push(
        `不允许为 ${kind} 自定义别名（仅低风险运算符/比较类可自定义，防止误导审批的语义滥用）`,
      );
      continue;
    }
    for (const alias of aliases ?? []) {
      if (!alias || !alias.trim()) {
        errors.push(`${kind} 的别名不能为空`);
        continue;
      }
      const norm = normalize(alias);
      // 铁律 0：提交值须已是规范形（注入值即匹配值）
      if (alias !== norm) {
        errors.push(
          `别名 '${alias}'（${kind}）含非规范空白/大小写；请提交规范形 '${norm}'`,
        );
        continue;
      }
      // 铁律 2：仅多词
      if (!norm.includes(' ')) {
        errors.push(
          `别名 '${alias}'（${kind}）必须是多词短语；单词别名会占用标识符命名空间，破坏用户空间`,
        );
      }
      // 不遮蔽规范拼写
      if (canonicalKeywordsLower.has(norm)) {
        errors.push(`别名 '${alias}'（${kind}）与某规范关键词同形，禁止遮蔽`);
      }
      // 跨 kind 不重复
      if (seen.has(norm)) {
        errors.push(`别名 '${alias}' 在多个 kind 间重复定义`);
      }
      seen.add(norm);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 确定性序列化 aliasSet 为规范 JSON（与 Java UserAliasValidator.canonicalJson 逐字节对齐）。
 *
 * kind 按名排序、别名归一+排序+去重。空/null → null。
 * 注意：与 Java Jackson 输出对齐——`{"K":["a","b"]}` 无空格。
 */
export function canonicalAliasJson(
  aliasSet: Readonly<Record<string, readonly string[]>> | null | undefined,
): string | null {
  if (!aliasSet || Object.keys(aliasSet).length === 0) {
    return null;
  }
  const sortedKinds = Object.keys(aliasSet).sort();
  const out: Record<string, string[]> = {};
  for (const kind of sortedKinds) {
    const vals = aliasSet[kind] ?? [];
    const norm = [...new Set(vals.filter((a) => a && a.trim()).map(normalize))].sort();
    if (norm.length > 0) {
      out[kind] = norm;
    }
  }
  if (Object.keys(out).length === 0) {
    return null;
  }
  // JSON.stringify 对插入顺序的对象保持顺序；out 已按 kind 排序、值已排序。
  // 与 Jackson writeValueAsString(TreeMap) 一致：紧凑、无空格、键有序。
  return JSON.stringify(out);
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
