import { getTranslations } from 'next-intl/server';
import { LoginContent } from './login-content';

export default async function LoginPage() {
  const t = await getTranslations('auth.login');
  const tNav = await getTranslations('nav');

  // 预渲染所有翻译字符串
  const translations = {
    brand: tNav('brand'),
    title: t('title'),
    noAccount: t('noAccount'),
    startTrial: t('startTrial'),
    orContinueWith: t('orContinueWith'),
    email: t('email'),
    password: t('password'),
    forgotPassword: t('forgotPassword'),
    signIn: t('signIn'),
    errors: {
      generic: t('errors.generic'),
      rateLimited: t.raw('errors.rateLimited'),
      accountLocked: t.raw('errors.accountLocked'),
      accountLockedGeneric: t('errors.accountLockedGeneric'),
      captchaFailed: t('errors.captchaFailed'),
      verificationFailed: t('errors.verificationFailed'),
      invalidCredentials: t('errors.invalidCredentials'),
      invalidCredentialsWithAttempts: t.raw('errors.invalidCredentialsWithAttempts'),
    },
  };

  // 获取 Turnstile Site Key（服务端安全传递）
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

  return <LoginContent translations={translations} turnstileSiteKey={turnstileSiteKey} />;
}
