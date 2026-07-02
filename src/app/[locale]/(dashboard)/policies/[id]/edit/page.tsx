import { getTranslations } from 'next-intl/server';
import { redirect, notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db, policies } from '@/lib/prisma';
import { eq, and } from 'drizzle-orm';
import { isPolicyFrozen } from '@/lib/policy-freeze';
import { EditPolicyContent } from './edit-policy-content';
import { getStructuralAliasGrant } from '@/lib/structural-alias-grants';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

export default async function EditPolicyPage({ params }: PageProps) {
  const { id, locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }
  const t = await getTranslations('policies');

  // 获取策略详情（只能编辑自己的策略）
  const policyData = await db.query.policies.findFirst({
    where: and(eq(policies.id, id), eq(policies.userId, session.user.id)),
    columns: {
      id: true,
      name: true,
      description: true,
      content: true,
      isPublic: true,
      groupId: true,
    },
  });

  if (!policyData) {
    notFound();
  }

  // 冻结策略只读：套餐降级超限后该策略被冻结，不可编辑。
  // 入口处服务端拦截，避免用户进编辑器改完后才在保存时被 API 403 拒绝。
  const freeze = await isPolicyFrozen(session.user.id, id);
  if (freeze.isFrozen) {
    redirect(`/${locale}/policies/${id}?frozen=1`);
  }
  const allowStructuralAliases = await getStructuralAliasGrant(session.user.id);

  // 序列化策略数据
  const policy = {
    id: policyData.id,
    name: policyData.name,
    description: policyData.description,
    content: policyData.content,
    isPublic: policyData.isPublic,
    groupId: policyData.groupId,
  };

  // 预渲染所有翻译字符串
  const translations = {
    form: {
      editTitle: t('form.editTitle'),
      editSubtitle: t('form.editSubtitle'),
      name: t('form.name'),
      namePlaceholder: t('form.namePlaceholder'),
      description: t('form.description'),
      descriptionPlaceholder: t('form.descriptionPlaceholder'),
      content: t('form.content'),
      contentPlaceholder: t('form.contentPlaceholder'),
      contentHelp: t('form.contentHelp'),
      isPublic: t('form.isPublic'),
      cancel: t('form.cancel'),
      save: t('form.save'),
      saving: t('form.saving'),
      failedToUpdate: t('form.failedToUpdate'),
    },
  };

  return (
    <EditPolicyContent
      policy={policy}
      translations={translations}
      locale={locale}
      allowStructuralAliases={allowStructuralAliases}
    />
  );
}
