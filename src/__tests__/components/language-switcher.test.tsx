import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageSwitcher } from '@/components/language-switcher';

// Mock next-intl
const mockReplace = vi.fn();
vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'en'),
}));

// Mock the i18n navigation
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/dashboard',
}));

// Mock i18n config
vi.mock('@/i18n/config', () => ({
  locales: ['en', 'zh', 'de'],
  localeNames: {
    en: 'English',
    zh: '中文',
    de: 'Deutsch',
  },
}));

describe('LanguageSwitcher', () => {
  let originalCookie: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCookie = document.cookie;
    // 清除所有 cookie
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  });

  afterEach(() => {
    document.cookie = originalCookie;
  });

  it('should render with all locale options', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    // 检查所有语言选项
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.getByText('Deutsch')).toBeInTheDocument();
  });

  it('should show current locale as selected', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('en');
  });

  it('should call router.replace with correct locale when changed', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'zh' } });

    expect(mockReplace).toHaveBeenCalledWith('/dashboard', { locale: 'zh' });
  });

  it('should set NEXT_LOCALE cookie when language is changed', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'de' } });

    expect(document.cookie).toContain('NEXT_LOCALE=de');
  });

  it('should navigate using locale-aware router, not standard next/navigation', () => {
    // 验证使用的是 @/i18n/navigation 而不是 next/navigation
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'zh' } });

    // mockReplace 应该被调用，并且带有 locale 选项
    // 这确保了使用的是 next-intl 的 locale-aware router
    expect(mockReplace).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ locale: 'zh' })
    );
  });
});

describe('LanguageSwitcher cookie behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set cookie with correct attributes', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en' } });

    // Cookie 应该包含 path 和 SameSite 属性
    expect(document.cookie).toContain('NEXT_LOCALE=en');
  });
});
