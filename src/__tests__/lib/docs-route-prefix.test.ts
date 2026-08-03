// 文档路由前缀回退测试。
//
// ★回归：hi 没有独立文档索引（文档站尚未出 hi 版），内容回退 en，
//   路由也只有 /docs/... 。若前缀仍拼 /hi，站内助手给 hi 用户的
//   每条文档链接都会 404——浏览器实测才发现。

import { describe, it, expect } from 'vitest';
import { getDocsRoutePrefix, getDocsSearchIndex } from '@/lib/docs/dashboard-docs-seeds';

describe('getDocsRoutePrefix', () => {
  it('en 无前缀', () => {
    expect(getDocsRoutePrefix('en')).toBe('');
  });

  it('有独立索引的 locale 带自己的前缀', () => {
    expect(getDocsRoutePrefix('zh')).toBe('/zh');
    expect(getDocsRoutePrefix('de')).toBe('/de');
  });

  it('hi 无文档索引 → 前缀回退空串（否则 /hi/docs/... 404）', () => {
    expect(getDocsRoutePrefix('hi')).toBe('');
  });

  it('未知 locale 同样回退', () => {
    expect(getDocsRoutePrefix('xx')).toBe('');
  });

  it('前缀与索引回退必须同步（同一判定口径）', () => {
    for (const loc of ['en', 'zh', 'de', 'hi', 'xx']) {
      const idx = getDocsSearchIndex(loc);
      const prefix = getDocsRoutePrefix(loc);
      // 回退到 en 索引 ⟺ 前缀为空串
      expect(idx.locale === 'en').toBe(prefix === '');
    }
  });
});
