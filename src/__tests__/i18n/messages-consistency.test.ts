import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import zh from '../../../messages/zh.json';
import de from '../../../messages/de.json';

/**
 * i18n 一致性测试
 *
 * 防止 en / zh / de 三个 JSON 的 key 树漂移：
 *   - 加新 key 时三语必须同步
 *   - 删 key 时三语必须同步
 *   - ICU 占位符（{name}）必须三语一致
 *
 * 不校验翻译质量，仅校验结构一致。
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * 把对象拍平成 dot path → 类型的 map
 *
 *  { a: { b: "x", c: ["d"] } }  →  { "a.b": "string", "a.c": "array(1)" }
 */
function flatten(obj: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (obj === null) {
    out.set(prefix || '$root', 'null');
    return out;
  }
  if (Array.isArray(obj)) {
    out.set(prefix, `array(${obj.length})`);
    return out;
  }
  if (typeof obj !== 'object') {
    out.set(prefix, typeof obj);
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    const sub = flatten(value as Json, nextPath);
    for (const [k, v] of sub) out.set(k, v);
  }
  return out;
}

/** 抽取字符串中所有 ICU 占位符 {var} */
function placeholders(s: string): string[] {
  const matches = s.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
  return matches ? matches.sort() : [];
}

/** 把所有 string 叶子收集出来，连同 path */
function collectStrings(obj: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof obj === 'string') {
    out.set(prefix, obj);
    return out;
  }
  if (obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      const sub = collectStrings(item, `${prefix}[${idx}]`);
      for (const [k, v] of sub) out.set(k, v);
    });
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    const sub = collectStrings(value as Json, next);
    for (const [k, v] of sub) out.set(k, v);
  }
  return out;
}

describe('messages i18n consistency', () => {
  const enFlat = flatten(en as Json);
  const zhFlat = flatten(zh as Json);
  const deFlat = flatten(de as Json);

  it('zh has same key set as en', () => {
    const enOnly = [...enFlat.keys()].filter((k) => !zhFlat.has(k));
    const zhOnly = [...zhFlat.keys()].filter((k) => !enFlat.has(k));
    expect({ enOnly, zhOnly }).toEqual({ enOnly: [], zhOnly: [] });
  });

  it('de has same key set as en', () => {
    const enOnly = [...enFlat.keys()].filter((k) => !deFlat.has(k));
    const deOnly = [...deFlat.keys()].filter((k) => !enFlat.has(k));
    expect({ enOnly, deOnly }).toEqual({ enOnly: [], deOnly: [] });
  });

  it('value types match across locales', () => {
    const mismatches: string[] = [];
    for (const [key, type] of enFlat) {
      const zhType = zhFlat.get(key);
      const deType = deFlat.get(key);
      if (zhType && zhType !== type) mismatches.push(`zh.${key}: ${type} vs ${zhType}`);
      if (deType && deType !== type) mismatches.push(`de.${key}: ${type} vs ${deType}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('ICU placeholders are identical across locales', () => {
    const enStrings = collectStrings(en as Json);
    const zhStrings = collectStrings(zh as Json);
    const deStrings = collectStrings(de as Json);

    const drift: string[] = [];
    for (const [path, enValue] of enStrings) {
      const enPh = placeholders(enValue);
      if (enPh.length === 0) continue;
      const zhValue = zhStrings.get(path);
      const deValue = deStrings.get(path);
      if (zhValue !== undefined && JSON.stringify(placeholders(zhValue)) !== JSON.stringify(enPh)) {
        drift.push(`zh.${path}: en=[${enPh.join(',')}] zh=[${placeholders(zhValue).join(',')}]`);
      }
      if (deValue !== undefined && JSON.stringify(placeholders(deValue)) !== JSON.stringify(enPh)) {
        drift.push(`de.${path}: en=[${enPh.join(',')}] de=[${placeholders(deValue).join(',')}]`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('arrays have identical length across locales', () => {
    const lengthDrift: string[] = [];
    for (const [key, marker] of enFlat) {
      if (!marker.startsWith('array(')) continue;
      const zhMarker = zhFlat.get(key);
      const deMarker = deFlat.get(key);
      if (zhMarker && zhMarker !== marker) lengthDrift.push(`zh.${key}: ${marker} vs ${zhMarker}`);
      if (deMarker && deMarker !== marker) lengthDrift.push(`de.${key}: ${marker} vs ${deMarker}`);
    }
    expect(lengthDrift).toEqual([]);
  });
});
