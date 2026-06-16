/**
 * team-locales 纯函数单元测试（ADR 0017 Phase 2）。
 *
 * 覆盖 normalizeEnabledLocales（写入规范化）+ applyTeamLocaleAllowlist（交集应用）
 * 的业务规则：默认语言不可关闭、全集折叠成"不限制"、未知 locale 过滤、空交集兜底。
 *
 * 这两个函数是纯函数，不碰 DB；DB 部分（get/set/resolveUser）由集成层覆盖。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeEnabledLocales,
  applyTeamLocaleAllowlist,
} from '@/lib/team-locales';
import { locales, defaultLocale, type Locale } from '@/i18n/config';

describe('normalizeEnabledLocales', () => {
  it('始终包含 defaultLocale（默认语言不可被关闭）', () => {
    const out = normalizeEnabledLocales(['zh']);
    expect(out).not.toBeNull();
    expect(out).toContain(defaultLocale);
  });

  it('去重 + 仅保留编译支持的 locale，过滤未知值', () => {
    const out = normalizeEnabledLocales(['zh', 'zh', 'xx-unknown', 'hi']);
    expect(out).not.toBeNull();
    // 去重后 zh 只一次；xx-unknown 被过滤
    expect(out!.filter((l) => l === 'zh')).toHaveLength(1);
    expect(out as string[]).not.toContain('xx-unknown');
    expect(out).toContain('hi' as Locale);
  });

  it('等于全集时折叠成 null（= 未配置 = 全部开放）', () => {
    const out = normalizeEnabledLocales([...locales]);
    expect(out).toBeNull();
  });

  it('空输入也至少保留 defaultLocale（不会把团队锁死在零语言）', () => {
    const out = normalizeEnabledLocales([]);
    // 全集只有 default 一种语言时会折叠成 null；否则返回含 default 的数组
    if (out === null) {
      expect(locales).toHaveLength(1);
    } else {
      expect(out).toEqual([defaultLocale]);
    }
  });

  it('输出按 i18n/config 的 locale 顺序稳定排列', () => {
    const out = normalizeEnabledLocales(['hi', 'zh', 'en']);
    if (out !== null) {
      const indices = out.map((l) => locales.indexOf(l));
      const sorted = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sorted);
    }
  });
});

describe('applyTeamLocaleAllowlist', () => {
  const candidates = [...locales];

  it('allowlist 为 null 时不限制（原样返回候选集）', () => {
    expect(applyTeamLocaleAllowlist(candidates, null)).toEqual(candidates);
  });

  it('按 allowlist 过滤候选集', () => {
    const allowed: Locale[] = [defaultLocale];
    expect(applyTeamLocaleAllowlist(candidates, allowed)).toEqual([defaultLocale]);
  });

  it('交集为空时兜底返回 defaultLocale（用户不会被锁在零语言）', () => {
    // 候选里没有的伪 locale 作为白名单 → 交集空 → 兜底 default
    const allowed = ['nonexistent' as Locale];
    expect(applyTeamLocaleAllowlist(candidates, allowed)).toEqual([defaultLocale]);
  });

  it('保持候选集顺序', () => {
    const allowed = [...locales];
    expect(applyTeamLocaleAllowlist(candidates, allowed)).toEqual(candidates);
  });
});
