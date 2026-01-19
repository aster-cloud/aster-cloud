import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { db, policies } from '@/lib/prisma';
import { eq, and } from 'drizzle-orm';
import { ExecutePolicyContent } from './execute-policy-content';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

export default async function ExecutePolicyPage({ params }: PageProps) {
  const { id, locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  // 验证策略存在且属于当前用户
  const policy = await db.query.policies.findFirst({
    where: and(eq(policies.id, id), eq(policies.userId, session.user.id)),
    columns: { id: true },
  });

  if (!policy) {
    notFound();
  }

  return <ExecutePolicyContent policyId={id} locale={locale} />;
}
