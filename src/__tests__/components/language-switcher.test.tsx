import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageSwitcher } from '@/components/language-switcher';

// Mock next-intl
const mockUseLocale = vi.fn(() => 'en');
vi.mock('next-intl', () => ({
  useLocale: () => mockUseLocale(),
  // 简化的 useTranslations：直接回显 key + 占位符
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (!vars) return key;
    return key + '(' + Object.values(vars).join(',') + ')';
  },
}));

// Mock the i18n navigation
const mockReplace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/dashboard',
}));

// Mock i18n config
vi.mock('@/i18n/config', () => ({
  locales: ['en', 'zh', 'de'],
  defaultLocale: 'en',
  localeNames: {
    en: 'English',
    zh: '中文',
    de: 'Deutsch',
  },
}));

// Mock useAvailableLexicons —— 默认所有三种语言都"后端可用"
const mockHook = vi.fn(() => ({
  lexicons: [
    { id: 'en-US', name: 'English', direction: 'ltr' as const },
    { id: 'zh-CN', name: '中文', direction: 'ltr' as const },
    { id: 'de-DE', name: 'Deutsch', direction: 'ltr' as const },
  ],
  loading: false,
  connected: true,
  error: null,
}));
vi.mock('@/hooks/useAvailableLexicons', () => ({
  useAvailableLexicons: () => mockHook(),
}));

describe('LanguageSwitcher', () => {
  let originalCookie: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLocale.mockReturnValue('en');
    originalCookie = document.cookie;
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
    // R4: 仅清 toast key，不动其他测试的 sessionStorage
    sessionStorage.removeItem('aster:lang-switcher:toast');
  });

  afterEach(() => {
    document.cookie = originalCookie;
    sessionStorage.removeItem('aster:lang-switcher:toast');
  });

  it('should render with all backend-available locale options', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
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

  it('only shows intersection of compiled locales and backend lexicons', () => {
    // 后端仅返回 en + zh（de 包被拔了）
    mockHook.mockReturnValueOnce({
      lexicons: [
        { id: 'en-US', name: 'English', direction: 'ltr' as const },
        { id: 'zh-CN', name: '中文', direction: 'ltr' as const },
      ],
      loading: false,
      connected: true,
      error: null,
    });
    render(<LanguageSwitcher />);
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.queryByText('Deutsch')).toBeNull();
  });

  it('auto-redirects to default locale when current locale becomes unavailable', async () => {
    // 当前 locale 是 zh，但后端只返回 en
    mockUseLocale.mockReturnValue('zh');
    mockHook.mockReturnValueOnce({
      lexicons: [
        { id: 'en-US', name: 'English', direction: 'ltr' as const },
      ],
      loading: false,
      connected: true,
      error: null,
    });
    render(<LanguageSwitcher />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard', { locale: 'en' });
    });
  });

  it('writes toast message to sessionStorage when current locale becomes unavailable', async () => {
    mockUseLocale.mockReturnValue('zh');
    mockHook.mockReturnValueOnce({
      lexicons: [
        { id: 'en-US', name: 'English', direction: 'ltr' as const },
      ],
      loading: false,
      connected: true,
      error: null,
    });
    sessionStorage.removeItem('aster:lang-switcher:toast');
    render(<LanguageSwitcher />);
    await waitFor(() => {
      const stored = sessionStorage.getItem('aster:lang-switcher:toast');
      expect(stored).toBeTruthy();
      expect(stored).toContain('languageUnavailable');
      expect(stored).toContain('switchedTo');
    });
  });

  it('reads toast from sessionStorage on mount and clears it', async () => {
    // 模拟前一次 unmount 已写入的 toast
    sessionStorage.setItem('aster:lang-switcher:toast', 'sticky toast contents');
    render(<LanguageSwitcher />);
    const alert = await screen.findByRole('status');
    expect(alert.textContent).toBe('sticky toast contents');
    // 读完应清除，避免下次挂载重复显示
    expect(sessionStorage.getItem('aster:lang-switcher:toast')).toBeNull();
  });

  it('does not redirect while still loading', () => {
    mockUseLocale.mockReturnValue('zh');
    mockHook.mockReturnValueOnce({
      lexicons: [],
      loading: true,
      connected: false,
      error: null,
    });
    render(<LanguageSwitcher />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
