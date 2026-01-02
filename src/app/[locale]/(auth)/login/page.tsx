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
  };

  return <LoginContent translations={translations} />;
}
