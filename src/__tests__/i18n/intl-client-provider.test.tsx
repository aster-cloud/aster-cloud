/**
 * IntlClientProvider 客户端 fail-open 契约测试。
 *
 * 核心：客户端组件（useTranslations）遇到**缺失 key** 时，必须显示 key 路径而非抛
 * MISSING_MESSAGE 崩页。这是生产 bug 的治本修复——裸 NextIntlClientProvider 不传
 * getMessageFallback 时，客户端缺 key 会白屏崩溃（服务端却因 request.ts fallback 不崩）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { IntlClientProvider } from '@/i18n/intl-client-provider';

function Consumer() {
  const t = useTranslations('settings.aiKeysPage');
  // 存在的 key + 故意缺失的 key（模拟 npm 包滞后未同步新 key 的生产场景）
  return (
    <div>
      <span data-testid="present">{t('present')}</span>
      <span data-testid="missing">{t('expiresAt')}</span>
    </div>
  );
}

describe('IntlClientProvider — 客户端 fail-open', () => {
  it('缺失 key → 显示 key 路径（不抛 MISSING_MESSAGE，不崩页）', () => {
    // messages 只含 present，故意不含 expiresAt（复现 ui-messages 包滞后）
    const messages = { settings: { aiKeysPage: { present: '存在的文案' } } };

    render(
      <IntlClientProvider locale="zh" messages={messages}>
        <Consumer />
      </IntlClientProvider>,
    );

    expect(screen.getByTestId('present').textContent).toBe('存在的文案');
    // 治本契约：缺 key 降级为 namespace.key 路径，而非抛错
    expect(screen.getByTestId('missing').textContent).toBe('settings.aiKeysPage.expiresAt');
  });
});
