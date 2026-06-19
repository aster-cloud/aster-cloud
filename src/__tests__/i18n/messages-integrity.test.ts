// 防回归：i18n messages 文件结构完整性
//
// 历史 bug：v6/v7/v8 多次往 messages/{en,zh,de}.json 末尾追加 "dashboard": {...}，
// 导致每个 locale 文件都有重复的 top-level "dashboard" 键。JSON 解析只保留最后一个，
// 使得 dashboard.welcomeBack 等键消失，dashboard 页面显示原始 i18n key。
//
// 这个测试在文本层（不依赖 JSON.parse）扫描每行，统计每个 top-level 键出现次数；
// 如果有任何键出现 ≥ 2 次，立即失败。
//
// 同时校验：
//   - JSON parse 通过
//   - 三语 top-level 键集合一致（防止某语言遗漏）

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// UI 文案真相源 = @aster-cloud/ui-messages npm 包（aster-lang-locales 发布）。cloud 不再
// 手维护 messages/*。包内文件按全码 id 命名（en-US.json）。此测试校验实际消费的文件
// JSON 完整性（机器生成，本不该有手编辑的重复键 bug，但保留为回归守门）。
const LOCALES = [
  { short: 'en', id: 'en-US' },
  { short: 'zh', id: 'zh-CN' },
  { short: 'de', id: 'de-DE' },
] as const;
const MESSAGES_DIR = path.join(
  __dirname, '..', '..', '..', 'node_modules', '@aster-cloud', 'ui-messages',
);

interface ParsedFile {
  raw: string;
  json: Record<string, unknown>;
  topLevelKeyCounts: Map<string, number>;
}

function loadAndCount(id: string): ParsedFile {
  const file = path.join(MESSAGES_DIR, `${id}.json`);
  const raw = readFileSync(file, 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;

  // 文本扫描：每行匹配 `^  "<key>":` 算作 top-level 键声明
  const counts = new Map<string, number>();
  const lines = raw.split('\n');
  for (const line of lines) {
    const m = /^  "([a-zA-Z][a-zA-Z0-9]*)":\s*[\{\[]/.exec(line);
    if (m) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
  }
  return { raw, json, topLevelKeyCounts: counts };
}

describe('messages JSON 完整性', () => {
  for (const loc of LOCALES) {
    describe(`@aster-cloud/ui-messages/${loc.id}.json`, () => {
      it('JSON parse 成功', () => {
        expect(() => loadAndCount(loc.id)).not.toThrow();
      });

      it('top-level 键无重复（防止 v6/v7/v8 dashboard 重复 bug 复发）', () => {
        const { topLevelKeyCounts } = loadAndCount(loc.id);
        const dups: string[] = [];
        for (const [key, count] of topLevelKeyCounts.entries()) {
          if (count > 1) {
            dups.push(`"${key}" 出现 ${count} 次`);
          }
        }
        expect(dups, `${loc.id}.json 有重复 top-level 键：${dups.join(', ')}`).toEqual([]);
      });

      it('"dashboard" 键存在且唯一', () => {
        const { topLevelKeyCounts } = loadAndCount(loc.id);
        expect(topLevelKeyCounts.get('dashboard')).toBe(1);
      });

      it('dashboard.welcomeBack 存在（修复 Bug-2 的核心键）', () => {
        const { json } = loadAndCount(loc.id);
        const dashboard = json.dashboard as Record<string, unknown> | undefined;
        expect(dashboard).toBeDefined();
        expect(dashboard?.welcomeBack).toBeDefined();
        expect(typeof dashboard?.welcomeBack).toBe('string');
      });

      it('dashboard.aiUsage / apiUsage / dunning 子命名空间存在', () => {
        const { json } = loadAndCount(loc.id);
        const dashboard = json.dashboard as Record<string, unknown>;
        expect(dashboard.aiUsage).toBeDefined();
        expect(dashboard.apiUsage).toBeDefined();
        expect(dashboard.dunning).toBeDefined();
      });
    });
  }

  it('三语 top-level 键集合一致', () => {
    const en = new Set(Object.keys(loadAndCount('en-US').json));
    const zh = new Set(Object.keys(loadAndCount('zh-CN').json));
    const de = new Set(Object.keys(loadAndCount('de-DE').json));

    const inEnNotZh = [...en].filter((k) => !zh.has(k));
    const inZhNotEn = [...zh].filter((k) => !en.has(k));
    const inDeNotEn = [...de].filter((k) => !en.has(k));

    expect(inEnNotZh, `en 有但 zh 缺失: ${inEnNotZh.join(', ')}`).toEqual([]);
    expect(inZhNotEn, `zh 有但 en 缺失: ${inZhNotEn.join(', ')}`).toEqual([]);
    expect(inDeNotEn, `de 有但 en 缺失: ${inDeNotEn.join(', ')}`).toEqual([]);
  });
});
