/**
 * Domain vocabulary 适配层
 *
 * 把 user_domain_term 行翻译成 aster-lang-ts 的 DomainVocabulary，
 * 调用上游的 validateVocabulary 做规范化校验，
 * 并计算 DomainTerm 表的 dedup 键。
 *
 * 不直接接触数据库——纯函数 + 类型。
 */

import { createHash } from 'node:crypto';
import {
  IdentifierKind,
  type DomainVocabulary,
  type IdentifierMapping,
  validateVocabulary,
} from '@aster-cloud/aster-lang-ts/lexicons/identifiers/types';

export type VocabularyValidationResult = ReturnType<typeof validateVocabulary>;

export type TermKind = 'struct' | 'field' | 'function' | 'enum_value';

export interface TermLikeRow {
  domainTermId: string;
  domain: string;
  locale: string;
  kind: TermKind | string;
  canonical: string;
  localized: string;
  parentCanonical?: string | null;
  aliases?: readonly string[] | null;
  description?: string | null;
}

export interface NormalizedTermInput {
  domain: string;
  locale: string;
  kind: TermKind;
  canonical: string;
  canonicalNorm: string;
  localized: string;
  localizedNorm: string;
  parentCanonical?: string;
  parentCanonicalNorm: string;
  description?: string;
  aliases: string[];
}

export interface AssembleVocabularyOptions {
  domain?: string;
  locale?: string;
  name?: string;
  version?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toIdentifierKind(kind: string): IdentifierKind {
  switch (kind) {
    case 'struct':
      return IdentifierKind.STRUCT;
    case 'field':
      return IdentifierKind.FIELD;
    case 'function':
      return IdentifierKind.FUNCTION;
    case 'enum_value':
      return IdentifierKind.ENUM_VALUE;
    default:
      throw new Error(`Unsupported vocabulary kind: ${kind}`);
  }
}

function mappingFromRow(row: TermLikeRow): IdentifierMapping {
  return {
    canonical: row.canonical,
    localized: row.localized,
    kind: toIdentifierKind(row.kind),
    ...(row.parentCanonical ? { parent: row.parentCanonical } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.aliases && row.aliases.length > 0 ? { aliases: [...row.aliases] } : {}),
  };
}

/**
 * Group rows by kind into a DomainVocabulary shape suitable for
 * aster-lang-ts lowering or Monaco re-registration.
 */
export function assembleDomainVocabularyFromLinks(
  termRows: readonly TermLikeRow[],
  opts: AssembleVocabularyOptions = {},
): DomainVocabulary {
  const first = termRows[0];
  const domain = opts.domain ?? first?.domain ?? 'custom';
  const locale = opts.locale ?? first?.locale ?? 'en-US';
  const structs: IdentifierMapping[] = [];
  const fields: IdentifierMapping[] = [];
  const functions: IdentifierMapping[] = [];
  const enumValues: IdentifierMapping[] = [];

  for (const row of termRows) {
    const mapping = mappingFromRow(row);
    switch (mapping.kind) {
      case IdentifierKind.STRUCT:
        structs.push(mapping);
        break;
      case IdentifierKind.FIELD:
        fields.push(mapping);
        break;
      case IdentifierKind.FUNCTION:
        functions.push(mapping);
        break;
      case IdentifierKind.ENUM_VALUE:
        enumValues.push(mapping);
        break;
    }
  }

  return {
    id: domain,
    name: opts.name ?? domain,
    locale,
    version: opts.version ?? 'user',
    structs,
    fields,
    functions,
    enumValues,
  };
}

/** Validate a DomainVocabulary using the shared aster-lang-ts validator. */
export function validateDomainVocabulary(vocab: DomainVocabulary): VocabularyValidationResult {
  return validateVocabulary(vocab);
}

/**
 * Normalize user-facing input and compute the columns used by the global
 * DomainTerm dedup key. The norm columns are lower(trim(...)) so the dedup
 * key is stable across whitespace and case.
 */
export function normalizeTermInput(input: {
  domain: string;
  locale: string;
  kind: TermKind;
  canonical: string;
  localized: string;
  parentCanonical?: string;
  description?: string;
  aliases?: string[];
}): NormalizedTermInput {
  return {
    domain: input.domain.trim(),
    locale: input.locale.trim(),
    kind: input.kind,
    canonical: input.canonical.trim(),
    canonicalNorm: normalizeText(input.canonical),
    localized: input.localized.trim(),
    localizedNorm: normalizeText(input.localized),
    parentCanonical: input.parentCanonical?.trim() || undefined,
    parentCanonicalNorm: normalizeText(input.parentCanonical),
    description: input.description?.trim() || undefined,
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
  };
}

/** Compute the stable global DomainTerm deduplication key. */
export function computeDedupKey(input: {
  domain: string;
  locale: string;
  kind: string;
  canonicalNorm: string;
  localizedNorm: string;
  parentCanonicalNorm?: string | null;
}): string {
  const json = canonicalJson({
    domain: input.domain,
    locale: input.locale,
    kind: input.kind,
    canonicalNorm: input.canonicalNorm,
    localizedNorm: input.localizedNorm,
    parentCanonicalNorm: input.parentCanonicalNorm ?? '',
  });
  return createHash('sha256').update(json).digest('hex');
}
