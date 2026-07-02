/**
 * 用户自定义关键词别名 —— **client-safe** 校验/规范化核心（ADR 0022 方案 D）。
 *
 * <p>本模块**不引入 node:crypto / node:* 任何 Node 内建**，可安全在浏览器组件中 import
 * 做前端预校验。信封哈希（computeSourceEnvelope，用 node:crypto）留在 {@link ./policy-alias}
 * 的服务端模块里。二者的 normalize/canonical 语义必须**逐字节一致**（同一别名集在前端预校验、
 * 服务端权威校验、Java 侧算出相同 canonical/envelope），parity 由 policy-alias.test.ts 钉住。
 *
 * <p>三层作用域（policy > team > tenant，Phase A 只用 policy 层）的合并解析器 {@link mergeAliasSets}
 * 也在此，供 Phase B/C 复用（按 kind 覆盖）。
 *
 * 纯函数，不接触数据库、不接触 Node 内建。
 */

/** 允许用户自定义别名的低风险 kind 白名单（与 Java UserAliasValidator.ALLOWED_KINDS 对齐）。 */
export const ALLOWED_KINDS: ReadonlySet<string> = new Set([
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

/** 恒允许自定义别名的**运算符/比较** kind（= 原 ALLOWED_KINDS，任何人可用）。 */
export const OPERATOR_KINDS: ReadonlySet<string> = ALLOWED_KINDS;

/**
 * **结构词** kind：声明 + 控制流 + 返回。**仅当调用方获授权（allowStructural=true）时可自定义别名**。
 *
 * <p>红队 H3 默认排除结构词（别名滥用会误导审批人）。放开需满足三重护栏：①别名必多词（铁律2）
 * ②审批 UI 显 canonicalize 后规范结构 ③审计留痕。授权由管理员**按用户**授予，服务端权威判定。
 *
 * <p>**仍禁（不在此集，任何授权都不放开）**：IMPORT*、效果(IO/CPU/AWAIT/WORKFLOW/STEP)、
 * 逻辑(AND/OR/NOT)、布尔/类型字面量——这些别名能改变语义/藏副作用，护栏兜不住，风险高于误导。
 */
export const STRUCTURAL_KINDS: ReadonlySet<string> = new Set([
  'MODULE_DECL',
  'FUNC_TO',      // Rule
  'IF',
  'OTHERWISE',
  'MATCH',
  'WHEN',
  'RETURN',
]);

/** 校验器版本（进 toolchain identity；与 Java UserAliasValidator.VERSION 对齐）。 */
export const USER_ALIAS_VALIDATOR_VERSION = '1';

/** 校验选项。allowStructural=true 时额外放开 STRUCTURAL_KINDS（需管理员授权，服务端权威传入）。 */
export interface AliasValidationOptions {
  /** 是否允许结构词别名（默认 false）。true 由服务端依 per-user entitlement 传入，不信前端。 */
  readonly allowStructural?: boolean;
}

/** 别名集：kind → 别名短语数组。 */
export type AliasSet = Readonly<Record<string, readonly string[]>>;

export interface AliasValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface ReservedSets {
  /** 基础 lexicon 全部规范拼写（归一小写）。从 ts 引擎 lexicon.keywords 取。 */
  readonly canonicalKeywordsLower: ReadonlySet<string>;
  /** 基础 lexicon 已有别名（归一小写）。从 ts 引擎 lexicon.aliases 取，缺省空。 */
  readonly baseAliasesLower?: ReadonlySet<string>;
  /** 领域词汇本地化术语（归一小写）。用于别名↔标识符碰撞校验，缺省空。 */
  readonly vocabularyTermsLower?: ReadonlySet<string>;
}

/**
 * 归一：trim + 折叠空白为单个 ASCII 空格 + 小写（与 Java normalize **逐字符对齐**）。
 *
 * <p>⚠ 与 Java 对齐的关键：Java `String.trim()` 只裁 ≤ U+0020 的字符，Java regex `\s`
 * （无 UNICODE_CHARACTER_CLASS）= ASCII `[ \t\n\x0B\f\r]`。JS 的 `trim()`/`\s` 会含 NBSP 等
 * **Unicode 空白**——若用 JS 默认会与 Java 行为分歧。故这里显式用 ASCII 空白类，不用 JS 的
 * `trim()`/`\s`，保证两侧 canonical/envelope 字节一致。
 *
 * <p>组装 ReservedSets（canonicalKeywords/baseAliases/vocabularyTerms）时**必须**用本函数归一，
 * 不可随手 `trim().toLowerCase()`，否则占用集与校验值归一口径不一致。
 */
const ASCII_WS = '[ \\t\\n\\x0B\\f\\r]';
export function normalizeAliasToken(s: string): string {
  // 与 Java String.trim() 对齐：裁掉首尾 ≤ U+0020 的字符（含 ASCII 空白与控制符）。
  let t = s.replace(new RegExp(`^[\\u0000-\\u0020]+`), '').replace(new RegExp(`[\\u0000-\\u0020]+$`), '');
  // 折叠 ASCII 空白为单空格（不折叠 NBSP 等 Unicode 空白——与 Java \s+ 一致）。
  t = t.replace(new RegExp(`${ASCII_WS}+`, 'g'), ' ');
  return t.toLowerCase();
}

/**
 * 校验用户 aliasSet（白名单/多词/不遮蔽规范拼写+base别名/不撞领域词汇）。
 *
 * <p>与 Java UserAliasValidator 对齐。reserved 可传 ReadonlySet（仅规范拼写）向后兼容。
 *
 * <p>白名单两档（deny-by-default）：OPERATOR_KINDS 恒允许；STRUCTURAL_KINDS 仅当
 * {@link AliasValidationOptions.allowStructural}=true（管理员按用户授权，服务端权威传入）时允许。
 * 其余 kind（高危：IMPORT/effects/逻辑/布尔）任何授权都拒。
 */
export function validateUserAliases(
  aliasSet: AliasSet | null | undefined,
  reserved: ReservedSets | ReadonlySet<string>,
  options?: AliasValidationOptions,
): AliasValidationResult {
  // 兼容旧签名：直接传规范拼写 Set。
  const sets: ReservedSets = reserved instanceof Set
    ? { canonicalKeywordsLower: reserved as ReadonlySet<string> }
    : (reserved as ReservedSets);
  const canonicalKeywordsLower = sets.canonicalKeywordsLower;
  const baseAliasesLower = sets.baseAliasesLower ?? new Set<string>();
  const vocabularyTermsLower = sets.vocabularyTermsLower ?? new Set<string>();
  const allowStructural = options?.allowStructural ?? false;

  if (!aliasSet || Object.keys(aliasSet).length === 0) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [kind, aliases] of Object.entries(aliasSet)) {
    // 白名单两档：运算符恒允；结构词需授权；其余高危 kind 恒拒。
    const isOperator = OPERATOR_KINDS.has(kind);
    const isStructural = STRUCTURAL_KINDS.has(kind);
    if (!isOperator && !(isStructural && allowStructural)) {
      if (isStructural) {
        errors.push(
          `不允许为结构词 ${kind} 自定义别名（需管理员授予结构词别名权限；审批时会显示规范化真实结构并留痕）`,
        );
      } else {
        errors.push(
          `不允许为 ${kind} 自定义别名（仅运算符/比较类，或经授权的结构词可自定义，防止误导审批的语义滥用）`,
        );
      }
      continue;
    }
    for (const alias of aliases ?? []) {
      if (!alias || !alias.trim()) {
        errors.push(`${kind} 的别名不能为空`);
        continue;
      }
      const norm = normalizeAliasToken(alias);
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
      // 不遮蔽规范拼写 / base 已有别名
      if (canonicalKeywordsLower.has(norm)) {
        errors.push(`别名 '${alias}'（${kind}）与某规范关键词同形，禁止遮蔽`);
      } else if (baseAliasesLower.has(norm)) {
        errors.push(`别名 '${alias}'（${kind}）与某已有官方别名同形，禁止遮蔽`);
      }
      // 不撞领域词汇标识符（关键词翻译先于标识符翻译 → 别名会抢赢用户字段名）
      if (vocabularyTermsLower.has(norm)) {
        errors.push(`别名 '${alias}'（${kind}）与领域词汇标识符同形，会让关键词抢赢用户标识符，禁止`);
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
 * kind 按名排序、别名归一+排序+去重。空/null → null。紧凑无空格键有序（同 Jackson TreeMap）。
 */
export function canonicalAliasJson(
  aliasSet: AliasSet | null | undefined,
): string | null {
  if (!aliasSet || Object.keys(aliasSet).length === 0) {
    return null;
  }
  const sortedKinds = Object.keys(aliasSet).sort();
  const out: Record<string, string[]> = {};
  for (const kind of sortedKinds) {
    const vals = aliasSet[kind] ?? [];
    const norm = [...new Set(vals.filter((a) => a && a.trim()).map(normalizeAliasToken))].sort();
    if (norm.length > 0) {
      out[kind] = norm;
    }
  }
  if (Object.keys(out).length === 0) {
    return null;
  }
  return JSON.stringify(out);
}

/**
 * 三层作用域别名合并（policy > team > tenant，**按 kind 覆盖**）。
 *
 * <p>同一 kind：policy 层定了就完全盖住 team/tenant 的同 kind；policy 没定用 team，team 没定
 * 用 tenant。即 `effective[kind] = policy[kind] ?? team[kind] ?? tenant[kind]`（层内该 kind
 * 有非空别名才算“定了”）。
 *
 * <p>Phase A 只传 policy 层（team/tenant 恒 undefined）。Phase B/C 填入对应层即生效，无需改此函数。
 *
 * @returns 合并后的 effective aliasSet（空则 {}）。仍须过 {@link validateUserAliases} + canonical。
 */
export function mergeAliasSets(layers: {
  policy?: AliasSet | null;
  team?: AliasSet | null;
  tenant?: AliasSet | null;
}): Record<string, string[]> {
  const ordered: Array<AliasSet | null | undefined> = [layers.policy, layers.team, layers.tenant];
  const effective: Record<string, string[]> = {};
  // 收集所有出现过的 kind
  const kinds = new Set<string>();
  for (const layer of ordered) {
    if (layer) {
      for (const k of Object.keys(layer)) kinds.add(k);
    }
  }
  for (const kind of kinds) {
    // 从高优先级到低：第一个“该 kind 有非空别名”的层胜出，整 kind 采用之。
    for (const layer of ordered) {
      const vals = layer?.[kind];
      const nonEmpty = (vals ?? []).filter((a) => a && a.trim());
      if (nonEmpty.length > 0) {
        effective[kind] = [...nonEmpty];
        break;
      }
    }
  }
  return effective;
}
