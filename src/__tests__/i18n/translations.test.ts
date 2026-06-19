import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { locales as configLocales } from '@/i18n/config';

// UI 文案真相源 = @aster-cloud/ui-messages npm 包（aster-lang-locales 发布）。cloud 不再
// 手维护 messages/*。包内文件按全码 id 命名（en-US.json）。
const messagesDir = path.join(process.cwd(), 'node_modules', '@aster-cloud', 'ui-messages');

// 完整翻译的 locale（每个 key 都必须翻译）。这些走严格的逐 key 校验。
// 短码 → 包内全码 id。hi 全量翻译且在独立包，逐 key 校验由 check-locales 覆盖，这里
// 维持 en/zh/de（公共 ui-messages 包内三语）。
const LOCALE_IDS = { en: 'en-US', zh: 'zh-CN', de: 'de-DE' } as const;
const locales = ['en', 'zh', 'de'] as const;

// 动态加载翻译文件
function loadTranslations(locale: string): Record<string, unknown> {
  const id = LOCALE_IDS[locale as keyof typeof LOCALE_IDS] ?? locale;
  const filePath = path.join(messagesDir, `${id}.json`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// 获取对象的所有键路径
function getAllKeyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...getAllKeyPaths(value as Record<string, unknown>, fullPath));
    } else {
      paths.push(fullPath);
    }
  }

  return paths;
}

// 获取嵌套键的值
function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

describe('i18n Translation Files', () => {
  const translations: Record<string, Record<string, unknown>> = {};

  // 加载所有翻译文件
  for (const locale of locales) {
    translations[locale] = loadTranslations(locale);
  }

  describe('Translation file existence', () => {
    it.each(locales)('should have %s translation file', (locale) => {
      const id = LOCALE_IDS[locale as keyof typeof LOCALE_IDS] ?? locale;
      const filePath = path.join(messagesDir, `${id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('Translation key consistency', () => {
    const enKeys = getAllKeyPaths(translations.en);

    it.each(['zh', 'de'] as const)('%s.json should have all keys from en.json', (locale) => {
      const localeKeys = getAllKeyPaths(translations[locale]);
      const missingKeys = enKeys.filter(key => !localeKeys.includes(key));

      expect(missingKeys).toEqual([]);
    });

    it.each(['zh', 'de'] as const)('%s.json should not have extra keys not in en.json', (locale) => {
      const localeKeys = getAllKeyPaths(translations[locale]);
      const extraKeys = localeKeys.filter(key => !enKeys.includes(key));

      expect(extraKeys).toEqual([]);
    });
  });

  describe('Critical translation structure validation', () => {
    // teams.upgradeRequired 必须是嵌套对象
    it.each(locales)('%s: teams.upgradeRequired should be a nested object with title, description, upgradeButton', (locale) => {
      const upgradeRequired = getNestedValue(translations[locale], 'teams.upgradeRequired');

      expect(upgradeRequired).toBeDefined();
      expect(typeof upgradeRequired).toBe('object');
      expect(upgradeRequired).not.toBeNull();

      const obj = upgradeRequired as Record<string, unknown>;
      expect(obj.title).toBeDefined();
      expect(typeof obj.title).toBe('string');
      expect(obj.description).toBeDefined();
      expect(typeof obj.description).toBe('string');
      expect(obj.upgradeButton).toBeDefined();
      expect(typeof obj.upgradeButton).toBe('string');
    });

    // policies.form 必须包含所有必需的表单翻译
    it.each(locales)('%s: policies.form should have all required form translations', (locale) => {
      const formKeys = [
        'editTitle',
        'editSubtitle',
        'name',
        'namePlaceholder',
        'description',
        'descriptionPlaceholder',
        'content',
        'contentPlaceholder',
        'contentHelp',
        'isPublic',
        'cancel',
        'save',
        'saving',
        'failedToUpdate',
      ];

      for (const key of formKeys) {
        const value = getNestedValue(translations[locale], `policies.form.${key}`);
        expect(value, `Missing policies.form.${key} in ${locale}`).toBeDefined();
        expect(typeof value, `policies.form.${key} in ${locale} should be string`).toBe('string');
      }
    });

    // dashboardNav 必须包含所有导航项
    it.each(locales)('%s: dashboardNav should have all navigation items', (locale) => {
      const navKeys = ['dashboard', 'policies', 'reports', 'teams', 'billing', 'settings'];

      for (const key of navKeys) {
        const value = getNestedValue(translations[locale], `dashboardNav.${key}`);
        expect(value, `Missing dashboardNav.${key} in ${locale}`).toBeDefined();
        expect(typeof value, `dashboardNav.${key} in ${locale} should be string`).toBe('string');
      }
    });

    // teams.roles 必须包含所有角色翻译
    it.each(locales)('%s: teams.roles should have all role translations', (locale) => {
      const roleKeys = ['owner', 'admin', 'member', 'viewer'];

      for (const key of roleKeys) {
        const value = getNestedValue(translations[locale], `teams.roles.${key}`);
        expect(value, `Missing teams.roles.${key} in ${locale}`).toBeDefined();
        expect(typeof value, `teams.roles.${key} in ${locale} should be string`).toBe('string');
      }
    });
  });

  describe('Translation value validation', () => {
    it.each(locales)('%s: all translation values should be non-empty strings or valid objects', (locale) => {
      const allKeys = getAllKeyPaths(translations[locale]);

      for (const key of allKeys) {
        const value = getNestedValue(translations[locale], key);

        if (typeof value === 'string') {
          expect(value.trim().length, `${key} in ${locale} should not be empty`).toBeGreaterThan(0);
        }
      }
    });

    it.each(locales)('%s: should not have placeholder text like TODO or FIXME', (locale) => {
      const allKeys = getAllKeyPaths(translations[locale]);

      for (const key of allKeys) {
        const value = getNestedValue(translations[locale], key);

        if (typeof value === 'string') {
          expect(value.toUpperCase()).not.toContain('TODO');
          expect(value.toUpperCase()).not.toContain('FIXME');
          expect(value).not.toContain('XXX');
        }
      }
    });
  });

  describe('Locale config consistency', () => {
    it('配置的每个 locale 都有可解析的 ui-messages 文件（en/zh/de 在主包，hi 在 -hi 包）', () => {
      // 真相源 = @aster-cloud/ui-messages(en/zh/de) + @aster-cloud/ui-messages-hi(hi)。
      // cloud 不再手维护 messages/*。校验每个配置 locale 在对应包内都有全码 id 文件。
      const FULL: Record<string, { dir: string; id: string }> = {
        en: { dir: messagesDir, id: 'en-US' },
        zh: { dir: messagesDir, id: 'zh-CN' },
        de: { dir: messagesDir, id: 'de-DE' },
        hi: {
          dir: path.join(process.cwd(), 'node_modules', '@aster-cloud', 'ui-messages-hi'),
          id: 'hi-IN',
        },
      };
      for (const loc of configLocales) {
        const entry = FULL[loc];
        expect(entry, `locale ${loc} 未映射到 ui-messages 包`).toBeDefined();
        const filePath = path.join(entry.dir, `${entry.id}.json`);
        expect(fs.existsSync(filePath), `缺文件 ${filePath}`).toBe(true);
      }
    });

    it('完整翻译集是配置 locales 的子集（部分翻译语言除外）', () => {
      for (const l of locales) {
        expect(configLocales).toContain(l);
      }
    });
  });
});
