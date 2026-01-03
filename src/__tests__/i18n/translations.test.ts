import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// 读取所有翻译文件
const messagesDir = path.join(process.cwd(), 'messages');
const locales = ['en', 'zh', 'de'] as const;

// 动态加载翻译文件
function loadTranslations(locale: string): Record<string, unknown> {
  const filePath = path.join(messagesDir, `${locale}.json`);
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
    it.each(locales)('should have %s.json translation file', (locale) => {
      const filePath = path.join(messagesDir, `${locale}.json`);
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
    it('should have matching locales in config and translation files', () => {
      const filesInDir = fs.readdirSync(messagesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
        .sort();

      const expectedLocales = [...locales].sort();

      expect(filesInDir).toEqual(expectedLocales);
    });
  });
});
