'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: (error: string) => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact';
          language?: string;
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileProps {
  /** Site Key（从环境变量获取） */
  siteKey: string;
  /** 验证成功回调 */
  onVerify: (token: string) => void;
  /** 验证过期回调 */
  onExpire?: () => void;
  /** 验证失败回调 */
  onError?: (error: string) => void;
  /** 主题 */
  theme?: 'light' | 'dark' | 'auto';
  /** 尺寸 */
  size?: 'normal' | 'compact';
  /** 语言（如 'zh-CN', 'en', 'de'） */
  language?: string;
  /** 自定义类名 */
  className?: string;
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/**
 * Cloudflare Turnstile CAPTCHA 组件
 *
 * 用于防止恶意注册和自动化攻击。
 */
export function Turnstile({
  siteKey,
  onVerify,
  onExpire,
  onError,
  theme = 'auto',
  size = 'normal',
  language,
  className = '',
}: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 加载 Turnstile 脚本
  useEffect(() => {
    // 检查是否已加载
    if (window.turnstile) {
      setIsLoaded(true);
      return;
    }

    // 检查是否正在加载
    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => setIsLoaded(true));
      existingScript.addEventListener('error', () => setLoadError('Failed to load Turnstile'));
      return;
    }

    // 加载脚本
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    script.onload = () => setIsLoaded(true);
    script.onerror = () => setLoadError('Failed to load Turnstile');

    document.head.appendChild(script);

    return () => {
      // 清理：不移除脚本，其他组件可能需要
    };
  }, []);

  // 渲染 Turnstile widget
  useEffect(() => {
    if (!isLoaded || !containerRef.current || !window.turnstile) return;

    // 避免重复渲染
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
    }

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: onVerify,
        'expired-callback': onExpire,
        'error-callback': onError,
        theme,
        size,
        language,
      });
    } catch (error) {
      console.error('[Turnstile] 渲染失败:', error);
      setLoadError('Failed to render Turnstile');
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 忽略清理错误
        }
        widgetIdRef.current = null;
      }
    };
  }, [isLoaded, siteKey, onVerify, onExpire, onError, theme, size, language]);

  // 重置方法（可通过 ref 调用）
  const reset = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  if (loadError) {
    return (
      <div className={`text-sm text-red-600 ${className}`}>
        {loadError}
      </div>
    );
  }

  if (!siteKey) {
    // 未配置时显示占位符（开发环境）
    return (
      <div className={`text-sm text-gray-500 italic ${className}`}>
        CAPTCHA disabled (development mode)
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} data-turnstile-reset={reset} />
  );
}

/**
 * 用于开发环境的模拟 Turnstile 组件
 */
export function TurnstilePlaceholder({
  onVerify,
  className = '',
}: {
  onVerify: (token: string) => void;
  className?: string;
}) {
  return (
    <div className={`border border-dashed border-gray-300 rounded p-4 text-center ${className}`}>
      <p className="text-sm text-gray-500 mb-2">CAPTCHA (开发模式)</p>
      <button
        type="button"
        onClick={() => onVerify('dev-token-' + Date.now())}
        className="text-xs text-indigo-600 hover:text-indigo-500"
      >
        点击模拟验证
      </button>
    </div>
  );
}
