import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
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
  const policy = await prisma.policy.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
    select: { id: true },
  });

  if (!policy) {
    notFound();
  }

  return <ExecutePolicyContent policyId={id} locale={locale} />;
}
