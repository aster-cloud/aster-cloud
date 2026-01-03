import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { listApiKeys } from '@/lib/api-keys';
import { ApiKeysContent } from './api-keys-content';

export default async function ApiKeysPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const t = await getTranslations('settings.apiKeys');
  const tNav = await getTranslations('dashboardNav');

  // 获取 API keys 列表
  const keys = await listApiKeys(session.user.id);

  // 序列化数据以便传递给客户端组件
  const apiKeys = keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt?.toISOString() ?? null,
  }));

  // 预渲染所有翻译字符串
  const translations = {
    breadcrumb: t('breadcrumb'),
    title: t('title'),
    subtitle: t('subtitle'),
    keyCreated: t('keyCreated'),
    copyWarning: t('copyWarning'),
    copy: t('copy'),
    dismiss: t('dismiss'),
    createNew: t('createNew'),
    keyPlaceholder: t('keyPlaceholder'),
    creating: t('creating'),
    createKey: t('createKey'),
    enterName: t('enterName'),
    confirmRevoke: t('confirmRevoke'),
    yourKeys: t('yourKeys'),
    noKeys: t('noKeys'),
    name: t('name'),
    key: t('key'),
    lastUsed: t('lastUsed'),
    created: t('created'),
    actions: t('actions'),
    never: t('never'),
    revoke: t('revoke'),
    usageExample: t('usageExample'),
    usageDescription: t('usageDescription'),
    examples: {
      getPolicyId: t('examples.getPolicyId'),
      getPolicyIdDesc: t('examples.getPolicyIdDesc'),
      executePolicy: t('examples.executePolicy'),
      executePolicyDesc: t('examples.executePolicyDesc'),
      listPolicies: t('examples.listPolicies'),
      listPoliciesDesc: t('examples.listPoliciesDesc'),
      responseExample: t('examples.responseExample'),
      responseExampleDesc: t('examples.responseExampleDesc'),
      errorHandling: t('examples.errorHandling'),
      errorHandlingDesc: t('examples.errorHandlingDesc'),
      error401: t('examples.error401'),
      error403: t('examples.error403'),
      error404: t('examples.error404'),
      error429: t('examples.error429'),
    },
    nav: {
      settings: tNav('settings'),
    },
  };

  return (
    <ApiKeysContent
      initialApiKeys={apiKeys}
      translations={translations}
    />
  );
}
