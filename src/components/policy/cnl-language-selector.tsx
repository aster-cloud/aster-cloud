'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { SupportedLocale } from '@/data/policy-examples';

interface LanguageOption {
  locale: SupportedLocale;
  flag: string;
  label: string;
  shortLabel: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { locale: 'en-US', flag: '🇺🇸', label: 'English', shortLabel: 'EN' },
  { locale: 'zh-CN', flag: '🇨🇳', label: '中文', shortLabel: '中' },
  { locale: 'de-DE', flag: '🇩🇪', label: 'Deutsch', shortLabel: 'DE' },
];

interface CNLLanguageSelectorProps {
  value: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  label?: string;
  className?: string;
  compact?: boolean;
}

export function CNLLanguageSelector({
  value,
  onChange,
  label,
  className = '',
  compact = false,
}: CNLLanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = LANGUAGE_OPTIONS.find((opt) => opt.locale === value) || LANGUAGE_OPTIONS[0];

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (locale: SupportedLocale) => {
      onChange(locale);
      setIsOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 ${
          compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2 text-sm'
        }`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="text-base" role="img" aria-label={selectedOption.label}>
            {selectedOption.flag}
          </span>
          {!compact && <span className="text-gray-700">{selectedOption.label}</span>}
          {compact && <span className="text-gray-700 font-medium">{selectedOption.shortLabel}</span>}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-20 mt-1 w-40 origin-top-left rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
          role="listbox"
        >
          <div className="py-1">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.locale}
                type="button"
                onClick={() => handleSelect(option.locale)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  option.locale === value
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
                role="option"
                aria-selected={option.locale === value}
              >
                <span className="text-base" role="img" aria-label={option.label}>
                  {option.flag}
                </span>
                <span className="flex-1 text-left">{option.label}</span>
                {option.locale === value && (
                  <svg className="h-4 w-4 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 用于编辑器工具栏的紧凑版语言选择器
 */
export function CNLLanguageSelectorCompact({
  value,
  onChange,
}: {
  value: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
}) {
  return (
    <CNLLanguageSelector value={value} onChange={onChange} compact={true} />
  );
}

/**
 * 语言选择器 Hook - 管理 CNL 语言状态
 */
export function useCNLLanguage(initialLocale?: SupportedLocale) {
  const [cnlLocale, setCnlLocale] = useState<SupportedLocale>(initialLocale || 'en-US');
  return { cnlLocale, setCnlLocale };
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): LanguageOption[] {
  return LANGUAGE_OPTIONS;
}

/**
 * 获取语言显示信息
 */
export function getLanguageInfo(locale: SupportedLocale): LanguageOption | undefined {
  return LANGUAGE_OPTIONS.find((opt) => opt.locale === locale);
}
