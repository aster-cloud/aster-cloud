/**
 * Admin tool: 列出 riskTier > 0 用户，支持手动覆盖。
 *
 * 路由保护：server-side admin 判定不通过 → notFound（不暴露页面存在）。
 */
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isAdminFromSession } from '@/lib/admin-auth';
import { RiskTierAdminContent } from './risk-tier-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

export default async function RiskTierAdminPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await isAdminFromSession();
  if (!admin) {
    notFound();
  }

  return <RiskTierAdminContent />;
}
